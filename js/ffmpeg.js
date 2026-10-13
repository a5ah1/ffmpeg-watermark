(function (global) {
  "use strict";

  var WM = global.WM || (global.WM = {});

  function blendSpec(id) {
    var list = WM.BLENDS || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  WM.formatAa = function (opacity) {
    var n = WM.clampOpacity(opacity);
    var rounded = Math.round(n * 1000) / 1000;
    return String(rounded);
  };

  WM.needsScale = function (scale, nativeW, nativeH) {
    var size = WM.scaledSize(nativeW, nativeH, WM.clampScale(scale));
    return !(WM.clampScale(scale) === 1 && size.w === nativeW && size.h === nativeH);
  };

  WM.needsOpacity = function (opacity) {
    return WM.clampOpacity(opacity) !== 1;
  };

  WM.needsBlend = function (blend) {
    var spec = blendSpec(blend);
    return !!(spec && spec.ffmpeg);
  };

  WM.quoteArg = function (path) {
    return '"' + String(path).replace(/"/g, '\\"') + '"';
  };

  WM.intersectCrop = function (x, y, sw, sh, fw, fh) {
    var left = Math.max(0, x);
    var top = Math.max(0, y);
    var right = Math.min(fw, x + sw);
    var bottom = Math.min(fh, y + sh);
    var cropW = right - left;
    var cropH = bottom - top;
    if (cropW <= 0 || cropH <= 0) return null;
    return {
      cropX: left - x,
      cropY: top - y,
      cropW: cropW,
      cropH: cropH,
      outX: left,
      outY: top
    };
  };

  function overlayGraph(x, y, sw, sh, nativeW, nativeH, scale, opacity) {
    var parts = [];
    if (WM.needsScale(scale, nativeW, nativeH)) parts.push("scale=" + sw + ":" + sh);
    if (WM.needsOpacity(opacity)) {
      parts.push("format=rgba");
      parts.push("colorchannelmixer=aa=" + WM.formatAa(opacity));
    }
    var overlay = "overlay=x=" + x + ":y=" + y + ":format=auto";
    if (!parts.length) return "[0:v][1:v]" + overlay;
    return "[1:v]" + parts.join(",") + "[wm];[0:v][wm]" + overlay;
  }

  function blendGraph(state, sw, sh, nativeW, nativeH, crop, mode) {
    var chain = [];
    if (WM.needsScale(state.scale, nativeW, nativeH)) chain.push("scale=" + sw + ":" + sh);
    chain.push("format=rgba");
    if (WM.needsOpacity(state.opacity)) {
      chain.push("colorchannelmixer=aa=" + WM.formatAa(state.opacity));
    }
    var full = crop.cropX === 0 && crop.cropY === 0 && crop.cropW === sw && crop.cropH === sh;
    if (!full) {
      chain.push("crop=" + crop.cropW + ":" + crop.cropH + ":" + crop.cropX + ":" + crop.cropY);
    }
    return (
      "[1:v]" + chain.join(",") + ",split[wm][wmsrc];" +
      "[wmsrc]alphaextract,loop=loop=-1:size=1[maskl];" +
      "[wm]format=gbrp,loop=loop=-1:size=1[wmgl];" +
      "[0:v]split[base][bot];" +
      "[bot]crop=" + crop.cropW + ":" + crop.cropH + ":" + crop.outX + ":" + crop.outY + ":exact=1,format=gbrp[botg];" +
      "[wmgl][botg]blend=all_mode=" + mode + ":shortest=1[mix];" +
      "[mix][maskl]alphamerge=shortest=1[mixa];" +
      "[base][mixa]overlay=x=" + crop.outX + ":y=" + crop.outY + ":format=rgb:shortest=1"
    );
  }

  WM.computeFilterGraph = function (state) {
    if (!state || !state.frame || !state.watermark) {
      return { ok: false, reason: "add a frame and a watermark" };
    }
    var nativeW = state.watermark.nativeWidth;
    var nativeH = state.watermark.nativeHeight;
    var size = WM.scaledSize(nativeW, nativeH, state.scale);
    var x = WM.roundInt(state.x);
    var y = WM.roundInt(state.y);
    var filter;
    if (WM.needsBlend(state.blend)) {
      var crop = WM.intersectCrop(x, y, size.w, size.h, state.frame.width, state.frame.height);
      if (!crop) {
        filter = overlayGraph(x, y, size.w, size.h, nativeW, nativeH, state.scale, state.opacity);
      } else {
        filter = blendGraph(state, size.w, size.h, nativeW, nativeH, crop, blendSpec(state.blend).ffmpeg);
      }
    } else {
      filter = overlayGraph(x, y, size.w, size.h, nativeW, nativeH, state.scale, state.opacity);
    }
    return { ok: true, filter: filter };
  };

  function encodeOf(state) {
    return (state && state.encode) || WM.createEncodeState();
  }

  WM.formatTime = function (input) {
    if (input == null) return "";
    return String(input).trim().replace(/;/g, ":");
  };

  WM.x264ParamsForFps = function (fps) {
    var table = {
      "24": "keyint=240:aq-mode=2",
      "25": "keyint=250:aq-mode=2",
      "30": "keyint=300:aq-mode=2",
      "50": "keyint=500:aq-mode=2",
      "60": "keyint=600:aq-mode=2"
    };
    return table[String(fps || "")] || "";
  };

  WM.buildAudioFlags = function (encode) {
    var audio = WM.normalizeAudio(encode && encode.audio);
    if (audio === "none") return ["-an"];
    if (!WM.audioNeedsEncode(audio)) return ["-c:a copy"];
    var parts = ["-c:a " + audio];
    if (WM.normalizeAudioMode(encode && encode.audioMode) === "cbr") {
      var br = String((encode && encode.audioBitrate) || "").trim();
      if (br) parts.push("-b:a " + br);
    } else {
      var q = WM.clampAudioQuality(audio, encode && encode.audioQuality);
      parts.push((audio === "libfdk_aac" ? "-vbr " : "-q:a ") + q);
    }
    return parts;
  };

  WM.buildMetadataFlags = function (encode) {
    var e = encode || {};
    var parts = [];
    if (e.stripMetadata) parts.push("-map_metadata -1");
    function add(key, raw) {
      var v = String(raw || "").trim();
      if (v) parts.push("-metadata " + key + "=" + WM.quoteArg(v));
    }
    add("title", e.metaTitle);
    add("description", e.metaDescription);
    add("comment", e.metaComment);
    add("year", e.metaYear);
    return parts;
  };

  WM.encodeSummary = function (encode) {
    var e = encode || WM.createEncodeState();
    var parts = ["libx264", "CRF " + WM.clampCrf(e.crf), WM.normalizePreset(e.preset)];
    var tune = WM.normalizeTune(e.tune);
    if (tune) parts.push(tune);
    if (WM.x264ParamsForFps(e.fpsPreset)) parts.push(String(e.fpsPreset) + " fps");
    var ss = WM.formatTime(e.inPoint);
    var to = WM.formatTime(e.outPoint);
    if (ss) parts.push("-ss " + ss);
    if (to) parts.push("-to " + to);
    var audio = WM.normalizeAudio(e.audio);
    if (audio === "none") {
      parts.push("audio omit");
    } else if (WM.audioNeedsEncode(audio)) {
      if (WM.normalizeAudioMode(e.audioMode) === "cbr") {
        parts.push(audio + " CBR " + (String(e.audioBitrate || "").trim() || "default"));
      } else {
        parts.push(audio + " VBR " + WM.clampAudioQuality(audio, e.audioQuality));
      }
    } else {
      parts.push("audio copy");
    }
    if (e.stripMetadata || String(e.metaTitle || "").trim() || String(e.metaDescription || "").trim() ||
        String(e.metaComment || "").trim() || String(e.metaYear || "").trim()) {
      parts.push("meta");
    }
    return parts.join(" · ");
  };

  WM.computeCommand = function (state, filter) {
    var video = ((state && state.videoName) || "").trim() || "INPUT_VIDEO";
    var wm = ((state && state.wmName) || "").trim() || "WATERMARK";
    var out = ((state && state.outputName) || "").trim() || "OUTPUT";
    var enc = encodeOf(state);
    var parts = ["ffmpeg"];
    var ss = WM.formatTime(enc.inPoint);
    var to = WM.formatTime(enc.outPoint);
    if (ss) parts.push("-ss " + ss);
    if (to) parts.push("-to " + to);
    parts.push("-i " + WM.quoteArg(video));
    parts.push("-i " + WM.quoteArg(wm));
    parts.push("-filter_complex " + WM.quoteArg(filter));
    parts.push("-c:v libx264");
    parts.push("-crf " + WM.clampCrf(enc.crf));
    parts.push("-preset " + WM.normalizePreset(enc.preset));
    var tune = WM.normalizeTune(enc.tune);
    if (tune) parts.push("-tune " + tune);
    parts.push("-pix_fmt yuv420p");
    var xp = WM.x264ParamsForFps(enc.fpsPreset);
    if (xp) parts.push("-x264-params " + WM.quoteArg(xp));
    parts = parts.concat(WM.buildAudioFlags(enc));
    parts = parts.concat(WM.buildMetadataFlags(enc));
    parts.push(WM.quoteArg(out));
    return parts.join(" ");
  };
})(typeof window !== "undefined" ? window : globalThis);
