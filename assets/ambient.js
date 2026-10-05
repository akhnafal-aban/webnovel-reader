/* =========================================================================
   MT_AMBIENT — pure WebAudio ambient soundscapes. No files, no network.
   API: start(mode) · stop() · setVol(v) · active()
   Modes: rain | wind | fire | night
   Audio context is created lazily on first start (after a user gesture).
   ========================================================================= */
(function () {
  "use strict";
  if (window.MT_AMBIENT) return;

  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null;
  var master = null;
  var nodes = [];          // active nodes for current scene (cleaned on stop)
  var lfoTimers = [];      // setInterval handles for JS-driven LFOs / crackle
  var currentMode = "off";

  function ensureCtx() {
    if (ctx) return ctx;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = readVol();
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }

  // Read volume from MT_App prefs if available, else default 0.35.
  function readVol() {
    try {
      if (window.MT_App && MT_App.prefs && typeof MT_App.prefs.ambientVol === "number") {
        return MT_App.prefs.ambientVol;
      }
    } catch (e) {}
    return 0.35;
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* ---- noise buffer generators ---- */
  function whiteBuffer(seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function brownBuffer(seconds) {
    // integrated white noise → brownian
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  function pinkBuffer(seconds) {
    // Paul Kellet's pink noise approximation
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  function loopSource(buf) {
    var s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    return s;
  }

  /* ---- JS-driven slow LFO on a gain node (periodic setValueAtTime ramp) ---- */
  function startGainLFO(gainNode, depth, periodMs, base) {
    var t = 0;
    function tick() {
      var now = ctx.currentTime;
      var up = base + depth;
      var dn = base - depth;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(t % 2 === 0 ? dn : up, now);
      gainNode.gain.linearRampToValueAtTime(t % 2 === 0 ? up : dn, now + periodMs / 1000);
      t++;
    }
    tick();
    var id = setInterval(tick, periodMs);
    lfoTimers.push(id);
    return gainNode;
  }

  /* ---- scenes ---- */
  function buildRain() {
    var src = loopSource(whiteBuffer(3));
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 0.7;
    var g = ctx.createGain(); g.gain.value = 0.5;
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start();
    nodes.push(src, lp, g);
    // slow amplitude LFO 0.25Hz, depth 0.12
    startGainLFO(g, 0.12, 4000, 0.5);
  }

  function buildWind() {
    var src = loopSource(brownBuffer(3));
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 350; bp.Q.value = 0.5;
    var g = ctx.createGain(); g.gain.value = 0.4;
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start();
    nodes.push(src, bp, g);
    // 0.1Hz gain LFO, depth 0.1
    startGainLFO(g, 0.1, 10000, 0.4);
  }

  function buildFire() {
    var src = loopSource(pinkBuffer(3));
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 700; lp.Q.value = 0.6;
    var g = ctx.createGain(); g.gain.value = 0.32;
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start();
    nodes.push(src, lp, g);
    // crackle: random gain spikes via short bursts
    function crackle() {
      if (!ctx || currentMode !== "fire") return;
      var burst = ctx.createGain();
      burst.gain.value = 0;
      burst.connect(master);
      var now = ctx.currentTime;
      var peak = 0.18 + Math.random() * 0.22;
      burst.gain.setValueAtTime(0, now);
      burst.gain.linearRampToValueAtTime(peak, now + 0.005);
      burst.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
      // short noise pop
      var pop = ctx.createBufferSource();
      pop.buffer = whiteBuffer(0.05);
      pop.connect(burst);
      pop.start(now);
      pop.stop(now + 0.05);
      var next = 200 + Math.random() * 400;
      var id = setTimeout(crackle, next);
      lfoTimers.push(id);
    }
    var id = setTimeout(crackle, 200);
    lfoTimers.push(id);
  }

  function buildNight() {
    // two sine oscillators 110Hz + 164.8Hz (E), gain 0.05, tremolo 0.2Hz
    var freqs = [110, 164.8];
    var carGain = ctx.createGain(); carGain.gain.value = 0.05;
    carGain.connect(master);
    nodes.push(carGain);
    freqs.forEach(function (f) {
      var osc = ctx.createOscillator();
      osc.type = "sine"; osc.frequency.value = f;
      var og = ctx.createGain(); og.gain.value = 0.5;
      osc.connect(og); og.connect(carGain);
      osc.start();
      nodes.push(osc, og);
    });
    // tremolo 0.2Hz on the carrier gain, depth 0.02
    startGainLFO(carGain, 0.02, 5000, 0.05);
  }

  var BUILDERS = {
    rain: buildRain,
    wind: buildWind,
    fire: buildFire,
    night: buildNight
  };

  function clearAll() {
    nodes.forEach(function (n) {
      try { if (n.stop) n.stop(); } catch (e) {}
      try { n.disconnect(); } catch (e) {}
    });
    nodes = [];
    lfoTimers.forEach(function (id) { clearTimeout(id); clearInterval(id); });
    lfoTimers = [];
  }

  function start(mode) {
    if (!BUILDERS[mode]) { stop(); return; }
    var c = ensureCtx();
    if (!c) return;
    // resume if suspended (gesture-driven start)
    if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
    if (currentMode === mode) return; // already running
    clearAll();
    currentMode = mode;
    try { BUILDERS[mode](); } catch (e) { clearAll(); currentMode = "off"; }
  }

  function stop() {
    clearAll();
    currentMode = "off";
  }

  function setVol(v) {
    var nv = clamp01(v);
    if (master) {
      try { master.gain.setTargetAtTime(nv, ctx.currentTime, 0.05); } catch (e) { try { master.gain.value = nv; } catch (x) {} }
    }
  }

  function active() {
    return currentMode !== "off" && !!ctx;
  }

  window.MT_AMBIENT = {
    start: start,
    stop: stop,
    setVol: setVol,
    active: active,
    get mode() { return currentMode; }
  };
})();
