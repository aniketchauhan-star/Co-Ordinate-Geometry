/* ===================================================================
   CO-ORDINATE GEOMETRY — THE ARRIVAL
   -------------------------------------------------------------------
   Press PLAY and an aircraft is inbound, high over open water. Five
   beats, and it flies in a straight line the whole way:

     APPROACH  four seconds above the sea, descending, cloud rushing up
     DESCENT   the runway fades up ahead and it crosses the threshold
     TOUCH     the wheels meet the tarmac
     ROLLOUT   reverse thrust, decelerating down the strip
     STOP      stopped, engines winding down — then the game

   FOUR THINGS THAT ARE THE WAY THEY ARE ON PURPOSE

   1. IT LANDS TOWARD THE CAMERA. The same runway flown the other way
      would have the aircraft receding from the near threshold into the
      distance — a landing watched from behind, where it shrinks all the
      way in and touchdown happens at the furthest point. Coming at the
      camera it grows the whole way and touches down in front of you.
      Its heading is therefore 180 for the entire flight.

   2. IT ONLY EVER SLOWS DOWN once the wheels are on. The rollout's
      easing is chosen so its velocity falls monotonically: an aircraft
      that accelerates out of touchdown reads as a bounce.

   3. THE GROUND RUNS BACKWARD compared with a takeoff. Travelling
      toward the camera moves the vanishing point away, so the dolly
      CONTRACTS the runway — k falls from 1.52 to 1.02 — and the ground
      sweeps up the frame. The speed lines run up with it.

   4. IT FADES OUT TO CROSS THE GAP. Its station is the chart's origin,
      which is not on the runway, and no straight line joins the two.
      So rather than bend the flight into a curve, the aircraft fades
      out where it stopped, moves while invisible, and fades back in on
      station under the closing dissolve — which is also where the
      180-degree turn onto north happens, unseen.

   frame(t) is a pure function of the clock: it returns the complete
   visual state at time t and touches nothing. tick() is the only thing
   that writes to the DOM. That split is what makes the whole timeline
   checkable without rendering a single pixel.
   =================================================================== */
window.CG = window.CG || {};

