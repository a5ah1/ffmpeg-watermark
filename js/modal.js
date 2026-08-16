(function (global) {
  "use strict";

  var WM = global.WM || (global.WM = {});

  var dialog = null;
  var titleEl = null;
  var kickerEl = null;
  var closeBtn = null;
  var registry = {};
  var openId = null;
  var returnFocus = null;
  var ready = false;

  function panels() {
    if (!dialog) return [];
    return dialog.querySelectorAll("[data-modal-panel]");
  }

  function firstFocusable(root) {
    if (!root) return null;
    return root.querySelector("input, select, textarea, button, [href], [tabindex]:not([tabindex='-1'])");
  }

  function hidePanels() {
    var nodes = panels();
    var i;
    for (i = 0; i < nodes.length; i++) nodes[i].hidden = true;
  }

  function onClosed() {
    var id = openId;
    var spec = id ? registry[id] : null;
    openId = null;
    document.body.style.overflow = "";
    hidePanels();
    if (spec && spec.onClose) spec.onClose();
    if (returnFocus && typeof returnFocus.focus === "function" && document.contains(returnFocus)) {
      try { returnFocus.focus(); } catch (err) { /* ignore */ }
    }
    returnFocus = null;
  }

  function bind() {
    if (ready) return;
    dialog = document.getElementById("modal");
    titleEl = document.getElementById("modal-title");
    kickerEl = document.getElementById("modal-kicker");
    closeBtn = document.getElementById("modal-close");
    if (!dialog) return;
    dialog.addEventListener("close", onClosed);
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        if (dialog.open) dialog.close();
      });
    }
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog && dialog.open) dialog.close();
    });
    ready = true;
  }

  WM.modal = {
    register: function (id, opts) {
      registry[id] = opts || {};
    },
    open: function (id) {
      bind();
      var panel = document.getElementById("panel-" + id);
      var spec = registry[id] || {};
      if (!dialog || !panel || typeof dialog.showModal !== "function") return;
      if (dialog.open && openId === id) return;
      if (dialog.open) {
        var prev = openId ? registry[openId] : null;
        if (prev && prev.onClose) prev.onClose();
      } else {
        returnFocus = document.activeElement;
        document.body.style.overflow = "hidden";
        dialog.showModal();
      }
      hidePanels();
      panel.hidden = false;
      if (kickerEl && spec.kicker) kickerEl.textContent = spec.kicker;
      if (titleEl && spec.title) titleEl.textContent = spec.title;
      openId = id;
      var focusEl = firstFocusable(panel) || closeBtn;
      if (focusEl && typeof focusEl.focus === "function") {
        try { focusEl.focus(); } catch (err) { /* ignore */ }
      }
      if (spec.onOpen) spec.onOpen();
    },
    close: function () {
      bind();
      if (dialog && dialog.open) dialog.close();
    },
    isOpen: function () {
      return !!(dialog && dialog.open);
    },
    current: function () {
      return openId;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})(typeof window !== "undefined" ? window : globalThis);
