/* ============================================================
   audio.js — sound effects.

   Two supplied recordings do the heavy lifting:
     sfx/airplane fly sound .ogg     looped while the aircraft flies
     sfx/airplane reached sound .ogg played when it reaches the target
     sfx/bg music.ogg                looped under everything, at 40%

   Everything else (clicks, stepper ticks, the wrong-answer cue) is
   still generated with the Web Audio API, so no extra files are
   needed. If a recording fails to load the synthesised engine takes
   over automatically, and the game never falls silent.
   ============================================================ */
window.CG = window.CG || {};

CG.Audio = (function () {
  var ctx = null, master = null;
  var enabled = true;

  try {
    var saved = sessionStorage.getItem('cg-sound');
    if (saved !== null) enabled = saved === '1';
  } catch (e) { /* private mode — keep default */ }

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { console.warn('[audio] Web Audio API unavailable — running silent.'); return null; }
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.30;
      master.connect(ctx.destination);
    } catch (err) {
      console.warn('[audio] could not create AudioContext:', err);
      ctx = null;
    }
    return ctx;
  }

  /* Called from the first real user gesture (no autoplay before that). */
  function unlock() {
    var c = ensure();
    if (c && c.state === 'suspended') c.resume();
  }

  function voice(o) {
    if (!enabled) return;
    var c = ensure();
    if (!c) return;
    var t0 = c.currentTime + (o.delay || 0);
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t0 + o.dur);

    var peak = (o.vol == null ? 0.5 : o.vol);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack || 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  }

  function noise(o) {
    if (!enabled) return;
    var c = ensure();
    if (!c) return;
    var dur = o.dur || 0.3;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource();
    src.buffer = buf;
    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = o.freq || 800;
    bp.Q.value = o.q || 0.8;
    var g = c.createGain();
    g.gain.value = (o.vol == null ? 0.12 : o.vol);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(c.currentTime + (o.delay || 0));
  }

  /* ---- looping aircraft engine -------------------------------------
     Two detuned saw oscillators plus filtered noise, so the aircraft is
     audibly running for the whole flight rather than just clicking per
     cell. start() ramps in, boost() lifts it as the plane accelerates
     into a cell, stop() ramps out. ------------------------------------ */
  var engine = null;

  function engineStart() {
    if (!enabled) return;
    var c = ensure();
    if (!c || engine) return;
    try {
      var t = c.currentTime;
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.35);

      var lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(420, t);
      lp.Q.value = 0.7;

      var o1 = c.createOscillator(), o2 = c.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'sawtooth';
      o1.frequency.setValueAtTime(84, t);
      o2.frequency.setValueAtTime(88.5, t);      /* slight detune = beating */

      var og = c.createGain();
      og.gain.value = 0.55;
      o1.connect(og); o2.connect(og); og.connect(lp);

      /* rushing-air bed: 2 s of looping noise */
      var len = Math.floor(c.sampleRate * 2);
      var buf = c.createBuffer(1, len, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      var air = c.createBufferSource();
      air.buffer = buf; air.loop = true;
      var bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.5;
      var ag = c.createGain(); ag.gain.value = 0.30;
      air.connect(bp); bp.connect(ag); ag.connect(lp);

      lp.connect(g); g.connect(master);
      o1.start(t); o2.start(t); air.start(t);

      engine = { g: g, lp: lp, o1: o1, o2: o2, air: air };
    } catch (err) {
      console.warn('[audio] engine failed to start:', err);
      engine = null;
    }
  }

  /* a small surge of thrust as the aircraft enters the next cell */
  function engineBoost() {
    if (!engine || !ctx) return;
    var t = ctx.currentTime;
    try {
      engine.lp.frequency.cancelScheduledValues(t);
      engine.lp.frequency.setValueAtTime(engine.lp.frequency.value, t);
      engine.lp.frequency.linearRampToValueAtTime(900, t + 0.10);
      engine.lp.frequency.linearRampToValueAtTime(430, t + 0.40);
      engine.o1.frequency.setValueAtTime(engine.o1.frequency.value, t);
      engine.o1.frequency.linearRampToValueAtTime(102, t + 0.10);
      engine.o1.frequency.linearRampToValueAtTime(86, t + 0.40);
    } catch (err) { /* ramp collision — harmless */ }
  }

  function engineStop() {
    if (!engine || !ctx) return;
    var e = engine, t = ctx.currentTime;
    engine = null;
    try {
      e.g.gain.cancelScheduledValues(t);
      e.g.gain.setValueAtTime(e.g.gain.value, t);
      e.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      window.setTimeout(function () {
        try { e.o1.stop(); e.o2.stop(); e.air.stop(); } catch (err) {}
      }, 600);
    } catch (err) { /* context already gone */ }
  }

  /* ---- supplied recordings ------------------------------------------
     The fly recording is 45s of varied flight ambience rather than a
     clean drone: it opens quietly, and thins out badly after ~33s. We
     start every flight at a settled, even-level point and loop, so each
     flight sounds the same and never lands in the quiet stretch. */
  var FLY_START = 11.0;      /* seconds — measured settled point */
  var FLY_VOL = 0.55;
  var REACHED_VOL = 0.9;
  var MUSIC_VOL = 0.40;      /* the requested bed level */
  /* Shore break level. Everything synthesised runs through master at
     0.30, and the brown-noise bed loses 5.5dB to its own bandpass, so a
     small-looking number here is far quieter than it appears: 0.075 came
     out at -74dBFS, inaudible. Measured, 0.80 puts the swell between
     -42 and -32 dBFS — clearly there, and roughly 25dB under the music
     bed, which is what "slightly, not too loud" needs to mean once the
     signal chain is accounted for. */
  var SURF_VOL = 0.80;

  /* Ducking. A 40% music bed sitting under a 0.9 voice muddies the
     instruction, which is the one thing a learner cannot afford to miss,
     so the bed steps down while anything more important is playing.
     Factors multiply, so voice during flight ducks the most. */
  /* How far the music bed drops. These were 0.42 and 0.70, which left the
     bed still competing with a spoken instruction and with the aircraft
     recording. A learner has to be able to hear the question and the
     engine without either fighting the music, so both ducks go much
     deeper — and they multiply, so a line spoken during a flight ducks
     furthest of all. */
  var DUCK = { voice: 0.20, flight: 0.38 };
  var ducks = {};

  var media = { fly: null, reached: null };
  var mediaReady = { fly: false, reached: false };
  var music = null, musicReady = false, musicWanted = false;
  var surf = null;           /* { src, gain, duck, lfo[] } once running */
  var fadeRaf = null, musicRaf = null;

  function bindMedia() {
    if (media.fly || media.reached) return;
    media.fly = document.getElementById('sfxFly');
    media.reached = document.getElementById('sfxReached');
    music = document.getElementById('sfxMusic');
    if (music) {
      music.volume = 0;
      music.addEventListener('canplay', function () {
        musicReady = true;
        if (musicWanted) musicStart();
      });
      music.addEventListener('error', function () {
        musicReady = false;
        console.warn('[audio] could not load ' + music.getAttribute('src') +
                     ' — the game runs without music.');
      });
      if (music.readyState >= 2) musicReady = true;
    } else {
      console.warn('[audio] no <audio id="sfxMusic"> — no background music.');
    }
    Object.keys(media).forEach(function (k) {
      var el = media[k];
      if (!el) { console.warn('[audio] missing <audio> element for "' + k + '"'); return; }
      el.volume = 0;
      el.addEventListener('canplaythrough', function () { mediaReady[k] = true; });
      el.addEventListener('error', function () {
        mediaReady[k] = false;
        console.warn('[audio] could not load ' + el.getAttribute('src') +
                     ' — falling back to the synthesised cue.');
      });
      if (el.readyState >= 3) mediaReady[k] = true;
    });
  }

  /* Waits for both recordings so the loading screen can cover them. */
  /* preload() used to live here and block the boot on canplaythrough.
     js/preload.js owns fetching now and hands each element a blob, and
     bindMedia() picks the readiness up either from its canplaythrough
     listener or from readyState on attach — so there is nothing left for
     a second preloader to do. */



  /* smooth volume ramp on a media element (no Web Audio routing needed,
     so this works from file:// as well as a server) */
  function fadeTo(el, target, ms, thenPause) {
    if (!el) return;
    if (fadeRaf) { cancelAnimationFrame(fadeRaf); fadeRaf = null; }
    var from = el.volume, t0 = performance.now();
    function frame(now) {
      var p = Math.min(1, (now - t0) / ms);
      el.volume = Math.max(0, Math.min(1, from + (target - from) * p));
      if (p < 1) { fadeRaf = requestAnimationFrame(frame); return; }
      fadeRaf = null;
      if (thenPause) { try { el.pause(); } catch (e) {} }
    }
    fadeRaf = requestAnimationFrame(frame);
  }

  function flyStart() {
    var el = media.fly;
    if (!el || !mediaReady.fly) return false;
    try {
      /* always from the same settled point: every flight sounds the
         same, and playback can never drift into the thin stretch that
         starts around 33s */
      el.currentTime = FLY_START;
      el.volume = 0;
      var pr = el.play();
      if (pr && pr.catch) pr.catch(function () { /* blocked before a gesture */ });
      fadeTo(el, FLY_VOL, 420);
      return true;
    } catch (err) {
      console.warn('[audio] fly sound failed:', err);
      return false;
    }
  }

  function flyStop() {
    var el = media.fly;
    if (!el) return;
    fadeTo(el, 0, 520, true);
  }

  /* muting must be instant, not a graceful landing */
  function flyStopNow() {
    var el = media.fly;
    if (!el) return;
    if (fadeRaf) { cancelAnimationFrame(fadeRaf); fadeRaf = null; }
    el.volume = 0;
    try { el.pause(); } catch (e) {}
  }

  /* ---- shore break -------------------------------------------------
     No recording was supplied for this one, so it is synthesised: a
     seamless loop of brown noise through a bandpass, with two very slow
     oscillators summed into its gain so the swell rises and falls
     without ever repeating a pattern the ear can latch onto.

     The loop is crossfaded end-to-start, otherwise brown noise clicks
     audibly every time it wraps.                                      */
  function makeSurfBuffer(c) {
    var seconds = 8, tail = Math.floor(c.sampleRate * 0.6);
    var len = Math.floor(c.sampleRate * seconds);
    var raw = new Float32Array(len + tail);
    var last = 0;
    for (var i = 0; i < raw.length; i++) {
      var w = Math.random() * 2 - 1;
      last = (last + 0.022 * w) / 1.022;    /* integrate toward brown */
      raw[i] = last * 3.2;
    }
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var j = 0; j < len; j++) d[j] = raw[j];
    /* fold the tail back over the head so the wrap is inaudible */
    for (var k = 0; k < tail; k++) {
      var t = k / tail;
      d[k] = d[k] * t + raw[len + k] * (1 - t);
    }
    return buf;
  }

  function surfStart() {
    var c = ensure();
    if (!c || !enabled || surf) return;
    try {
      var src = c.createBufferSource();
      src.buffer = makeSurfBuffer(c);
      src.loop = true;

      var bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 560;             /* the body of a breaking wave */
      bp.Q.value = 0.62;

      var hp = c.createBiquadFilter();
      hp.type = 'highshelf';
      hp.frequency.value = 2400;
      hp.gain.value = -7;                   /* take the hiss off the top   */

      var g = c.createGain();
      g.gain.value = SURF_VOL * 0.62;       /* the level between swells    */

      /* two slow swells, deliberately not harmonically related */
      var lfos = [];
      [[0.105, 0.20], [0.067, 0.11]].forEach(function (pair) {
        var o = c.createOscillator();
        o.frequency.value = pair[0];
        var depth = c.createGain();
        depth.gain.value = SURF_VOL * pair[1];
        o.connect(depth);
        depth.connect(g.gain);
        o.start();
        lfos.push(o);
      });

      var duckGain = c.createGain();
      duckGain.gain.value = 0;              /* faded in below */

      src.connect(bp); bp.connect(hp); hp.connect(g);
      g.connect(duckGain); duckGain.connect(master);
      src.start();

      surf = { src: src, gain: g, duck: duckGain, lfos: lfos };
      duckGain.gain.setTargetAtTime(surfDuckLevel(), c.currentTime, 1.2);
    } catch (err) {
      console.warn('[audio] shore break unavailable:', err);
      surf = null;
    }
  }

  function surfStop() {
    if (!surf) return;
    try {
      surf.duck.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      var s = surf;
      window.setTimeout(function () {
        try { s.src.stop(); s.lfos.forEach(function (o) { o.stop(); }); } catch (e) {}
      }, 900);
    } catch (e) {}
    surf = null;
  }

  /* the shore break ducks with everything else, just less deeply: it is
     scenery, so it thins under an instruction rather than disappearing */
  function surfDuckLevel() {
    var v = 1;
    Object.keys(ducks).forEach(function (k) {
      if (ducks[k]) v *= (k === 'voice' ? 0.32 : 0.58);
    });
    return v;
  }

  /* ---- background music -------------------------------------------- */
  function musicTarget() {
    var v = MUSIC_VOL;
    Object.keys(ducks).forEach(function (k) { if (ducks[k]) v *= DUCK[k] || 1; });
    return v;
  }

  function fadeMusic(target, ms) {
    if (!music) return;
    if (musicRaf) { cancelAnimationFrame(musicRaf); musicRaf = null; }
    var from = music.volume, t0 = performance.now();
    function frame(now) {
      var p = Math.min(1, (now - t0) / ms);
      music.volume = Math.max(0, Math.min(1, from + (target - from) * p));
      if (p < 1) { musicRaf = requestAnimationFrame(frame); return; }
      musicRaf = null;
      if (target === 0) { try { music.pause(); } catch (e) {} }
    }
    musicRaf = requestAnimationFrame(frame);
  }

  function musicStart() {
    musicWanted = true;
    if (!enabled) return;
    bindMedia();
    if (!music || !musicReady) return;      /* still streaming; retried on canplay */
    try {
      var pr = music.play();
      if (pr && pr.catch) pr.catch(function () {});
      fadeMusic(musicTarget(), 1400);       /* ease in, never a hard cut */
    } catch (err) {
      console.warn('[audio] music failed to start:', err);
    }
  }

  function musicStop() {
    musicWanted = false;
    fadeMusic(0, 700);
  }

  /* duck('voice', true) while an instruction is being spoken, etc. */
  function duck(reason, on) {
    if (!(reason in DUCK)) return;
    if (!!ducks[reason] === !!on) return;
    ducks[reason] = !!on;
    if (music && musicWanted && enabled) fadeMusic(musicTarget(), on ? 200 : 640);
    if (surf && ctx) {
      surf.duck.gain.setTargetAtTime(surfDuckLevel(), ctx.currentTime, on ? 0.20 : 0.45);
    }
  }

  function playReached() {
    var el = media.reached;
    if (!el || !mediaReady.reached) return false;
    try {
      el.currentTime = 0;
      el.volume = REACHED_VOL;
      var pr = el.play();
      if (pr && pr.catch) pr.catch(function () {});
      return true;
    } catch (err) {
      console.warn('[audio] reached sound failed:', err);
      return false;
    }
  }

  /* ---- takeoff cues -------------------------------------------------
     The supplied recording is a steady cruise loop, so the two moments
     the intro needs from it are missing: engines running up against the
     brakes, and the rush as the wheels leave the tarmac. Both are
     synthesised here.

     Both are BODIES, not notes. A jet is broadband and weighted low, so
     the pitch you hear is the filter opening, never an oscillator
     sweeping a scale — a rising tone reads as a cartoon slide whistle. */

  /* Brown-ish noise through a swept bandpass: the airframe rush. */
  function rush(o) {
    if (!enabled) return;
    var c = ensure();
    if (!c) return;
    var t0 = c.currentTime + (o.delay || 0);
    var dur = o.dur;
    var len = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0), last = 0, i;
    for (i = 0; i < len; i++) {
      last = (last + (Math.random() * 2 - 1) * 0.11) * 0.985;
      d[i] = last * 3.2;
    }
    var src = c.createBufferSource();
    src.buffer = buf;
    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = o.q || 0.7;
    bp.frequency.setValueAtTime(o.from, t0);
    /* o.peak gives the doppler arc: open up, then fall away behind us */
    if (o.peak) {
      bp.frequency.linearRampToValueAtTime(o.peak, t0 + dur * 0.42);
      bp.frequency.linearRampToValueAtTime(o.to, t0 + dur);
    } else {
      bp.frequency.linearRampToValueAtTime(o.to, t0 + dur);
    }
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.vol, t0 + dur * (o.attack || 0.3));
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /* Engines spooling: two detuned saws travelling through a lowpass, so
     what moves is the body and not the note. f and lp are [from, to],
     which is what makes it work in both directions — running up on the
     brakes, or winding down after a landing. */
  function spool(o) {
    if (!enabled) return;
    var c = ensure();
    if (!c) return;
    var t0 = c.currentTime, dur = o.dur, i, osc;
    var up = o.lp[1] > o.lp[0];
    var lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(o.lp[0], t0);
    lp.frequency.linearRampToValueAtTime(o.lp[1], t0 + dur);
    var g = c.createGain();
    /* the level follows the filter: a run-up swells, a wind-down sags */
    g.gain.setValueAtTime(up ? 0.0001 : o.vol, t0);
    if (up) {
      g.gain.linearRampToValueAtTime(o.vol, t0 + dur * 0.80);
      g.gain.linearRampToValueAtTime(o.vol * 0.86, t0 + dur);
    } else {
      g.gain.linearRampToValueAtTime(o.vol * 0.55, t0 + dur * 0.70);
    }
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.35);
    for (i = 0; i < 2; i++) {
      osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(o.f[0] + i * 1.7, t0);   /* detuned: it beats */
      osc.frequency.linearRampToValueAtTime(o.f[1] + i * 5, t0 + dur);
      osc.connect(lp);
      osc.start(t0);
      osc.stop(t0 + dur + 0.4);
    }
    lp.connect(g); g.connect(master);
    /* the intake hiss riding on top, travelling the same way */
    rush({ dur: dur, from: o.lp[0] * 1.5, to: o.lp[1] * 1.6,
           vol: o.vol * 0.50, q: 0.6, attack: up ? 0.85 : 0.12 });
  }

  var cues = {
    uiClick:     function () { voice({ freq: 620, to: 880, dur: 0.09, type: 'triangle', vol: 0.30 }); },
    stepperTick: function () { voice({ freq: 1180, to: 1500, dur: 0.05, type: 'square', vol: 0.10 }); },
    /* a soft tick as each grid line is crossed — it gives the counting a
       rhythm under the flight recording without competing with it */
    aircraftMove: function () {
      if (mediaReady.fly) { voice({ freq: 1500, to: 1900, dur: 0.06, type: 'triangle', vol: 0.07 }); return; }
      noise({ freq: 1300, dur: 0.30, vol: 0.09, q: 1.1 });
      voice({ freq: 300, to: 220, dur: 0.18, type: 'sine', vol: 0.09 });
      engineBoost();
    },
    /* the supplied arrival chime; synth fallback if it is unavailable */
    reached: function () {
      if (playReached()) return;
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        voice({ freq: f, dur: 0.30, type: 'triangle', vol: 0.26, delay: i * 0.085 });
      });
    },
    success: function () {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        voice({ freq: f, dur: 0.30, type: 'triangle', vol: 0.26, delay: i * 0.085 });
      });
    },
    incorrect: function () {
      voice({ freq: 300, to: 190, dur: 0.26, type: 'sine', vol: 0.24 });
      voice({ freq: 224, to: 150, dur: 0.30, type: 'sine', vol: 0.16, delay: 0.09 });
    },
    levelTransition: function () {
      voice({ freq: 440, to: 880, dur: 0.22, type: 'triangle', vol: 0.16 });
    },
    reveal: function () {
      voice({ freq: 880, to: 1320, dur: 0.20, type: 'triangle', vol: 0.16 });
    },
    /* ---- the intro landing --------------------------------------- */
    /* Coming over the threshold: airframe only, no engine — an aircraft
       on final approach is at idle, and that quiet is what makes the
       touchdown land. */
    airframeRush: function () {
      rush({ dur: 1.10, from: 300, peak: 1900, to: 480, vol: 0.22, q: 0.55, attack: 0.26 });
    },
    /* THE WHEELS MEETING THE TARMAC — a bright tyre chirp with a hard
       decay, over a low thump through the airframe. Two layers, because
       a landing is heard in two places at once: the contact and the
       weight coming down onto it. */
    touchdown: function () {
      rush({ dur: 0.34, from: 1500, peak: 2700, to: 900, vol: 0.30, q: 1.6, attack: 0.06 });
      voice({ freq: 96, to: 52, dur: 0.42, type: 'sine', vol: 0.30, attack: 0.004 });
      voice({ freq: 152, to: 82, dur: 0.24, type: 'triangle', vol: 0.13, attack: 0.004 });
    },
    /* reverse thrust, swelling and falling away through the rollout */
    reverseThrust: function () {
      rush({ dur: 1.50, from: 380, peak: 1500, to: 300, vol: 0.24, q: 0.5, attack: 0.18 });
      voice({ freq: 84, to: 58, dur: 1.20, type: 'sawtooth', vol: 0.09, attack: 0.22 });
    },
    /* engines winding down once it has come to a stop */
    spoolDown: function () {
      spool({ dur: 1.7, vol: 0.18, f: [122, 40], lp: [1050, 200] });
    },
    /* land ahead: the airspace opening up as the headlands arrive */
    landfall: function () {
      [261.63, 392.00, 523.25, 659.25].forEach(function (f, i) {
        voice({ freq: f, dur: 1.15, type: 'triangle', vol: 0.13, attack: 0.22, delay: i * 0.13 });
      });
      rush({ dur: 1.60, from: 900, to: 220, vol: 0.10, q: 0.5, attack: 0.25 });
    }
  };

  function play(name) {
    var fn = cues[name];
    if (!fn) { console.warn('[audio] unknown cue:', name); return; }
    if (!enabled) return;
    unlock();
    try { fn(); } catch (err) { console.warn('[audio] cue failed:', name, err); }
  }

  return {
    play: play,
    unlock: unlock,
    musicStart: function () { unlock(); bindMedia(); musicStart(); },
    musicStop: musicStop,
    surfStart: function () { unlock(); surfStart(); },
    surfStop: surfStop,
    duck: duck,
    /* flight bed: the recording if it loaded, the synthesiser if not */
    engineStart: function () {
      if (!enabled) return;
      unlock();
      bindMedia();
      if (!flyStart()) engineStart();      /* recording, else synthesiser */
    },
    engineStop: function () {
      flyStop();
      engineStop();
    },
    isEnabled: function () { return enabled; },
    setEnabled: function (v) {
      enabled = !!v;
      try { sessionStorage.setItem('cg-sound', enabled ? '1' : '0'); } catch (e) {}
      if (enabled) { unlock(); if (musicWanted) musicStart(); surfStart(); }
      else { flyStopNow(); engineStop(); fadeMusic(0, 200); surfStop(); }
    }
  };
})();
