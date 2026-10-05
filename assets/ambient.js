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
  function makeEl(src, loop) {
    var a = new Audio();
    a.src = src;
    a.loop = !!loop;
    a.preload = "auto";
    a.crossOrigin = "anonymous";
    return a;
  }
  function crossTo(el, from, to, ms, cb) {
    var t0 = Date.now();
    var iv = setInterval(function () {
      var p = Math.min(1, (Date.now() - t0) / ms);
      var v = from + (to - from) * p;
      if (el) el.volume = Math.max(0, Math.min(1, v));
      if (p >= 1) { clearInterval(iv); if (cb) cb(); }
    }, 40);
  }
  function playLoop(name) {
    if (currentLoop === name && loopEl) return;
    stopLoop();
    if (name === "off") { currentLoop = "off"; return; }
    if (!LOOPS[name]) { procStart(name); currentLoop = name; return; }
    currentLoop = name;
    var el = makeEl(BASE + LOOPS[name], true);
    el.volume = 0;
    el.onerror = function () { procStart(name); };
    el.play().then(function () { crossTo(el, 0, soundVol, 600); }).catch(function () { procStart(name); });
    loopEl = el;
  }
  function stopLoop() {
    if (loopEl) { try { loopEl.pause(); loopEl.src = ""; } catch (e) {} loopEl = null; }
    procStop();
    currentLoop = "off";
  }
  function playMusic(name) {
    if (currentMusic === name && musicEl) return;
    var old = musicEl;
    musicEl = null;
    currentMusic = "off";
    if (old) { crossTo(old, old.volume, 0, 350, function () { try { old.pause(); } catch (e) {} }); }
    if (name === "off") return;
    if (!MUSIC[name]) return;
    currentMusic = name;
    var el = makeEl(BASE + MUSIC[name], true);
    el.volume = 0;
    el.onerror = function () {};
    el.play().then(function () { crossTo(el, 0, musicVol, 900); }).catch(function () {});
    musicEl = el;
  }
  function stopMusic() {
    if (musicEl) { try { musicEl.pause(); musicEl.src = ""; } catch (e) {} musicEl = null; }
    currentMusic = "off";
  }
  function setVol(v) { soundVol = v; if (loopEl) loopEl.volume = v; if (masterGain) masterGain.gain.value = v; }
  function setMusicVol(v) { musicVol = v; if (musicEl) musicEl.volume = v; }

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