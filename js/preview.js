(function (global) {
  "use strict";

  var WM = global.WM || (global.WM = {});

  var stageEl = null;
  var hintEl = null;
  var wrapEl = null;
  var frameImg = null;
  var wmEl = null;
  var wmImg = null;
  var handlers = { onMove: null, onResize: null, onSelect: null };
  var drag = null;

  function blendCss(id) {
    var list = WM.BLENDS || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i].css;
    }
    return "normal";
  }

  function additionCss() {
    if (typeof CSS !== "undefined" && CSS.supports && CSS.supports("mix-blend-mode", "plus-lighter")) {
      return "plus-lighter";
    }
    return "lighten";
  }

  function currentContained(state) {
    var rect = stageEl.getBoundingClientRect();
    var maxScale = WM.normalizeViewMode(state.viewMode) === "fit" ? null : 1;
    return WM.getContainedRect(rect.width, rect.height, state.frame.width, state.frame.height, maxScale);
  }

  WM.initPreview = function (el) {
    stageEl = el;
    stageEl.innerHTML = "";

    hintEl = document.createElement("div");
    hintEl.className = "stage-hint";
    hintEl.innerHTML =
      "<strong>Drop a video frame</strong>" +
      "<span>PNG, JPEG, WebP, GIF</span>" +
      "<span class=\"hint-sub\">or use the Frame file control</span>";
    stageEl.appendChild(hintEl);

    wrapEl = document.createElement("div");
    wrapEl.className = "frame-wrap";
    wrapEl.hidden = true;

    frameImg = document.createElement("img");
    frameImg.id = "frame-img";
    frameImg.alt = "Main frame";
    frameImg.draggable = false;
    wrapEl.appendChild(frameImg);

    wmEl = document.createElement("div");
    wmEl.className = "wm";
    wmEl.hidden = true;

    wmImg = document.createElement("img");
    wmImg.id = "wm-img";
    wmImg.alt = "Watermark";
    wmImg.draggable = false;
    wmEl.appendChild(wmImg);

    ["nw", "ne", "sw", "se"].forEach(function (name) {
      var handle = document.createElement("button");
      handle.type = "button";
      handle.className = "handle";
      handle.setAttribute("data-handle", name);
      handle.setAttribute("aria-label", "Resize " + name.toUpperCase());
      wmEl.appendChild(handle);
    });

    wrapEl.appendChild(wmEl);
    stageEl.appendChild(wrapEl);

    stageEl.addEventListener("dragstart", function (event) {
      event.preventDefault();
    });

    stageEl.addEventListener("pointerdown", onPointerDown);
    stageEl.addEventListener("pointermove", onPointerMove);
    stageEl.addEventListener("pointerup", onPointerUp);
    stageEl.addEventListener("pointercancel", onPointerUp);

    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(function () {
        WM.renderPreview(WM.getState());
      }).observe(stageEl);
    }
  };

  WM.setPreviewHandlers = function (next) {
    handlers = next || handlers;
  };

  WM.renderPreview = function (state) {
    if (!stageEl) return;
    if (!state.frame) {
      hintEl.hidden = false;
      wrapEl.hidden = true;
      wmEl.hidden = true;
      frameImg.removeAttribute("src");
      wmImg.removeAttribute("src");
      return;
    }

    hintEl.hidden = true;

    var contained = currentContained(state);
    wrapEl.style.left = contained.left + "px";
    wrapEl.style.top = contained.top + "px";
    wrapEl.style.width = contained.width + "px";
    wrapEl.style.height = contained.height + "px";
    wrapEl.hidden = false;
    if (frameImg.getAttribute("src") !== state.frame.objectUrl) {
      frameImg.src = state.frame.objectUrl;
    }
    frameImg.draggable = false;

    if (!state.watermark) {
      wmEl.hidden = true;
      wmImg.removeAttribute("src");
      return;
    }

    // Position the watermark relative to the stage, then clip via the wrap.
    // wrap is already at contain-rect, so convert stage-space to wrap-space.
    var size = WM.scaledSize(state.watermark.nativeWidth, state.watermark.nativeHeight, state.scale);
    wmEl.style.left = (state.x * contained.viewScale) + "px";
    wmEl.style.top = (state.y * contained.viewScale) + "px";
    wmEl.style.width = (size.w * contained.viewScale) + "px";
    wmEl.style.height = (size.h * contained.viewScale) + "px";
    wmEl.classList.toggle("is-selected", !!state.selected);
    wmEl.hidden = false;
    if (wmImg.getAttribute("src") !== state.watermark.objectUrl) {
      wmImg.src = state.watermark.objectUrl;
    }
    wmImg.draggable = false;
    wmImg.style.opacity = String(state.opacity);
    var css = blendCss(state.blend);
    if (css === "plus-lighter") css = additionCss();
    wmImg.style.mixBlendMode = css;
  };

  function onPointerDown(event) {
    var state = WM.getState();
    if (!state.frame || !state.watermark) return;
    var handle = event.target.closest ? event.target.closest(".handle") : null;
    var onWm = event.target.closest ? event.target.closest(".wm") : null;
    if (!handle && !onWm) {
      if (handlers.onSelect) handlers.onSelect(false);
      return;
    }

    event.preventDefault();
    stageEl.focus();
    if (handlers.onSelect) handlers.onSelect(true);

    var contained = currentContained(state);
    var stageRect = stageEl.getBoundingClientRect();
    var src = WM.mapPointerToSource(event.clientX, event.clientY, stageRect, contained, state.frame.width, state.frame.height);
    var size = WM.scaledSize(state.watermark.nativeWidth, state.watermark.nativeHeight, state.scale);

    drag = {
      pointerId: event.pointerId,
      kind: handle ? "resize" : "move",
      handle: handle ? handle.getAttribute("data-handle") : null,
      grabX: src.x - state.x,
      grabY: src.y - state.y,
      ax: state.x,
      ay: state.y
    };
    if (drag.kind === "resize") {
      if (drag.handle === "se") { drag.ax = state.x; drag.ay = state.y; }
      if (drag.handle === "sw") { drag.ax = state.x + size.w; drag.ay = state.y; }
      if (drag.handle === "ne") { drag.ax = state.x; drag.ay = state.y + size.h; }
      if (drag.handle === "nw") { drag.ax = state.x + size.w; drag.ay = state.y + size.h; }
    }
    try { stageEl.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
  }

  function onPointerMove(event) {
    if (!drag) return;
    var state = WM.getState();
    if (!state.frame || !state.watermark) return;
    var contained = currentContained(state);
    var stageRect = stageEl.getBoundingClientRect();
    var src = WM.mapPointerToSource(event.clientX, event.clientY, stageRect, contained, state.frame.width, state.frame.height);

    if (drag.kind === "move") {
      if (handlers.onMove) {
        handlers.onMove(WM.roundInt(src.x - drag.grabX), WM.roundInt(src.y - drag.grabY));
      }
      return;
    }

    var nativeW = state.watermark.nativeWidth;
    var nativeH = state.watermark.nativeHeight;
    var newW;
    if (drag.handle === "ne" || drag.handle === "se") newW = src.x - drag.ax;
    else newW = drag.ax - src.x;
    if (newW <= 0) return;
    var scale = WM.clampScale(newW / nativeW);
    var size = WM.scaledSize(nativeW, nativeH, scale);
    if (size.w < 1) return;
    var x = (drag.handle === "nw" || drag.handle === "sw") ? drag.ax - size.w : drag.ax;
    var y = (drag.handle === "nw" || drag.handle === "ne") ? drag.ay - size.h : drag.ay;
    if (handlers.onResize) handlers.onResize(x, y, scale);
  }

  function onPointerUp(event) {
    if (!drag) return;
    if (event && event.pointerId != null) {
      try { stageEl.releasePointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    }
    drag = null;
  }
})(typeof window !== "undefined" ? window : globalThis);
