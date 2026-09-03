/* ===================================================================
   CO-ORDINATE GEOMETRY — THE TAKEOFF
   -------------------------------------------------------------------
   The transition between pressing PLAY and the first mission, in five
   beats and one continuous flight:

     SPOOL    engines run up while the aircraft is held on the runway
     ROLL     brakes off; the ground rushes past
     ROTATE   the wheels leave the tarmac and the runway falls away
     CRUISE   a circuit over open water, cloud rushing the camera
     LANDFALL the headlands fly in, and the aircraft settles on station

   TWO DECISIONS WORTH KNOWING ABOUT

   1. THE CAMERA TRACKS THE AIRCRAFT, so the aircraft barely changes
      size during the roll and the GROUND does the moving. The runway
      artwork is very nearly an overhead view - measured, its tarmac is
      258px wide at the far threshold against 300px at the near one, a
      ratio of 0.86 - so shrinking the aircraft to sell speed would
      contradict the art. Scaling the ground away from its own vanishing
      point does not.

   2. NOTHING IS DUPLICATED AND NOTHING IS CUT. The ocean, the
      headlands and the aircraft in this cinematic are the game's own
      layers, at the game's own coordinates. That is why the handoff can
      be a reveal rather than a cut, and why the aircraft can fly the
      whole way from the runway onto its station without a join.

   frame(t) is a pure function of the clock: it returns the complete
   visual state at time t and touches nothing. tick() is the only thing
   that writes to the DOM. That split is what makes the whole timeline
   checkable without rendering a single pixel.
   =================================================================== */
window.CG = window.CG || {};

