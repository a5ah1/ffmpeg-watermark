(function (global) {
  "use strict";

  var WM = global.WM;

  var els = {};
  var statusTimer = null;
  var transientStatus = "";
  var draggingFields = false;
  var persistTimer = null;
  var hydrating = false;
  var imageData = { frame: null, watermark: null };
  var lastSnapJson = "";
  var lastFrameData = null;
  var lastWmData = null;

  function $(id) {
    return document.getElementById(id);
  }

  function isField(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  }

  function dim(w, h) {
    return w && h ? w + " × " + h : "—";
  }

  function showStatus(text, holdMs) {
    transientStatus = text || "";
    els.status.textContent = transientStatus;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = null;
    if (holdMs && text) {
      statusTimer = setTimeout(function () {
        transientStatus = "";
        renderOutputs(WM.getState());
      }, holdMs);
    }
  }

  function sessionGet(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function sessionSet(key, value) {
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch (err) {
      return false;
    }
  }

  function sessionRemove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch (err) {
      /* ignore */
    }
  }

  function persistNow() {
    if (hydrating) return;
    var snap = WM.snapshotSession(WM.getState());
    var json = JSON.stringify(snap);
    if (json !== lastSnapJson) {
      if (sessionSet(WM.SESSION_KEY, json)) lastSnapJson = json;
    }
    if (imageData.frame !== lastFrameData) {
      if (!imageData.frame) {
        sessionRemove(WM.SESSION_KEY + ".frame");
        lastFrameData = null;
      } else if (sessionSet(WM.SESSION_KEY + ".frame", imageData.frame)) {
        lastFrameData = imageData.frame;
      } else {
        sessionRemove(WM.SESSION_KEY + ".frame");
      }
    }
    if (imageData.watermark !== lastWmData) {
      if (!imageData.watermark) {
        sessionRemove(WM.SESSION_KEY + ".wm");
        lastWmData = null;
      } else if (sessionSet(WM.SESSION_KEY + ".wm", imageData.watermark)) {
        lastWmData = imageData.watermark;
      } else {
        sessionRemove(WM.SESSION_KEY + ".wm");
      }
    }
  }

  function schedulePersist() {
    if (hydrating) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 180);
  }

  function rememberFile(file, slot) {
    if (!file || typeof FileReader === "undefined") return;
    var reader = new FileReader();
    reader.onload = function () {
      if (typeof reader.result === "string") {
        imageData[slot] = reader.result;
        persistNow();
      }
    };
    reader.readAsDataURL(file);
  }

  async function decodeStoredUrl(url) {
    if (!url) return null;
    var img = new Image();
    img.decoding = "async";
    img.src = url;
    try {
      if (img.decode) await img.decode();
      else await new Promise(function (res, rej) { img.onload = res; img.onerror = rej; });
    } catch (err) {
      return null;
    }
    if (!img.naturalWidth || !img.naturalHeight) return null;
    return { url: url, width: img.naturalWidth, height: img.naturalHeight };
  }

  async function hydrateSession() {
    var raw = sessionGet(WM.SESSION_KEY);
    if (!raw) return;
    var data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return;
    }
    if (!data || data.v !== 1) return;
    var images = {};
    var frameStored = sessionGet(WM.SESSION_KEY + ".frame");
    var wmStored = sessionGet(WM.SESSION_KEY + ".wm");
    var frameImg = data.frame ? await decodeStoredUrl(frameStored) : null;
    var wmImg = data.watermark ? await decodeStoredUrl(wmStored) : null;
    if (frameImg) {
      images.frame = frameImg.url;
      data.frame = { width: frameImg.width, height: frameImg.height };
    }
    if (wmImg) {
      images.watermark = wmImg.url;
      data.watermark = { nativeWidth: wmImg.width, nativeHeight: wmImg.height };
    }
    hydrating = true;
    WM.setState(WM.stateFromSession(data, images));
    imageData.frame = frameImg ? frameImg.url : null;
    imageData.watermark = wmImg ? wmImg.url : null;
    lastSnapJson = JSON.stringify(WM.snapshotSession(WM.getState()));
    lastFrameData = imageData.frame;
    lastWmData = imageData.watermark;
    hydrating = false;
  }

  function clearSessionStore() {
    sessionRemove(WM.SESSION_KEY);
    sessionRemove(WM.SESSION_KEY + ".frame");
    sessionRemove(WM.SESSION_KEY + ".wm");
    lastSnapJson = "";
    lastFrameData = null;
    lastWmData = null;
    imageData.frame = null;
    imageData.watermark = null;
  }

  function resetSession() {
    var state = WM.getState();
    if (state.frame) WM.revokeUrl(state.frame.objectUrl);
    if (state.watermark) WM.revokeUrl(state.watermark.objectUrl);
    clearSessionStore();
    hydrating = true;
    WM.setState(WM.createInitialState());
    hydrating = false;
    if (new URLSearchParams(window.location.search).get("debug") === "1") {
      WM.setState({ debug: true });
    }
  }

  function fullyOffFrame(state) {
    if (!state.frame || !state.watermark) return false;
    var size = WM.scaledSize(state.watermark.nativeWidth, state.watermark.nativeHeight, state.scale);
    return WM.intersectCrop(state.x, state.y, size.w, size.h, state.frame.width, state.frame.height) === null;
  }

  function renderForm(state) {
    if (document.activeElement !== els.frameName) els.frameName.value = state.frameName;
    if (document.activeElement !== els.wmName) els.wmName.value = state.wmName;
    if (document.activeElement !== els.videoName) els.videoName.value = state.videoName;
    if (document.activeElement !== els.outputName) els.outputName.value = state.outputName;
    if (document.activeElement !== els.x) els.x.value = state.frame && state.watermark ? String(state.x) : "";
    if (document.activeElement !== els.y) els.y.value = state.frame && state.watermark ? String(state.y) : "";
    if (document.activeElement !== els.scale) {
      els.scale.value = state.watermark ? String(state.scale) : "";
    }
    if (document.activeElement !== els.opacity) {
      els.opacity.value = String(Math.round(WM.clampOpacity(state.opacity) * 100));
    }
    els.opacityReadout.textContent = Math.round(WM.clampOpacity(state.opacity) * 100) + "%";
    if (document.activeElement !== els.blend) els.blend.value = state.blend;
    els.blendNote.hidden = state.blend === "normal";

    els.frameSize.textContent = state.frame ? dim(state.frame.width, state.frame.height) : "—";
    if (state.watermark) {
      var size = WM.scaledSize(state.watermark.nativeWidth, state.watermark.nativeHeight, state.scale);
      els.wmNative.textContent = dim(state.watermark.nativeWidth, state.watermark.nativeHeight);
      els.wmScaled.textContent = dim(size.w, size.h);
    } else {
      els.wmNative.textContent = "—";
      els.wmScaled.textContent = "—";
    }
    els.debug.checked = !!state.debug;

    var enc = state.encode || WM.createEncodeState();
    if (document.activeElement !== els.encodeCrf) els.encodeCrf.value = String(WM.clampCrf(enc.crf));
    if (document.activeElement !== els.encodePreset) els.encodePreset.value = WM.normalizePreset(enc.preset);
    if (document.activeElement !== els.encodeTune) els.encodeTune.value = WM.normalizeTune(enc.tune);
    if (document.activeElement !== els.encodeFps) els.encodeFps.value = WM.x264ParamsForFps(enc.fpsPreset) ? String(enc.fpsPreset) : "";
    if (document.activeElement !== els.encodeAudio) els.encodeAudio.value = WM.normalizeAudio(enc.audio);
    var audio = WM.normalizeAudio(enc.audio);
    var encodeOn = WM.audioNeedsEncode(audio);
    var mode = WM.normalizeAudioMode(enc.audioMode);
    els.encodeAudioModeRow.hidden = !encodeOn;
    els.encodeAudioBitrateField.hidden = !encodeOn || mode !== "cbr";
    els.encodeAudioQualityField.hidden = !encodeOn || mode !== "vbr";
    els.encodeAudioModeVbr.checked = mode === "vbr";
    els.encodeAudioModeCbr.checked = mode === "cbr";
    if (document.activeElement !== els.encodeAudioBitrate) {
      els.encodeAudioBitrate.value = enc.audioBitrate || "";
    }
    if (encodeOn) {
      var cfg = WM.AAC_VBR[audio];
      els.encodeAudioQuality.min = cfg.min;
      els.encodeAudioQuality.max = cfg.max;
      els.encodeAudioQuality.step = cfg.step;
      els.encodeAudioQualityHint.textContent = cfg.hint;
      if (document.activeElement !== els.encodeAudioQuality) {
        els.encodeAudioQuality.value = String(WM.clampAudioQuality(audio, enc.audioQuality));
      }
    }
    if (document.activeElement !== els.encodeIn) els.encodeIn.value = enc.inPoint || "";
    if (document.activeElement !== els.encodeTo) els.encodeTo.value = enc.outPoint || "";
    els.encodeStripMeta.checked = !!enc.stripMetadata;
    if (document.activeElement !== els.encodeMetaTitle) els.encodeMetaTitle.value = enc.metaTitle || "";
    if (document.activeElement !== els.encodeMetaYear) els.encodeMetaYear.value = enc.metaYear || "";
    if (document.activeElement !== els.encodeMetaDescription) els.encodeMetaDescription.value = enc.metaDescription || "";
    if (document.activeElement !== els.encodeMetaComment) els.encodeMetaComment.value = enc.metaComment || "";
    els.encodeSummary.textContent = WM.encodeSummary(enc);
  }

  function renderOutputs(state) {
    var result = WM.computeFilterGraph(state);
    if (!result.ok) {
      els.filterOut.value = "(add a frame and a watermark)";
      els.commandOut.value = "(add a frame and a watermark)";
    } else {
      els.filterOut.value = result.filter;
      els.commandOut.value = WM.computeCommand(state, result.filter);
    }
    if (transientStatus) {
      els.status.textContent = transientStatus;
    } else if (fullyOffFrame(state)) {
      els.status.textContent = "Watermark is fully outside the frame; FFmpeg will clip it.";
    } else {
      els.status.textContent = "";
    }
    if (state.debug && result.ok && typeof console !== "undefined" && console.debug) {
      console.debug("filter", result.filter);
      console.debug("command", els.commandOut.value);
    }
  }

  function render(state) {
    WM.renderPreview(state);
    renderForm(state);
    renderOutputs(state);
  }

  async function loadImageFile(file) {
    var verdict = WM.acceptFile(file);
    if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { toast: true });
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.decoding = "async";
    img.src = url;
    try {
      if (img.decode) await img.decode();
      else await new Promise(function (res, rej) { img.onload = res; img.onerror = rej; });
    } catch (err) {
      WM.revokeUrl(url);
      throw Object.assign(new Error("Could not decode image."), { toast: true });
    }
    var w = img.naturalWidth;
    var h = img.naturalHeight;
    if (!w || !h) {
      WM.revokeUrl(url);
      throw Object.assign(new Error("Could not decode image."), { toast: true });
    }
    return { url: url, width: w, height: h, name: file.name };
  }

  function applyFrame(loaded) {
    var prev = WM.getState();
    var prevUrl = prev.frame && prev.frame.objectUrl;
    var sameSize = prev.frame && prev.frame.width === loaded.width && prev.frame.height === loaded.height;
    var next = {
      frame: { width: loaded.width, height: loaded.height, objectUrl: loaded.url },
      frameName: loaded.name
    };
    if (prev.watermark && !sameSize) {
      var place = WM.defaultPlacement(loaded.width, loaded.height, prev.watermark.nativeWidth, prev.watermark.nativeHeight);
      next.x = place.x;
      next.y = place.y;
      next.scale = place.scale;
    }
    WM.setState(next);
    if (prevUrl && prevUrl !== loaded.url) WM.revokeUrl(prevUrl);
  }

  function applyWatermark(loaded) {
    var prev = WM.getState();
    var prevUrl = prev.watermark && prev.watermark.objectUrl;
    var next = {
      watermark: { nativeWidth: loaded.width, nativeHeight: loaded.height, objectUrl: loaded.url },
      wmName: loaded.name
    };
    if (prev.frame) {
      var place = WM.defaultPlacement(prev.frame.width, prev.frame.height, loaded.width, loaded.height);
      next.x = place.x;
      next.y = place.y;
      next.scale = place.scale;
    }
    WM.setState(next);
    if (prevUrl && prevUrl !== loaded.url) WM.revokeUrl(prevUrl);
  }

  async function ingest(file, role) {
    try {
      var loaded = await loadImageFile(file);
      if (role === "frame") {
        applyFrame(loaded);
        rememberFile(file, "frame");
      } else {
        applyWatermark(loaded);
        rememberFile(file, "watermark");
      }
    } catch (err) {
      if (WM.getState().debug && typeof console !== "undefined") console.warn(err);
      showStatus(err.message || "Could not decode image.", 4000);
    }
  }

  function bindDrop(el, roleFor) {
    if (!el) return;
    ["dragenter", "dragover", "drop"].forEach(function (type) {
      el.addEventListener(type, function (event) {
        event.preventDefault();
        if (type === "dragover" && event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        if (type !== "drop") return;
        var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (!file) return;
        ingest(file, roleFor(WM.getState()));
      });
    });
  }

  async function copyText(text, buttonEl, textareaEl) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        textareaEl.focus();
        textareaEl.select();
        document.execCommand("copy");
      }
      buttonEl.textContent = "Copied";
      setTimeout(function () { buttonEl.textContent = "Copy"; }, 1200);
    } catch (err) {
      if (WM.getState().debug && typeof console !== "undefined") console.warn("copy failed", err);
      buttonEl.textContent = "Copy failed";
    }
  }

  function fillBlends() {
    WM.BLENDS.forEach(function (item) {
      var opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.label;
      els.blend.appendChild(opt);
    });
  }

  function fillEncodeControls() {
    var presetLabels = {
      ultrafast: "ultrafast — fastest",
      superfast: "superfast",
      veryfast: "veryfast",
      faster: "faster",
      fast: "fast",
      medium: "medium — default",
      slow: "slow",
      slower: "slower",
      veryslow: "veryslow"
    };
    WM.PRESETS.forEach(function (id) {
      var opt = document.createElement("option");
      opt.value = id;
      opt.textContent = presetLabels[id] || id;
      els.encodePreset.appendChild(opt);
    });

    [
      { value: "", label: "none" },
      { value: "film", label: "film — live action" },
      { value: "animation", label: "animation" },
      { value: "grain", label: "grain — preserve film grain" }
    ].forEach(function (item) {
      var opt = document.createElement("option");
      opt.value = item.value;
      opt.textContent = item.label;
      els.encodeTune.appendChild(opt);
    });

    [
      { value: "", label: "none (omit keyint)" },
      { value: "24", label: "24 fps" },
      { value: "25", label: "25 fps" },
      { value: "30", label: "30 fps" },
      { value: "50", label: "50 fps" },
      { value: "60", label: "60 fps" }
    ].forEach(function (item) {
      var opt = document.createElement("option");
      opt.value = item.value;
      opt.textContent = item.label;
      els.encodeFps.appendChild(opt);
    });

    [
      { value: "copy", label: "copy (−c:a copy)" },
      { value: "aac", label: "aac — native FFmpeg" },
      { value: "libfdk_aac", label: "libfdk_aac — high quality (external)" },
      { value: "none", label: "omit (video-only)" }
    ].forEach(function (item) {
      var opt = document.createElement("option");
      opt.value = item.value;
      opt.textContent = item.label;
      els.encodeAudio.appendChild(opt);
    });
  }

  function fillPresets() {
    var ids = ["TL", "TC", "TR", "ML", "C", "MR", "BL", "BC", "BR"];
    var labels = {
      TL: "Top left", TC: "Top center", TR: "Top right",
      ML: "Middle left", C: "Center", MR: "Middle right",
      BL: "Bottom left", BC: "Bottom center", BR: "Bottom right"
    };
    ids.forEach(function (id) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.preset = id;
      btn.setAttribute("aria-label", labels[id]);
      btn.title = labels[id];
      els.presets.appendChild(btn);
    });
    els.presets.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-preset]");
      if (!btn) return;
      var state = WM.getState();
      if (!state.frame || !state.watermark) return;
      var size = WM.scaledSize(state.watermark.nativeWidth, state.watermark.nativeHeight, state.scale);
      var pos = WM.presetPosition(btn.dataset.preset, state.frame.width, state.frame.height, size.w, size.h);
      WM.setState({ x: pos.x, y: pos.y });
    });
  }

  async function onReady() {
    els.frameName = $("frame-name");
    els.frameFile = $("frame-file");
    els.frameSize = $("frame-size");
    els.wmName = $("wm-name");
    els.wmFile = $("wm-file");
    els.wmNative = $("wm-native");
    els.wmScaled = $("wm-scaled");
    els.x = $("x");
    els.y = $("y");
    els.scale = $("scale");
    els.opacity = $("opacity");
    els.opacityReadout = $("opacity-readout");
    els.blend = $("blend");
    els.blendNote = $("blend-note");
    els.presets = $("presets");
    els.videoName = $("video-name");
    els.outputName = $("output-name");
    els.encodeSummary = $("encode-summary");
    els.openEncode = $("open-encode");
    els.openHelp = $("open-help");
    els.openAbout = $("open-about");
    els.openReset = $("open-reset");
    els.cancelReset = $("cancel-reset");
    els.confirmReset = $("confirm-reset");
    els.encodeCrf = $("encode-crf");
    els.encodePreset = $("encode-preset");
    els.encodeTune = $("encode-tune");
    els.encodeFps = $("encode-fps");
    els.encodeAudio = $("encode-audio");
    els.encodeAudioModeRow = $("encode-audio-mode-row");
    els.encodeAudioModeVbr = $("encode-audio-mode-vbr");
    els.encodeAudioModeCbr = $("encode-audio-mode-cbr");
    els.encodeAudioBitrateField = $("encode-audio-bitrate-field");
    els.encodeAudioBitrate = $("encode-audio-bitrate");
    els.encodeAudioQualityField = $("encode-audio-quality-field");
    els.encodeAudioQuality = $("encode-audio-quality");
    els.encodeAudioQualityHint = $("encode-audio-quality-hint");
    els.encodeIn = $("encode-in");
    els.encodeTo = $("encode-to");
    els.encodeStripMeta = $("encode-strip-meta");
    els.encodeMetaTitle = $("encode-meta-title");
    els.encodeMetaYear = $("encode-meta-year");
    els.encodeMetaDescription = $("encode-meta-description");
    els.encodeMetaComment = $("encode-meta-comment");
    els.filterOut = $("filter-out");
    els.commandOut = $("command-out");
    els.copyFilter = $("copy-filter");
    els.copyCommand = $("copy-command");
    els.status = $("status");
    els.debug = $("debug");

    var params = new URLSearchParams(window.location.search);

    fillBlends();
    fillPresets();
    fillEncodeControls();

    WM.modal.register("encode", {
      title: "Encode settings",
      kicker: "Video · audio · metadata",
      onOpen: function () { els.openEncode.setAttribute("aria-expanded", "true"); },
      onClose: function () { els.openEncode.setAttribute("aria-expanded", "false"); }
    });
    WM.modal.register("help", {
      title: "How to",
      kicker: "Help",
      onOpen: function () { els.openHelp.setAttribute("aria-expanded", "true"); },
      onClose: function () { els.openHelp.setAttribute("aria-expanded", "false"); }
    });
    WM.modal.register("about", {
      title: "About",
      kicker: "This page",
      onOpen: function () { els.openAbout.setAttribute("aria-expanded", "true"); },
      onClose: function () { els.openAbout.setAttribute("aria-expanded", "false"); }
    });
    WM.modal.register("reset", {
      title: "Reset this tab",
      kicker: "Confirm",
      onOpen: function () { els.openReset.setAttribute("aria-expanded", "true"); },
      onClose: function () { els.openReset.setAttribute("aria-expanded", "false"); }
    });
    els.openEncode.addEventListener("click", function () { WM.modal.open("encode"); });
    els.openHelp.addEventListener("click", function () { WM.modal.open("help"); });
    els.openAbout.addEventListener("click", function () { WM.modal.open("about"); });
    els.openReset.addEventListener("click", function () { WM.modal.open("reset"); });
    els.cancelReset.addEventListener("click", function () { WM.modal.close(); });
    els.confirmReset.addEventListener("click", function () {
      resetSession();
      WM.modal.close();
      showStatus("Tab reset.", 2500);
    });

    var stage = $("stage");
    WM.initPreview(stage);
    WM.setPreviewHandlers({
      onMove: function (x, y) {
        draggingFields = true;
        WM.setState({ x: x, y: y });
      },
      onResize: function (x, y, scale) {
        draggingFields = true;
        WM.setState({ x: x, y: y, scale: scale });
      },
      onSelect: function (selected) {
        WM.setState({ selected: selected });
      }
    });
    stage.addEventListener("pointerup", function () { draggingFields = false; });

    await hydrateSession();
    if (params.get("debug") === "1") WM.setState({ debug: true });

    WM.subscribe(function (state) {
      render(state);
      schedulePersist();
    });
    render(WM.getState());

    var modalId = params.get("modal");
    if (modalId === "encode" || modalId === "help" || modalId === "about" || modalId === "reset") {
      WM.modal.open(modalId);
    }

    bindDrop(stage, function (state) { return state.frame ? "wm" : "frame"; });
    bindDrop(document.querySelector('[data-drop="frame"]'), function () { return "frame"; });
    bindDrop(document.querySelector('[data-drop="wm"]'), function () { return "wm"; });

    stage.addEventListener("click", function (event) {
      if (event.target.closest && event.target.closest(".wm")) return;
      if (!WM.getState().frame) els.frameFile.click();
    });

    els.frameFile.addEventListener("change", function () {
      var file = els.frameFile.files && els.frameFile.files[0];
      if (file) ingest(file, "frame");
      els.frameFile.value = "";
    });
    els.wmFile.addEventListener("change", function () {
      var file = els.wmFile.files && els.wmFile.files[0];
      if (file) ingest(file, "wm");
      els.wmFile.value = "";
    });

    els.frameName.addEventListener("input", function () { WM.setState({ frameName: els.frameName.value }); });
    els.wmName.addEventListener("input", function () { WM.setState({ wmName: els.wmName.value }); });
    els.videoName.addEventListener("input", function () { WM.setState({ videoName: els.videoName.value }); });
    els.outputName.addEventListener("input", function () { WM.setState({ outputName: els.outputName.value }); });
    els.x.addEventListener("input", function () {
      if (draggingFields) return;
      WM.setState({ x: WM.roundInt(els.x.valueAsNumber) });
    });
    els.y.addEventListener("input", function () {
      if (draggingFields) return;
      WM.setState({ y: WM.roundInt(els.y.valueAsNumber) });
    });
    els.scale.addEventListener("input", function () {
      if (draggingFields) return;
      WM.setState({ scale: WM.clampScale(els.scale.valueAsNumber) });
    });
    els.opacity.addEventListener("input", function () {
      WM.setState({ opacity: WM.clampOpacity(els.opacity.valueAsNumber / 100) });
    });
    els.blend.addEventListener("change", function () {
      WM.setState({ blend: els.blend.value });
    });
    els.debug.addEventListener("change", function () {
      WM.setState({ debug: els.debug.checked });
    });

    els.encodeCrf.addEventListener("input", function () {
      if (!Number.isFinite(els.encodeCrf.valueAsNumber)) return;
      WM.patchEncode({ crf: WM.clampCrf(els.encodeCrf.valueAsNumber) });
    });
    els.encodeCrf.addEventListener("change", function () {
      WM.patchEncode({ crf: WM.clampCrf(els.encodeCrf.valueAsNumber) });
    });
    els.encodePreset.addEventListener("change", function () {
      WM.patchEncode({ preset: WM.normalizePreset(els.encodePreset.value) });
    });
    els.encodeTune.addEventListener("change", function () {
      WM.patchEncode({ tune: WM.normalizeTune(els.encodeTune.value) });
    });
    els.encodeFps.addEventListener("change", function () {
      WM.patchEncode({ fpsPreset: els.encodeFps.value });
    });
    els.encodeAudio.addEventListener("change", function () {
      var audio = WM.normalizeAudio(els.encodeAudio.value);
      var patch = { audio: audio };
      if (WM.audioNeedsEncode(audio)) {
        patch.audioQuality = WM.clampAudioQuality(audio, WM.getState().encode.audioQuality);
      }
      WM.patchEncode(patch);
    });
    els.encodeAudioModeVbr.addEventListener("change", function () {
      if (els.encodeAudioModeVbr.checked) WM.patchEncode({ audioMode: "vbr" });
    });
    els.encodeAudioModeCbr.addEventListener("change", function () {
      if (els.encodeAudioModeCbr.checked) WM.patchEncode({ audioMode: "cbr" });
    });
    els.encodeAudioBitrate.addEventListener("input", function () {
      WM.patchEncode({ audioBitrate: els.encodeAudioBitrate.value });
    });
    els.encodeAudioQuality.addEventListener("input", function () {
      if (!Number.isFinite(els.encodeAudioQuality.valueAsNumber)) return;
      var audio = WM.normalizeAudio(WM.getState().encode.audio);
      WM.patchEncode({ audioQuality: WM.clampAudioQuality(audio, els.encodeAudioQuality.valueAsNumber) });
    });
    els.encodeAudioQuality.addEventListener("change", function () {
      var audio = WM.normalizeAudio(WM.getState().encode.audio);
      WM.patchEncode({ audioQuality: WM.clampAudioQuality(audio, els.encodeAudioQuality.valueAsNumber) });
    });
    els.encodeIn.addEventListener("input", function () {
      WM.patchEncode({ inPoint: els.encodeIn.value });
    });
    els.encodeTo.addEventListener("input", function () {
      WM.patchEncode({ outPoint: els.encodeTo.value });
    });
    els.encodeStripMeta.addEventListener("change", function () {
      WM.patchEncode({ stripMetadata: els.encodeStripMeta.checked });
    });
    els.encodeMetaTitle.addEventListener("input", function () {
      WM.patchEncode({ metaTitle: els.encodeMetaTitle.value });
    });
    els.encodeMetaYear.addEventListener("input", function () {
      WM.patchEncode({ metaYear: els.encodeMetaYear.value });
    });
    els.encodeMetaDescription.addEventListener("input", function () {
      WM.patchEncode({ metaDescription: els.encodeMetaDescription.value });
    });
    els.encodeMetaComment.addEventListener("input", function () {
      WM.patchEncode({ metaComment: els.encodeMetaComment.value });
    });

    $("copy-filter").addEventListener("click", function () {
      copyText(els.filterOut.value, els.copyFilter, els.filterOut);
    });
    $("copy-command").addEventListener("click", function () {
      copyText(els.commandOut.value, els.copyCommand, els.commandOut);
    });

    document.addEventListener("keydown", function (event) {
      if (WM.modal && WM.modal.isOpen()) return;
      var state = WM.getState();
      if (!state.selected || isField(document.activeElement)) return;
      var step = event.shiftKey ? 10 : 1;
      if (event.key === "Escape") {
        event.preventDefault();
        WM.setState({ selected: false });
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        WM.setState({ x: state.x - step });
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        WM.setState({ x: state.x + step });
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        WM.setState({ y: state.y - step });
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        WM.setState({ y: state.y + step });
      }
    });

    window.addEventListener("pagehide", function () {
      persistNow();
      var state = WM.getState();
      if (state.frame) WM.revokeUrl(state.frame.objectUrl);
      if (state.watermark) WM.revokeUrl(state.watermark.objectUrl);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }
})(window);
