/* =========================================================================
   MT_TTS — Text-to-speech wrapper over Web Speech API.
   API: open() · close() · start() · stop() · toggle() · from(paragraphEl) ·
        setSentences(arr) · rate · voice
   Highlights the current sentence in the prose. No network.
   ========================================================================= */
(function () {
  "use strict";
  if (window.MT_TTS) return;

  var panel = document.getElementById("tts-panel");
  var nowEl = document.getElementById("tts-now");
  var rateEl = document.getElementById("tts-rate");
  var voiceEl = document.getElementById("tts-voice");
  var playIco = document.getElementById("tts-play-ico");

  var synth = window.speechSynthesis;
  var supported = !!synth && "SpeechSynthesisUtterance" in window;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Sentence-level highlight via the CSS Custom Highlight API. It highlights a Range over
  // text nodes WITHOUT mutating the DOM, so existing <mark class="hl"> highlights stay intact
  // (the brief requires highlights and TTS to coexist). No-ops on browsers without the API.
  var hlAPI = !!(window.Highlight && window.CSS && CSS.highlights);
  if (hlAPI) {
    var __hlStyle = document.createElement("style");
    __hlStyle.textContent = "::highlight(tts-sent){background-color:var(--accent-soft);color:inherit;} ::highlight(tts-word){background-color:var(--accent);color:var(--on-accent);border-radius:2px;}";
    document.head.appendChild(__hlStyle);
  }
  function rangeFromOffsets(root, start, end) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node, off = 0, rs = null, re = null;
    while ((node = walker.nextNode())) {
      var len = node.nodeValue.length;
      if (rs === null && off + len >= start) rs = { node: node, offset: Math.max(0, start - off) };
      if (re === null && off + len >= end) re = { node: node, offset: Math.max(0, end - off) };
      off += len;
      if (rs !== null && re !== null) break;
    }
    var range = document.createRange();
    if (rs && re) { range.setStart(rs.node, Math.min(rs.offset, rs.node.nodeValue.length)); range.setEnd(re.node, Math.min(re.offset, re.node.nodeValue.length)); }
    else if (rs) { range.setStart(rs.node, Math.min(rs.offset, rs.node.nodeValue.length)); range.collapse(true); }
    return range;
  }
  function applySentenceHighlight(s) {
    if (!hlAPI || !s || s.el == null || s.start == null) return;
    try { CSS.highlights.set("tts-sent", new Highlight(rangeFromOffsets(s.el, s.start, s.end))); } catch (e) {}
  }

  var state = {
    open: false,
    playing: false,
    rate: 1,
    voiceURI: null,
    sentences: [],     // [{el, text}]
    idx: 0
  };

  function voices() {
    return synth ? synth.getVoices() : [];
  }

  function loadVoices() {
    if (!supported) return;
    var vs = voices();
    voiceEl.innerHTML = "";
    var idVoices = vs.filter(function (v) { return /id(-|_)/i.test(v.lang) || v.lang === "id"; });
    var pick = idVoices.length ? idVoices : vs;
    pick.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v.voiceURI;
      o.textContent = v.name + " · " + v.lang;
      voiceEl.appendChild(o);
    });
    if (state.voiceURI) voiceEl.value = state.voiceURI;
    else if (pick[0]) state.voiceURI = pick[0].voiceURI;
  }
  if (supported) {
    loadVoices();
    synth.onvoiceschanged = loadVoices;
  }

  function clearActive() {
    var old = document.querySelectorAll(".prose .tts-sent, .prose p.tts-active");
    old.forEach(function (n) {
      if (n.tagName === "P") n.classList.remove("tts-active");
      else n.parentNode && n.parentNode.removeChild(n);
    });
    if (hlAPI) { try { CSS.highlights.delete("tts-sent"); } catch (e) {} }
    clearWordHighlight();
    stopFallback();
  }

  /* ---------------- word-level (karaoke) highlight ---------------- */
  var wState = { words: [], idx: 0, timer: null, startTimer: null, boundaryFired: false };
  function splitWords(text) {
    var words = [];
    var re = /\S+/g, m;
    while ((m = re.exec(text))) words.push({ start: m.index, end: m.index + m[0].length, len: m[0].length });
    return words;
  }
  function clearWordHighlight() {
    if (hlAPI) { try { CSS.highlights.delete("tts-word"); } catch (e) {} }
  }
  function stopFallback() {
    if (wState.startTimer) { clearTimeout(wState.startTimer); wState.startTimer = null; }
    if (wState.timer) { clearTimeout(wState.timer); wState.timer = null; }
  }
  function highlightWord(s, w) {
    if (!hlAPI || !s || !s.el || !w) return;
    try { CSS.highlights.set("tts-word", new Highlight(rangeFromOffsets(s.el, s.start + w.start, s.start + w.end))); } catch (e) {}
  }
  function advanceFallback(s) {
    if (wState.idx >= wState.words.length) { stopFallback(); return; }
    var w = wState.words[wState.idx];
    highlightWord(s, w);
    wState.idx++;
    var base = 150 + 40 * (w ? w.len : 1);
    if (base > 400) base = 400;
    var delay = base / Math.max(0.5, state.rate || 1);
    wState.timer = setTimeout(function () { advanceFallback(s); }, delay);
  }
  function startFallback(s) {
    stopFallback();
    wState.idx = 0;
    wState.startTimer = setTimeout(function () {
      if (wState.boundaryFired) return;
      advanceFallback(s);
    }, 600);
  }

  /* ---------------- sleep timer ---------------- */
  var sleepSelect = document.getElementById("tts-sleep");
  var sleepLabel = document.getElementById("tts-sleep-label");
  var sleepTimer = null, sleepRemaining = 0;
  function fmtSleep(secs) {
    var m = Math.floor(secs / 60), s = secs % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function clearSleep() {
    if (sleepTimer) { clearInterval(sleepTimer); sleepTimer = null; }
    sleepRemaining = 0;
    if (sleepLabel) sleepLabel.textContent = "";
    if (sleepSelect) sleepSelect.value = "0";
  }
  function startSleep(minutes) {
    clearSleep();
    if (!minutes || minutes <= 0) return;
    sleepRemaining = minutes * 60;
    if (sleepLabel) sleepLabel.textContent = fmtSleep(sleepRemaining);
    sleepTimer = setInterval(function () {
      sleepRemaining--;
      if (sleepRemaining <= 0) {
        clearSleep();
        try { if (synth) synth.cancel(); } catch (e) {}
        toast("Timer berakhir");
        close();
      } else if (sleepLabel) {
        sleepLabel.textContent = fmtSleep(sleepRemaining);
      }
    }, 1000);
  }
  if (sleepSelect) sleepSelect.addEventListener("change", function () {
    var v = parseInt(sleepSelect.value, 10) || 0;
    if (v > 0) startSleep(v); else clearSleep();
  });

  function splitSentences(text) {
    // split on . ! ? … and curly quotes endings, keep delimiters
    return text.match(/[^.!?…]+[.!?…]*(\s|$)|[^.!?…]+$/g) || [text];
  }

  function setSentences(arr) {
    state.sentences = arr || [];
    state.idx = 0;
  }

  function speak() {
    if (!supported) { toast("Browser tidak mendukung TTS"); return; }
    synth.cancel();
    if (state.idx >= state.sentences.length) state.idx = 0;
    speakFrom(state.idx);
  }

  function speakFrom(idx) {
    clearActive();
    if (idx >= state.sentences.length) {
      // End of chapter: auto-continue to the next chapter while reading (brief: "auto-lanjut bab").
      if (state.playing && window.MT_App && MT_App.nextForTTS && MT_App.nextForTTS()) {
        buildFromProse();
        state.idx = 0;
        speakFrom(0);
        return;
      }
      state.playing = false; updateIco(); return;
    }
    var s = state.sentences[idx];
    if (!s || !s.el) { state.idx = idx + 1; speakFrom(state.idx); return; }
    var u = new SpeechSynthesisUtterance(s.text);
    u.rate = state.rate;
    var vs = voices();
    var v = vs.filter(function (x) { return x.voiceURI === state.voiceURI; })[0];
    if (v) u.voice = v;
    u.lang = v ? v.lang : "id-ID";

    // Highlight the exact sentence being read (Highlight API) + softer paragraph state.
    s.el.classList.add("tts-active");
    applySentenceHighlight(s);
    nowEl.textContent = s.text;
    // word-level (karaoke): build word offsets and arm the fallback timer
    wState.words = splitWords(s.text);
    wState.idx = 0;
    wState.boundaryFired = false;
    startFallback(s);
    if (window.MT_App && MT_App.state.mode === "paged" && MT_App.ttsShowParagraph) {
      MT_App.ttsShowParagraph(s.el); // bring the sentence's page into view in paged mode
    } else {
      s.el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    }

    u.onboundary = function (e) {
      if (e.name === "word" && typeof e.charIndex === "number") {
        if (!wState.boundaryFired) { wState.boundaryFired = true; stopFallback(); }
        if (hlAPI) {
          var wStart = s.start + e.charIndex;
          var wLen = e.charLength || 0;
          var wEnd = wLen > 0 ? wStart + wLen : wStart;
          try { CSS.highlights.set("tts-word", new Highlight(rangeFromOffsets(s.el, wStart, wEnd))); } catch (er) {}
        }
      } else if (e.name === "sentence") {
        nowEl.textContent = s.text;
      }
    };
    u.onend = function () {
      s.el.classList.remove("tts-active");
      clearWordHighlight();
      stopFallback();
      state.idx = idx + 1;
      if (state.playing) speakFrom(state.idx);
    };
    u.onerror = function () {
      s.el.classList.remove("tts-active");
      clearWordHighlight();
      stopFallback();
      state.playing = false; updateIco();
    };
    try { synth.speak(u); } catch (e) { state.playing = false; updateIco(); }
  }

  function start() {
    if (!supported) { toast("Browser tidak mendukung TTS"); return; }
    if (state.sentences.length === 0) {
      // build from current prose paragraphs
      buildFromProse();
    }
    state.playing = true;
    updateIco();
    speak();
  }
  function stop() {
    if (!supported) return;
    synth.cancel();
    state.playing = false;
    clearActive();
    updateIco();
  }
  function toggle() { state.playing ? stop() : start(); }

  function from(el) {
    // start reading from a specific paragraph element
    buildFromProse(el);
    state.idx = 0;
    open();
    start();
  }

  function buildFromProse(startEl) {
    var prose = document.getElementById("prose");
    var ps = Array.prototype.slice.call(prose.querySelectorAll("p[data-pi]"));
    if (startEl) {
      var start = parseInt(startEl.getAttribute("data-pi"), 10) || 0;
      ps = ps.filter(function (p) { return parseInt(p.getAttribute("data-pi"), 10) >= start; });
    }
    var arr = [];
    ps.forEach(function (p) {
      var text = p.textContent; // raw textContent; offsets map 1:1 onto the paragraph's text nodes
      if (!text || !text.trim()) return;
      var cursor = 0;
      splitSentences(text).forEach(function (piece) {
        var trimmed = piece.trim();
        if (!trimmed) { cursor += piece.length; return; }
        var sStart = text.indexOf(trimmed, cursor);
        if (sStart < 0) sStart = cursor;
        arr.push({ el: p, text: trimmed, start: sStart, end: sStart + trimmed.length });
        cursor = sStart + trimmed.length;
      });
    });
    setSentences(arr);
  }

  function open() {
    state.open = true;
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
  }
  function close() {
    state.open = false;
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    clearSleep();
    stop();
  }

  function updateIco() {
    playIco.innerHTML = state.playing
      ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
      : '<path d="M8 5v14l11-7z"/>';
    var btn = document.querySelector('[data-action="tts-toggle"]');
    if (btn) btn.setAttribute("aria-pressed", state.playing ? "true" : "false");
  }

  rateEl.addEventListener("input", function () {
    state.rate = parseFloat(rateEl.value);
    var rv = document.getElementById("tts-rate-val");
    if (rv) rv.textContent = state.rate.toFixed(1) + "×";
  });
  voiceEl.addEventListener("change", function () {
    state.voiceURI = voiceEl.value;
  });

  window.MT_TTS = {
    open: open, close: close, start: start, stop: stop, toggle: toggle,
    from: from, setSentences: setSentences,
    get isOpen() { return state.open; },
    get playing() { return state.playing; },
    get rate() { return state.rate; },
    set rate(v) { state.rate = v; rateEl.value = v; }
  };

  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("is-show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("is-show"); }, 2400);
  }
})();