CG.Intro = (function () {
  'use strict';

  /* ---- the beat table ---------------------------------------------
     Milliseconds from the first frame. Shorten the whole cinematic by
     scaling these; the flight, the sound and the effects all read their
     timing from here, so nothing drifts out of step. */
  var BEAT = {
    spool:  0,
    roll:   900,     /* brakes off                                    */
    rotate: 2180,    /* wheels off                                    */
    cruise: 2860,    /* established in the climb                      */
    land:   4520,    /* the headlands arrive                          */
    finals: 5820,    /* turning onto station                          */
    flash:  6840,    /* the handoff bloom                             */
    end:    7200     /* control passes to the game                    */
  };

  /* ---- runway geometry, measured out of runway.png -----------------
     Stage pixels on the 1920x1080 canvas. */
  var CENTRELINE = 954;    /* x = 0.497w: the tarmac's centre         */
  /* Where an aircraft waits. The painted near threshold is at y=1041,
     but a 182px aircraft is 212px tall, so holding it any lower than
     this crops its tail against the bottom of the frame on the very
     first frame of the game — which reads as a mistake, not a choice.
     At 958 it is still 92% of the way down the strip. */
  var HOLD_Y     = 958;
  var ROTATE_Y   = 700;    /* where the wheels leave                  */

  /* ---- the airborne circuit ----------------------------------------
     Waypoints in stage pixels, flown as one arc-length-parameterised
     Catmull-Rom spline so the aircraft holds a real speed through the
     corners instead of slowing down in them.

     THE LAST FOUR ARE THE ARRIVAL, and they are a measured compromise.
     The aircraft has to finish ON (624,870) - stage 1's origin - and it
     is coming in from the east, so something has to give: a tight hook
     onto the pad arrives almost pointing north but jerks in the frame,
     while a straight run in is smooth but arrives pointing due west and
     needs a 90-degree pirouette on the spot.

     Searched across eight tails, this one is the knee of that curve: no
     frame turns more than 6.7 degrees, and it arrives 45 degrees off
     north - which is the same order of straighten the game already
     performs after every landing, and it happens standing still. */
  var WAY = [
    { x: CENTRELINE, y: 560 },   /* liftoff                            */
    { x: CENTRELINE, y: 300 },   /* climbing out                       */
    { x: 1090,       y: 150 },   /* right turn, into the upper ocean   */
    { x: 1400,       y: 190 },   /* crossing the top                   */
    { x: 1560,       y: 470 },   /* down the seaward side              */
    { x: 1400,       y: 760 },   /* turning back                       */
    { x: 1150,       y: 930 },   /* low across the south              */
    { x: 900,        y: 956 },
    { x: 740,        y: 930 },   /* rolling out onto finals            */
    { x: 650,        y: 890 },
    { x: 624,        y: 870 }    /* on station: stage 1's origin       */
  ];

  /* Wingspan along the circuit, keyed to distance flown rather than to
     time, so it cannot drift out of step with the path. 95.2px is what
     syncPlaneScale() asks for at stage 1 (0.85 x a 112px cell), so the
     aircraft is already the right size the instant the game takes it. */
  var WSPAN = [
    [0.00, 216], [0.14, 168], [0.34, 146],
    [0.60, 132], [0.84, 116], [1.00, 95.2]
  ];

  /* ---- easing ------------------------------------------------------ */
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeIn(u)  { return Math.pow(clamp01(u), 1.9); }
  function easeOut(u) { u = clamp01(u); return 1 - Math.pow(1 - u, 3); }
  function easeIO(u)  {
    u = clamp01(u);
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  }
  function mix(a, b, u) { return a + (b - a) * u; }

  /* ---- the spline --------------------------------------------------
     Uniform Catmull-Rom, then a cumulative length table so that a
     normalised DISTANCE maps to a point. Without that table the
     aircraft would crawl through the tight corners and sprint down the
     straights, which is exactly backwards. */
  var LUT = null;

  function crAt(i, t) {
    var p0 = WAY[Math.max(0, i - 1)], p1 = WAY[i];
    var p2 = WAY[Math.min(WAY.length - 1, i + 1)];
    var p3 = WAY[Math.min(WAY.length - 1, i + 2)];
    var t2 = t * t, t3 = t2 * t;
    return {
      x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t +
           (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
           (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t +
           (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
           (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
    };
  }

  function buildLUT() {
    var segs = WAY.length - 1, per = 90, pts = [], len = [0], i, j, p, d;
    for (i = 0; i < segs; i++) {
      for (j = 0; j < per; j++) pts.push(crAt(i, j / per));
    }
    pts.push({ x: WAY[WAY.length - 1].x, y: WAY[WAY.length - 1].y });
    for (i = 1; i < pts.length; i++) {
      d = Math.sqrt(Math.pow(pts[i].x - pts[i - 1].x, 2) +
                    Math.pow(pts[i].y - pts[i - 1].y, 2));
      len.push(len[i - 1] + d);
    }
    LUT = { pts: pts, len: len, total: len[len.length - 1] };
    return LUT;
  }

  /* point at normalised arc length s (0..1) */
  function pathAt(s) {
    var L = LUT || buildLUT();
    var want = clamp01(s) * L.total, lo = 0, hi = L.len.length - 1, mid;
    while (lo < hi - 1) {
      mid = (lo + hi) >> 1;
      if (L.len[mid] <= want) lo = mid; else hi = mid;
    }
    var span = L.len[hi] - L.len[lo];
    var u = span > 0 ? (want - L.len[lo]) / span : 0;
    return {
      x: mix(L.pts[lo].x, L.pts[hi].x, u),
      y: mix(L.pts[lo].y, L.pts[hi].y, u)
    };
  }

  /* Heading from the path's own tangent, in the game's convention:
     grid y is up, and the supplied art points north at 0deg. Stage y
     runs the other way, hence the negated dy. */
  function headingAt(s) {
    var e = 0.0022;
    var a = pathAt(Math.max(0, s - e)), b = pathAt(Math.min(1, s + e));
    var dx = b.x - a.x, dy = -(b.y - a.y);
    if (!dx && !dy) return 0;
    return Math.atan2(dx, dy) * 180 / Math.PI;
  }

  /* HOW HARD IT IS TURNING, in degrees, at distance s along the path.

     The subtraction MUST go the short way round. Taken raw it wraps
     where the circuit crosses due south: measured, one 21-degree turn
     read as a 339-degree one, which pinned the wings at full
     foreshortening for the rest of the flight. */
  function turnRate(s) {
    var d = 0.018;
    var a = headingAt(Math.max(0, s - d)), b = headingAt(Math.min(1, s + d));
    return Math.abs(((b - a + 540) % 360) - 180);
  }

  /* Bank, as the wing foreshortening the game already uses. Measured
     across this path the turn rate runs from about 5 degrees on the
     straights to 52 at the tightest corner, so the mapping is a square
     root rather than a straight line: proportional banking leaves the
     gentle turns at 3% and invisible, while the root spreads a readable
     roll across the whole range and still only reaches the clamp at the
     one corner that earns it. */
  var BANK_MAX = 0.16, BANK_REF = 55;
  function bankAt(s) {
    return Math.min(BANK_MAX, BANK_MAX * Math.sqrt(turnRate(s) / BANK_REF));
  }

  function spanAt(s) {
    var i;
    for (i = 1; i < WSPAN.length; i++) {
      if (s <= WSPAN[i][0]) {
        return mix(WSPAN[i - 1][1], WSPAN[i][1],
          easeIO((s - WSPAN[i - 1][0]) / (WSPAN[i][0] - WSPAN[i - 1][0])));
      }
    }
    return WSPAN[WSPAN.length - 1][1];
  }

  /* THE SPEED PROFILE. Mostly linear with an easing tail, so the
     aircraft leaves the climb briskly and decelerates onto its station
     rather than either coasting throughout or stopping dead. */
  function distanceFlown(u) {
    u = clamp01(u);
    return 0.72 * u + 0.28 * (1 - Math.pow(1 - u, 2));
  }

  /* ===================================================================
     frame(t) — the complete visual state at time t, and nothing else.
     Pure: no DOM, no side effects, no clock of its own.
     =================================================================== */
  function frame(t) {
    var u, e, s, p, f = { t: t, phase: '', bank: 0, runway: null };

    if (t < BEAT.roll) {
      /* HELD ON THE BRAKES. The creep is 8px over most of a second:
         enough to read as an aircraft straining, not as one moving. */
      u = clamp01(t / (BEAT.roll - BEAT.spool));
      f.phase = 'spool';
      f.x = CENTRELINE;
      f.y = mix(HOLD_Y, HOLD_Y - 8, u);
      f.w = mix(182, 180, u);
      f.deg = 0;
      f.runway = { k: mix(1.02, 1.04, u), y: 0, o: 1 };

    } else if (t < BEAT.rotate) {
      /* THE ROLL. easeIn is the acceleration. The aircraft covers 250px
         of frame while the ground covers 595px - a ratio of 2.4 - and
         that is the whole point: the camera is travelling with it, so
         the ground is what moves. */
      u = clamp01((t - BEAT.roll) / (BEAT.rotate - BEAT.roll));
      e = easeIn(u);
      f.phase = 'roll';
      f.x = CENTRELINE;
      f.y = mix(HOLD_Y - 8, ROTATE_Y, e);
      f.w = mix(180, 172, e);
      f.deg = 0;
      f.runway = { k: mix(1.04, 1.46, e), y: mix(0, 180, e), o: 1 };

    } else if (t < BEAT.cruise) {
      /* ROTATION. The aircraft grows - it is climbing toward the camera
         - while the ground falls away beneath it at 1176px/s. */
      u = clamp01((t - BEAT.rotate) / (BEAT.cruise - BEAT.rotate));
      e = easeOut(u);
      f.phase = 'rotate';
      f.x = CENTRELINE;
      f.y = mix(ROTATE_Y, WAY[0].y, e);
      f.w = mix(172, WSPAN[0][1], e);
      f.deg = 0;
      f.runway = { k: mix(1.46, 1.72, e), y: mix(180, 980, e), o: 1 - e };

    } else {
      /* AIRBORNE: the circuit, from liftoff to station. */
      u = clamp01((t - BEAT.cruise) / (BEAT.flash - BEAT.cruise));
      s = distanceFlown(u);
      p = pathAt(s);
      f.phase = t < BEAT.land ? 'cruise' : (t < BEAT.finals ? 'landfall' : 'finals');
      f.x = p.x;
      f.y = p.y;
      f.w = spanAt(s);
      f.deg = headingAt(s);
      /* the same wing foreshortening the game uses in play */
      f.bank = bankAt(s);
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

  function clearTimers() {
    timers.forEach(window.clearTimeout);
    timers = [];
  }

  /* ---- the effects, all spawned rather than authored one by one ---- */

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
    /* inside the measured tarmac: x 42.3% to 57.1% of 1920 */
    d.className = 'rw-streak';
    d.style.left = Math.round(812 + Math.random() * 284) + 'px';
    d.style.top = Math.round(60 + Math.random() * 220) + 'px';
    el.wake.appendChild(d);
    window.setTimeout(function () {
      if (d.parentNode) d.parentNode.removeChild(d);
    }, 480);
  }

  /* Cloud rushing the camera. `front` decides which side of the
     aircraft it passes, which is the whole depth cue. */
  var CLOUDS = [
    { at: 120,  x: 1180, y: 300, dx:  520, dy: 700, k: 3.0, o: 0.62, d: 1900, front: true  },
    { at: 380,  x:  700, y: 240, dx: -680, dy: 640, k: 2.6, o: 0.48, d: 2200, front: false },
    { at: 760,  x: 1420, y: 420, dx:  640, dy: 520, k: 3.4, o: 0.58, d: 1700, front: true  },
    { at: 1180, x:  900, y: 520, dx: -300, dy: 880, k: 2.2, o: 0.40, d: 2400, front: false },
    { at: 1620, x: 1300, y: 640, dx:  480, dy: 640, k: 3.1, o: 0.55, d: 1800, front: true  },
    { at: 2040, x: 1050, y: 180, dx:  120, dy: 900, k: 2.4, o: 0.44, d: 2100, front: false }
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

  /* ---- the writing end -------------------------------------------- */
  function tick() {
    var f = frame(Date.now() - t0);
    var pc = CG.planeControl;
    if (pc) {
      pc.atStage(f.x, f.y);
      pc.width(f.w);
      pc.heading(f.deg, f.bank);
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

    /* A skip must not leave a 1.5s headland fly-in to play over the top
       of the first mission, so the class comes off and the islands are
       simply there. */
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

    /* THE BLOOM IS DELIBERATELY ALLOWED TO OUTLIVE THE CINEMATIC.
       Its 640ms decay is still running when control changes hands, and
       cutting it there snaps it off at 24% opacity - measured - instead
       of letting it fall away over the game it has just revealed, which
       is the entire point of a bloom. The layer is pointer-events:none,
       so nothing underneath is blocked while it finishes. A plain timer
       rather than later(): clearTimers() must not take this one. */
    var blooming = !!(el.flash && el.flash.classList.contains('go'));
    if (el.front) {
      if (blooming) {
        window.setTimeout(function () {
          el.front.hidden = true;
          el.flash.classList.remove('go');
        }, 700);
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
     The same five beats' worth of story with nothing moving: the
     runway, the clearance, the bloom, the game. */
  function runStill() {
    if (el.runway) el.runway.hidden = false;
    if (el.art) { el.art.style.transform = 'none'; el.art.style.opacity = '1'; }
    if (CG.planeControl) {
      CG.planeControl.atStage(CENTRELINE, HOLD_Y);
      CG.planeControl.width(182);
      CG.planeControl.heading(0, 0);
    }
    say();
    call('CLEARED FOR TAKEOFF · RUNWAY 09');
    later(760, function () {
      if (el.stage) el.stage.classList.add('intro-land');
      CG.Audio.play('landfall');
    });
    later(1120, function () { finish(false); });
  }

  function call(text) {
    if (!el.call) return;
    el.call.hidden = false;
    el.call.classList.remove('out');
    el.call.querySelector('span').textContent = text;
  }

  /* FLOW 01. It is spoken HERE, at the top of the takeoff, and not at
     the handoff: loadLevel() cancels the voice before speaking the
     first mission, so a line started any later than this is cut off
     part-way through its own sentence. */
  function say() {
    if (!CG.Voice) return;
    CG.Voice.say('You are the air traffic controller. ' +
                 'Guide each aircraft to its target.');
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

      el.runway.hidden = false;
      if (el.art) { el.art.style.opacity = '1'; }

      /* SPOOL — engines against the brakes, and the clearance */
      CG.Audio.duck('flight', true);          /* the bed steps back */
      CG.Audio.play('spoolUp');
      later(140, function () { call('CLEARED FOR TAKEOFF · RUNWAY 09'); });
      later(420, say);

      /* ROLL — the engine bed proper, plus tyre smoke and speed lines.
         Every delay below is measured from the first frame, never from
         the beat it belongs to: nesting one later() inside another adds
         the two offsets together and silently pushes the effect out of
         step with the flight it is supposed to be attached to. */
      later(BEAT.roll, function () {
        CG.Audio.engineStart();
        /* The haze sits at a fixed point on screen while the ground it
           is supposed to be rising off starts moving underneath it, so
           it belongs to the hold and to nothing after it. */
        if (el.runway) el.runway.classList.add('rolling');
      });
      var n;
      for (n = 0; n < 11; n++) {
        later(BEAT.roll + n * 110, function () {
          var f = frame(Date.now() - t0);
          puff(CENTRELINE - 34, f.y + 26);      /* one per main wheel */
          puff(CENTRELINE + 34, f.y + 26);
        });
      }
      /* speed lines wait 380ms: they should read as velocity, and at
         walking pace they would only read as texture */
      for (n = 0; n < 14; n++) later(BEAT.roll + 380 + n * 70, streak);

      /* ROTATE — the wheels leave, the runway goes */
      later(BEAT.rotate, function () {
        CG.Audio.play('takeoffRush');
        if (el.call) el.call.classList.add('out');
        if (el.plane) el.plane.classList.add('flying');
      });
      later(BEAT.rotate + 340, function () { if (el.call) el.call.hidden = true; });

      /* CRUISE — cloud rushing the camera, and the runway is done with */
      later(BEAT.cruise, function () { if (el.runway) el.runway.hidden = true; });
      CLOUDS.forEach(function (c) {
        later(BEAT.cruise + c.at, function () { cloud(c); });
      });

      /* LANDFALL — the headlands fly in to the positions they keep */
      later(BEAT.land, function () {
        if (el.stage) el.stage.classList.add('intro-land');
        CG.Audio.play('landfall');
      });

      /* HANDOFF — a bloom, and the aircraft is on station */
      later(BEAT.flash, function () {
        if (el.flash) { el.flash.classList.remove('go'); void el.flash.offsetWidth; el.flash.classList.add('go'); }
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
    WAY: WAY,
    WSPAN: WSPAN,
    turnRate: turnRate,
    bankAt: bankAt,
    CLOUDS: CLOUDS,
    pathAt: pathAt,
    headingAt: headingAt,
    pathLength: function () { return (LUT || buildLUT()).total; }
  };
})();
