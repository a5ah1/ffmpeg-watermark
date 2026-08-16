(function (global) {
  "use strict";

  var WM = global.WM || (global.WM = {});

  WM.MARGIN = 24;
  WM.SCALE_MIN = 0.01;
  WM.SCALE_MAX = 8;
  WM.SCALE_DECIMALS = 3;
  WM.OPACITY_DEFAULT = 0.8;
  WM.CRF_DEFAULT = 23;
  WM.CRF_MIN = 0;
  WM.CRF_MAX = 51;
  WM.PRESETS = [
    "ultrafast", "superfast", "veryfast", "faster", "fast",
    "medium", "slow", "slower", "veryslow"
  ];
  WM.BLENDS = [
    { id: "normal", label: "Normal (overlay)", css: "normal", ffmpeg: null },
    { id: "multiply", label: "Multiply", css: "multiply", ffmpeg: "multiply" },
    { id: "screen", label: "Screen", css: "screen", ffmpeg: "screen" },
    { id: "overlay", label: "Overlay (blend)", css: "overlay", ffmpeg: "overlay" },
    { id: "addition", label: "Addition", css: "plus-lighter", ffmpeg: "addition" },
    { id: "darken", label: "Darken", css: "darken", ffmpeg: "darken" },
    { id: "lighten", label: "Lighten", css: "lighten", ffmpeg: "lighten" }
  ];
  WM.ACCEPT_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
  WM.ACCEPT_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  WM.SESSION_KEY = "wm.v1";
  WM.FPS_PRESETS = ["24", "25", "30", "50", "60"];

  var state = null;
  var listeners = [];

  WM.AAC_VBR = {
    aac: { min: 0.1, max: 2, step: 0.1, def: 2, hint: "0.1–2 · experimental · 2 is high quality" },
    libfdk_aac: { min: 1, max: 5, step: 1, def: 3, hint: "1–5 · 1 lowest, 5 highest · Fraunhofer" }
  };

  WM.createEncodeState = function () {
    return {
      crf: WM.CRF_DEFAULT,
      preset: "medium",
      tune: "",
      fpsPreset: "",
      audio: "copy",
      audioMode: "vbr",
      audioBitrate: "192k",
      audioQuality: "",
      inPoint: "",
      outPoint: "",
      stripMetadata: false,
      metaTitle: "",
      metaDescription: "",
      metaComment: "",
      metaYear: ""
    };
  };

  function createInitialState() {
    return {
      frame: null,
      watermark: null,
      frameName: "",
      wmName: "",
      x: 0,
      y: 0,
      scale: 1,
      opacity: WM.OPACITY_DEFAULT,
      blend: "normal",
      videoName: "",
      outputName: "",
      encode: WM.createEncodeState(),
      selected: false,
      debug: false
    };
  }

  WM.createInitialState = createInitialState;

  WM.getState = function () {
    if (!state) state = createInitialState();
    return state;
  };

  WM.setState = function (partial) {
    if (!state) state = createInitialState();
    var key;
    for (key in partial) {
      if (Object.prototype.hasOwnProperty.call(partial, key)) {
        state[key] = partial[key];
      }
    }
    if (state.debug && typeof console !== "undefined" && console.debug) {
      console.debug("setState", partial, state);
    }
    for (var i = 0; i < listeners.length; i++) listeners[i](state);
    return state;
  };

  WM.patchEncode = function (partial) {
    var cur = (WM.getState().encode) || WM.createEncodeState();
    var next = WM.createEncodeState();
    var key;
    for (key in cur) {
      if (Object.prototype.hasOwnProperty.call(cur, key)) next[key] = cur[key];
    }
    if (partial) {
      for (key in partial) {
        if (Object.prototype.hasOwnProperty.call(partial, key)) next[key] = partial[key];
      }
    }
    return WM.setState({ encode: next });
  };

  WM.subscribe = function (fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (item) { return item !== fn; });
    };
  };

  WM.roundInt = function (n) {
    if (!Number.isFinite(n)) return 0;
    return Math.round(n);
  };

  WM.clampScale = function (n) {
    if (!Number.isFinite(n)) return WM.SCALE_MIN;
    var clamped = Math.min(WM.SCALE_MAX, Math.max(WM.SCALE_MIN, n));
    var factor = Math.pow(10, WM.SCALE_DECIMALS);
    return Math.round(clamped * factor) / factor;
  };

  WM.clampOpacity = function (n) {
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  };

  WM.clampCrf = function (n) {
    if (!Number.isFinite(n)) return WM.CRF_DEFAULT;
    return Math.min(WM.CRF_MAX, Math.max(WM.CRF_MIN, Math.round(n)));
  };

  WM.normalizePreset = function (value) {
    return WM.PRESETS.indexOf(value) >= 0 ? value : "medium";
  };

  WM.normalizeTune = function (value) {
    return value === "film" || value === "animation" || value === "grain" ? value : "";
  };

  WM.normalizeAudio = function (value) {
    if (value === "none" || value === "aac" || value === "libfdk_aac") return value;
    return "copy";
  };

  WM.audioNeedsEncode = function (value) {
    var audio = WM.normalizeAudio(value);
    return audio === "aac" || audio === "libfdk_aac";
  };

  WM.normalizeAudioMode = function (value) {
    return value === "cbr" ? "cbr" : "vbr";
  };

  WM.clampAudioQuality = function (codec, value) {
    var cfg = WM.AAC_VBR[codec];
    if (!cfg) return "";
    if (value === "" || value == null) return cfg.def;
    var n = typeof value === "number" ? value : parseFloat(value);
    if (!Number.isFinite(n)) return cfg.def;
    if (n < cfg.min) return cfg.min;
    if (n > cfg.max) return cfg.max;
    if (cfg.step === 1) return Math.round(n);
    return Math.round(n * 10) / 10;
  };

  WM.scaledSize = function (nativeW, nativeH, scale) {
    return {
      w: Math.max(1, WM.roundInt(nativeW * scale)),
      h: Math.max(1, WM.roundInt(nativeH * scale))
    };
  };

  WM.getContainedRect = function (stageWidth, stageHeight, frameW, frameH) {
    if (!stageWidth || !stageHeight || !frameW || !frameH) {
      return { left: 0, top: 0, width: 0, height: 0, viewScale: 1 };
    }
    var viewScale = Math.min(stageWidth / frameW, stageHeight / frameH);
    var width = frameW * viewScale;
    var height = frameH * viewScale;
    return {
      left: (stageWidth - width) / 2,
      top: (stageHeight - height) / 2,
      width: width,
      height: height,
      viewScale: viewScale
    };
  };

  WM.mapPointerToSource = function (clientX, clientY, stageRect, contained, frameW, frameH) {
    var scale = contained.viewScale || 1;
    return {
      x: (clientX - stageRect.left - contained.left) / scale,
      y: (clientY - stageRect.top - contained.top) / scale
    };
  };

  WM.defaultPlacement = function (frameW, frameH, nativeW, nativeH, margin) {
    if (margin == null) margin = WM.MARGIN;
    var scale = 1;
    var maxW = frameW - 2 * margin;
    var maxH = frameH - 2 * margin;
    var exceedsMax = nativeW > maxW || nativeH > maxH;
    var exceedsFrame = nativeW > frameW || nativeH > frameH;

    if (exceedsMax && maxW > 0 && maxH > 0) {
      scale = WM.clampScale(Math.min(maxW / nativeW, maxH / nativeH, 1));
    } else if (exceedsFrame) {
      scale = WM.clampScale(Math.min(frameW / nativeW, frameH / nativeH, 1));
      var fit = WM.scaledSize(nativeW, nativeH, scale);
      return {
        x: WM.roundInt((frameW - fit.w) / 2),
        y: WM.roundInt((frameH - fit.h) / 2),
        scale: scale
      };
    }

    var size = WM.scaledSize(nativeW, nativeH, scale);
    var x = frameW - size.w - margin;
    var y = frameH - size.h - margin;
    if (x < 0 || y < 0) {
      return {
        x: WM.roundInt((frameW - size.w) / 2),
        y: WM.roundInt((frameH - size.h) / 2),
        scale: scale
      };
    }
    return { x: x, y: y, scale: scale };
  };

  WM.presetPosition = function (id, frameW, frameH, sw, sh, margin) {
    if (margin == null) margin = WM.MARGIN;
    var m = margin;
    var cx = WM.roundInt((frameW - sw) / 2);
    var cy = WM.roundInt((frameH - sh) / 2);
    var right = frameW - sw - m;
    var bottom = frameH - sh - m;
    switch (id) {
      case "TL": return { x: m, y: m };
      case "TC": return { x: cx, y: m };
      case "TR": return { x: right, y: m };
      case "ML": return { x: m, y: cy };
      case "C": return { x: cx, y: cy };
      case "MR": return { x: right, y: cy };
      case "BL": return { x: m, y: bottom };
      case "BC": return { x: cx, y: bottom };
      case "BR": return { x: right, y: bottom };
      default: return { x: right, y: bottom };
    }
  };

  function extensionOf(name) {
    var base = String(name || "").toLowerCase();
    var slash = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
    if (slash >= 0) base = base.slice(slash + 1);
    var dot = base.lastIndexOf(".");
    return dot >= 0 ? base.slice(dot) : "";
  }

  WM.acceptFile = function (file) {
    if (!file || !file.name) {
      return { ok: false, reason: "Unsupported file (use PNG, JPEG, WebP, GIF)." };
    }
    var mime = String(file.type || "").toLowerCase();
    var ext = extensionOf(file.name);
    if (mime === "image/svg+xml" || ext === ".svg") {
      return { ok: false, reason: "Unsupported file (use PNG, JPEG, WebP, GIF)." };
    }
    if (mime.indexOf("video/") === 0) {
      return { ok: false, reason: "Unsupported file (use PNG, JPEG, WebP, GIF)." };
    }
    var mimeOk = WM.ACCEPT_MIME.indexOf(mime) !== -1;
    var extOk = WM.ACCEPT_EXT.indexOf(ext) !== -1;
    if (mimeOk || extOk) return { ok: true };
    return { ok: false, reason: "Unsupported file (use PNG, JPEG, WebP, GIF)." };
  };

  WM.basename = function (name) {
    var value = String(name || "");
    var parts = value.split(/[/\\]/);
    return parts[parts.length - 1] || value;
  };

  WM.revokeUrl = function (url) {
    if (!url || String(url).indexOf("blob:") !== 0) return;
    try {
      if (typeof URL !== "undefined" && URL.revokeObjectURL) URL.revokeObjectURL(url);
    } catch (err) {
      /* ignore */
    }
  };

  WM.normalizeBlend = function (value) {
    var i;
    for (i = 0; i < WM.BLENDS.length; i++) {
      if (WM.BLENDS[i].id === value) return value;
    }
    return "normal";
  };

  WM.normalizeFpsPreset = function (value) {
    var s = String(value == null ? "" : value);
    return WM.FPS_PRESETS.indexOf(s) >= 0 ? s : "";
  };

  function copyEncode(enc) {
    var next = WM.createEncodeState();
    if (!enc) return next;
    var key;
    for (key in next) {
      if (Object.prototype.hasOwnProperty.call(enc, key)) next[key] = enc[key];
    }
    next.crf = WM.clampCrf(next.crf);
    next.preset = WM.normalizePreset(next.preset);
    next.tune = WM.normalizeTune(next.tune);
    next.fpsPreset = WM.normalizeFpsPreset(next.fpsPreset);
    next.audio = WM.normalizeAudio(next.audio);
    next.audioMode = WM.normalizeAudioMode(next.audioMode);
    next.audioBitrate = String(next.audioBitrate == null ? "192k" : next.audioBitrate);
    next.audioQuality = next.audioQuality == null ? "" : next.audioQuality;
    next.inPoint = String(next.inPoint == null ? "" : next.inPoint);
    next.outPoint = String(next.outPoint == null ? "" : next.outPoint);
    next.stripMetadata = !!next.stripMetadata;
    next.metaTitle = String(next.metaTitle == null ? "" : next.metaTitle);
    next.metaDescription = String(next.metaDescription == null ? "" : next.metaDescription);
    next.metaComment = String(next.metaComment == null ? "" : next.metaComment);
    next.metaYear = String(next.metaYear == null ? "" : next.metaYear);
    return next;
  }

  WM.snapshotSession = function (state) {
    var src = state || {};
    var frame = src.frame && src.frame.width && src.frame.height
      ? { width: src.frame.width, height: src.frame.height }
      : null;
    var watermark = src.watermark && src.watermark.nativeWidth && src.watermark.nativeHeight
      ? { nativeWidth: src.watermark.nativeWidth, nativeHeight: src.watermark.nativeHeight }
      : null;
    return {
      v: 1,
      frameName: String(src.frameName || ""),
      wmName: String(src.wmName || ""),
      x: WM.roundInt(src.x),
      y: WM.roundInt(src.y),
      scale: WM.clampScale(src.scale),
      opacity: WM.clampOpacity(src.opacity),
      blend: WM.normalizeBlend(src.blend),
      videoName: String(src.videoName || ""),
      outputName: String(src.outputName || ""),
      encode: copyEncode(src.encode),
      debug: !!src.debug,
      frame: frame,
      watermark: watermark
    };
  };

  WM.stateFromSession = function (data, images) {
    var next = createInitialState();
    if (!data || data.v !== 1) return next;
    next.frameName = String(data.frameName || "");
    next.wmName = String(data.wmName || "");
    next.x = WM.roundInt(data.x);
    next.y = WM.roundInt(data.y);
    next.scale = WM.clampScale(data.scale);
    next.opacity = WM.clampOpacity(data.opacity);
    next.blend = WM.normalizeBlend(data.blend);
    next.videoName = String(data.videoName || "");
    next.outputName = String(data.outputName || "");
    next.encode = copyEncode(data.encode);
    next.debug = !!data.debug;
    next.selected = false;
    next.frame = null;
    next.watermark = null;
    if (images && images.frame && data.frame) {
      next.frame = {
        width: data.frame.width,
        height: data.frame.height,
        objectUrl: images.frame
      };
    }
    if (images && images.watermark && data.watermark) {
      next.watermark = {
        nativeWidth: data.watermark.nativeWidth,
        nativeHeight: data.watermark.nativeHeight,
        objectUrl: images.watermark
      };
    }
    return next;
  };
})(typeof window !== "undefined" ? window : globalThis);
