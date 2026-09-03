/* ===================================================================
   CO-ORDINATE GEOMETRY — THE APPROACH  (FLOW §E)
   -------------------------------------------------------------------
   The aircraft arrives before its world does.

     RISE    it climbs into frame from below the stage, nose up
     HOLD    it reaches centre and pauses
     OCEAN   the water fades up around it
     LAND    the headlands arrive
     GRID    the chart materialises
     then the game introduction

   WHY THE ORDER IS THIS WAY
   §E asks for the environment to materialise AROUND the aircraft, so
   the environment cannot already be on screen while the assets load.
   The loading gauge therefore sits on a bare stage, and each screen is
   shown exactly once:

     loading (gauge) -> approach (this) -> introduction (START) -> game

   That is also the PDF's own order: page 4 describes this flight, page
   5 is the introduction with START, page 6 is the first mission.

   WHAT THIS REPLACED
   A runway arrival — sea, a fade, a landing, a fade. It was built to a
   different instruction and is gone, along with the runway artwork it
   needed. See _masters/README.md if it is ever wanted back.

   frame(t) is a pure function of the clock: it returns the complete
   visual state at time t and touches nothing. tick() is the only thing
   that writes to the DOM. That split is what makes the whole timeline
   checkable without rendering a single pixel.
   =================================================================== */
window.CG = window.CG || {};

