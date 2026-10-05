/* =========================================================================
   MT_LB — Lightbox for illustrations.
   API: open(list, idx, caption?) · close() · next() · prev() · zoomIn() ·
        zoomOut() · reset() · idx · isOpen
   Zoom: wheel, dblclick, +/-/0 keys. Pan when zoomed. Swipe 1-step.
   Vanilla, zero deps. Respects prefers-reduced-motion.
   ========================================================================= */
(function () {
  "use strict";
  if (window.MT_LB) return;

  var box = document.getElementById("lightbox");
  var stage = document.getElementById("lb-stage");
  var img = document.getElementById("lb-img");
  var countEl = document.getElementById("lb-count");
  var capEl = document.getElementById("lb-cap");
  var zEl = document.getElementById("lb-z");

  var list = [];          // [{src, caption, orient}]
  var i = 0;
  var zoom = 1;           // current scale
  var minZoom = 1, maxZoom = 5;
  var panX = 0, panY = 0;  // current pan offset (px)
  var isOpen = false;
  var drag = null;        // {x,y,px,py}
  var swipe = null;       // {x,y,t}
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function render() {
    var item = list[i] || list[0];
    if (!item) return;
    img.src = item.src;
    img.alt = item.caption || "Ilustrasi";
    capEl.textContent = item.caption || "";
    countEl.textContent = (i + 1) + " / " + list.length;
    zoom = 1; panX = 0; panY = 0;
    apply();
  }

  function apply() {
    img.style.transform = "translate(" + panX + "px," + panY + "px) scale(" + zoom + ")";
    zEl.textContent = Math.round(zoom * 100) + "%";
    img.classList.toggle("is-panning", drag !== null);
  }

  function open(items, index, caption) {
    if (!items || !items.length) return;
    list = items.map(function (it) {
      if (typeof it === "string") return { src: it, caption: caption || "" };
      return { src: it.src, caption: it.caption || it.cap || caption || "", orient: it.orient };
    });
    i = clamp(index || 0, 0, list.length - 1);
    isOpen = true;
    box.classList.add("is-open");
    box.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    render();
    if (!reduce && window.anime) {
      try {
        anime({ targets: img, opacity: [0, 1], scale: [0.92, 1], duration: reduce ? 1 : 360, ease: "outExpo" });
      } catch (e) {}
    }
  }

  function close() {
    isOpen = false;
    box.classList.remove("is-open");
    box.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function next() { if (!list.length) return; i = (i + 1) % list.length; render(); }
  function prev() { if (!list.length) return; i = (i - 1 + list.length) % list.length; render(); }

  function zoomIn() { setZoom(zoom * 1.25); }
  function zoomOut() { setZoom(zoom / 1.25); }
  function reset() { zoom = 1; panX = 0; panY = 0; apply(); }

  function setZoom(z, cx, cy) {
    var prev = zoom;
    zoom = clamp(z, minZoom, maxZoom);
    if (zoom <= 1) { panX = 0; panY = 0; }
    // keep focal point under cursor when provided
    if (cx !== undefined && zoom > 1 && prev > 0) {
      var rect = img.getBoundingClientRect();
      var fx = cx - (rect.left + rect.width / 2);
      var fy = cy - (rect.top + rect.height / 2);
      var k = zoom / prev;
      panX = clamp(panX * k + fx * (1 - 1 / k), -1200, 1200);
      panY = clamp(panY * k + fy * (1 - 1 / k), -1200, 1200);
    }
    apply();
  }

  // ---- Wheel zoom ----
  stage.addEventListener("wheel", function (e) {
    if (!isOpen) return;
    e.preventDefault();
    var delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setZoom(zoom * delta, e.clientX, e.clientY);
  }, { passive: false });

  // ---- Dblclick zoom toggle ----
  img.addEventListener("dblclick", function (e) {
    if (zoom > 1.2) reset();
    else setZoom(2.2, e.clientX, e.clientY);
  });

  // ---- Pan (drag) when zoomed ----
  img.addEventListener("pointerdown", function (e) {
    if (zoom <= 1) {
      // begin swipe
      swipe = { x: e.clientX, y: e.clientY, t: Date.now() };
      return;
    }
    drag = { x: e.clientX, y: e.clientY, px: panX, py: panY };
    img.setPointerCapture(e.pointerId);
  });
  img.addEventListener("pointermove", function (e) {
    if (drag) {
      panX = drag.px + (e.clientX - drag.x);
      panY = drag.py + (e.clientY - drag.y);
      apply();
    } else if (swipe) {
      // live follow for tactile feel
      img.style.transform = "translateX(" + (e.clientX - swipe.x) + "px) scale(1)";
    }
  });
  function endPointer(e) {
    if (drag) {
      drag = null; apply();
    } else if (swipe) {
      var dx = e.clientX - swipe.x;
      var dy = e.clientY - swipe.y;
      var dt = Date.now() - swipe.t;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && dt < 600) {
        if (dx < 0) next(); else prev();
      }
      img.style.transform = ""; // restore via apply
      swipe = null; apply();
    }
  }
  img.addEventListener("pointerup", endPointer);
  img.addEventListener("pointercancel", endPointer);

  // ---- Buttons (event delegation handles data-action) ----
  // keyboard handled by app.js global handler, but keep local Esc too
  box.addEventListener("click", function (e) {
    if (e.target === stage || e.target === box) close();
  });

  window.MT_LB = {
    open: open, close: close, next: next, prev: prev,
    zoomIn: zoomIn, zoomOut: zoomOut, reset: reset,
    get idx() { return i; },
    get isOpen() { return isOpen; }
  };
})();
