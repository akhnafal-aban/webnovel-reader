/* =========================================================================
   MT Reader — assets/ambient.js
   Atmosphere for reading: natural field-recording loops + musical moods.

   Sources (all legally bundled, offline):
   • loop-rain  — Bako Nat'l Park rainforest ambience · Freesound CC0, via archive.org
   • loop-fire  — firewood crackling · Public Domain (archive.org)
   • loop-wind  — wind in trees · Freesound CC0, via archive.org
   • loop-night — cold forest river, dark ambience · Freesound CC0, via archive.org
   • music-calm/sad/tense/epic — Kevin MacLeod (incompetech.com), CC-BY 4.0

   Fallback: if an audio file fails to load, the old procedural WebAudio
   generators (noise) take over so silence never happens.
   ========================================================================= */
(function () {
  "use strict";
  if (window.MT_AMBIENT) return;

  var BASE = "assets/audio/";
  var LOOPS = { rain: "loop-rain.m4a", fire: "loop-fire.m4a", wind: "loop-wind.m4a", night: "loop-night.m4a" };
  var MUSIC = { calm: "music-calm.m4a", sad: "music-sad.m4a", tense: "music-tense.m4a", epic: "music-epic.m4a" };

  var loopEl = null;      // current noise loop audio element
  var musicEl = null;     // current music audio element
  var soundVol = 0.35;
  var musicVol = 0.4;
  var currentLoop = "off";
  var currentMusic = "off";

  /* ---------------- procedural fallback (kept from v1) ---------------- */
  var ctx = null, masterGain = null, masterMusic = null, procNodes = [];
  function procCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      masterGain = ctx.createGain(); masterGain.gain.value = 0.15; masterGain.connect(ctx.destination);
      masterMusic = ctx.createGain(); masterMusic.gain.value = 0.7; masterMusic.connect(ctx.destination);
    }
    if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }
  function noiseBuffer(c, warm) {
    var len = c.sampleRate * 2;
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      // brown-ish when warm
      last = warm ? (last + 0.02 * w) / 1.02 : w;
      d[i] = warm ? last * 3.5 : w;
    }
    return buf;
  }
  function procStart(name) {
    var c = procCtx(); if (!c) return;
    procStop();
    var src = c.createBufferSource();
    src.buffer = noiseBuffer(c, name === "wind" || name === "fire");
    src.loop = true;
    var gain = c.createGain(); gain.gain.value = 1;
    if (name === "rain") { var lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1100; }
    else if (name === "wind") { var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 380; bp.Q.value = 0.6; }
    else if (name === "fire") { var lp2 = c.createBiquadFilter(); lp2.type = "lowpass"; lp2.frequency.value = 750; }
    else { var lp3 = c.createBiquadFilter(); lp3.type = "lowpass"; lp3.frequency.value = 500; }
    var filter = name === "rain" ? lp : name === "wind" ? bp : name === "fire" ? lp2 : lp3;
    src.connect(filter); filter.connect(gain); gain.connect(masterGain);
    src.start(); procNodes = [src, gain, filter];
  }
  function procStop() {
    procNodes.forEach(function (n) { try { n.stop && n.stop(); n.disconnect && n.disconnect(); } catch (e) {} });
    procNodes = [];
  }

  /* ---------------- shared helpers ---------------- */
  function getLoopEl() {
    if (!loopEl) { loopEl = new Audio(); loopEl.loop = true; loopEl.preload = "auto"; loopEl.volume = 0; }
    return loopEl;
  }
  function getMusicEl() {
    if (!musicEl) { musicEl = new Audio(); musicEl.loop = true; musicEl.preload = "auto"; musicEl.volume = 0; }
    return musicEl;
  }
  // silence an element WITHOUT letting its error handler leak noise:
  // null the handler FIRST, then unload. Src="" otherwise fires "error", which
  // used to re-trigger the procedural fallback after the user chose "Mati".
  function quiet(el) {
    if (!el) return;
    el.onerror = null;
    try { el.pause(); } catch (e) {}
    try { el.removeAttribute("src"); el.load(); } catch (e) {}
  }
  function crossTo(el, from, to, ms, cb) {
    el.volume = Math.max(0, Math.min(1, from));
    var t0 = Date.now();
    var iv = setInterval(function () {
      var p = Math.min(1, (Date.now() - t0) / ms);
      var v = from + (to - from) * p;
      if (el) el.volume = Math.max(0, Math.min(1, v));
      if (p >= 1) { clearInterval(iv); if (cb) cb(); }
    }, 40);
  }
  // Promise-safe play: browsers reject play() when interrupted (fast toggling,
  // iOS). Only treat it as a failure worth the procedural fallback if this
  // element is STILL the active one — otherwise just drop it silently.
  function safePlay(el, name, fallback) {
    var p = null;
    try { p = el.play(); } catch (e) { p = Promise.reject(e); }
    if (p && p.then) {
      p.then(function () { crossTo(el, 0, el === loopEl ? soundVol : musicVol, 600); })
        .catch(function () {
          // wait a beat: if this element is still the active one, fall back / retry
          setTimeout(function () {
            if (el === loopEl && currentLoop === name) fallback();
            else if (el === musicEl && currentMusic === name) { try { el.play(); } catch (e2) {} }
          }, 120);
        });
    } else { crossTo(el, 0, el === loopEl ? soundVol : musicVol, 600); }
  }

  function playLoop(name) {
    if (name === "off") { stopLoop(); return; }
    if (!LOOPS[name]) { stopLoop(); procStart(name); currentLoop = name; return; }
    var el = getLoopEl();
    if (currentLoop === name && el.src && !el.paused) { crossTo(el, el.volume, soundVol, 250); return; }
    quiet(el);
    procStop();
    el.onerror = null;
    el.src = BASE + LOOPS[name];
    currentLoop = name;
    el.onerror = function () {
      if (el === loopEl && currentLoop === name) procStart(name);
    };
    el.volume = 0;
    safePlay(el, name, function () { procStart(name); });
  }
  function stopLoop() {
    if (loopEl) quiet(loopEl);
    procStop();
    currentLoop = "off";
  }
  function playMusic(name) {
    if (name === "off") { stopMusic(); return; }
    if (!MUSIC[name]) return;
    var el = getMusicEl();
    if (currentMusic === name && el.src && !el.paused) { crossTo(el, el.volume, musicVol, 250); return; }
    quiet(el);
    el.onerror = null;
    el.src = BASE + MUSIC[name];
    currentMusic = name;
    el.volume = 0;
    safePlay(el, name, function () {});
  }
  function stopMusic() {
    if (musicEl) quiet(musicEl);
    currentMusic = "off";
  }
  function setVol(v) { soundVol = v; if (loopEl && loopEl.src) loopEl.volume = v; if (masterGain) masterGain.gain.value = v; }
  function setMusicVol(v) { musicVol = v; if (musicEl && musicEl.src) musicEl.volume = v; }

  /* ---------------- expose (backward-compatible surface) ---------------- */
  window.MT_AMBIENT = {
    start: playLoop,      // noise loop by name ("rain","fire","wind","night")
    stop: stopLoop,
    playMusic: playMusic, // music mood ("calm","sad","tense","epic")
    stopMusic: stopMusic,
    setVol: setVol,
    setMusicVol: setMusicVol,
    active: function () { return currentLoop; },
    music: function () { return currentMusic; }
  };
})();