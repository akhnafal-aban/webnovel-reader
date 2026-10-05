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
  }

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
    if (idx >= state.sentences.length) { state.playing = false; updateIco(); return; }
    var s = state.sentences[idx];
    if (!s || !s.el) { state.idx = idx + 1; speakFrom(state.idx); return; }
    var u = new SpeechSynthesisUtterance(s.text);
    u.rate = state.rate;
    var vs = voices();
    var v = vs.filter(function (x) { return x.voiceURI === state.voiceURI; })[0];
    if (v) u.voice = v;
    u.lang = v ? v.lang : "id-ID";

    // highlight sentence by wrapping — but we keep it simple: highlight paragraph + show text
    s.el.classList.add("tts-active");
    nowEl.textContent = s.text;
    s.el.scrollIntoView({ behavior: "smooth", block: "center" });

    u.onboundary = function (e) {
      if (e.name === "sentence" || e.charLength) {
        nowEl.textContent = s.text;
      }
    };
    u.onend = function () {
      s.el.classList.remove("tts-active");
      state.idx = idx + 1;
      if (state.playing) speakFrom(state.idx);
    };
    u.onerror = function () {
      s.el.classList.remove("tts-active");
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
      var text = p.textContent.replace(/\s+/g, " ").trim();
      if (!text) return;
      splitSentences(text).forEach(function (s) {
        s = s.trim();
        if (s) arr.push({ el: p, text: s });
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
    stop();
  }

  function updateIco() {
    playIco.innerHTML = state.playing
      ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
      : '<path d="M8 5v14l11-7z"/>';
  }

  rateEl.addEventListener("input", function () {
    state.rate = parseFloat(rateEl.value);
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
