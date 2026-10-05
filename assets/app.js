/* =========================================================================
   MT_App — main controller. Vanilla, zero deps at runtime.
   - hash routing (#/lib, #/r/<vid>/<c>[/p<N>]) with replaceState per move
   - global event delegation via [data-action] (buttons never die)
   - library (spotlight stage + film-strip gallery + continue reading)
   - reader (scroll + paged via CSS multicol), TOC, search, marks, stats
   - 5 themes, prefs, progress, bookmarks, highlights, stats → localStorage
   - error guard, keyboard, swipe, reduced-motion
   ========================================================================= */
(function () {
  "use strict";
  if (window.MT_App) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- animation helper (animejs v4 — namespace API) ----------------
     The vendored v4 UMD exposes a NAMESPACE (anime.animate / anime.stagger),
     NOT the v3 legacy anime() function. This helper normalizes v3-style params
     into v4 (ease prefix, complete→onComplete) and no-ops gracefully. */
  var anim = function (targets, params) {
    if (reduceMotion || !window.anime || !window.anime.animate) return null;
    var p = {}, k;
    for (k in params) { if (Object.prototype.hasOwnProperty.call(params, k)) p[k] = params[k]; }
    if (p.easing) { p.ease = String(p.easing).replace(/^ease/, ""); delete p.easing; }
    if (p.complete && !p.onComplete) { p.onComplete = p.complete; delete p.complete; }
    try { return window.anime.animate(targets, p); } catch (e) { return null; }
  };

  /* ---------------- data access ---------------- */
  var BOOKS = window.__MT_BOOKS__ || [];
  function chaptersOf(vid) {
    var k = "__MT_" + String(vid).toUpperCase() + "__";
    return window[k] || [];
  }
  function bookById(vid) { for (var i = 0; i < BOOKS.length; i++) if (BOOKS[i].id === vid) return BOOKS[i]; return null; }

  /* ---------------- meta (chars / terms / recap) ---------------- */
  // Merge __MT_META_A__ / __MT_META_B__ (guarded — globals may not exist yet).
  var META = (function () {
    var m = {};
    try {
      if (window.__MT_META_A__ && typeof window.__MT_META_A__ === "object") m = Object.assign(m, window.__MT_META_A__);
      if (window.__MT_META_B__ && typeof window.__MT_META_B__ === "object") m = Object.assign(m, window.__MT_META_B__);
    } catch (e) {}
    return m;
  })();

  /* ---------------- storage ---------------- */
  var KEYS = { prefs: "mt:prefs", prog: "mt:prog", bms: "mt:bms", hls: "mt:hls", stats: "mt:stats" };
  function load(key, dflt) {
    try {
      var v = localStorage.getItem(key);
      if (!v) return dflt;
      var parsed = JSON.parse(v);
      if (dflt && typeof dflt === 'object' && !Array.isArray(dflt) && typeof parsed === 'object' && !Array.isArray(parsed)) {
        var merged = {};
        for (var k in dflt) merged[k] = (k in parsed) ? parsed[k] : dflt[k];
        for (var k2 in parsed) if (!(k2 in merged)) merged[k2] = parsed[k2];
        return merged;
      }
      return parsed;
    } catch (e) { return dflt; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  var prefs = load(KEYS.prefs, {
    theme: "ink", mode: "scroll", font: "novel", fz: 19, lh: 1.75, col: 34,
    autoScroll: false, autoScrollSpeed: 1,
    focus: "off", bionic: false, dys: false,
    ambient: "off", ambientVol: 0.35,
    music: "off", musicVol: 0.4,
    goalBab: 0, themeAuto: "off", align: "left", indent: false,
    recapSeen: {}
  });
  var prog = load(KEYS.prog, {});
  var bms = load(KEYS.bms, []);
  var hls = load(KEYS.hls, []);
  var stats = load(KEYS.stats, { totalWords: 0, days: {}, lastDate: null, chapters: {} });

  /* ---------------- state ---------------- */
  var state = { view: "lib", vid: null, c: 0, page: 0, pageCount: 1, mode: prefs.mode || "scroll", tocTab: "toc" };
  var navLock = false;

  /* ---------------- toast ---------------- */
  var toastEl = $("#toast"), toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-show"); }, 2200);
  }

  /* ---------------- text helpers ---------------- */
  var ENT = { "&": String.fromCharCode(38, 97, 109, 112, 59), "<": String.fromCharCode(38, 108, 116, 59), ">": String.fromCharCode(38, 103, 116, 59) };
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return ENT[c]; }); }
  function processParagraph(text, pi) {
    var s = esc(text);
    // bionic reading — bold first ~40% of each alphabetic word (entity-safe, runs
    // before any markup is inserted so HTML tags are never corrupted). Skipped for
    // pov-lines (rendered via textContent) and figures.
    if (prefs.bionic) {
      s = s.replace(/(&[a-z]+;)|\b[A-Za-zÀ-ÿ]+\b/g, function (m, ent) {
        if (ent) return ent;
        var w = m;
        if (w.length < 3) return w;
        var n = Math.ceil(w.length * 0.4);
        if (n > w.length - 1) n = w.length - 1;
        if (n < 1) n = 1;
        return '<b class="fx">' + w.slice(0, n) + '</b>' + w.slice(n);
      });
    }
    // page markers like [p.10] — wrap ALL occurrences (inline or prefix)
    s = s.replace(/\[p\.(\d+)\]/g, '<span class="pagemark">[p.$1]</span> ');
    // italic *x*
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return s;
  }
  function chapterWords(ch) {
    var n = 0;
    (ch.blocks || []).forEach(function (b) { if (b[0] === "p") { n += String(b[1]).split(/\s+/).filter(Boolean).length; } });
    return n;
  }
  function todayKey() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  function countStats(vid, c) {
    var key = vid + ":" + c;
    var ch = chaptersOf(vid)[c];
    if (!ch) return;
    var t = todayKey();
    if (stats.chapters[key] === t) return; // already counted today
    var isNewDay = !stats.days[t];
    var w = chapterWords(ch);
    stats.chapters[key] = t;
    stats.totalWords += w;
    stats.days[t] = (stats.days[t] || 0) + w;
    stats.lastDate = t;
    save(KEYS.stats, stats);
    // streak flame: animate once per session when a new day is first recorded
    if (isNewDay && !state._flameAnimated) {
      state._flameAnimated = true;
      animateFlame();
    }
    updateFlame();
    // reading goal: toast + pulse when today's chapter count crosses the goal exactly
    if (prefs.goalBab > 0) {
      var todayCount = 0;
      for (var k in stats.chapters) if (stats.chapters[k] === t) todayCount++;
      if (todayCount === prefs.goalBab) {
        toast("\u2726 Target tercapai!");
        pulseGoalCell();
      }
    }
  }
  function updateFlame() {
    var flame = $("#streak-flame");
    if (!flame) return;
    var streak = computeStreak();
    var show = streak >= 1;
    flame.hidden = !show;
    if (show) flame.title = streak + " hari beruntun";
  }
  function animateFlame() {
    var flame = $("#streak-flame");
    if (!flame || reduceMotion || !window.anime) return;
    anim(flame, { scale: [0.4, 1.2, 1], duration: 700, easing: "easeOutElastic(1, .6)" });
  }
  function pulseGoalCell() {
    if (reduceMotion) return;
    var cell = $("#goal-ring");
    if (!cell) return;
    try {
      anim(cell, { scale: [1, 1.12, 1], duration: 560, easing: "easeOutQuad" });
      if (!window.anime && cell.animate) cell.animate([{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], { duration: 560, easing: "ease-out" });
    } catch (e) {}
  }
  function computeStreak() {
    var streak = 0, d = new Date();
    // allow today or yesterday as start
    var hasToday = !!stats.days[todayKey()];
    if (!hasToday) d.setDate(d.getDate() - 1);
    while (true) {
      var k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      if (stats.days[k]) { streak++; d.setDate(d.getDate() - 1); }
      else break;
      if (streak > 365) break;
    }
    return streak;
  }

  /* ---------------- prefs → DOM ---------------- */
  function applyPrefs() {
    document.documentElement.setAttribute("data-theme", prefs.theme);
    document.documentElement.style.setProperty("--reader-fz", prefs.fz + "px");
    document.documentElement.style.setProperty("--reader-lh", prefs.lh);
    document.documentElement.style.setProperty("--reader-col", prefs.col + "rem");
    var prose = $("#prose");
    if (prose) prose.setAttribute("data-font", prefs.font);
    // settings UI sync
    var mv = $("#mode-val"); if (mv) mv.textContent = prefs.mode === "paged" ? "halaman" : "gulir";
    var fv = $("#font-val"); if (fv) fv.textContent = prefs.font === "ui" ? "sans" : "serif";
    var fzv = $("#fz-val"); if (fzv) fzv.textContent = prefs.fz + "px";
    var lhv = $("#lh-val"); if (lhv) lhv.textContent = prefs.lh;
    var cv = $("#col-val"); if (cv) cv.textContent = prefs.col + "rem";
    var rngFz = $("#rng-fz"); if (rngFz) rngFz.value = prefs.fz;
    var rngLh = $("#rng-lh"); if (rngLh) rngLh.value = prefs.lh;
    var rngCol = $("#rng-col"); if (rngCol) rngCol.value = prefs.col;
    // swatch active state: the "auto" swatch is active when themeAuto != off,
    // otherwise the swatch matching the resolved theme is active.
    var autoOn = prefs.themeAuto && prefs.themeAuto !== "off";
    $$("#swatches .swatch").forEach(function (s) {
      var st = s.getAttribute("data-t");
      var on = (st === "auto") ? autoOn : (!autoOn && st === prefs.theme);
      s.classList.toggle("is-active", on); s.setAttribute("aria-pressed", String(on));
    });
    var tv = $("#theme-val"); if (tv) tv.textContent = autoOn ? ("otomatis · " + prefs.theme) : prefs.theme;
    $$("#seg-mode button").forEach(function (b) { var on = b.getAttribute("data-m") === prefs.mode; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on)); });
    $$("#seg-font button").forEach(function (b) { var on = b.getAttribute("data-f") === prefs.font; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on)); });
    var btnMode = $("#btn-mode"); if (btnMode) btnMode.setAttribute("aria-pressed", String(prefs.mode === "paged"));
    // auto-scroll UI lives in the floating FAB panel; sync only
    syncAutoScrollUI();
    var asSpeedVal = $("#as-speed-val"); if (asSpeedVal) asSpeedVal.textContent = prefs.autoScrollSpeed.toFixed(1) + "×";
    // resolve theme auto (system / time) — applied but not persisted as the resolved value
    if (autoOn) { prefs.theme = resolveTheme(); document.documentElement.setAttribute("data-theme", prefs.theme); }
    // dyslexia mode
    document.body.classList.toggle("dys", !!prefs.dys);
    var dysV = $("#dys-val"); if (dysV) dysV.textContent = prefs.dys ? "aktif" : "mati";
    $$("#seg-dys button").forEach(function (b) { var on = (b.getAttribute("data-d") === "on") === prefs.dys; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on)); });
    // paragraph align + indent
    document.documentElement.style.setProperty("--reader-align", prefs.align === "justify" ? "justify" : "left");
    document.body.classList.toggle("indent-on", !!prefs.indent);
    var alV = $("#align-val"); if (alV) alV.textContent = prefs.align === "justify" ? "rata" : "kiri";
    var inV = $("#indent-val"); if (inV) inV.textContent = prefs.indent ? "aktif" : "mati";
    $$("#seg-align button").forEach(function (b) { var on = b.getAttribute("data-al") === prefs.align; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on)); });
    $$("#seg-indent button").forEach(function (b) { var on = (b.getAttribute("data-i") === "on") === prefs.indent; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on)); });
    // line focus
    var foV = $("#focus-val"); if (foV) foV.textContent = prefs.focus === "band" ? "pita" : prefs.focus === "ruler" ? "penggaris" : "mati";
    $$("#seg-focus button").forEach(function (b) { var on = b.getAttribute("data-f") === prefs.focus; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on)); });
    applyFocus();
    // bionic
    var bioV = $("#bionic-val"); if (bioV) bioV.textContent = prefs.bionic ? "aktif" : "mati";
    $$("#seg-bionic button").forEach(function (b) { var on = (b.getAttribute("data-b") === "on") === prefs.bionic; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on)); });
    // ambient soundscapes
    var amV = $("#ambient-val"); if (amV) amV.textContent = prefs.ambient === "off" ? "mati" : prefs.ambient;
    $$("#seg-ambient button").forEach(function (b) { var on = b.getAttribute("data-a") === prefs.ambient; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on)); });
    var rngAmVol = $("#rng-ambient-vol"); if (rngAmVol) rngAmVol.value = prefs.ambientVol;
    var amVolV = $("#ambient-vol-val"); if (amVolV) amVolV.textContent = Math.round(prefs.ambientVol * 100) + "%";
    // music moods
    var muV = $("#music-val"); if (muV) muV.textContent = prefs.music === "off" ? "tanpa" : prefs.music;
    $$("#seg-music button").forEach(function (b) { var on = b.getAttribute("data-m") === prefs.music; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on)); });
    var rngMuVol = $("#rng-music-vol"); if (rngMuVol) rngMuVol.value = prefs.musicVol;
    var muVolV = $("#music-vol-val"); if (muVolV) muVolV.textContent = Math.round(prefs.musicVol * 100) + "%";
    updateFlame();
  }
  function resolveTheme() {
    if (prefs.themeAuto === "system") {
      try {
        var mq = window.matchMedia("(prefers-color-scheme: dark)");
        return mq && mq.matches ? "ink" : "paper";
      } catch (e) { return prefs.theme; }
    }
    if (prefs.themeAuto === "time") {
      var h = new Date().getHours();
      return (h >= 18 || h < 6) ? "dusk" : "paper";
    }
    return prefs.theme;
  }
  function savePrefs() { save(KEYS.prefs, prefs); }

  /* ---------------- line focus (Fokus Garis) ---------------- */
  function applyFocus() {
    var scroller = $("#reader-scroller");
    if (!scroller) return;
    var top = $("#lf-top"), bottom = $("#lf-bottom"), ruler = $("#lf-ruler");
    var enabled = prefs.focus !== "off" && state.mode === "scroll" && state.view === "reader";
    var band = enabled && prefs.focus === "band";
    var rul = enabled && prefs.focus === "ruler";
    scroller.classList.toggle("lf-band", band);
    scroller.classList.toggle("lf-ruler-on", rul);
    if (top) top.hidden = !band;
    if (bottom) bottom.hidden = !band;
    if (ruler) ruler.hidden = !rul;
    if (enabled) markFocusParagraphs(true);
    else clearFocusDim();
  }
  function clearFocusDim() {
    $$("#prose p[data-pi]").forEach(function (p) { p.classList.remove("lf-dim"); });
    lfCache = null;
  }
  var lfCache = null; // { prose, items:[{el, off}] } — rebuilt on render/invalidate
  function lfBuildIfNeeded() {
    var prose = $("#prose");
    if (!prose) return false;
    var stale = !lfCache || lfCache.prose !== prose || !lfCache.items.length || !lfCache.items[0].el.isConnected;
    if (stale) {
      lfCache = { prose: prose, items: $$("#prose p[data-pi]").map(function (p) {
        return { el: p, off: p.offsetTop, h: p.offsetHeight };
      }) };
    }
    return true;
  }
  function markFocusParagraphs(force) {
    var stage = $(".reader-stage");
    var scroller = $("#reader-scroller");
    if (!stage || !scroller) return;
    var vh = stage.clientHeight;
    if (!vh) return;
    if (!lfBuildIfNeeded()) return;
    force = force || false;
    var center = vh / 2;
    var half = prefs.focus === "band" ? vh * 0.175 : Math.max(30, vh * 0.055);
    var best = null, bestD = 1e9;
    var items = lfCache.items;
    var st = scroller.scrollTop;
    for (var j = 0; j < items.length; j++) {
      var it = items[j], p = it.el;
      var pc = it.off + it.h / 2 - st;
      var d = Math.abs(pc - center);
      if (d < bestD) { bestD = d; best = p; }
      var dim = d > half;
      if (dim !== p.classList.contains("lf-dim")) p.classList.toggle("lf-dim", dim);
    }
    // ruler: at least the closest paragraph stays focused (it would otherwise never
    // land inside a thin band, making the rule look broken)
    if (prefs.focus === "ruler" && best) best.classList.remove("lf-dim");
  }
  var lfRAF = 0;
  function lfScrollMark() {
    if (state.mode !== "scroll" || prefs.focus === "off") return;
    if (lfRAF) return;
    lfRAF = requestAnimationFrame(function () { lfRAF = 0; markFocusParagraphs(false); });
  }

  /* ============================================================
     ROUTING
     ============================================================ */
  function parseHash() {
    var h = (location.hash || "").replace(/^#\/?/, "");
    var parts = h.split("/").filter(Boolean);
    if (!parts.length || parts[0] === "lib") return { view: "lib" };
    if (parts[0] === "r" && parts.length >= 3) {
      var vid = parts[1], c = parseInt(parts[2], 10) || 0, page = null;
      if (parts[3] && /^p\d+$/.test(parts[3])) page = parseInt(parts[3].slice(1), 10);
      return { view: "reader", vid: vid, c: c, page: page };
    }
    return { view: "lib" };
  }
  function setHash(path, replace) {
    // Always emit a leading slash so the hash matches the brief's contract (#/r/v15/0[/p<N>], #/lib).
    if (path.charAt(0) !== "/") path = "/" + path;
    if (replace) history.replaceState(null, "", "#" + path);
    else history.pushState(null, "", "#" + path);
  }
  function navigate(path, opts) {
    opts = opts || {};
    setHash(path, !!opts.replace);
    route();
  }
  function route() {
    var r = parseHash();
    if (r.view === "reader" && bookById(r.vid)) {
      state.view = "reader"; state.vid = r.vid; state.c = clamp(r.c, 0, chaptersOf(r.vid).length - 1);
      state.mode = prefs.mode;
      // page only resumes when re-entering the SAME chapter; a different chapter starts at page 0
      if (r.page != null && prefs.mode === "paged") state.page = r.page;
      else if (prog[r.vid] && prog[r.vid].mode === "paged" && prog[r.vid].c === r.c) state.page = prog[r.vid].page || 0;
      else state.page = 0;
      showView("reader");
      renderReader();
    } else {
      state.view = "lib";
      stopAutoScroll();
      showView("lib");
      setHash("lib", true);
    }
  }
  function showView(v) {
    document.body.setAttribute("data-view", v);
    $("#view-lib").classList.toggle("is-active", v === "lib");
    $("#view-reader").classList.toggle("is-active", v === "reader");
    autoScrollViewSync();
  }

  /* ============================================================
     LIBRARY
     ============================================================ */
  function renderLib() {
    var rowCount = $("#stage-row");
    rowCount.innerHTML = "";
    BOOKS.forEach(function (b, i) {
      var p = prog[b.id] || {};
      var total = b.chapters.length;
      var read = p.c != null ? p.c + 1 : 0;
      var pct = total ? Math.round((read / total) * 100) : 0;
      var card = document.createElement("div");
      card.className = "book-card";
      card.setAttribute("data-action", "open-book");
      card.setAttribute("data-vid", b.id);
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.style.setProperty("--i", i);
      card.innerHTML =
        '<span class="book-num">VOL ' + String(b.num).padStart(2, "0") + "</span>" +
        '<div class="book-cover-wrap"><img class="book-cover" loading="lazy" src="' + esc(b.cover) + '" alt="' + esc(b.title) + '"/></div>' +
        '<div class="book-meta">' +
        '<div class="book-title">Volume ' + String(b.num) + "</div>" +
        '<div class="book-sub">' + esc(b.subtitle || "") + "</div>" +
        '<div class="book-progress"><span class="bar"><i style="width:' + pct + '%"></i></span><span class="pct">' + pct + "%</span></div>" +
        "</div>";
      card.addEventListener("mouseenter", function () { spotlightBook(b.id); });
      rowCount.appendChild(card);
    });
    $("#lib-count").textContent = BOOKS.length + " volume";

    // continue reading
    renderContinue();
    // initial filmstrip
    var firstVid = (function () {
      var latest = null, lt = 0;
      BOOKS.forEach(function (b) { if (prog[b.id] && prog[b.id].ts > lt) { lt = prog[b.id].ts; latest = b.id; } });
      return latest || (BOOKS[0] && BOOKS[0].id);
    })();
    if (firstVid) spotlightBook(firstVid);

    // staggered entrance
    if (!reduceMotion && window.anime) {
      try {
        anim("#stage-row .book-card", { translateY: [18, 0], opacity: [0, 1], delay: window.anime ? window.anime.stagger(70, { from: "center" }) : 0, duration: 540, ease: "outExpo" });
      } catch (e) {}
    }
  }

  function renderContinue() {
    var slot = $("#continue-slot");
    var latest = null, lt = 0;
    BOOKS.forEach(function (b) { if (prog[b.id] && prog[b.id].ts > lt) { lt = prog[b.id].ts; latest = b; } });
    if (!latest && BOOKS[0]) latest = BOOKS[0];
    if (!latest) { slot.innerHTML = ""; return; }
    var p = prog[latest.id] || {};
    var total = latest.chapters.length;
    var c = p.c || 0;
    var pct = total ? Math.round(((c + 1) / total) * 100) : 0;
    var chTitle = latest.chapters[c] ? latest.chapters[c].title : "Bab 1";
    var kicker = prog[latest.id] ? "Lanjutkan membaca" : "Mulai membaca";
    slot.innerHTML =
      '<div class="continue" data-action="open-book" data-vid="' + latest.id + '" role="button" tabindex="0">' +
      '<img class="continue-cover" src="' + esc(latest.cover) + '" alt="' + esc(latest.title) + '"/>' +
      '<div class="continue-meta">' +
      '<div class="continue-kicker">' + kicker + "</div>" +
      '<div class="continue-title">' + esc(latest.title) + "</div>" +
      '<div class="continue-chap">' + esc(chTitle) + "</div>" +
      '<div class="continue-bar"><i style="width:' + pct + '%"></i></div>' +
      "</div>" +
      '<div class="continue-cta"><span class="btn">' + (prog[latest.id] ? "Lanjut" : "Baca") + '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></span></div>' +
      "</div>";
  }

  function galleryOf(book) {
    var arr = [];
    (book.frontGallery || []).forEach(function (g) { if (g[0] === "fig") arr.push({ src: g[1].src, thumb: g[1].thumb, orient: g[1].orient, cap: "Ilustrasi" }); });
    (book.backGallery || []).forEach(function (grp) {
      (grp.imgs || []).forEach(function (g) { if (g[0] === "fig") arr.push({ src: g[1].src, thumb: g[1].thumb, orient: g[1].orient, cap: grp.title || "Galeri" }); });
    });
    return arr;
  }

  function spotlightBook(vid) {
    var book = bookById(vid); if (!book) return;
    var wrap = $("#filmstrip-wrap");
    var gal = galleryOf(book);
    if (!gal.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $("#film-title").textContent = book.title + " · " + gal.length + " karya";
    var strip = $("#filmstrip");
    strip.innerHTML = "";
    gal.forEach(function (g, i) {
      var c = document.createElement("div");
      c.className = "film-card";
      c.setAttribute("data-orient", g.orient || "portrait");
      c.setAttribute("data-action", "open-fig-from-gallery");
      c.setAttribute("data-vid", vid);
      c.setAttribute("data-i", i);
      c.setAttribute("role", "button");
      c.setAttribute("tabindex", "0");
      c.innerHTML = '<img loading="lazy" src="' + esc(g.thumb || g.src) + '" alt="' + esc(g.cap) + '"/><span class="fc-label">' + esc(g.cap) + "</span>";
      strip.appendChild(c);
    });
  }

  /* ============================================================
     READER
     ============================================================ */
  function renderReader() {
    var vid = state.vid, c = state.c;
    var book = bookById(vid);
    var chapters = chaptersOf(vid);
    if (!book || !chapters.length) { navigate("lib", { replace: true }); return; }
    c = clamp(c, 0, chapters.length - 1);
    state.c = c;
    var ch = chapters[c];
    if (!ch) { navigate("lib", { replace: true }); return; }

    // toolbar title
    $("#reader-chaptitle").innerHTML = "<b>" + esc(book.title) + "</b> · " + esc(ch.title || "");
    // announce chapter change to screen readers
    var sr = $("#sr-status");
    if (sr) sr.textContent = "Bab " + (c + 1) + ": " + (ch.title || "");

    // progress save (chapter reached). Reset per-chapter scroll/page when the chapter actually
    // changes so we never restore a previous chapter's position into a new one.
    var p = prog[vid] || {};
    var chapterChanged = (p.c !== c);
    p.c = c; p.ts = Date.now(); p.mode = state.mode;
    if (chapterChanged) { p.page = 0; p.scroll = 0; }
    prog[vid] = p; save(KEYS.prog, prog);

    countStats(vid, c);

    // build prose
    var prose = $("#prose");
    prose.innerHTML = "";
    var words = chapterWords(ch);
    var readMin = Math.max(1, Math.round(words / 250));
    var head = document.createElement("header");
    head.className = "chapter-head";
    head.innerHTML =
      '<div class="chapter-kicker">VOL ' + String(book.num).padStart(2, "0") + " · BAB " + (c + 1) + " · ≈ " + readMin + " mnt</div>" +
      '<h1 class="chapter-title">' + esc(ch.title || "") + "</h1>";
    // recap card — first chapter of a volume with meta; open only until first dismissed
    if (c === 0 && META[vid]) {
      var meta = META[vid] || {};
      if (meta.recap || meta.arc) {
        var recap = document.createElement("details");
        recap.className = "recap-card";
        recap.setAttribute("data-recap", "");
        recap.open = prefs.recapSeen[vid] !== true;
        recap.innerHTML =
          '<summary>Sebelumnya di Volume ' + book.num + " \u2014 <b>" + esc(meta.arc || "") + '</b> <span class="recap-chev">\u25BE</span></summary>' +
          "<p>" + esc(meta.recap || "") + "</p>";
        recap.addEventListener("toggle", function () {
          if (!recap.open) { prefs.recapSeen[vid] = true; savePrefs(); }
        });
        prose.appendChild(recap);
      }
    }
    prose.appendChild(head);

    var pi = 0;
    var figs = [];
    (ch.blocks || []).forEach(function (b) {
      var type = b[0], payload = b[1];
      if (type === "p") {
        var pEl = document.createElement("p");
        pEl.setAttribute("data-pi", pi);
        pEl.innerHTML = renderParagraphInner(vid, c, pi, String(payload));
        // bookmark mark
        if (hasBookmark(vid, c, pi)) pEl.classList.add("is-marked");
        prose.appendChild(pEl);
        pi++;
      } else if (type === "pov") {
        var pv = document.createElement("p");
        pv.className = "pov-line";
        pv.setAttribute("data-pi", "pov");
        pv.textContent = "— " + (payload || "");
        prose.appendChild(pv);
      } else if (type === "orn") {
        var o = document.createElement("div");
        o.className = "orn";
        o.setAttribute("aria-hidden", "true");
        o.textContent = "· · ·";
        prose.appendChild(o);
      } else if (type === "fig" && payload && payload.src) {
        var f = document.createElement("figure");
        f.className = "fig";
        f.setAttribute("data-orient", payload.orient || "portrait");
        var btn = document.createElement("button");
        btn.setAttribute("data-action", "open-fig");
        btn.setAttribute("data-vid", vid);
        btn.setAttribute("data-c", c);
        btn.setAttribute("data-fig", figs.length);
        btn.setAttribute("aria-label", "Buka ilustrasi");
        btn.innerHTML = '<img loading="lazy" src="' + esc(payload.thumb || payload.src) + '" alt="Ilustrasi"/>';
        f.appendChild(btn);
        var cap = document.createElement("figcaption");
        cap.className = "fig-cap";
        cap.textContent = "Ilustrasi · " + (payload.src.replace(/^.*\//, "").replace(/\.[^.]+$/, ""));
        f.appendChild(cap);
        prose.appendChild(f);
        figs.push({ src: payload.src, thumb: payload.thumb, orient: payload.orient, cap: "Ilustrasi" });
        // store figs for current chapter for lightbox
      }
    });
    prose._figs = figs;
    prose._vid = vid; prose._c = c;

    // end-of-chapter CTA: next chapter or "selesai"
    var maxChap = chaptersOf(vid).length - 1;
    var foot = document.createElement("footer");
    foot.className = "chap-end";
    if (c < maxChap) {
      var nextCh = chaptersOf(vid)[c + 1];
      foot.innerHTML = '<div class="chap-end-label">Bab berikutnya</div>' +
        '<button class="chap-end-cta" data-action="next-chap-end" role="button">' +
        '<span class="chap-end-arrow">→</span> ' + esc(nextCh ? (nextCh.title || "Bab " + (c + 2)) : "Bab " + (c + 2)) + '</button>';
    } else {
      foot.innerHTML = '<div class="chap-end-done">✓ Bab terakhir volume ini</div>';
    }
    prose.appendChild(foot);
    // spacer so end-of-chapter controls clear the mobile browser bar at max scroll
    var spacer = document.createElement("div");
    spacer.className = "chap-end-spacer";
    spacer.setAttribute("aria-hidden", "true");
    prose.appendChild(spacer);

    // volume finale — last chapter of the volume
    if (c === maxChap) {
      var vfin = document.createElement("footer");
      vfin.className = "vol-finale";
      var vCount = chaptersOf(vid).length;
      var vWords = 0;
      chaptersOf(vid).forEach(function (ch2) { vWords += chapterWords(ch2); });
      var bookIdx = -1;
      for (var bi = 0; bi < BOOKS.length; bi++) if (BOOKS[bi].id === vid) { bookIdx = bi; break; }
      var nextBook = (bookIdx >= 0 && bookIdx < BOOKS.length - 1) ? BOOKS[bookIdx + 1] : null;
      vfin.innerHTML =
        '<div class="vol-finale-check">\u2713 Volume ' + book.num + " selesai</div>" +
        '<div class="vol-finale-stats">' + vCount + " bab \u00b7 " + vWords.toLocaleString("id") + " kata</div>" +
        '<div class="vol-finale-btns">' +
          '<button class="btn ghost" data-action="back-lib">Ke perpustakaan</button>' +
          (nextBook ? '<button class="btn" data-action="next-volume" data-vid="' + nextBook.id + '">Volume ' + nextBook.num + " \u2192</button>" : "") +
        "</div>";
      prose.appendChild(vfin);
    }

    // apply highlights (offset-based, works across inline tags)
    applyHighlightsToProse();

    // mode
    applyMode();

    // entrance animation — gate on chapter change only (avoids re-fade on highlight/bookmark toggle)
    if (!reduceMotion && window.anime && state._lastChapKey !== (vid + ":" + c)) {
      state._lastChapKey = vid + ":" + c;
      try {
        anim("#prose > *", { translateY: [14, 0], opacity: [0, 1], delay: window.anime ? window.anime.stagger(40, { start: 40 }) : 0, duration: 380, ease: "outQuad" });
      } catch (e) {}
    }

    // toc current
    $$("#toc-list .toc-item").forEach(function (it) {
      it.classList.toggle("is-current", parseInt(it.getAttribute("data-c"), 10) === c);
    });
    updateProgress();
    // resume auto-scroll if enabled
    if (prefs.autoScroll && state.mode === "scroll") startAutoScroll();
  }

  function renderParagraphInner(vid, c, pi, text) {
    var s = processParagraph(text, pi);
    // highlights applied after DOM render via applyHighlightsToProse (offset-based)
    return s;
  }

  /* ---------------- modes ---------------- */
  function applyMode() {
    var scroller = $("#reader-scroller");
    var prose = $("#prose");
    var hud = $("#page-hud");
    var tap = $("#tap-zones");
    state.mode = prefs.mode;
    if (state.mode === "paged") {
      scroller.classList.add("paged");
      prose.classList.add("paged");
      hud.hidden = false;
      tap.classList.remove("hidden");
      // measure after layout
      requestAnimationFrame(function () { recomputePaged(); restorePage(); });
    } else {
      scroller.classList.remove("paged");
      prose.classList.remove("paged");
      prose.style.removeProperty("--page-w");
      prose.style.removeProperty("--page-h");
      prose.style.removeProperty("--page-gap");
      prose.style.removeProperty("--page");
      hud.hidden = true;
      tap.classList.add("hidden");
      restoreScroll();
    }
    var mv = $("#mode-val"); if (mv) mv.textContent = state.mode === "paged" ? "halaman" : "gulir";
    var btnMode = $("#btn-mode"); if (btnMode) btnMode.setAttribute("aria-pressed", String(state.mode === "paged"));
    // auto-scroll: stop in paged, start in scroll if enabled
    if (state.mode === "paged") stopAutoScroll();
    else if (prefs.autoScroll && state.view === "reader") startAutoScroll();
    autoScrollViewSync();
    // line focus only applies in scroll mode
    applyFocus();
  }

  function recomputePaged() {
    if (state.mode !== "paged") return;
    var stage = $(".reader-stage");
    var prose = $("#prose");
    if (!stage || !prose) return;
    var cs = getComputedStyle(prose);
    var padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
    var padT = parseFloat(cs.paddingTop) || 0, padB = parseFloat(cs.paddingBottom) || 0;
    var pageW = Math.max(200, stage.clientWidth - padL - padR);
    var pageH = Math.max(200, stage.clientHeight - padT - padB);
    var gap = 64;
    prose.style.setProperty("--page-w", pageW + "px");
    prose.style.setProperty("--page-h", pageH + "px");
    prose.style.setProperty("--page-gap", gap + "px");
    var sw = prose.scrollWidth;
    var total = Math.max(1, Math.round((sw + gap) / (pageW + gap)));
    state.pageCount = total;
    state.page = clamp(state.page, 0, total - 1);
    prose.style.setProperty("--page", state.page);
    updatePageHud();
  }

  function updatePageHud() {
    $("#pg-cur").textContent = (state.page + 1);
    $("#pg-total").textContent = state.pageCount;
    var f = $("#pg-bar-fill");
    if (f) f.style.transform = "scaleX(" + (state.pageCount ? (state.page + 1) / state.pageCount : 0) + ")";
  }

  function setPage(p) {
    if (state.mode !== "paged") return;
    // auto-advance to next chapter at last page
    if (p > state.pageCount - 1) {
      var maxChap = chaptersOf(state.vid).length - 1;
      if (state.c < maxChap) { goChapter(state.c + 1); return; }
      toast("Sudah di bab terakhir");
      return;
    }
    if (p < 0) {
      if (state.c > 0) { goChapter(state.c - 1); return; }
      toast("Sudah di bab pertama");
      return;
    }
    if (p === state.page) return;
    var prev = state.page;
    state.page = p;
    $("#prose").style.setProperty("--page", state.page);
    updatePageHud();
    saveProgressPage();
    // silent hash sync (no route() — avoids a full re-render on every page turn)
    setHash("r/" + state.vid + "/" + state.c + "/p" + state.page, true);
    updateProgress();
    // page-turn cue (uses CSS individual `translate` property — composes with the
    // paged `transform`, so the column offset is preserved)
    if (!reduceMotion && window.anime) {
      try { anim("#prose", { translateX: [p > prev ? 14 : -14, 0], opacity: [0.5, 1], duration: 160, easing: "easeOutQuad" }); } catch (e) {}
    }
  }

  function restorePage() {
    // state.page is already resolved by route(); here we only clamp, apply and persist.
    // Silent hash update only — calling navigate() here re-enters route()→renderReader()→
    // applyMode()→rAF(restorePage) and loops forever in paged mode.
    state.page = clamp(state.page, 0, state.pageCount - 1);
    $("#prose").style.setProperty("--page", state.page);
    updatePageHud();
    if (state.mode === "paged") {
      saveProgressPage();
      setHash("r/" + state.vid + "/" + state.c + "/p" + state.page, true);
    }
  }

  function saveProgressPage() {
    var p = prog[state.vid] || {};
    p.c = state.c; p.mode = state.mode; p.page = state.page; p.ts = Date.now();
    prog[state.vid] = p; save(KEYS.prog, prog);
  }

  function restoreScroll() {
    var p = prog[state.vid];
    var scroller = $("#reader-scroller");
    if (p && p.c === state.c && typeof p.scroll === "number" && prefs.mode === "scroll") {
      requestAnimationFrame(function () { scroller.scrollTop = p.scroll; updateProgress(); });
    } else {
      scroller.scrollTop = 0;
    }
  }

  function updateProgress() {
    var ember = $("#ember-fill");
    if (!ember) return;
    var pct = 0;
    if (state.mode === "paged") {
      pct = state.pageCount ? (state.page + 1) / state.pageCount : 0;
    } else {
      var scroller = $("#reader-scroller");
      var max = scroller.scrollHeight - scroller.clientHeight;
      pct = max > 0 ? scroller.scrollTop / max : 0;
      // also factor chapter position
    }
    // blend with chapter progress across book
    var book = bookById(state.vid);
    var chFrac = book ? state.c / Math.max(1, book.chapters.length - 1) : 0;
    var total = chFrac * 0.85 + pct * 0.15;
    var clamped = clamp(total, 0, 1);
    ember.style.transform = "scaleY(" + clamped + ")";
    var bar = $(".progress-ember");
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
  }

  /* ---------------- TOC ---------------- */
  function renderTOC() {
    var book = bookById(state.vid); if (!book) return;
    var list = $("#toc-list");
    list.innerHTML = "";
    book.chapters.forEach(function (ch, i) {
      var li = document.createElement("li");
      li.className = "toc-item";
      li.setAttribute("data-action", "toc-go");
      li.setAttribute("data-c", i);
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      var p = prog[state.vid];
      var read = p && p.c != null && i <= p.c;
      li.innerHTML =
        '<span class="toc-n">' + String(i + 1).padStart(2, "0") + "</span>" +
        '<span class="toc-t">' + esc(ch.title) + "</span>" +
        (read ? '<span class="toc-read">✓</span>' : "");
      list.appendChild(li);
    });
    $$("#toc-list .toc-item").forEach(function (it) {
      it.classList.toggle("is-current", parseInt(it.getAttribute("data-c"), 10) === state.c);
    });
  }
  function renderTocChars() {
    var box = $("#toc-chars");
    if (!box) return;
    var meta = META[state.vid];
    var hasChars = meta && meta.chars && meta.chars.length;
    var hasTerms = meta && meta.terms && meta.terms.length;
    if (!meta || (!hasChars && !hasTerms)) {
      box.innerHTML = '<div class="search-empty">Belum ada data karakter untuk volume ini.</div>';
      return;
    }
    var html = "";
    if (hasChars) {
      html += '<div class="chars-sect">Karakter</div>';
      meta.chars.forEach(function (ch, i) {
        html += '<div class="char-card" data-action="char-toggle" data-i="' + i + '" role="button" tabindex="0" aria-expanded="false">' +
          '<div class="char-name">' + esc(ch.n || "") + (ch.aka ? ' <span class="char-aka">\u00b7 ' + esc(ch.aka) + "</span>" : "") + "</div>" +
          '<span class="char-desc" hidden>' + esc(ch.desc || "") + "</span>" +
          "</div>";
      });
    }
    if (hasTerms) {
      html += '<div class="chars-sect">Istilah</div>';
      meta.terms.forEach(function (tm, i) {
        html += '<div class="char-card term-card" data-action="term-toggle" data-i="' + i + '" role="button" tabindex="0" aria-expanded="false">' +
          '<div class="char-name">' + esc(tm.t || "") + "</div>" +
          '<span class="char-desc" hidden>' + esc(tm.desc || "") + "</span>" +
          "</div>";
      });
    }
    box.innerHTML = html;
  }
  function setTocTab(tab) {
    state.tocTab = tab;
    $$("#toc-tabs button").forEach(function (b) {
      var on = b.getAttribute("data-tab") === tab;
      b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on));
    });
    var tl = $("#toc-list"), tc = $("#toc-chars");
    if (tl) tl.hidden = tab !== "toc";
    if (tc) { tc.hidden = tab !== "chars"; if (tab === "chars") renderTocChars(); }
  }

  /* ---------------- search ---------------- */
  var searchTimer;
  function runSearch(q) {
    var box = $("#search-results");
    q = (q || "").trim().toLowerCase();
    if (!q) { box.innerHTML = '<div class="search-empty">Ketik untuk mencari di semua buku…</div>'; return; }
    box.innerHTML = '<div class="search-empty">Mencari…</div>';
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var results = [];
      BOOKS.forEach(function (b) {
        var chapters = chaptersOf(b.id);
        chapters.forEach(function (ch, ci) {
          var pIdx = 0; // matches the data-pi attribute, which counts only "p" blocks
          (ch.blocks || []).forEach(function (blk) {
            if (blk[0] !== "p") return;
            var t = String(blk[1]);
            var low = t.toLowerCase();
            var idx = low.indexOf(q);
            if (idx >= 0) {
              var snip = t.slice(Math.max(0, idx - 40), idx + q.length + 60);
              snip = snip.replace(/\*([^*]+)\*/g, "$1");
              var esn = esc(snip);
              var eq = esc(q);
              esn = esn.replace(new RegExp(quoteRe(eq), "gi"), function (m) { return "<b>" + m + "</b>"; });
              results.push({ vid: b.id, c: ci, pi: pIdx, meta: b.title + " · " + ch.title, snip: esn });
            }
            pIdx++;
          });
        });
      });
      if (!results.length) { box.innerHTML = '<div class="search-empty">Tidak ada hasil untuk “' + esc(q) + '”.</div>'; return; }
      box.innerHTML = "";
      results.slice(0, 60).forEach(function (r) {
        var d = document.createElement("div");
        d.className = "search-result";
        d.setAttribute("data-action", "search-go");
        d.setAttribute("data-vid", r.vid);
        d.setAttribute("data-c", r.c);
        d.setAttribute("data-pi", r.pi);
        d.setAttribute("role", "button");
        d.setAttribute("tabindex", "0");
        d.innerHTML = '<div class="sr-meta">' + esc(r.meta) + "</div><div class=\"sr-snippet\">" + r.snip + "</div>";
        box.appendChild(d);
      });
    }, 180);
  }
  function quoteRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  /* ---------------- bookmarks ---------------- */
  function hasBookmark(vid, c, pi) {
    return bms.some(function (m) { return m.vid === vid && m.c === c && m.pi === pi; });
  }
  function toggleCurrentBookmark() {
    var p = currentParagraph();
    if (!p) { toast("Arahkan ke paragraf dulu"); return; }
    var pi = parseInt(p.getAttribute("data-pi"), 10);
    if (isNaN(pi)) { toast("Tidak bisa menandai baris ini"); return; }
    var idx = bms.findIndex(function (m) { return m.vid === state.vid && m.c === state.c && m.pi === pi; });
    if (idx >= 0) { bms.splice(idx, 1); toast("Penanda dilepas"); }
    else {
      var txt = p.textContent.replace(/\s+/g, " ").trim().slice(0, 140);
      bms.push({ vid: state.vid, c: state.c, pi: pi, text: txt, ts: Date.now() });
      toast("Ditandai");
    }
    save(KEYS.bms, bms);
    p.classList.toggle("is-marked", hasBookmark(state.vid, state.c, pi));
    renderMarks();
  }
  function currentParagraph() {
    var stage = $(".reader-stage");
    var r = stage.getBoundingClientRect();
    var ps = $$("#prose p[data-pi]");
    var best = null, bestTop = Infinity;
    ps.forEach(function (p) {
      var pr = p.getBoundingClientRect();
      if (pr.left < r.right - 20 && pr.right > r.left + 20) {
        var top = pr.top - r.top;
        if (top > -20 && top < bestTop) { bestTop = top; best = p; }
      }
    });
    return best;
  }
  function dueReviews() {
    var now = Date.now();
    var out = [];
    for (var i = 0; i < hls.length; i++) {
      var h = hls[i];
      if (typeof h.reviewDue === "number" && h.reviewDue <= now) out.push(i);
    }
    return out;
  }
  function updateMarksBadge() {
    var badge = $("#marks-badge");
    if (!badge) return;
    var n = dueReviews().length;
    badge.hidden = n === 0;
    badge.textContent = n > 9 ? "9+" : String(n);
  }
  function renderMarks() {
    var box = $("#marks-list");
    updateMarksBadge();
    var due = dueReviews();
    box.innerHTML = "";
    var sectHead = function (label) {
      var h = document.createElement("div");
      h.className = "marks-sect";
      h.setAttribute("style", "font-family:var(--font-ui);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);margin:14px 4px 6px;padding-bottom:4px;border-bottom:1px solid var(--line)");
      h.textContent = label;
      box.appendChild(h);
    };
    // daily review (Readwise-style) — always shown at top
    sectHead("Ulas Harian");
    if (due.length) {
      due.forEach(function (idx) {
        var h = hls[idx];
        var book = bookById(h.vid);
        var d = document.createElement("div");
        d.className = "mark-item review-item";
        d.innerHTML =
          '<div style="flex:1;min-width:0">' +
          '<div class="mi-t">' + esc(h.text) + "</div>" +
          '<div class="mi-meta">' + esc(book ? book.title : h.vid) + " \u00b7 " + esc((book && book.chapters[h.c]) ? book.chapters[h.c].title : "Bab " + (h.c + 1)) + "</div>" +
          '<div class="review-btns">' +
            '<button class="btn" data-action="review-ok" data-hi="' + idx + '">Ingat</button>' +
            '<button class="btn ghost" data-action="review-lupa" data-hi="' + idx + '">Lupa</button>' +
          "</div></div>";
        box.appendChild(d);
      });
    } else {
      var e = document.createElement("div");
      e.className = "search-empty";
      e.setAttribute("style", "margin:4px 4px 8px");
      e.textContent = "Tidak ada ulasan hari ini.";
      box.appendChild(e);
    }
    // onboarding hint when there are no bookmarks or highlights yet
    if (!bms.length && !hls.length) {
      var onb = document.createElement("div");
      onb.className = "search-empty";
      onb.setAttribute("style", "margin:8px 4px");
      onb.textContent = "Belum ada penanda. Tekan tombol bintang saat membaca untuk menandai paragraf, atau pilih teks untuk menyortot kutipan.";
      box.appendChild(onb);
      return;
    }
    if (bms.length) {
      sectHead("Penanda");
      bms.slice().reverse().forEach(function (m, i) {
        var real = bms.length - 1 - i;
        var book = bookById(m.vid);
        var d = document.createElement("div");
        d.className = "mark-item";
        d.setAttribute("data-action", "mark-go");
        d.setAttribute("data-vid", m.vid);
        d.setAttribute("data-c", m.c);
        d.setAttribute("data-pi", m.pi);
        d.setAttribute("role", "button");
        d.setAttribute("tabindex", "0");
        d.innerHTML =
          '<span class="mi-ico">✦</span>' +
          '<div style="flex:1;min-width:0">' +
          '<div class="mi-t">' + esc(m.text) + "</div>" +
          '<div class="mi-meta">' + esc(book ? book.title : m.vid) + " · " + esc((book && book.chapters[m.c]) ? book.chapters[m.c].title : "Bab " + (m.c + 1)) + "</div>" +
          "</div>" +
          '<button class="iconbtn mark-del" data-action="mark-del" data-id="' + real + '" aria-label="Hapus penanda"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>';
        box.appendChild(d);
      });
    }
    if (hls.length) {
      sectHead("Sorotan");
      hls.slice().reverse().forEach(function (h, i) {
        var real = hls.length - 1 - i;
        var book = bookById(h.vid);
        var d = document.createElement("div");
        d.className = "mark-item hl-item";
        d.setAttribute("data-action", "hl-go");
        d.setAttribute("data-vid", h.vid);
        d.setAttribute("data-c", h.c);
        d.setAttribute("data-pi", h.pi);
        d.setAttribute("data-id", real);
        d.setAttribute("role", "button");
        d.setAttribute("tabindex", "0");
        d.innerHTML =
          '<span class="mi-ico">▮</span>' +
          '<div style="flex:1;min-width:0">' +
          '<div class="mi-t">' + esc(h.text) + "</div>" +
          '<div class="mi-meta">' + esc(book ? book.title : h.vid) + " · " + esc((book && book.chapters[h.c]) ? book.chapters[h.c].title : "Bab " + (h.c + 1)) + "</div>" +
          "</div>" +
          '<button class="iconbtn mark-del" data-action="hl-del" data-id="' + real + '" aria-label="Hapus sorotan"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>';
        box.appendChild(d);
      });
    }
  }

  /* ---------------- highlights ---------------- */
  function addHighlightFromSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    var node = sel.anchorNode;
    if (!node) return;
    var p = node.nodeType === 3 ? node.parentElement : node;
    p = p && p.closest("#prose p[data-pi]");
    if (!p) return;
    var pi = parseInt(p.getAttribute("data-pi"), 10);
    if (isNaN(pi)) return;
    var txt = sel.toString().replace(/\s+/g, " ").trim();
    if (txt.length < 2) return;
    // compute char offsets within the paragraph's textContent
    var range = sel.getRangeAt(0);
    var pText = p.textContent;
    var start = 0, end = 0;
    try {
      var preRange = document.createRange();
      preRange.setStart(p, 0);
      preRange.setEnd(range.startContainer, range.startOffset);
      start = preRange.toString().length;
      end = start + range.toString().length;
    } catch (e) { start = 0; end = txt.length; }
    hls.push({ vid: state.vid, c: state.c, pi: pi, text: txt, start: start, end: end, ts: Date.now(), reviewDue: Date.now() + 24 * 3600 * 1000, interval: 1 });
    save(KEYS.hls, hls);
    sel.removeAllRanges();
    toast("Disorot");
    renderReader();
  }
  // wrap a range across tag boundaries using <mark>
  function wrapRangeWithMark(range, id) {
    var walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      if (!range.intersectsNode(node)) return;
      var start = (node === range.startContainer) ? range.startOffset : 0;
      var end = (node === range.endContainer) ? range.endOffset : node.nodeValue.length;
      if (start === end) return;
      var before = node.nodeValue.slice(0, start);
      var marked = node.nodeValue.slice(start, end);
      var after = node.nodeValue.slice(end);
      var mark = document.createElement("mark");
      mark.className = "hl";
      mark.setAttribute("data-action", "hl-click");
      mark.setAttribute("data-id", id);
      mark.textContent = marked;
      var parent = node.parentNode;
      if (before) parent.insertBefore(document.createTextNode(before), node);
      parent.insertBefore(mark, node);
      if (after) parent.insertBefore(document.createTextNode(after), node);
      parent.removeChild(node);
    });
  }
  function applyHighlightsToProse() {
    var prose = $("#prose");
    if (!prose || !prose._vid) return;
    var vid = prose._vid, c = prose._c;
    var paras = prose.querySelectorAll("p[data-pi]");
    paras.forEach(function (pEl) {
      var pi = parseInt(pEl.getAttribute("data-pi"), 10);
      if (isNaN(pi)) return;
      var matches = hls.filter(function (h) { return h.vid === vid && h.c === c && h.pi === pi; });
      if (!matches.length) return;
      matches.forEach(function (h, hi) {
        // offset-based: works across <em> and other inline tags
        if (typeof h.start === "number" && typeof h.end === "number" && h.end > h.start) {
          try {
            var walker = document.createTreeWalker(pEl, NodeFilter.SHOW_TEXT, null);
            var n, off = 0, rs = null, re = null;
            while ((n = walker.nextNode())) {
              var len = n.nodeValue.length;
              if (!rs && off + len >= h.start) rs = { n: n, o: Math.max(0, h.start - off) };
              if (!re && off + len >= h.end) re = { n: n, o: Math.max(0, h.end - off) };
              off += len;
              if (rs && re) break;
            }
            if (rs && re) {
              var r = document.createRange();
              r.setStart(rs.n, Math.min(rs.o, rs.n.nodeValue.length));
              r.setEnd(re.n, Math.min(re.o, re.n.nodeValue.length));
              var id = vid + ":" + c + ":" + pi + ":" + hi;
              wrapRangeWithMark(r, id);
            }
          } catch (e) {}
        } else {
          // legacy: text-based fallback for old highlights without offsets
          var needle = esc(h.text);
          if (!needle) return;
          var html = pEl.innerHTML;
          var idx = html.indexOf(needle);
          if (idx >= 0) {
            var id = vid + ":" + c + ":" + pi + ":" + hi;
            pEl.innerHTML = html.slice(0, idx) + '<mark class="hl" data-action="hl-click" data-id="' + id + '">' + html.slice(idx, idx + needle.length) + "</mark>" + html.slice(idx + needle.length);
          }
        }
      });
    });
  }
  function renderStats() {
    var box = $("#stats-body");
    var streak = computeStreak();
    var todayW = stats.days[todayKey()] || 0;
    var keys = Object.keys(stats.days).sort();
    var last14 = keys.slice(-14);
    var heat = "";
    for (var i = 0; i < 14; i++) {
      var k = last14[i];
      heat += '<i class="' + (k && stats.days[k] ? "on" : "") + '" title="' + esc(k || "") + '"></i>';
    }
    var t = todayKey();
    var todayCount = 0;
    for (var kk in stats.chapters) if (stats.chapters[kk] === t) todayCount++;
    var goal = prefs.goalBab || 0;
    var pct = goal > 0 ? Math.min(100, Math.round((todayCount / goal) * 100)) : 0;
    var ringStyle = goal > 0
      ? "background:conic-gradient(var(--accent) " + pct + "%, var(--line-strong) 0)"
      : "background:var(--line-strong)";
    box.innerHTML =
      '<div class="stat-grid">' +
      '<div class="stat-cell"><div class="v">' + stats.totalWords.toLocaleString("id") + "</div><div class=\"k\">Kata dibaca</div></div>" +
      '<div class="stat-cell"><div class="v">' + streak + "</div><div class=\"k\">Hari beruntun</div></div>" +
      '<div class="stat-cell"><div class="v">' + todayW.toLocaleString("id") + "</div><div class=\"k\">Hari ini</div></div>" +
      '<div class="stat-cell"><div class="v">' + Object.keys(stats.chapters).length + "</div><div class=\"k\">Bab dibuka</div></div>" +
      "</div>" +
      '<div class="goal-section">' +
        '<div class="goal-ring" id="goal-ring" style="' + ringStyle + '"><span>' + (goal > 0 ? pct + "%" : "\u2014") + "</span></div>" +
        '<div class="goal-meta">' +
          '<div class="goal-today">' + todayCount + " / " + (goal > 0 ? goal : "\u2014") + " bab hari ini</div>" +
          '<label class="goal-label" for="rng-goal">Target bab per hari</label>' +
          '<input id="rng-goal" type="number" min="0" max="50" value="' + goal + '" aria-label="Target bab per hari" />' +
        "</div>" +
      "</div>" +
      '<div style="padding:0 16px 16px"><div class="pop-label"><span>14 hari terakhir</span></div><div class="stat-heat">' + heat + "</div></div>" +
      '<div style="padding:0 16px;font-family:var(--font-mono);font-size:11px;color:var(--ink-faint)">Data tersimpan di perangkat ini.</div>';
    var rngGoal = $("#rng-goal");
    if (rngGoal) rngGoal.addEventListener("input", function () {
      var v = parseInt(this.value, 10);
      if (isNaN(v) || v < 0) v = 0;
      if (v > 50) v = 50;
      prefs.goalBab = v;
      savePrefs();
      updateGoalRing();
    });
  }
  function updateGoalRing() {
    var ring = $("#goal-ring");
    if (!ring) return;
    var t = todayKey();
    var todayCount = 0;
    for (var k in stats.chapters) if (stats.chapters[k] === t) todayCount++;
    var goal = prefs.goalBab || 0;
    var pct = goal > 0 ? Math.min(100, Math.round((todayCount / goal) * 100)) : 0;
    ring.style.background = goal > 0 ? "conic-gradient(var(--accent) " + pct + "%, var(--line-strong) 0)" : "var(--line-strong)";
    var span = ring.querySelector("span");
    if (span) span.textContent = goal > 0 ? pct + "%" : "\u2014";
    var meta = $(".goal-today");
    if (meta) meta.textContent = todayCount + " / " + (goal > 0 ? goal : "\u2014") + " bab hari ini";
  }

  /* ============================================================
     SHEETS / OVERLAYS
     ============================================================ */
  var SCRIM = $("#scrim");
  var lastFocus = null;
  var sheetFocusTrap = null;
  function openSheet(id) {
    closeSheets();
    var el = $("#" + id);
    if (!el) return;
    lastFocus = document.activeElement;
    el.classList.add("is-open");
    el.setAttribute("aria-hidden", "false");
    if ("inert" in el) el.inert = false;
    SCRIM.classList.add("is-open");
    // move focus into the sheet so keyboard users land inside
    var closer = el.querySelector('[data-action="close-sheets"]');
    if (closer) closer.focus({ preventScroll: true });
    // focus trap: cycle Tab/Shift+Tab within the open sheet
    sheetFocusTrap = function (e) {
      if (e.key !== "Tab") return;
      var f = el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener("keydown", sheetFocusTrap);
  }
  function closeSheets() {
    $$(".sheet").forEach(function (s) {
      s.classList.remove("is-open");
      s.setAttribute("aria-hidden", "true");
      if ("inert" in s) s.inert = true;
      if (sheetFocusTrap) s.removeEventListener("keydown", sheetFocusTrap);
    });
    sheetFocusTrap = null;
    SCRIM.classList.remove("is-open");
    closeSettings();
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} lastFocus = null; }
  }
  function closeSettings() {
    var pop = $("#settings-pop");
    pop.classList.remove("is-open");
    pop.setAttribute("aria-hidden", "true");
  }
  function toggleSettings(btn) {
    var pop = $("#settings-pop");
    var open = pop.classList.contains("is-open");
    closeSettings();
    if (open) return; // toggle closed — no stack
    // position near button
    var r = btn.getBoundingClientRect();
    var pw = 320;
    var left = Math.min(r.right - pw - 8, window.innerWidth - pw - 12);
    var top = r.bottom + 8;
    pop.style.left = Math.max(8, left) + "px";
    pop.style.top = top + "px";
    pop.classList.add("is-open");
    pop.setAttribute("aria-hidden", "false");
  }

  /* ============================================================
     EVENT DELEGATION (global — buttons never die)
     ============================================================ */
  function handle(action, el, e) {
    switch (action) {
      case "go-lib": navigate("lib"); closeSheets(); if (window.MT_TTS) MT_TTS.close(); break;
      case "open-book": {
        var vid = el.getAttribute("data-vid");
        var p = prog[vid] || {};
        var startC = p.c || 0;
        var path = "r/" + vid + "/" + startC;
        if (prefs.mode === "paged" && p.mode === "paged" && p.page != null) path += "/p" + p.page;
        navigate(path);
        break;
      }
      case "prev-chap": goChapter(state.c - 1); break;
      case "next-chap": goChapter(state.c + 1); break;
      case "next-chap-end": goChapter(state.c + 1); break;
      case "open-toc": renderTOC(); setTocTab(state.tocTab || "toc"); openSheet("sheet-toc"); break;
      case "open-search": openSheet("sheet-search"); setTimeout(function () { $("#search-input").focus(); }, 240); runSearch($("#search-input").value); break;
      case "open-marks": renderMarks(); openSheet("sheet-marks"); break;
      case "open-stats": renderStats(); openSheet("sheet-stats"); break;
      case "close-sheets": closeSheets(); if (window.MT_LB && MT_LB.isOpen) MT_LB.close(); break;
      case "toc-go": { var c = parseInt(el.getAttribute("data-c"), 10); closeSheets(); goChapter(c); break; }
      case "search-go": {
        var sv = el.getAttribute("data-vid"), sc = parseInt(el.getAttribute("data-c"), 10), spi = parseInt(el.getAttribute("data-pi"), 10);
        closeSheets();
        state.vid = sv; state.c = sc;
        navigate("r/" + sv + "/" + sc, { replace: true });
        // jump to paragraph
        requestAnimationFrame(function () {
          var target = $('#prose p[data-pi="' + spi + '"]');
          if (target) target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        });
        break;
      }
      case "mark-go": {
        var mv = el.getAttribute("data-vid"), mc = parseInt(el.getAttribute("data-c"), 10), mpi = parseInt(el.getAttribute("data-pi"), 10);
        closeSheets();
        state.vid = mv; state.c = mc;
        navigate("r/" + mv + "/" + mc, { replace: true });
        requestAnimationFrame(function () {
          var t = $('#prose p[data-pi="' + mpi + '"]');
          if (t) t.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        });
        break;
      }
      case "mark-del": {
        var id = parseInt(el.getAttribute("data-id"), 10);
        if (!isNaN(id)) { bms.splice(id, 1); save(KEYS.bms, bms); renderMarks(); renderReader(); toast("Penanda dihapus"); }
        break;
      }
      case "hl-click": {
        // open the marks panel so the user can review and jump to their highlights
        renderMarks(); openSheet("sheet-marks");
        break;
      }
      case "hl-go": {
        var hgv = el.getAttribute("data-vid"), hgc = parseInt(el.getAttribute("data-c"), 10), hgpi = parseInt(el.getAttribute("data-pi"), 10);
        closeSheets();
        state.vid = hgv; state.c = hgc;
        navigate("r/" + hgv + "/" + hgc, { replace: true });
        requestAnimationFrame(function () {
          var t = $('#prose p[data-pi="' + hgpi + '"]');
          if (t) t.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        break;
      }
      case "hl-del": {
        var hdid = parseInt(el.getAttribute("data-id"), 10);
        if (!isNaN(hdid)) { hls.splice(hdid, 1); save(KEYS.hls, hls); renderMarks(); renderReader(); toast("Sorotan dihapus"); }
        break;
      }
      case "toggle-bookmark": toggleCurrentBookmark(); break;
      case "toggle-mode": {
        prefs.mode = prefs.mode === "paged" ? "scroll" : "paged";
        state.mode = prefs.mode;
        applyPrefs(); savePrefs();
        applyMode();
        // applyMode already syncs the paged hash via restorePage; just keep URL consistent for scroll
        if (prefs.mode === "scroll") setHash("r/" + state.vid + "/" + state.c, true);
        toast(prefs.mode === "paged" ? "Mode halaman" : "Mode gulir");
        break;
      }
      case "toggle-settings": toggleSettings(el); break;
      case "set-theme": {
        var tt = el.getAttribute("data-t");
        if (tt === "auto") { prefs.themeAuto = "system"; }
        else { prefs.themeAuto = "off"; prefs.theme = tt; }
        applyPrefs(); savePrefs();
        toast(prefs.themeAuto !== "off" ? "Tema otomatis" : "Tema " + prefs.theme);
        break;
      }
      case "set-mode": { prefs.mode = el.getAttribute("data-m"); state.mode = prefs.mode; applyPrefs(); savePrefs(); applyMode(); if (prefs.mode === "scroll") setHash("r/" + state.vid + "/" + state.c, true); break; }
      case "set-font": { prefs.font = el.getAttribute("data-f"); applyPrefs(); savePrefs(); if (state.mode === "paged") recomputePaged(); break; }
      /* ---- auto-scroll FAB + floating panel ---- */
      case "fab-autoscroll": openAutoScrollPanel(); break;
      case "as-close": closeAutoScrollPanel(); break;
      case "as-play-toggle": {
        if (prefs.autoScroll) { prefs.autoScroll = false; stopAutoScroll(); toast("Gulir otomatis berhenti"); }
        else { prefs.autoScroll = true; savePrefs(); startAutoScroll(); toast("Gulir otomatis berjalan"); }
        applyPrefs(); savePrefs();
        break;
      }
      case "toggle-tts": if (window.MT_TTS) { MT_TTS.open(); if (!MT_TTS.playing) { var cp = currentParagraph(); MT_TTS.from(cp || $("#prose p[data-pi]")); } } break;
      case "tts-close": if (window.MT_TTS) MT_TTS.close(); break;
      case "tts-toggle": if (window.MT_TTS) MT_TTS.toggle(); break;
      case "page-prev": setPage(state.page - 1); break;
      case "page-next": setPage(state.page + 1); break;
      case "toggle-tap-zones": $("#tap-zones").classList.toggle("hidden"); break;
      case "open-fig": {
        var figs = $("#prose")._figs || [];
        var fi = parseInt(el.getAttribute("data-fig"), 10) || 0;
        if (window.MT_LB) MT_LB.open(figs, fi);
        break;
      }
      case "open-fig-from-gallery": {
        var gvid = el.getAttribute("data-vid");
        var gi = parseInt(el.getAttribute("data-i"), 10) || 0;
        var book = bookById(gvid);
        if (book && window.MT_LB) MT_LB.open(galleryOf(book), gi);
        break;
      }
      case "lb-prev": if (window.MT_LB) MT_LB.prev(); break;
      case "lb-next": if (window.MT_LB) MT_LB.next(); break;
      case "lb-zoom-in": if (window.MT_LB) MT_LB.zoomIn(); break;
      case "lb-zoom-out": if (window.MT_LB) MT_LB.zoomOut(); break;
      case "lb-reset": if (window.MT_LB) MT_LB.reset(); break;
      case "err-reload": location.reload(); break;
      case "err-go-lib": closeErrorGuard(); navigate("lib"); break;
      /* ---- feature 1: line focus ---- */
      case "set-focus": {
        prefs.focus = el.getAttribute("data-f");
        applyPrefs(); savePrefs();
        toast("Fokus " + (prefs.focus === "band" ? "pita" : prefs.focus === "ruler" ? "penggaris" : "mati"));
        break;
      }
      /* ---- feature 2: bionic reading ---- */
      case "toggle-bionic": {
        prefs.bionic = (el.getAttribute("data-b") === "on");
        applyPrefs(); savePrefs(); renderReader();
        toast(prefs.bionic ? "Baca bionik aktif" : "Baca bionik mati");
        break;
      }
      /* ---- feature 3: dyslexia mode ---- */
      case "toggle-dys": {
        prefs.dys = (el.getAttribute("data-d") === "on");
        applyPrefs(); savePrefs();
        toast(prefs.dys ? "Mode disleksia aktif" : "Mode disleksia mati");
        break;
      }
      /* ---- feature 6: ambient soundscapes ---- */
      case "set-ambient": {
        prefs.ambient = el.getAttribute("data-a");
        applyPrefs(); savePrefs();
        if (window.MT_AMBIENT) {
          if (prefs.ambient === "off") MT_AMBIENT.stop();
          else MT_AMBIENT.start(prefs.ambient);
        }
        toast(prefs.ambient === "off" ? "Suasana mati" : "Suasana " + prefs.ambient);
        break;
      }
      /* ---- feature 6b: music moods ---- */
      case "set-music": {
        prefs.music = el.getAttribute("data-m");
        applyPrefs(); savePrefs();
        if (window.MT_AMBIENT) {
          if (prefs.music === "off") MT_AMBIENT.stopMusic();
          else MT_AMBIENT.playMusic(prefs.music);
        }
        toast(prefs.music === "off" ? "Musik mati" : "Musik " + prefs.music);
        break;
      }
      /* ---- feature 12: justify + indent ---- */
      case "set-align": {
        prefs.align = el.getAttribute("data-al");
        applyPrefs(); savePrefs();
        break;
      }
      case "toggle-indent": {
        prefs.indent = (el.getAttribute("data-i") === "on");
        applyPrefs(); savePrefs();
        break;
      }
      /* ---- feature 7: daily review ---- */
      case "review-ok": {
        var rid = parseInt(el.getAttribute("data-hi"), 10);
        if (!isNaN(rid) && hls[rid]) {
          hls[rid].interval = Math.min((hls[rid].interval || 1) * 2, 60);
          hls[rid].reviewDue = Date.now() + hls[rid].interval * 86400000;
          save(KEYS.hls, hls); renderMarks(); toast("Dijadwalkan ulang");
        }
        break;
      }
      case "review-lupa": {
        var lid = parseInt(el.getAttribute("data-hi"), 10);
        if (!isNaN(lid) && hls[lid]) {
          hls[lid].interval = 1;
          hls[lid].reviewDue = Date.now() + 86400000;
          save(KEYS.hls, hls); renderMarks(); toast("Akan diulas besok");
        }
        break;
      }
      /* ---- feature 14: TOC chars tab + glossary ---- */
      case "toc-tab": setTocTab(el.getAttribute("data-tab")); break;
      case "char-toggle":
      case "term-toggle": {
        var desc = el.querySelector(".char-desc");
        if (desc) {
          desc.hidden = !desc.hidden;
          el.setAttribute("aria-expanded", desc.hidden ? "false" : "true");
        }
        break;
      }
      /* ---- feature 10: volume finale ---- */
      case "next-volume": {
        var nv = el.getAttribute("data-vid");
        if (nv && bookById(nv)) navigate("r/" + nv + "/0");
        break;
      }
      default: return;
    }
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action]");
    if (!el) return;
    var action = el.getAttribute("data-action");
    if (!action) return;
    // ignore disabled
    if (el.getAttribute("aria-disabled") === "true") return;
    handle(action, el, e);
    // micro feedback
    if (!reduceMotion && el.classList.contains("iconbtn")) {
      try { el.animate && el.animate([{ transform: "scale(1)" }, { transform: "scale(.9)" }, { transform: "scale(1)" }], { duration: 160, easing: "ease-out" }); } catch (x) {}
    }
  });

  // keyboard activation for [role=button] (a11y)
  document.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.closest) {
      var t = e.target.closest('[role="button"], .book-card, .film-card, .toc-item, .search-result, .mark-item');
      if (t && t.getAttribute("data-action")) {
        e.preventDefault();
        handle(t.getAttribute("data-action"), t, e);
        // stop the global shortcut listener from also firing (e.g. Space advancing a paged page)
        e.stopImmediatePropagation();
      }
    }
  });

  /* ---------------- chapter nav with race guard ---------------- */
  function goChapter(c) {
    if (navLock) return;
    var max = chaptersOf(state.vid).length - 1;
    var clamped = clamp(c, 0, max);
    if (clamped === state.c) {
      // at boundary — give feedback
      if (c < 0) toast("Sudah di bab pertama");
      else if (c > max) toast("Sudah di bab terakhir");
      return;
    }
    navLock = true;
    state.c = clamped;
    state.page = 0;
    navigate("r/" + state.vid + "/" + clamped, { replace: true });
    renderReader();
    setTimeout(function () { navLock = false; }, reduceMotion ? 60 : 260);
  }

  /* ---------------- keyboard shortcuts ---------------- */
  document.addEventListener("keydown", function (e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      if (e.key === "Escape") { e.target.blur(); closeSheets(); if (window.MT_TTS) MT_TTS.close(); }
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "k") { e.preventDefault(); handle("open-search", null); return; }
    if (window.MT_LB && MT_LB.isOpen) {
      if (e.key === "Escape") { MT_LB.close(); return; }
      if (e.key === "ArrowRight") { MT_LB.next(); return; }
      if (e.key === "ArrowLeft") { MT_LB.prev(); return; }
      if (e.key === "+" || e.key === "=") { MT_LB.zoomIn(); return; }
      if (e.key === "-") { MT_LB.zoomOut(); return; }
      if (e.key === "0") { MT_LB.reset(); return; }
      return;
    }
    if (e.key === "Escape") { closeSheets(); closeAutoScrollPanel(); if (window.MT_TTS) MT_TTS.close(); return; }
    if (state.view !== "reader") {
      if (e.key === "/") { e.preventDefault(); handle("open-search", null); }
      return;
    }
    switch (e.key) {
      case "ArrowRight": case "PageDown": if (state.mode === "paged") { e.preventDefault(); setPage(state.page + 1); } else { e.preventDefault(); $("#reader-scroller").scrollBy({ top: window.innerHeight * 0.85, behavior: "smooth" }); } break;
      case " ": if (state.mode === "paged") { e.preventDefault(); setPage(state.page + 1); } else { e.preventDefault(); $("#reader-scroller").scrollBy({ top: window.innerHeight * 0.85, behavior: "smooth" }); } break;
      case "ArrowLeft": case "PageUp": if (state.mode === "paged") { e.preventDefault(); setPage(state.page - 1); } else { e.preventDefault(); $("#reader-scroller").scrollBy({ top: -window.innerHeight * 0.85, behavior: "smooth" }); } break;
      case "[": goChapter(state.c - 1); break;
      case "]": goChapter(state.c + 1); break;
      case "t": handle("open-toc", null); break;
      case "b": handle("toggle-bookmark", null); break;
      case "s": handle("open-search", null); break;
      case "m": handle("open-marks", null); break;
      default: break;
    }
  });

  /* ---------------- swipe for paged mode ---------------- */
  (function () {
    var sx = 0, sy = 0, st = 0, tracking = false;
    var scroller = $("#reader-scroller");
    scroller.addEventListener("pointerdown", function (e) {
      if (state.mode !== "paged") return;
      tracking = true; sx = e.clientX; sy = e.clientY; st = Date.now();
    });
    scroller.addEventListener("pointerup", function (e) {
      if (!tracking) return; tracking = false;
      var dx = e.clientX - sx, dy = e.clientY - sy, dt = Date.now() - st;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 700) {
        if (dx < 0) setPage(state.page + 1); else setPage(state.page - 1);
      }
    });
    scroller.addEventListener("pointercancel", function () { tracking = false; });
  })();

  /* ---------------- scroll progress tracking ---------------- */
  $("#reader-scroller").addEventListener("scroll", function () {
    if (state.mode !== "scroll") return;
    updateProgress();
    lfScrollMark();
    var scroller = this;
    clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(function () {
      var p = prog[state.vid] || {};
      p.c = state.c; p.mode = "scroll"; p.scroll = scroller.scrollTop; p.ts = Date.now();
      prog[state.vid] = p; save(KEYS.prog, prog);
    }, 400);
  }, { passive: true });
  var scrollSaveTimer;

  /* ---------------- text selection → highlight ---------------- */
  $("#prose").addEventListener("mouseup", function () {
    setTimeout(addHighlightFromSelection, 10);
  });
  $("#prose").addEventListener("touchend", function () {
    setTimeout(addHighlightFromSelection, 250);
  });

  /* ---------------- settings ranges ---------------- */
  $("#rng-fz").addEventListener("input", function () { prefs.fz = parseInt(this.value, 10); applyPrefs(); savePrefs(); if (state.mode === "paged") recomputePaged(); });
  $("#rng-lh").addEventListener("input", function () { prefs.lh = parseFloat(this.value); applyPrefs(); savePrefs(); if (state.mode === "paged") recomputePaged(); });
  $("#rng-col").addEventListener("input", function () { prefs.col = parseInt(this.value, 10); applyPrefs(); savePrefs(); if (state.mode === "paged") recomputePaged(); });
  var asSpeed = $("#as-speed");
  if (asSpeed) {
    asSpeed.addEventListener("input", function () {
      prefs.autoScrollSpeed = parseFloat(this.value);
      var sv = $("#as-speed-val2"); if (sv) sv.textContent = prefs.autoScrollSpeed.toFixed(1) + "×";
      savePrefs();
    });
    asSpeed.addEventListener("change", function () { applyPrefs(); });
  }
  var rngAmbVol = $("#rng-ambient-vol");
  if (rngAmbVol) rngAmbVol.addEventListener("input", function () {
    prefs.ambientVol = parseFloat(this.value);
    applyPrefs(); savePrefs();
    if (window.MT_AMBIENT) MT_AMBIENT.setVol(prefs.ambientVol);
  });
  var rngMuVol = $("#rng-music-vol");
  if (rngMuVol) rngMuVol.addEventListener("input", function () {
    prefs.musicVol = parseFloat(this.value);
    applyPrefs(); savePrefs();
    if (window.MT_AMBIENT) MT_AMBIENT.setMusicVol(prefs.musicVol);
  });
  $("#search-input").addEventListener("input", function () { runSearch(this.value); });

  /* ---------------- close settings on outside click (capture click) ---------------- */
  document.addEventListener("click", function (e) {
    var pop = $("#settings-pop");
    if (!pop.classList.contains("is-open")) return;
    if (pop.contains(e.target)) return;
    if (e.target.closest && e.target.closest('[data-action="toggle-settings"]')) return;
    closeSettings();
  }, true);

  /* ---------------- resize → recompute paged ---------------- */
  var ro = new ResizeObserver(function () { if (state.mode === "paged") recomputePaged(); });
  var stage = $(".reader-stage"); if (stage) ro.observe(stage);
  window.addEventListener("resize", function () { if (state.mode === "paged") recomputePaged(); updateProgress(); });

  /* ---------------- theme auto (system / time) ---------------- */
  (function () {
    try {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq && mq.addEventListener) mq.addEventListener("change", function () { if (prefs.themeAuto === "system") { prefs.theme = resolveTheme(); document.documentElement.setAttribute("data-theme", prefs.theme); } });
      else if (mq && mq.addListener) mq.addListener(function () { if (prefs.themeAuto === "system") { prefs.theme = resolveTheme(); document.documentElement.setAttribute("data-theme", prefs.theme); } });
    } catch (e) {}
    // time-based: re-evaluate every 10 minutes
    setInterval(function () {
      if (prefs.themeAuto === "time") { var nt = resolveTheme(); if (nt !== prefs.theme) { prefs.theme = nt; document.documentElement.setAttribute("data-theme", prefs.theme); } }
    }, 600000);
  })();

  /* ---------------- error guard ---------------- */
  var errGuard = $("#error-guard"), errCode = $("#error-code");
  function showError(msg) {
    errCode.textContent = String(msg && msg.message ? msg.message : msg);
    errGuard.classList.add("is-show");
    errGuard.setAttribute("aria-hidden", "false");
  }
  function closeErrorGuard() { errGuard.classList.remove("is-show"); errGuard.setAttribute("aria-hidden", "true"); }
  window.addEventListener("error", function (e) { showError(e.error || e.message || "Galat"); });
  window.addEventListener("unhandledrejection", function (e) { showError((e.reason && e.reason.message) || e.reason || "Promise ditolak"); });

  /* ---------------- service worker (http/https only) ---------------- */
  if ("serviceWorker" in navigator && /^http/.test(location.protocol)) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        // unregister the legacy mis-scoped SW (assets/sw.js, scope /assets/) so the
        // root SW at /sw.js controls the whole app and offline actually works.
        return Promise.all(regs.map(function (r) {
          try { if (/\/assets\/$/.test(new URL(r.scope).pathname)) return r.unregister(); } catch (e) {}
        }));
      }).then(function () {
        return navigator.serviceWorker.register("sw.js").catch(function () { /* offline not available */ });
      }).catch(function () {});
    });
    // notify on update
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (window.MT_App && MT_App.toast) toast("Pembaruan tersedia — muat ulang untuk versi baru");
    });
  }

  /* ---------------- auto-scroll mode ---------------- */
  var autoScrollRAF = null;
  var autoScrollWatchdog = null;
  var autoScrollPaused = false;

  function startAutoScroll() {
    stopAutoScroll();
    if (state.mode !== "scroll" || state.view !== "reader") { syncAutoScrollUI(); return; }
    autoScrollPaused = false;
    var scroller = $("#reader-scroller");
    if (!scroller) return;
    // force instant programmatic scrolls — CSS `scroll-behavior:smooth` fights the
    // per-frame writes on mobile browsers and can freeze movement at visible zero
    scroller.style.scrollBehavior = "auto";
    var lastTime = 0;
    var lastTick = Date.now();
    var kicked = false;
    function step(px) {
      if (!isFinite(px) || px <= 0) px = 0.5;
      var top = scroller.scrollTop;
      if (!isFinite(top)) top = 0;
      scroller.scrollTop = top + px;
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8) {
        var maxChap = chaptersOf(state.vid).length - 1;
        if (state.c < maxChap) { lastTime = 0; goChapter(state.c + 1); }
        else { stopAutoScroll(); prefs.autoScroll = false; applyPrefs(); savePrefs(); toast("Selesai membaca volume"); }
        return true;
      }
      return false;
    }
    function loop(t) {
      if (!prefs.autoScroll || state.mode !== "scroll") { stopAutoScroll(); return; }
      if (!autoScrollPaused) {
        if (!kicked) { kicked = true; step(2); }
        if (lastTime) {
          lastTick = Date.now();
          var dt = t - lastTime;
          if (dt > 16 && step((prefs.autoScrollSpeed || 1) * dt * 0.04)) return;
        }
        lastTime = t;
      } else { lastTime = 0; }
      autoScrollRAF = requestAnimationFrame(loop);
    }
    autoScrollRAF = requestAnimationFrame(loop);
    // watchdog: some mobile browsers throttle/stall rAF (battery saver, overlays).
    // If rAF went quiet >700ms, tick manually so auto-scroll never silently dies.
    var wd = setInterval(function () {
      if (!prefs.autoScroll || state.mode !== "scroll") { clearInterval(wd); return; }
      if (autoScrollPaused) return;
      if (Date.now() - lastTick > 700) step((prefs.autoScrollSpeed || 1) * 2.8);
    }, 700);
    autoScrollWatchdog = wd;
    syncAutoScrollUI();
  }
  function stopAutoScroll() {
    if (autoScrollRAF) { cancelAnimationFrame(autoScrollRAF); autoScrollRAF = null; }
    if (autoScrollWatchdog) { clearInterval(autoScrollWatchdog); autoScrollWatchdog = null; }
    autoScrollPaused = false;
    var scroller = $("#reader-scroller");
    if (scroller) scroller.style.scrollBehavior = "";
    syncAutoScrollUI();
  }

  /* view/visibility sync: FAB lives only in scroll-mode reader */
  function autoScrollViewSync() {
    var fab = $("#fab-autoscroll");
    if (!fab) return;
    var visible = state.view === "reader" && state.mode !== "paged";
    if (visible && fab.hidden) {
      fab.hidden = false;
      fabEntrance();
    } else if (!visible && !fab.hidden) {
      fab.hidden = true;
      closeAutoScrollPanel(true);
      stopAutoScroll();
    }
  }

  /* one-way state → UI mirror (FAB glyph, play button, slider, hint) */
  function syncAutoScrollUI() {
    var fab = $("#fab-autoscroll");
    if (!fab) return;
    var running = !!(prefs.autoScroll && !autoScrollPaused);
    fab.hidden = !(state.view === "reader" && state.mode !== "paged");
    fab.classList.toggle("is-on", running);
    fab.classList.toggle("is-paused", !!(prefs.autoScroll && autoScrollPaused));
    fab.setAttribute("aria-pressed", String(!!prefs.autoScroll));
    fab.setAttribute("aria-label", prefs.autoScroll ? (autoScrollPaused ? "Gulir otomatis dijeda — ketuk untuk melanjutkan" : "Gulir otomatis berjalan — ketuk untuk jeda") : "Gulir otomatis: atur kecepatan");
    var play = $("#as-play-toggle");
    if (play) {
      play.classList.toggle("is-active", !!prefs.autoScroll);
      play.setAttribute("aria-pressed", String(!!prefs.autoScroll));
      play.setAttribute("aria-label", prefs.autoScroll ? "Jeda gulir otomatis" : "Mulai gulir otomatis");
    }
    var sp = $("#as-speed");
    if (sp && document.activeElement !== sp) sp.value = prefs.autoScrollSpeed;
    var sv = $("#as-speed-val2"); if (sv) sv.textContent = prefs.autoScrollSpeed.toFixed(1) + "×";
    var hint = $(".as-hint");
    if (hint) {
      hint.textContent = prefs.autoScroll
        ? (autoScrollPaused ? "dijeda — ketuk teks untuk lanjut" : "berjalan · gulir manual = jeda")
        : "ketuk ▶ untuk mulai dari posisi ini";
    }
  }

  /* FAB spring-entrance (skill: purposeful motion, transform/opacity only) */
  function fabEntrance() {
    if (!reduceMotion && window.anime) {
      anim("#fab-autoscroll", { scale: [.4, 1.14, 1], opacity: [0, 1], duration: 460, easing: "easeOutElastic(1, .55)" });
    }
  }

  /* floating panel open/close with layered motion (slide + fade + settle) */
  function openAutoScrollPanel() {
    var panel = $("#autoscroll-panel");
    if (!panel) return;
    if (panel.classList.contains("is-open")) { closeAutoScrollPanel(); return; }
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    if ("inert" in panel) panel.inert = false;
    // base visibility FIRST (anime is polish only — never leaves panel invisible)
    panel.style.transform = "none";
    panel.style.opacity = "1";
    try { syncAutoScrollUI(); } catch (e) {}
    if (!reduceMotion && window.anime) {
      anim(panel, { translateY: [16, 0], scale: [.95, 1], opacity: [0, 1], duration: 300, easing: "easeOutExpo" });
    }
  }
  function closeAutoScrollPanel(silent) {
    var panel = $("#autoscroll-panel");
    if (!panel || !panel.classList.contains("is-open")) return;
    var done = function () {
      panel.classList.remove("is-open");
      panel.setAttribute("aria-hidden", "true");
      if ("inert" in panel) panel.inert = true;
      panel.style.opacity = "0";
      panel.style.transform = "translateY(14px) scale(.96)";
    };
    if (!reduceMotion && window.anime) {
      if (!anim(panel, { translateY: [0, 12], scale: [1, .97], opacity: [1, 0], duration: 170, easing: "easeInQuad", complete: done })) done();
    } else done();
  }

  (function () {
    var scroller = $("#reader-scroller");
    if (!scroller) return;
    ["wheel", "touchstart", "pointerdown"].forEach(function (ev) {
      scroller.addEventListener(ev, function () {
        if (prefs.autoScroll && !autoScrollPaused) { autoScrollPaused = true; syncAutoScrollUI(); }
      }, { passive: true });
    });
    // resume on tap after pause
    scroller.addEventListener("click", function () {
      if (prefs.autoScroll && autoScrollPaused) { autoScrollPaused = false; syncAutoScrollUI(); }
    });
  })();

  // tap outside the floating panel closes it (FAB excluded — it toggles)
  document.addEventListener("click", function (e) {
    var panel = $("#autoscroll-panel");
    if (!panel || !panel.classList.contains("is-open")) return;
    if (panel.contains(e.target)) return;
    var fab = $("#fab-autoscroll");
    if (fab && fab.contains(e.target)) return;
    closeAutoScrollPanel();
  });

  /* ---------------- boot ---------------- */
  window.addEventListener("popstate", route);
  // hashchange is redundant with popstate (fires on same navigation); skip to avoid double render
  applyPrefs();
  renderLib();
  route();
  // expose
  window.MT_App = {
    state: state, prefs: prefs, prog: prog, bms: bms, hls: hls, stats: stats,
    renderLib: renderLib, renderReader: renderReader, navigate: navigate, toast: toast,
    openSheet: openSheet, closeSheets: closeSheets, applyPrefs: applyPrefs, savePrefs: savePrefs,
    // advance to the next chapter for TTS auto-continue; returns false at the last chapter
    nextForTTS: function () {
      if (state.view !== "reader") return false;
      var max = chaptersOf(state.vid).length - 1;
      if (state.c >= max) return false;
      goChapter(state.c + 1);
      return true;
    },
    // in paged mode, navigate to the page that contains the given paragraph (used by TTS)
    ttsShowParagraph: function (el) {
      if (state.mode !== "paged" || !el) return;
      var prose = document.getElementById("prose");
      var pw = parseFloat(prose.style.getPropertyValue("--page-w")) || 0;
      var pg = parseFloat(prose.style.getPropertyValue("--page-gap")) || 0;
      if (pw > 0) {
        var relLeft = el.getBoundingClientRect().left - prose.getBoundingClientRect().left;
        setPage(Math.round(relLeft / (pw + pg)));
      }
    }
  };
})();