CG.Intro = (function () {
  'use strict';

  /* ---- the beat table ---------------------------------------------
     Milliseconds from the click. The whole cinematic reads its timing
     from here, so nothing can drift out of step; scale these to make it
     shorter. APPROACH to DESCENT is deliberately exactly four seconds. */
  var BEAT = {
    approach: 0,       /* inbound, high over open water               */
    descent:  4000,    /* 4000ms of sea; the runway fades up ahead     */
    touch:    4900,    /* the wheels meet the tarmac                   */
    stop:     6600,    /* rolled out to a standstill                   */
    close:    7300,    /* engines idling, then the dissolve            */
    end:      8200
  };

  /* ---- runway geometry, measured out of runway.png -----------------
     Stage pixels on the 1920x1080 canvas. The artwork is 1672x941 —
     exactly 16:9 — so it fills the canvas with no crop, and reading its
     pixels gives the tarmac centreline at x = 0.497w and the strip
     running from y = 53px (far threshold) to y = 1041px (near one). */
  var CENTRELINE = 954;
  /* It lands toward the camera, so it points down the frame the whole
     way. The supplied art points north at 0 degrees. */
  var HEADING = 180;
  var TOUCH_Y = 620;     /* where the wheels meet the tarmac           */
  /* Where it comes to rest. The painted near threshold is at y=1041,
     but a 196px aircraft is 229px tall, so stopping any lower crops its
     nose against the bottom of the frame. At 946 it has used 90% of the
     strip, which is about what a landing uses. */
  var PARK_Y = 946;

  /* ---- the approach above the sea ----------------------------------
     Dead straight down the same centreline, and slow: 220px over four
     seconds is 55px/s, against the game's own cruise of 175px/s. The
     aircraft is almost stationary in frame on purpose — the cloud
     streaming UP past it is what carries the speed, which is how a
     tracking shot works. It grows the whole way in. */
  var SEA = { y0: 250, y1: 470, w0: 132, w1: 168 };
  var W_TOUCH = 190, W_PARK = 196;

  /* Speed at the moment the wheels meet, in px/ms. It is the fastest
     the aircraft ever moves, and it is also what keeps the rollout
     decelerating: the cubic that meets it needs an opening slope of at
     least (3 - m1)/2, and any slower a touchdown would force that
     slope below the bar and put a brief acceleration — a bounce —
     right after the wheels are down. See slopes(). */
  var V_TOUCH = 0.29;

  /* Where the game wants the aircraft: stage 1's origin, at the
     wingspan syncPlaneScale() asks for. Read from the same config the
     game reads, so the two cannot drift apart. */
  function station() {
    var s = (CG.STAGES && CG.STAGES[1]) || { cell: 112, origin: { x: 624, y: 870 } };
    return {
      x: s.origin.x,
      y: s.origin.y,
      w: Math.max(88, Math.min(108, 0.85 * s.cell))
    };
  }

  /* ---- easing ------------------------------------------------------ */
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOut(u) { u = clamp01(u); return 1 - Math.pow(1 - u, 3); }
  function easeIO(u)  {
    u = clamp01(u);
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  }
  function mix(a, b, u) { return a + (b - a) * u; }

  /* ---- velocity-matched easing --------------------------------------
     Eases laid end to end do not make a smooth flight. Each one opens
     and closes at whatever velocity its own curve happens to have, so
     the joins lurch — measured, on the takeoff this replaced, an
     easeOut opened at 834px/s against the phase before it exiting at
     252px/s: a 3.3x jump at exactly the frame the player is watching.

     hermite(u, m0, m1) is the cubic through (0,0) and (1,1) whose end
     slopes are m0 and m1, expressed as multiples of the phase's own
     average speed. Give a phase the slope its neighbour hands over at
     and velocity is continuous across the join. */
  function hermite(u, m0, m1) {
    u = clamp01(u);
    var a = m0 - 2 + m1, b = 3 - 2 * m0 - m1;
    return ((a * u + b) * u + m0) * u;
  }

  function rate(dist, ms) { return dist / ms; }

  /* Every slope here is DERIVED from the beat table and the distances,
     never written down, so retiming a beat keeps the joins smooth
     rather than quietly reintroducing a lurch.

     The descent opens at the approach's cruise speed and closes at
     touchdown speed. The rollout opens at touchdown speed and closes at
     whatever the settle opens at. */
  function slopes() {
    var appD = SEA.y1 - SEA.y0,        appMs = BEAT.descent - BEAT.approach;
    var desD = TOUCH_Y - SEA.y1,       desMs = BEAT.touch - BEAT.descent;
    var rolD = (PARK_Y - 6) - TOUCH_Y, rolMs = BEAT.stop - BEAT.touch;
    var setD = 6,                      setMs = BEAT.close - BEAT.stop;
    var vCruise = rate(appD, appMs);
    var vSettle = 3 * rate(setD, setMs);      /* easeOut opens at 3x average */
    return {
      des: [vCruise / rate(desD, desMs), V_TOUCH / rate(desD, desMs)],
      rol: [V_TOUCH / rate(rolD, rolMs), vSettle / rate(rolD, rolMs)]
    };
  }

  /* ===================================================================
     frame(t) — the complete visual state at time t, and nothing else.
     Pure: no DOM, no side effects, no clock of its own.

     o is the aircraft's opacity; runway is null while there is no
     runway on screen. deg is 180 for the whole flight, because the
     aircraft never turns.
     =================================================================== */
  function frame(t) {
    var u, e, f = { t: t, phase: '', deg: HEADING, bank: 0, o: 1, runway: null };

    if (t < BEAT.descent) {
      /* FOUR SECONDS ABOVE THE SEA, dead straight and linear — a cruise
         holds its speed, and easing it would have the aircraft coasting
         to a halt in mid-air. It grows as it closes on the field.

         There is no runway yet; the layer is not even up. This is the
         open-water establishing shot the start screen dissolves onto.

         The bob is windowed by sin(pi*u), which is zero at both ends.
         Without that window the aircraft would step by however much the
         bob happened to be worth at the boundary. */
      u = clamp01((t - BEAT.approach) / (BEAT.descent - BEAT.approach));
      var win = Math.sin(u * Math.PI);
      var secs = (t - BEAT.approach) / 1000;
      f.phase = 'approach';
      f.x = CENTRELINE + Math.sin(secs * 2 * Math.PI * 0.19 + 1.1) * 4 * win;
      f.y = mix(SEA.y0, SEA.y1, u) + Math.sin(secs * 2 * Math.PI * 0.30) * 5 * win;
      f.w = mix(SEA.w0, SEA.w1, u);

    } else if (t < BEAT.touch) {
      /* THE DESCENT. The runway fades up out of the water ahead — a
         cross-fade onto artwork that has been sitting under the ocean
         all along — while the aircraft crosses the threshold. */
      u = clamp01((t - BEAT.descent) / (BEAT.touch - BEAT.descent));
      var sd = slopes();
      e = hermite(u, sd.des[0], sd.des[1]);
      f.phase = 'descent';
      f.x = CENTRELINE;
      f.y = mix(SEA.y1, TOUCH_Y, e);
      /* Wingspan gets its own, firmer curve: closing the last of the
         distance to the camera is the fastest it ever grows. */
      f.w = mix(SEA.w1, W_TOUCH, hermite(u, 0.6, 0.15));
      f.runway = { k: mix(1.52, 1.40, e), y: mix(300, 150, e), o: easeIO(u) };

    } else if (t < BEAT.stop) {
      /* THE ROLLOUT, decelerating the whole way. The ground CONTRACTS
         and sweeps up the frame, because travelling toward the camera
         moves the vanishing point away. */
      u = clamp01((t - BEAT.touch) / (BEAT.stop - BEAT.touch));
      var sr = slopes();
      e = hermite(u, sr.rol[0], sr.rol[1]);
      f.phase = 'rollout';
      f.x = CENTRELINE;
      f.y = mix(TOUCH_Y, PARK_Y - 6, e);
      f.w = mix(W_TOUCH, W_PARK - 2, e);
      f.runway = { k: mix(1.40, 1.04, e), y: mix(150, 0, e), o: 1 };

    } else if (t < BEAT.close) {
      /* SETTLED. The last 6px of creep as the brakes take hold, eased
         so it reaches a genuine standstill rather than stopping dead. */
      u = clamp01((t - BEAT.stop) / (BEAT.close - BEAT.stop));
      e = easeOut(u);
      f.phase = 'stop';
      f.x = CENTRELINE;
      f.y = mix(PARK_Y - 6, PARK_Y, e);
      f.w = mix(W_PARK - 2, W_PARK, e);
      f.runway = { k: mix(1.04, 1.02, e), y: 0, o: 1 };

    } else {
      /* THE CLOSING DISSOLVE. The aircraft fades out where it stopped,
         moves to its station while invisible, and fades back in on it
         as the game arrives. Nothing has to bend to make that join —
         the 180-degree turn onto north included. */
      u = clamp01((t - BEAT.close) / (BEAT.end - BEAT.close));
      var OUT = 0.42, DARK = 0.22, h = station();
      f.phase = 'close';
      if (u < OUT) {
        f.x = CENTRELINE;
        f.y = PARK_Y;
        f.w = W_PARK;
        f.o = 1 - easeIO(u / OUT);
      } else {
        f.x = h.x; f.y = h.y; f.w = h.w;
        f.deg = 0;                       /* on station it faces north */
        f.o = easeIO(clamp01(((u - OUT) / (1 - OUT) - DARK) / (1 - DARK)));
      }
    }
    return f;
  }

  /* ===================================================================
     PLAYBACK
     =================================================================== */
  var el = {}, raf = null, timers = [], settle = null, running = false;
  var t0 = 0, reduced = false;

  function grab() {
    el.stage    = document.getElementById('stage');
    el.runway   = document.getElementById('layerRunway');
    el.art      = document.getElementById('runwayArt');
    el.wake     = document.getElementById('rwWake');
    el.back     = document.getElementById('cineBack');
    el.front    = document.getElementById('cineFront');
    el.call     = document.getElementById('cineCall');
    el.flash    = document.getElementById('cineFlash');
    el.plane    = document.getElementById('plane');
    el.heat     = el.runway ? el.runway.querySelector('.rw-heat') : null;
  }

  function later(ms, fn) { timers.push(window.setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(window.clearTimeout); timers = []; }

  /* ---- the effects, spawned rather than authored one by one -------- */

  function puff(x, y, big) {
    if (reduced || !el.wake) return;
    var d = document.createElement('div');
    d.className = big ? 'rw-puff big' : 'rw-puff';
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    el.wake.appendChild(d);
    window.setTimeout(function () {
      if (d.parentNode) d.parentNode.removeChild(d);
    }, 1200);
  }

  /* Speed lines run UP the frame on a landing: the ground is sweeping
     up, because the aircraft is coming toward the camera. */
  function streak() {
    if (reduced || !el.wake) return;
    var d = document.createElement('div');
    d.className = 'rw-streak up';
    /* inside the measured tarmac: x 42.3% to 57.1% of 1920 */
    d.style.left = Math.round(812 + Math.random() * 284) + 'px';
    d.style.top = Math.round(560 + Math.random() * 300) + 'px';
    el.wake.appendChild(d);
    window.setTimeout(function () {
      if (d.parentNode) d.parentNode.removeChild(d);
    }, 620);
  }

  /* Cloud drifting UP past the aircraft, which is what makes an
     almost-stationary aircraft read as one descending toward you.
     `front` decides which side of it each puff passes, and that is the
     whole depth cue. Every one finishes before the descent begins, so
     none is ever snapped away mid-drift. */
  var CLOUDS = [
    { at:    0, x: 1180, y: 760, dx:  180, dy: -760, k: 1.9, o: 0.44, d: 2800, front: true  },
    { at:  240, x:  720, y: 820, dx: -220, dy: -700, k: 1.7, o: 0.36, d: 2900, front: false },
    { at:  560, x: 1420, y: 580, dx:  260, dy: -640, k: 2.1, o: 0.40, d: 2600, front: true  },
    { at:  800, x:  880, y: 500, dx: -120, dy: -820, k: 1.6, o: 0.30, d: 2900, front: false },
    { at: 1000, x: 1060, y: 880, dx:   60, dy: -880, k: 1.8, o: 0.34, d: 2700, front: false }
  ];

  function cloud(c) {
    if (reduced) return;
    var host = c.front ? el.front : el.back;
    if (!host) return;
    var d = document.createElement('div');
    d.className = 'cine-puff';
    d.style.left = c.x + 'px';
    d.style.top = c.y + 'px';
    d.style.setProperty('--dx', c.dx + 'px');
    d.style.setProperty('--dy', c.dy + 'px');
    d.style.setProperty('--k', c.k);
    d.style.setProperty('--o', c.o);
    d.style.setProperty('--d', c.d + 'ms');
    d.appendChild(document.createElement('i'));
    d.appendChild(document.createElement('i'));
    d.appendChild(document.createElement('i'));
    host.appendChild(d);
    window.setTimeout(function () {
      if (d.parentNode) d.parentNode.removeChild(d);
    }, c.d + 60);
  }

  function call(text) {
    if (!el.call) return;
    el.call.hidden = false;
    el.call.classList.remove('out');
    el.call.querySelector('span').textContent = text;
  }

  /* ---- the writing end -------------------------------------------- */
  function tick() {
    var f = frame(Date.now() - t0);
    var pc = CG.planeControl;
    if (pc) {
      pc.atStage(f.x, f.y);
      pc.width(f.w);
      pc.heading(f.deg, f.bank);
      pc.opacity(f.o);
    }
    if (f.runway && el.art) {
      el.art.style.transform =
        'translate3d(0,' + f.runway.y.toFixed(1) + 'px,0) scale(' + f.runway.k.toFixed(4) + ')';
      el.art.style.opacity = f.runway.o.toFixed(3);
    }
    if (f.t >= BEAT.end) { finish(false); return; }
    raf = window.requestAnimationFrame(tick);
  }

  function finish(skipped) {
    if (!running) return;
    running = false;
    if (raf) { window.cancelAnimationFrame(raf); raf = null; }
    clearTimers();
    window.removeEventListener('keydown', onKey, true);
    if (el.stage) el.stage.removeEventListener('pointerdown', onPoint, true);

    /* A skip must not leave the headlands still flying in over the top
       of the first mission, so the class comes off and they are simply
       there. */
    if (skipped && el.stage) el.stage.classList.remove('intro-land');

    if (el.runway) {
      el.runway.hidden = true;
      el.runway.classList.remove('rolling');
      if (el.art) el.art.style.transform = '';
    }
    if (el.wake)  el.wake.innerHTML = '';
    if (el.call)  { el.call.hidden = true; el.call.classList.remove('out'); }
    if (el.plane) el.plane.classList.remove('flying');

    /* only the spawned cloud: cineCall and cineFlash live in these
       layers permanently and must survive the clear */
    [el.back, el.front].forEach(function (host) {
      if (!host) return;
      var p = host.querySelectorAll('.cine-puff'), i;
      for (i = p.length - 1; i >= 0; i--) p[i].parentNode.removeChild(p[i]);
    });
    if (el.back) el.back.hidden = true;

    /* THE CLOSING VEIL IS DELIBERATELY ALLOWED TO OUTLIVE THE
       CINEMATIC. Cutting it at the instant control changes hands snaps
       it off at around 29% opacity — measured — instead of letting it
       fall away over the game it has just revealed, which is the whole
       point of a dissolve. The layer is pointer-events:none, so nothing
       underneath is blocked while it finishes. A plain timer rather
       than later(): clearTimers() must not take this one. */
    var veiling = !!(el.flash && el.flash.classList.contains('go'));
    if (el.front) {
      if (veiling) {
        window.setTimeout(function () {
          el.front.hidden = true;
          el.flash.classList.remove('go');
        }, 1100);
      } else {
        el.front.hidden = true;
        if (el.flash) el.flash.classList.remove('go');
      }
    }

    CG.Audio.duck('flight', false);
    CG.Audio.engineStop();
    if (CG.planeControl) CG.planeControl.home();
    if (settle) { settle(); settle = null; }
  }

  function onKey(ev) {
    if (ev.key === 'Tab') return;              /* leave focus alone */
    ev.preventDefault();
    finish(true);
  }
  function onPoint() { finish(true); }

  /* ---- the reduced-motion cut --------------------------------------
     The same story with nothing moving: the aircraft down on the
     runway, the clearance, and then the game. */
  function runStill() {
    if (el.runway) el.runway.hidden = false;
    if (el.art) { el.art.style.transform = 'none'; el.art.style.opacity = '1'; }
    if (CG.planeControl) {
      CG.planeControl.atStage(CENTRELINE, PARK_Y);
      CG.planeControl.width(W_PARK);
      CG.planeControl.heading(HEADING, 0);
      CG.planeControl.opacity(1);
    }
    call('LANDED · RUNWAY 09');
    later(900, function () {
      if (el.stage) el.stage.classList.add('intro-land');
      CG.Audio.play('landfall');
    });
    later(1300, function () { finish(false); });
  }

  /* ===================================================================
     run() — resolves when control should pass to the game
     =================================================================== */
  function run() {
    grab();
    if (running) finish(true);
    running = true;
    reduced = !!(window.matchMedia &&
                 window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    if (el.stage) el.stage.classList.remove('intro-land');
    if (el.back)  el.back.innerHTML = '';
    if (el.wake)  el.wake.innerHTML = '';
    if (el.front) el.front.hidden = false;
    if (el.back)  el.back.hidden = false;
    if (el.flash) el.flash.classList.remove('go');

    /* any key, any tap: straight to the game */
    window.addEventListener('keydown', onKey, true);
    if (el.stage) el.stage.addEventListener('pointerdown', onPoint, true);

    return new Promise(function (resolve) {
      settle = resolve;

      if (reduced) { runStill(); return; }

      /* The runway is NOT up yet — this opens over open water, and the
         layer would cover it. It is raised at the descent beat, with
         its opacity already being driven from zero. */
      if (el.runway) {
        el.runway.hidden = true;
        el.runway.classList.add('rolling');   /* no heat haze in flight */
        if (el.art) el.art.style.opacity = '0';
      }

      /* APPROACH — the engine bed, and the clearance. There is no voice
         line anywhere in the arrival: the caption is what says where
         you are, and the game does its own talking once it has
         control. */
      CG.Audio.duck('flight', true);          /* the bed steps back */
      CG.Audio.engineStart();
      later(240, function () { call('CLEARED TO LAND · RUNWAY 09'); });
      CLOUDS.forEach(function (c) {
        later(BEAT.approach + c.at, function () { cloud(c); });
      });

      /* DESCENT — the runway comes up out of the water ahead. Every
         delay below is measured from the first frame, never from the
         beat it belongs to: nesting one later() inside another adds the
         two offsets together and silently pushes the effect out of step
         with the flight it is attached to. */
      later(BEAT.descent, function () {
        if (el.runway) el.runway.hidden = false;
        if (el.plane) el.plane.classList.add('flying');
        CG.Audio.play('airframeRush');
      });
      later(BEAT.descent + 620, function () { if (el.call) el.call.classList.add('out'); });
      later(BEAT.descent + 940, function () { if (el.call) el.call.hidden = true; });

      /* TOUCH — the wheels. A burst of smoke off both mains, then
         reverse thrust and the speed lines while it is still fast. */
      later(BEAT.touch, function () {
        CG.Audio.play('touchdown');
        var f = frame(Date.now() - t0), i;
        for (i = 0; i < 3; i++) {
          puff(CENTRELINE - 36 - i * 12, f.y + 22 + i * 6, true);
          puff(CENTRELINE + 36 + i * 12, f.y + 22 + i * 6, true);
        }
        if (el.plane) el.plane.classList.remove('flying');
      });
      later(BEAT.touch + 180, function () { CG.Audio.play('reverseThrust'); });
      var n;
      /* trailing smoke, thinning out as it slows */
      for (n = 0; n < 9; n++) {
        later(BEAT.touch + 140 + n * 150, function () {
          var f = frame(Date.now() - t0);
          puff(CENTRELINE - 34, f.y + 24);      /* one per main wheel */
          puff(CENTRELINE + 34, f.y + 24);
        });
      }
      /* speed lines stop 1100ms in: past that it is no longer fast
         enough for them to read as velocity rather than texture */
      for (n = 0; n < 12; n++) later(BEAT.touch + n * 92, streak);

      /* STOP — down, stopped, engines winding down. The heat haze is
         painted at a fixed point on screen, so it can only be on once
         the ground has stopped moving underneath it. */
      later(BEAT.stop, function () {
        if (el.runway) el.runway.classList.remove('rolling');
        CG.Audio.engineStop();
        CG.Audio.play('spoolDown');
      });

      /* LANDFALL — the headlands come into view just before the
         dissolve, so land arriving is what motivates the cut */
      later(BEAT.close - 500, function () {
        if (el.stage) el.stage.classList.add('intro-land');
        CG.Audio.play('landfall');
      });

      /* CLOSE — the soft dissolve into the game */
      later(BEAT.close, function () {
        if (el.flash) {
          el.flash.classList.remove('go');
          void el.flash.offsetWidth;
          el.flash.classList.add('go');
        }
        CG.Audio.play('reveal');
        CG.Audio.duck('flight', false);
      });

      /* THE BACKSTOP. requestAnimationFrame stops completely in a
         backgrounded tab, so without this a player who presses PLAY and
         switches away comes back to a game that never started. A timer
         is throttled there but never stopped, and finish() is
         idempotent, so whichever of the two arrives first wins. */
      later(BEAT.end + 60, function () { finish(false); });

      t0 = Date.now();
      if (CG.planeControl) CG.planeControl.free(true);
      tick();
    });
  }

  return {
    run: run,
    skip: function () { finish(true); },
    isRunning: function () { return running; },
    /* exposed so the whole timeline can be checked without rendering */
    frame: frame,
    BEAT: BEAT,
    CLOUDS: CLOUDS,
    SEA: SEA,
    station: station,
    hermite: hermite,
    slopes: slopes,
    CENTRELINE: CENTRELINE,
    HEADING: HEADING,
    TOUCH_Y: TOUCH_Y,
    PARK_Y: PARK_Y,
    W_TOUCH: W_TOUCH,
    W_PARK: W_PARK,
    V_TOUCH: V_TOUCH
  };
})();
