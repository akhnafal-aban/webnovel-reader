/* =========================================================================
   MT Reader — assets/sync.js
   Multi-device sync: GitHub Gist as a private cloud + JSON export/import.

   Static GitHub Pages cannot persist data server-side. Strategy:
   - Bundle the reader's localStorage keys (prefs/prog/bms/hls/stats) into one
     JSON blob with per-key timestamps.
   - Store the blob in a PRIVATE GitHub Gist owned by the user, authorized by
     a fine-grained Personal Access Token (scope: Gists read/write).
   - Both devices pull on load and push on change; per-key newest-wins merge.
   - Offline fallback: export/import the same JSON blob as a file.

   ZERO dependencies. ES5 style to match app.js. No CDN.
   ========================================================================= */
(function () {
  "use strict";
  if (window.MT_SYNC) return;

  var CFG_KEY = "mt:sync-cfg";   // { pat, gistId, auto, lastPush, lastPull }
  var TS_KEY = "mt:sync-ts";     // { "mt:prefs": 1234, ... } local known timestamps
  var DATA_KEYS = ["mt:prefs", "mt:prog", "mt:bms", "mt:hls", "mt:stats"];
  var GIST_DESC = "mt-reader-sync";
  var API = "https://api.github.com";
  var dirty = false;
  var pushTimer = null;
  var connected = false;
  var applying = false; // suppress dirty-marking while applying a pulled bundle

  var cfg = loadCfg();
  var ts = loadTs();

  var noop = function () {};

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} }
  function loadTs() {
    try { return JSON.parse(localStorage.getItem(TS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveTs() { try { localStorage.setItem(TS_KEY, JSON.stringify(ts)); } catch (e) {} }

  /* ---------------- helpers ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]; }); }
  function now() { return Date.now(); }
  function fmtTime(t) { if (!t) return "—"; var d = new Date(t); return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }); }

  /* ---------------- bundle ---------------- */
  function bundle() {
    var out = { app: "mt-reader", v: 1, data: {} };
    DATA_KEYS.forEach(function (k) {
      var raw = null;
      try { raw = localStorage.getItem(k); } catch (e) {}
      out.data[k] = { ts: ts[k] || 0, v: raw };
    });
    return out;
  }
  function applyBundle(b, mergeOnlyNewer) {
    var changed = false;
    if (!b || !b.data) return false;
    applying = true;
    Object.keys(b.data).forEach(function (k) {
      if (DATA_KEYS.indexOf(k) < 0) return;
      var inc = b.data[k], incTs = Number(inc.ts) || 0;
      var localTs = Number(ts[k]) || 0;
      if (mergeOnlyNewer && incTs <= localTs) return;
      if (inc.v != null) {
        try { localStorage.setItem(k, inc.v); } catch (e) { return; }
        ts[k] = incTs;
        changed = true;
      }
    });
    applying = false;
    if (changed) { saveTs(); refreshApp(); }
    return changed;
  }

  /* Dirty tracking: app.js saves via localStorage.setItem — wrap it.
     "storage" event only fires across tabs, so monkey-patch catches same-tab. */
  var _setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    var r = _setItem.apply(this, arguments);
    if (k && k.indexOf("mt:") === 0 && k !== CFG_KEY && k !== TS_KEY) markDirty();
    return r;
  };
  function markDirty() {
    if (applying) return;
    dirty = true;
    updateBadge();
    if (connected && cfg.auto !== false) schedulePush();
  }

  /* Tell the app to re-read prefs etc. after a pull. */
  function refreshApp() {
    if (window.MT_App && MT_App.pullData) {
      try { MT_App.pullData(); } catch (e) {}
      return;
    }
    // fallback: app objects are in-memory; a soft reload applies pulled data
    if (window.MT_App && MT_App.toast) MT_App.toast("Data sinkron diterapkan — memuat ulang");
    setTimeout(function () { location.reload(); }, 700);
  }

  /* ---------------- Gist API ---------------- */
  function apiHeaders() {
    return {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + (cfg.pat || ""),
      "Content-Type": "application/json"
    };
  }
  function findGist() {
    // list first 100 gists, look for our description
    return fetch(API + "/gists?per_page=100", { headers: apiHeaders() })
      .then(function (r) { if (!r.ok) throw apiError(r); return r.json(); })
      .then(function (list) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].description === GIST_DESC && list[i].files && list[i].files["mt-reader-data.json"]) return { id: list[i].id };
        }
        return null;
      });
  }
  function createGist(content) {
    return fetch(API + "/gists", {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ description: GIST_DESC, public: false, files: { "mt-reader-data.json": { content: content } } })
    }).then(function (r) { if (!r.ok) throw apiError(r); return r.json(); });
  }
  function apiError(r) {
    var e = new Error("API " + r.status);
    e.status = r.status;
    return e;
  }

  /* ---------------- public ops ---------------- */
  function connect(pat, cb) {
    if (!pat || pat.length < 10) { status("Token terlalu pendek", "err"); return (cb || noop)(false); }
    cfg.pat = pat; saveCfg();
    findGist().then(function (g) {
      if (g) { cfg.gistId = g.id; }
    }).catch(function () { /* fallback to create */ })
      .then(function () {
        if (cfg.gistId) return cfg.gistId;
        return createGist(JSON.stringify(bundle())).then(function (g) { cfg.gistId = g.id; return g.id; });
      })
      .then(function () {
        connected = true; saveCfg(); pull(); status("Terhubung · gist " + cfg.gistId.slice(0, 8) + "…", "ok"); return cb(true);
      })
      .catch(function (e) {
        connected = false;
        status(e.status === 401 ? "Token tidak valid (401)" : "Gagal hubung: " + e.message, "err");
        cb(false);
      });
  }
  function pull(cb) {
    var silent = cb === true;
    if (!cfg.gistId || !cfg.pat) { if (!silent) status("Belum terhubung", "err"); return; }
    if (!silent) status("Menarik…", "busy");
    fetch(API + "/gists/" + cfg.gistId, { headers: apiHeaders() })
      .then(function (r) { if (!r.ok) throw apiError(r); return r.json(); })
      .then(function (g) {
        var f = g.files && g.files["mt-reader-data.json"];
        if (!f || !f.content) throw new Error("gist kosong");
        var b = JSON.parse(f.content);
        var changed = applyBundle(b, true);
        cfg.lastPull = now(); saveCfg();
        if (!changed) dirty = false;
        updateBadge();
        if (!silent) status(changed ? "Tersinkron ✓" : "Sudah terbaru", "ok");
        if (cb && cb !== true) cb(true);
      })
      .catch(function (e) { if (!silent) status("Tarik gagal: " + e.message, "err"); if (cb && cb !== true) cb(false); });
  }
  function push(cb) {
    if (!cfg.gistId || !cfg.pat) { status("Belum terhubung", "err"); return; }
    // stamp all keys we consider "ours" right now (per-key newest-wins)
    var t = now();
    DATA_KEYS.forEach(function (k) { if (localStorage.getItem(k) != null) ts[k] = t; });
    saveTs();
    status("Mendorong…", "busy");
    fetch(API + "/gists/" + cfg.gistId, {
      method: "PATCH",
      headers: apiHeaders(),
      body: JSON.stringify({ files: { "mt-reader-data.json": { content: JSON.stringify(bundle()) } } })
    })
      .then(function (r) { if (!r.ok) throw apiError(r); return r.json(); })
      .then(function () {
        cfg.lastPush = now(); saveCfg();
        dirty = false; updateBadge();
        status("Tersimpan ke cloud ✓", "ok");
        if (cb) cb(true);
      })
      .catch(function (e) { status("Dorong gagal: " + e.message, "err"); if (cb) cb(false); });
  }

  /* ---------------- export / import file ---------------- */
  function exportFile() {
    var blob = new Blob([JSON.stringify(bundle(), null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mt-reader-data-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    status("Berkas diunduh", "ok");
  }
  function importFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var b = JSON.parse(fr.result);
        if (!b || !b.data) throw new Error("format");
        applyBundle(b, false); // import wins over local
        dirty = true; updateBadge();
        status("Data diimpor ✓", "ok");
        if (connected && cfg.auto !== false) schedulePush();
      } catch (e) { status("Berkas tidak valid", "err"); }
    };
    fr.readAsText(file);
  }

  /* ---------------- auto sync ---------------- */
  function schedulePush() {
    if (pushTimer) return;
    pushTimer = setTimeout(function () { pushTimer = null; push(function () {}); }, 25000);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && dirty && connected) {
      // fire-and-forget, best effort before tab closes
      if (window.fetch && "keepalive" in window.Request) {
        var t = now();
        DATA_KEYS.forEach(function (k) { if (localStorage.getItem(k) != null) ts[k] = t; });
        saveTs();
        fetch(API + "/gists/" + cfg.gistId, {
          method: "PATCH", keepalive: true, headers: apiHeaders(),
          body: JSON.stringify({ files: { "mt-reader-data.json": { content: JSON.stringify(bundle()) } } })
        }).catch(function () {});
      }
    } else if (document.visibilityState === "visible" && connected && cfg.auto !== false) {
      pull(); // pick up changes pushed from the other device
    }
  });
  // light polling while reading, so device B receives device A's saves
  setInterval(function () {
    if (document.visibilityState === "visible" && connected && cfg.auto !== false) pull(true);
  }, 180000);

  /* ---------------- UI ---------------- */
  var sheet = null, statusEl = null, patEl = null, autoEl = null, badgeEl = null;

  function buildUI() {
    // topbar button (cloud) — injected so app.js never dies
    var tools = $(".topbar-tools") || $(".topbar");
    var btn = document.createElement("button");
    btn.className = "iconbtn";
    btn.id = "btn-sync";
    btn.setAttribute("aria-label", "Sinkronisasi antar perangkat");
    btn.title = "Sinkronisasi";
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19a4.5 4.5 0 0 0 .42-8.98 6 6 0 0 0-11.65 1.62A4 4 0 0 0 7 19"/><path d="M12 12v8"/><path d="m9 15 3 3 3-3"/></svg>' +
      '<i class="badge sync-badge" id="sync-badge" hidden></i>';
    btn.addEventListener("click", function () { openSync(); });
    if (tools) tools.insertBefore(btn, tools.firstChild);
    badgeEl = $("#sync-badge");

    // sheet (class "sheet" so app.js scrim/inert/escape handles it too)
    sheet = document.createElement("aside");
    sheet.id = "sheet-sync";
    sheet.className = "sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Sinkronisasi");
    sheet.setAttribute("aria-hidden", "true");
    if ("inert" in sheet) sheet.inert = true;
    sheet.innerHTML =
      '<div class="sheet-head"><h2>Sinkronisasi</h2>' +
      '<button class="iconbtn" data-action="close-sheets" aria-label="Tutup"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
      '<div class="sheet-body" style="padding:16px;display:flex;flex-direction:column;gap:14px">' +
      '<div id="sync-status" role="status" aria-live="polite" style="font-family:var(--font-mono);font-size:12px;color:var(--ink-soft)">Belum terhubung</div>' +
      '<p style="font-size:13px;color:var(--ink-soft);line-height:1.6">Baca di Mac &amp; iPhone dengan data yang sama. Progres, penanda, sorotan, statistik, dan pengaturan disimpan ke <b>gist GitHub pribadi</b> milik akunmu — tanpa server pihak ketiga.</p>' +
      '<label style="font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint)">Token akses GitHub (fine-grained, izin <b>Gists: read &amp; write</b>)<input id="sync-pat" type="password" placeholder="github_pat_…" autocomplete="off" style="margin-top:6px;width:100%;min-height:44px;background:var(--bg-sink);border:1px solid var(--line);border-radius:var(--r-sm);padding:0 12px;color:var(--ink);font-family:var(--font-mono);font-size:12px"/></label>' +
      '<details style="font-size:12px;color:var(--ink-faint)"><summary>Cara membuat token</summary><ol style="margin:8px 0 0 18px;line-height:1.7"><li>Buka github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens.</li><li>Pilih <b>All repositories</b> (atau none) — token hanya dipakai untuk gist.</li><li>Izin: <b>Account permissions → Gists → Read and write</b>.</li><li>Salin token, tempel di sini. Token tersimpan <b>hanya di perangkat ini</b>, bisa dicabut kapan saja.</li></ol></details>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn" id="sync-connect" style="min-height:44px">Hubungkan</button>' +
      '<button class="btn ghost" id="sync-pull" style="min-height:44px" disabled>Tarik</button>' +
      '<button class="btn ghost" id="sync-push" style="min-height:44px" disabled>Dorong</button>' +
      '</div>' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-soft)"><input type="checkbox" id="sync-auto" checked disabled> Sinkron otomatis (tarik saat buka, dorong saat berubah)</label>' +
      '<div style="border-top:1px solid var(--line);padding-top:12px;display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn ghost" id="sync-export" style="min-height:44px">Ekspor berkas</button>' +
      '<button class="btn ghost" id="sync-import" style="min-height:44px">Impor berkas</button>' +
      '<input type="file" id="sync-file" accept="application/json" hidden aria-hidden="true"/>' +
      '</div>' +
      '<div id="sync-meta" style="font-family:var(--font-mono);font-size:11px;color:var(--ink-faint);line-height:1.7"></div>' +
      '</div>';

    document.body.appendChild(sheet);

    patEl = $("#sync-pat");
    autoEl = $("#sync-auto");
    statusEl = $("#sync-status");

    $("#sync-connect").addEventListener("click", function () {
      var pat = patEl.value.trim();
      connect(pat, function (ok) {
        if (ok) {
          $("#sync-pull").disabled = false;
          $("#sync-push").disabled = false;
          autoEl.disabled = false;
        }
      });
    });
    $("#sync-pull").addEventListener("click", function () { pull(); });
    $("#sync-push").addEventListener("click", function () { push(); });
    $("#sync-export").addEventListener("click", exportFile);
    $("#sync-import").addEventListener("click", function () { $("#sync-file").click(); });
    $("#sync-file").addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) importFile(e.target.files[0]);
      e.target.value = "";
    });
    autoEl.addEventListener("change", function () { cfg.auto = autoEl.checked; saveCfg(); });

    updateMeta();
  }

  function updateMeta() {
    var m = $("#sync-meta");
    if (!m) return;
    m.innerHTML = "Gist: " + (cfg.gistId ? esc(cfg.gistId) : "belum ada") +
      "<br>Dorong terakhir: " + fmtTime(cfg.lastPush) +
      " · Tarik terakhir: " + fmtTime(cfg.lastPull);
  }
  function status(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = kind === "err" ? "var(--danger,#e05)" : kind === "ok" ? "var(--accent)" : "var(--ink-soft)";
  }
  function updateBadge() {
    if (badgeEl) badgeEl.hidden = !dirty;
  }
  function openSync() {
    if (!sheet) buildUI();
    if (window.MT_App && MT_App.openSheet) MT_App.openSheet("sheet-sync");
    else {
      // fallback: manual open matching app.js visual state
      sheet.classList.add("is-open");
      sheet.setAttribute("aria-hidden", "false");
      var scrim = $("#scrim");
      if (scrim) scrim.classList.add("is-open");
      var closer = sheet.querySelector('[data-action="close-sheets"]');
      if (closer) closer.focus({ preventScroll: true });
    }
    if (patEl && cfg.pat) patEl.value = cfg.pat;
    if (autoEl) autoEl.checked = cfg.auto !== false;
    updateMeta();
    status(connected ? (dirty ? "Ada perubahan belum didorong" : "Terhubung ✓") : "Belum terhubung — tempel token");
  }

  /* ---------------- expose ---------------- */
  window.MT_SYNC = {
    connect: connect, pull: pull, push: push,
    exportFile: exportFile, importFile: importFile,
    open: openSync,
    config: cfg,
    _markDirty: markDirty,
    status: function () { return { connected: connected, dirty: dirty, gistId: cfg.gistId }; }
  };

  /* ---------------- boot ---------------- */
  connected = !!(cfg.pat && cfg.gistId);
  function boot() {
    if (!document.querySelector(".topbar")) {
      // app.js mounts in same static HTML; retry briefly
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (document.querySelector(".topbar") || tries > 40) { clearInterval(iv); if (document.querySelector(".topbar")) buildUI(); }
      }, 250);
    } else buildUI();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // initial pull shortly after connect state at load
  if (connected) {
    setTimeout(function () { pull(); }, 2000);
  }
})();