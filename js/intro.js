/* ===================================================================
   CO-ORDINATE GEOMETRY — THE TAKEOFF
   -------------------------------------------------------------------
   Press PLAY and you are on the runway. Four beats, and the aircraft
   flies in a straight line the whole way:

     HOLD     engines run up while the aircraft is held on the runway
     ROLL     brakes off, straight up the centreline
     ROTATE   the wheels leave, and the runway dissolves to open water
     SEA      four seconds of straight, slow cruise above the sea
     CLOSE    a soft dissolve, and the game is there

   THREE THINGS THAT ARE THE WAY THEY ARE ON PURPOSE

   1. THE RUNWAY IS UP ON THE SAME FRAME AS THE CLICK, and the start
      screen dissolves over the top of it. Fading the start screen out
      first and only then showing the runway reveals the game's own
      ocean underneath for half a second — you see the airspace before
      you have taken off for it.

   2. THE AIRCRAFT NEVER TURNS. It holds a heading of zero from the
      first frame to the last, so there is no bank, no circuit and no
      pirouette onto its station.

   3. IT FADES OUT TO CROSS THE GAP. Its station is at the chart's
      origin, which is nowhere near the runway centreline, and no
      straight line joins the two. So rather than bend the flight into
      a curve, the aircraft fades out where it is, moves while it is
      invisible, and fades back in on station under the closing
      dissolve. That is a scene change, which is what this is.

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
     shorter. SEA to CLOSE is deliberately exactly four seconds. */
  var BEAT = {
    spool:  0,
    roll:   800,     /* brakes off                                    */
    rotate: 2500,    /* wheels off; the runway starts to dissolve     */
    sea:    3300,    /* established above open water                  */
    close:  7300,    /* 4000ms of sea, then the closing dissolve      */
    end:    8200
  };

  /* ---- runway geometry, measured out of runway.png -----------------
     Stage pixels on the 1920x1080 canvas. The artwork is 1672x941 —
     exactly 16:9 — so it fills the canvas with no crop, and reading its
     pixels gives the tarmac centreline at x = 0.497w and the strip
     running from y = 53px (far threshold) to y = 1041px (near one). */
  var CENTRELINE = 954;
  /* Where an aircraft waits. The painted near threshold is at y=1041,
     but a 182px aircraft is 212px tall, so holding it any lower crops
     its tail against the bottom of the frame on the very first frame of
     the game. At 958 it is still 92% of the way down the strip. */
  var HOLD_Y   = 958;
  var ROTATE_Y = 700;    /* where the wheels leave                    */

  /* ---- the cruise above the sea ------------------------------------
     Dead straight up the same centreline, and slow: 220px over four
     seconds is 55px/s, against the game's own cruise of 175px/s. The
     aircraft is almost stationary in frame on purpose — the cloud
     streaming down past it is what carries the speed, which is how a
     tracking shot works. It shrinks as it climbs away. */
  var SEA = { y0: 470, y1: 250, w0: 210, w1: 150 };

  /* Where the game wants the aircraft: stage 1's origin, at the
     wingspan syncPlaneScale() asks for. Read from the same config the
     game reads so the two cannot drift apart. */
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
     Three eases in a row do not make a smooth flight. Each one opens
     and closes at whatever velocity its own curve happens to have, so
     the joins lurch: measured, an easeOut on the rotation opened at
     834px/s against the roll's 252px/s exit — a 3.3x jump at exactly
     the moment the wheels leave the tarmac, which is the one frame the
     player is actually watching.

     hermite(u, m0, m1) is the cubic through (0,0) and (1,1) whose
     slopes at each end are m0 and m1, expressed as multiples of the
     phase's own average speed. Give a phase the slope its neighbour
     hands over at and the velocity is continuous across the join.

     The slopes below are DERIVED from the beat table and the distances,
     never written down, so retiming any beat keeps the joins smooth
     instead of quietly reintroducing a lurch. */
  function hermite(u, m0, m1) {
    u = clamp01(u);
    var a = m0 - 2 + m1, b = 3 - 2 * m0 - m1;
    return ((a * u + b) * u + m0) * u;
  }

  /* px/ms, signed the way the phase travels */
  function rate(dist, ms) { return dist / ms; }

  /* The roll accelerates to 1.7x its own average — the same shape it
     always had — and that exit velocity is what the rotation must open
     at. The rotation then has to close at the cruise speed, or the
     aircraft arrives over the sea still climbing hard. */
  var ROLL_PEAK = 1.7;
  function slopes() {
    var rollD  = (HOLD_Y - 6) - ROTATE_Y,  rollMs  = BEAT.rotate - BEAT.roll;
    var rotD   = ROTATE_Y - SEA.y0,        rotMs   = BEAT.sea - BEAT.rotate;
    var seaD   = SEA.y0 - SEA.y1,          seaMs   = BEAT.close - BEAT.sea;
    var vLift   = ROLL_PEAK * rate(rollD, rollMs);
    var vCruise = rate(seaD, seaMs);
    return {
      roll: [0, ROLL_PEAK],
      rot:  [vLift / rate(rotD, rotMs), vCruise / rate(rotD, rotMs)]
    };
  }

  /* ===================================================================
     frame(t) — the complete visual state at time t, and nothing else.
     Pure: no DOM, no side effects, no clock of its own.

     o is the aircraft's opacity; runway is null once it has gone.
     deg is zero everywhere, because the aircraft never turns.
     =================================================================== */
  function frame(t) {
    var u, e, f = { t: t, phase: '', deg: 0, bank: 0, o: 1, runway: null };

    if (t < BEAT.roll) {
      /* HELD ON THE BRAKES. 6px of creep over most of a second: enough
         to read as an aircraft straining, not as one moving. */
      u = clamp01(t / (BEAT.roll - BEAT.spool));
      f.phase = 'spool';
      f.x = CENTRELINE;
      /* eased so it settles to a standstill, which is the velocity the
         roll then opens from */
      f.y = mix(HOLD_Y, HOLD_Y - 6, easeOut(u));
      f.w = mix(182, 180, u);
      f.runway = { k: mix(1.02, 1.04, u), y: 0, o: 1 };

    } else if (t < BEAT.rotate) {
      /* THE ROLL, straight up the centreline over 1.7 seconds. It
         accelerates to 1.7x its own average and hands that velocity
         straight to the rotation. The aircraft covers 252px of frame
         while the ground covers 545px — the camera is travelling with
         it, so the ground is what moves. */
      u = clamp01((t - BEAT.roll) / (BEAT.rotate - BEAT.roll));
      var sl = slopes();
      e = hermite(u, sl.roll[0], sl.roll[1]);
      f.phase = 'roll';
      f.x = CENTRELINE;
      f.y = mix(HOLD_Y - 6, ROTATE_Y, e);
      f.w = mix(180, 172, e);
      f.runway = { k: mix(1.04, 1.40, e), y: mix(0, 150, e), o: 1 };

    } else if (t < BEAT.sea) {
      /* ROTATION. The aircraft grows — it is climbing toward the camera
         — while the runway DISSOLVES rather than being yanked away: a
         cross-fade onto the open water already painted beneath it. */
      u = clamp01((t - BEAT.rotate) / (BEAT.sea - BEAT.rotate));
      var sr = slopes();
      e = hermite(u, sr.rot[0], sr.rot[1]);
      f.phase = 'rotate';
      f.x = CENTRELINE;
      f.y = mix(ROTATE_Y, SEA.y0, e);
      /* Wingspan gets its own, firmer curve. The aircraft growing is
         the pitch-up, so this is the one thing that should have some
         snap in it — but hermite still, not easeOut, whose 3x opening
         slope made it pop. */
      f.w = mix(172, SEA.w0, hermite(u, 0.6, 0.15));
      f.runway = { k: mix(1.40, 1.52, e), y: mix(150, 300, e), o: 1 - easeIO(u) };

    } else if (t < BEAT.close) {
      /* FOUR SECONDS ABOVE THE SEA, dead straight and linear — a cruise
         holds its speed, and easing it would have the aircraft coasting
         to a halt in mid-air. Both neighbours arrive and leave at
         near-zero velocity, so the joins are smooth anyway.

         The bob is windowed by sin(pi*u), which is zero at both ends:
         without that window the aircraft would step by however much the
         bob happened to be worth at each boundary. */
      u = clamp01((t - BEAT.sea) / (BEAT.close - BEAT.sea));
      var win = Math.sin(u * Math.PI);
      var secs = (t - BEAT.sea) / 1000;
      f.phase = 'sea';
      f.x = CENTRELINE + Math.sin(secs * 2 * Math.PI * 0.19 + 1.1) * 4 * win;
      f.y = mix(SEA.y0, SEA.y1, u) + Math.sin(secs * 2 * Math.PI * 0.30) * 5 * win;
      f.w = mix(SEA.w0, SEA.w1, u);

    } else {
      /* THE CLOSING DISSOLVE. The aircraft fades out where it is, moves
         to its station while it is invisible, and fades back in on it
         as the game arrives. Nothing has to bend to make that join. */
      u = clamp01((t - BEAT.close) / (BEAT.end - BEAT.close));
      var OUT = 0.42, DARK = 0.22, h = station();
      f.phase = 'close';
      if (u < OUT) {
        f.x = CENTRELINE + 0;         /* held where the cruise left it */
        f.y = SEA.y1;
        f.w = SEA.w1;
        f.o = 1 - easeIO(u / OUT);
      } else {
        f.x = h.x; f.y = h.y; f.w = h.w;
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

  function puff(x, y) {
    if (reduced || !el.wake) return;
    var d = document.createElement('div');
    d.className = 'rw-puff';
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    el.wake.appendChild(d);
    window.setTimeout(function () {
      if (d.parentNode) d.parentNode.removeChild(d);
    }, 1000);
  }

  function streak() {
    if (reduced || !el.wake) return;
    var d = document.createElement('div');
    d.className = 'rw-streak';
    /* inside the measured tarmac: x 42.3% to 57.1% of 1920 */
    d.style.left = Math.round(812 + Math.random() * 284) + 'px';
    d.style.top = Math.round(60 + Math.random() * 220) + 'px';
    el.wake.appendChild(d);
    window.setTimeout(function () {
      if (d.parentNode) d.parentNode.removeChild(d);
    }, 620);
  }

  /* Cloud drifting DOWN past the aircraft, which is what makes an
     almost-stationary aircraft read as one flying north. `front`
     decides which side of it each puff passes, and that is the whole
     depth cue. Every one of them finishes before the closing dissolve,
     so none is ever snapped away mid-drift. */
  var CLOUDS = [
    { at:    0, x: 1180, y: 300, dx:  180, dy: 760, k: 1.9, o: 0.44, d: 2800, front: true  },
    { at:  240, x:  720, y: 240, dx: -220, dy: 700, k: 1.7, o: 0.36, d: 2900, front: false },
    { at:  560, x: 1420, y: 480, dx:  260, dy: 640, k: 2.1, o: 0.40, d: 2600, front: true  },
    { at:  800, x:  880, y: 560, dx: -120, dy: 820, k: 1.6, o: 0.30, d: 2900, front: false },
    { at: 1000, x: 1060, y: 180, dx:   60, dy: 880, k: 1.8, o: 0.34, d: 2700, front: false }
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
     The same story with nothing moving: the runway, the clearance, and
     then the game. */
  function runStill() {
    if (el.runway) el.runway.hidden = false;
    if (el.art) { el.art.style.transform = 'none'; el.art.style.opacity = '1'; }
    if (CG.planeControl) {
      CG.planeControl.atStage(CENTRELINE, HOLD_Y);
      CG.planeControl.width(182);
      CG.planeControl.heading(0, 0);
      CG.planeControl.opacity(1);
    }
    call('CLEARED FOR TAKEOFF · RUNWAY 09');
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

      /* The runway goes up on THIS frame, before anything has had a
         chance to fade, so the start screen dissolves onto it rather
         than onto the game's own ocean. */
      el.runway.hidden = false;
      if (el.art) el.art.style.opacity = '1';

      if (reduced) { runStill(); return; }

      /* HOLD — engines against the brakes, and the clearance. There is
         no voice line anywhere in the takeoff: the caption is what says
         where you are, and the game does its own talking once it has
         control. */
      CG.Audio.duck('flight', true);          /* the bed steps back */
      CG.Audio.play('spoolUp');
      later(240, function () { call('CLEARED FOR TAKEOFF · RUNWAY 09'); });

      /* ROLL — the engine bed, tyre smoke and speed lines. Every delay
         below is measured from the first frame, never from the beat it
         belongs to: nesting one later() inside another adds the two
         offsets together and silently pushes the effect out of step
         with the flight it is attached to. */
      later(BEAT.roll, function () {
        CG.Audio.engineStart();
        /* The haze sits at a fixed point on screen while the ground it
           is supposed to be rising off starts moving underneath it, so
           it belongs to the hold and to nothing after it. */
        if (el.runway) el.runway.classList.add('rolling');
      });
      var n;
      for (n = 0; n < 13; n++) {
        later(BEAT.roll + n * 130, function () {
          var f = frame(Date.now() - t0);
          puff(CENTRELINE - 34, f.y + 26);      /* one per main wheel */
          puff(CENTRELINE + 34, f.y + 26);
        });
      }
      /* speed lines wait 500ms: they should read as velocity, and at
         walking pace they would only read as texture */
      for (n = 0; n < 12; n++) later(BEAT.roll + 500 + n * 90, streak);

      /* ROTATE — the wheels leave; the runway dissolves to open water */
      later(BEAT.rotate, function () {
        CG.Audio.play('takeoffRush');
        if (el.call) el.call.classList.add('out');
        if (el.plane) el.plane.classList.add('flying');
      });
      later(BEAT.rotate + 340, function () { if (el.call) el.call.hidden = true; });

      /* SEA — four seconds above open water, cloud drifting past */
      later(BEAT.sea, function () { if (el.runway) el.runway.hidden = true; });
      CLOUDS.forEach(function (c) {
        later(BEAT.sea + c.at, function () { cloud(c); });
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
        CG.Audio.engineStop();
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
    HOLD_Y: HOLD_Y,
    ROTATE_Y: ROTATE_Y
  };
})();