CG.Intro = (function () {
  'use strict';

  /* ---- the beat table ---------------------------------------------
     Milliseconds from the first frame. §E asks for elegant and SHORT,
     so the whole thing is under four seconds and the world assembles
     while the aircraft is already holding station. */
  var BEAT = {
    rise:  0,      /* climbing in from below                        */
    hold:  2000,   /* on station at centre                          */
    ocean: 2400,   /* the water comes up around it                  */
    land:  2900,   /* the headlands                                 */
    grid:  3400,   /* the chart                                     */
    end:   4200    /* hand over to the introduction                 */
  };

  /* ---- geometry, in stage px on the 1920x1080 canvas -------------- */
  var CENTRE_X = 960;
  var CENTRE_Y = 520;      /* where it holds — the chart's own centre  */
  var START_Y  = 1300;     /* below the stage, fully out of frame      */
  var W_IN     = 132;      /* distant as it enters                     */
  var W_HOLD   = 190;      /* closer once it is holding                */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOut(u) { u = clamp01(u); return 1 - Math.pow(1 - u, 3); }
  function easeIO(u)  {
    u = clamp01(u);
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  }
  function mix(a, b, u) { return a + (b - a) * u; }

  /* ===================================================================
     frame(t) — the complete visual state at t, and nothing else.
     o is the aircraft's opacity; world.* are the layer opacities.
     deg is 0 throughout: it is climbing straight up, nose up.
     =================================================================== */
  function frame(t) {
    var u, f = { t: t, phase: '', deg: 0, bank: 0, o: 1 };

    if (t < BEAT.hold) {
      /* THE RISE. easeOut, so it decelerates into its hold rather than
         arriving at speed and stopping dead — an aircraft settling on
         station, not a lift reaching a floor. */
      u = clamp01(t / (BEAT.hold - BEAT.rise));
      f.phase = 'rise';
      f.x = CENTRE_X;
      f.y = mix(START_Y, CENTRE_Y, easeOut(u));
      f.w = mix(W_IN, W_HOLD, easeOut(u));
      /* it fades up over the first fifth, so it does not pop into being
         at the stage edge */
      f.o = easeIO(clamp01(u / 0.20));
    } else {
      /* HOLDING, while the world arrives. A slow bob only — §E's pause
         is a pause, and a motionless sprite for two seconds reads as a
         stalled frame rather than as an aircraft. */
      var secs = (t - BEAT.hold) / 1000;
      f.phase = t < BEAT.ocean ? 'hold' : (t < BEAT.grid ? 'world' : 'grid');
      f.x = CENTRE_X + Math.sin(secs * 2 * Math.PI * 0.17) * 3;
      f.y = CENTRE_Y + Math.sin(secs * 2 * Math.PI * 0.26) * 4;
      f.w = W_HOLD;
    }

    /* THE WORLD, materialising around it in the order §E gives:
       ocean, then the headlands, then the chart. Each is a plain
       opacity ramp on a layer that is already in place — nothing is
       built here, it is revealed. */
    f.world = {
      ocean: easeIO(clamp01((t - BEAT.ocean) / 700)),
      land:  easeIO(clamp01((t - BEAT.land)  / 800)),
      grid:  easeIO(clamp01((t - BEAT.grid)  / 800))
    };
    return f;
  }

  /* ===================================================================
     PLAYBACK
     =================================================================== */
  var el = {}, raf = null, timers = [], settle = null, running = false;
  var t0 = 0, reduced = false;

  function grab() {
    el.stage = document.getElementById('stage');
    el.bg    = document.getElementById('bgImg');
    el.water = document.querySelector('.layer-water');
    el.land  = document.querySelector('.layer-terrain');
    el.cloud = document.querySelector('.layer-clouds');
    el.field = document.getElementById('field');
    el.veil  = document.getElementById('chartVeil');
    el.plane = document.getElementById('plane');
  }

  function later(ms, fn) { timers.push(window.setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(window.clearTimeout); timers = []; }

  function setOpacity(node, v) {
    if (node) node.style.opacity = v.toFixed(3);
  }

  function tick() {
    var f = frame(Date.now() - t0);
    var pc = CG.planeControl;
    if (pc) {
      pc.atStage(f.x, f.y);
      pc.width(f.w);
      pc.heading(f.deg, f.bank);
      pc.opacity(f.o);
    }
    setOpacity(el.bg,    f.world.ocean);
    setOpacity(el.water, f.world.ocean);
    setOpacity(el.land,  f.world.land);
    setOpacity(el.cloud, f.world.land);
    setOpacity(el.veil,  f.world.grid);
    setOpacity(el.field, f.world.grid);
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

    /* every layer handed back to the stylesheet, so the screen states
       own visibility again from here on */
    [el.bg, el.water, el.land, el.cloud, el.veil, el.field].forEach(function (n) {
      if (n) n.style.opacity = '';
    });
    if (el.plane) el.plane.classList.remove('flying');

    CG.Audio.duck('flight', false);
    CG.Audio.engineStop();
    if (CG.planeControl) CG.planeControl.home();
    if (settle) { settle(); settle = null; }
  }

  function onKey(ev) {
    if (ev.key === 'Tab') return;
    ev.preventDefault();
    finish(true);
  }
  function onPoint() { finish(true); }

  /* reduced motion: the same story, arrived at rather than travelled */
  function runStill() {
    if (CG.planeControl) {
      CG.planeControl.atStage(CENTRE_X, CENTRE_Y);
      CG.planeControl.width(W_HOLD);
      CG.planeControl.heading(0, 0);
      CG.planeControl.opacity(1);
    }
    later(500, function () { finish(false); });
  }

  function run() {
    grab();
    if (running) finish(true);
    running = true;
    reduced = !!(window.matchMedia &&
                 window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    window.addEventListener('keydown', onKey, true);
    if (el.stage) el.stage.addEventListener('pointerdown', onPoint, true);

    return new Promise(function (resolve) {
      settle = resolve;
      if (reduced) { runStill(); return; }

      /* the world starts hidden — it is going to arrive */
      setOpacity(el.bg, 0); setOpacity(el.water, 0);
      setOpacity(el.land, 0); setOpacity(el.cloud, 0);
      setOpacity(el.veil, 0); setOpacity(el.field, 0);

      CG.Audio.duck('flight', true);
      CG.Audio.engineStart();
      if (el.plane) el.plane.classList.add('flying');

      later(BEAT.ocean, function () { CG.Audio.play('reveal'); });
      later(BEAT.grid,  function () { CG.Audio.play('levelTransition'); });

      /* THE BACKSTOP. requestAnimationFrame stops completely in a
         backgrounded tab, so without this a player who switches away
         comes back to a game that never started. finish() is
         idempotent, so whichever arrives first wins. */
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
    frame: frame,
    BEAT: BEAT,
    CENTRE_X: CENTRE_X,
    CENTRE_Y: CENTRE_Y,
    START_Y: START_Y,
    W_IN: W_IN,
    W_HOLD: W_HOLD
  };
})();
