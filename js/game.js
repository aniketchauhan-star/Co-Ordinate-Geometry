/* ============================================================
   game.js — state machine, flight animation, teaching sequences.
   State  ->  render  ->  animation are kept separate:
   nothing in here draws SVG or touches control markup directly.
   ============================================================ */
window.CG = window.CG || {};

(function () {
  var Audio = CG.Audio, Grid = CG.Grid, UI = CG.UI;
  var LEVELS = CG.LEVELS, CFG = CG.CONFIG;

  /* ---------------- state ---------------- */
  var gameState = {
    screen: 'loading',            /* loading | start | tutorial | playing | feedback | reveal | complete */
    levelIndex: 0,
    aircraft: { x: 0, y: 0 },
    target: { x: 0, y: 0 },
    controls: { right: 0, left: 0, up: 0, down: 0, x: 0, y: 0 },
    /* FLOW 58 — direct co-ordinate mode: x and y replace the four
       directions, and the values they hold are SIGNED */
    direct: null,                 /* { index } while that mode is running */
    coordinateMode: false,        /* true once X / Y notation is in play */
    inputLocked: false,
    tutorialStep: -1,
    heading: 0,                   /* accumulated degrees; asset points "up" at 0 */

    /* --- per-mission attempt tracking, drives progressive hints --- */
    attemptNumber: 0,
    horizontalCorrect: false,
    verticalCorrect: false,
    revealedNumbers: { x: [], y: [] },
    /* one entry per solved mission — the lesson arc replays these as the
       "you used two directions to locate every aircraft" markers */
    reached: [],
    currentQuadrant: 1,
    animationState: 'idle'        /* idle | flying | returning */
  };

  /* set the moment the game may be started — by the preloader finishing,
     or by the boot watchdog. See startGame() and releaseBoot(). */
  var bootReleased = false;
  /* Held at module scope so onKeyDown() can reach onReset and
     onSoundToggle: their on-screen buttons were removed, and the
     keyboard is now the only way in. */
  var handlers = {};

  var animToken = 0;              /* bumped to cancel an in-flight sequence */
  var seqToken = 0;               /* bumped to cancel a teaching sequence   */
  var idleTimer = null;
  /* how many times the hand has already shown for THIS mission — capped
     by CFG.idleHintPerMission so it advises once and then keeps quiet */
  var idleHintShown = 0;
  var autoTimer = null;

  var dom = {};
  var OPPOSITE = { right: 'left', left: 'right', up: 'down', down: 'up' };

  /* ---------------- small utilities ---------------- */
  function wait(ms) { return new Promise(function (r) { window.setTimeout(r, ms); }); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function level() { return LEVELS[gameState.levelIndex]; }
  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ============================================================
     RENDER
     ============================================================ */
  /* The aircraft belongs to the chart, so it zooms with each stage.
     The clamp keeps it readable in the tight late stages without letting
     it reach the mission strip in the wide early ones (stage 1 is the
     binding case: gy(5) = 175, so the box must stay under ~130 tall). */
  function syncPlaneScale() {
    var w = Math.max(88, Math.min(108, 0.85 * Grid.cellPx()));
    dom.stage.style.setProperty('--plane-w', w.toFixed(1) + 'px');
  }

  /* Parking / resetting: eased CSS transition to a whole-cell position. */
  function setAircraftPosition(x, y, glide) {
    gameState.aircraft.x = x;
    gameState.aircraft.y = y;
    dom.planeHolder.classList.toggle('snap', !!glide);
    dom.planeHolder.style.transitionDuration = (glide ? 560 : 0) + 'ms';
    dom.planeHolder.style.transform =
      'translate3d(' + Grid.stageX(x) + 'px,' + Grid.stageY(y) + 'px,0)';
  }

  /* In flight: driven every frame, so no CSS transition may interfere. */
  function placeAircraft(x, y) {
    dom.planeHolder.style.transitionDuration = '0ms';
    dom.planeHolder.style.transform =
      'translate3d(' + Grid.stageX(x).toFixed(2) + 'px,' + Grid.stageY(y).toFixed(2) + 'px,0)';
  }

  /* Heading straight from the flight path's tangent. Grid space has y
     up; the supplied art points north at 0deg. */
  function headingFromVelocity(vx, vy) {
    return Math.atan2(vx, vy) * 180 / Math.PI;
  }
  function unwrap(fromDeg, toDeg) {
    var d = (((toDeg - (fromDeg % 360)) % 360) + 540) % 360 - 180;
    return fromDeg + d;
  }
  /* Heading, plus a bank. A top-down aircraft rolling into a turn reads
     as its wings foreshortening, so the bank is applied as a scaleX on
     the same element that carries the rotation — one transform, no extra
     node, and nothing per-frame beyond a transform. */
  function applyHeading(deg, bank) {
    gameState.heading = deg;
    var sx = 1 - Math.min(0.16, Math.abs(bank || 0));
    dom.planeSpin.style.transform =
      'rotate(' + deg.toFixed(2) + 'deg) scaleX(' + sx.toFixed(4) + ')';
  }

  /* one animation at a time: bob while parked, settle on arrival,
     a slow search sweep when the route ended in the wrong place */
  function setPlaneMood(mood) {
    dom.plane.classList.remove('bob', 'settle', 'lost');
    if (!mood) return;
    void dom.plane.offsetWidth;
    dom.plane.classList.add(mood);
  }

  /* two red pulses on a wrong landing — the wobble says "confused", this
     is what says "wrong". Removed on the way out so it can fire again on
     the next attempt. See .plane-holder.hit in styles.css. */
  function flashPlaneHit() {
    dom.planeHolder.classList.remove('hit');
    void dom.planeHolder.offsetWidth;
    dom.planeHolder.classList.add('hit');
    window.setTimeout(function () {
      dom.planeHolder.classList.remove('hit');
    }, 900);
  }

  /* park the aircraft on a heading with the eased CSS transition */
  function setHeading(deg) {
    dom.planeSpin.classList.remove('free');
    applyHeading(unwrap(gameState.heading, deg));
  }

  function calculateSelectedCoordinate() {
    var c = gameState.controls;
    /* In direct mode the learner enters the co-ordinate itself, so there
       is nothing to subtract — that is the whole point of the mode. */
    if (gameState.direct) return { x: c.x, y: c.y };
    return { x: c.right - c.left, y: c.up - c.down };
  }

  /* FLOW 02: the target always glows — it is the thing to fly to */
  function refreshTargetGlow(force) {
    Grid.highlightTarget(force === undefined ? true : !!force);
  }

  /* "the learner has chosen a destination" — the one condition GO and
     the idle nudge both need, so it is asked in one place */
  function routeIsSet() {
    var c = gameState.controls;
    if (gameState.direct) return c.x !== 0 || c.y !== 0;
    return (c.right + c.left + c.up + c.down) > 0;
  }

  function refreshGo() {
    if (gameState.inputLocked) { UI.setGoEnabled(false); return; }
    UI.setGoEnabled(routeIsSet());
  }

  /* lockInput(on, quiet) — `quiet` is the opening brief's lock, which is
     the same gate with a calmer face. See UI.setControlsLocked(). */
  function lockInput(v, quiet) {
    gameState.inputLocked = !!v;
    UI.setControlsLocked(!!v, quiet);
    refreshGo();
  }

  /* ============================================================
     CONTROLS
     ============================================================ */
  function updateControls(dir, delta) {
    if (gameState.inputLocked) return;

    /* DIRECT MODE: a signed value, and no opposite to zero — X and Y are
       not fighting each other, they are two halves of one co-ordinate. */
    if (gameState.direct) {
      if (dir !== 'x' && dir !== 'y') return;
      var R = CG.DIRECT_RANGE_OF(dir);       /* x reaches 7, y reaches 4 */
      var v = clamp(gameState.controls[dir] + delta, -R, R);
      if (v === gameState.controls[dir]) return;
      gameState.controls[dir] = v;
      UI.setValue(dir, v, true);
      Audio.play('stepperTick');
      refreshGo();
      clearIdleHint();
      return;
    }

    /* a control that is on screen but not armed for this mission */
    if ((level().controls || []).indexOf(dir) === -1) return;
    var next = clamp(gameState.controls[dir] + delta, 0, CFG.maxStep);
    if (next === gameState.controls[dir]) return;

    gameState.controls[dir] = next;
    UI.setValue(dir, next, true);

    /* error prevention: only net movement matters, so the opposite
       direction is smoothly zeroed instead of fighting this one. */
    var opp = OPPOSITE[dir];
    if (next > 0 && gameState.controls[opp] > 0) {
      gameState.controls[opp] = 0;
      UI.setValue(opp, 0, true);
    }

    Audio.play('stepperTick');
    refreshGo();
    onLearnerInteraction(dir);
  }

  function resetControlValues() {
    Object.keys(gameState.controls).forEach(function (k) {
      gameState.controls[k] = 0;
      UI.setValue(k, 0, false);
    });
    refreshGo();
  }

  /* ============================================================
     FLIGHT — ONE continuous timeline.

     The route is computed up front as an arc-length curve (horizontal
     leg, rounded corner, vertical leg). A single requestAnimationFrame
     loop walks distance `s` along it with a trapezoidal speed profile:
     it eases off the origin, holds a constant cruise so every cell is
     crossed at the same readable rate, and settles onto the target.
     The aircraft never stops at a cell boundary.

     Everything else in the flight is derived from `s`, never from
     timers: the path dots, the contrail, the heading, and — crucially —
     the movement numbers, which fire the moment the aircraft actually
     crosses each grid line (requirement 27).
     ============================================================ */

  /* The route is two STRAIGHT legs joined by a pivot, not a curve. The
     aircraft flies the horizontal run, comes to rest exactly on the
     corner point, turns on the spot, and only then flies the vertical
     run. That is what makes the two movements readable as two separate
     counts — a rounded corner blurs them into one diagonal sweep, and
     the learner loses which number belongs to which direction. */
  function flightPlan(dx, dy) {
    var ax = Math.abs(dx), ay = Math.abs(dy);
    return {
      sx: Math.sign(dx) || 1, sy: Math.sign(dy) || 1,
      ax: ax, ay: ay,
      pivots: ax > 0 && ay > 0,          /* is there a corner at all? */
      total: ax + ay
    };
  }

  /* position + velocity at arc length s along the route */
  /* Distance along the route, in cells. Corners are square: the position
     is on one axis or the other, never between them. */
  function routeAt(p, s) {
    if (p.ay === 0) return { x: p.sx * Math.min(s, p.ax), y: 0, vx: p.sx, vy: 0 };
    if (p.ax === 0) return { x: 0, y: p.sy * Math.min(s, p.ay), vx: 0, vy: p.sy };
    if (s <= p.ax) return { x: p.sx * s, y: 0, vx: p.sx, vy: 0 };
    return { x: p.sx * p.ax, y: p.sy * Math.min(s - p.ax, p.ay), vx: 0, vy: p.sy };
  }

  /* trapezoidal progress: ease in over `a`, cruise, ease out over `a` */
  function speedProfile(u, a) {
    if (a <= 0) return u;
    var peak = 1 / (1 - a);
    if (u < a) return peak * u * u / (2 * a);
    if (u > 1 - a) { var d = 1 - u; return 1 - peak * d * d / (2 * a); }
    return peak * (u - a / 2);
  }

  function animateAircraft(dx, dy, opts) {
    opts = opts || {};
    var token = ++animToken;
    var plan = flightPlan(dx, dy);
    var reduced = reduceMotion();

    setPlaneMood(null);
    Audio.engineStart();          /* supplied fly recording, looped */
    Audio.duck('flight', true);   /* pull the music bed down under it   */

    if (plan.total === 0) {
      return wait(360).then(function () {
        Audio.engineStop();
        Audio.duck('flight', false);
        return token === animToken;
      });
    }

    var cellMsNow = reduced ? 180 : (opts.cellMs || CFG.cellDuration);
    var accel = reduced ? 0 : CFG.accelFraction;
    /* three phases: fly the first leg, pivot on the spot, fly the second.
       Each leg eases in and out of its own duration, so the aircraft
       genuinely arrives at the corner, stops, turns, and sets off again. */
    var legA = plan.ax * cellMsNow;
    var legB = plan.ay * cellMsNow;
    if (plan.ax === 0) { legA = 0; legB = plan.ay * cellMsNow; }
    if (plan.ay === 0) { legA = plan.ax * cellMsNow; legB = 0; }
    var pivotMs = plan.pivots ? (reduced ? 1 : CFG.pivotMs) : 0;
    var duration = legA + pivotMs + legB;

    /* swing onto the opening heading while accelerating away */
    var startHeading = gameState.heading;
    var first = routeAt(plan, 0);
    var openHeading = unwrap(startHeading, headingFromVelocity(first.vx, first.vy));
    var rotMs = reduced ? 1 : CFG.rotateMs;

    dom.plane.classList.add('flying');
    dom.planeSpin.classList.add('free');

    var revX = 0, revY = 0, cellsDone = 0;
    var nextDot = CFG.dotSpacing, nextPuff = CFG.puffSpacing;
    var heading = startHeading, bank = 0, closing = false;

    return new Promise(function (resolve) {
      var t0 = performance.now();

      function frame(now) {
        if (token !== animToken) { endFlight(false); return; }

        var el2 = now - t0;
        var s, phase;
        if (el2 < legA || legB === 0) {
          /* leg 1 — the horizontal run */
          phase = 'a';
          s = legA > 0 ? speedProfile(Math.min(1, el2 / legA), accel) * plan.ax : 0;
        } else if (el2 < legA + pivotMs) {
          /* the pivot — parked exactly on the corner, turning in place */
          phase = 'pivot';
          s = plan.ax;
        } else {
          /* leg 2 — the vertical run */
          phase = 'b';
          var ub = legB > 0 ? Math.min(1, (el2 - legA - pivotMs) / legB) : 1;
          s = plan.ax + speedProfile(ub, accel) * plan.ay;
        }
        var at = routeAt(plan, s);

        placeAircraft(at.x, at.y);

        /* Heading. Off the mark it swings onto the opening bearing; during
           the pivot it rotates on the spot from one leg's bearing to the
           next; on a leg it simply holds that leg's bearing — no curve,
           so the aircraft never drifts diagonally. */
        var prevHeading = heading;
        if (el2 < rotMs && phase === 'a') {
          heading = startHeading + (openHeading - startHeading) * (el2 / rotMs);
        } else if (phase === 'pivot') {
          var pu = pivotMs > 0 ? (el2 - legA) / pivotMs : 1;
          pu = pu < 0 ? 0 : pu > 1 ? 1 : pu;
          var eased = pu < 0.5 ? 2 * pu * pu : 1 - Math.pow(-2 * pu + 2, 2) / 2;
          var fromH = headingFromVelocity(plan.sx, 0);
          var toH = unwrap(fromH, headingFromVelocity(0, plan.sy));
          heading = fromH + (toH - fromH) * eased;
        } else {
          heading = unwrap(heading, headingFromVelocity(at.vx, at.vy));
        }

        /* The wings foreshorten while it turns on the spot, then level. */
        var turnRate = Math.abs(heading - prevHeading);
        bank += (Math.min(1, turnRate / 3.2) - bank) * 0.18;
        applyHeading(heading, bank * 0.16);

        /* A2 — the target reacts as the aircraft closes on it, so arrival
           is earned rather than announced */
        var near = Math.hypot(dx - at.x, dy - at.y) <= 1.5;
        if (near !== closing) { closing = near; Grid.setTargetClosing(near); }

        /* route draws itself behind the aircraft, at even spacing */
        while (s >= nextDot) {
          var d = routeAt(plan, nextDot);
          Grid.addPathDot(d.x, d.y);
          nextDot += CFG.dotSpacing;
        }
        if (!reduced) {
          while (s >= nextPuff) {
            var q = routeAt(plan, nextPuff);
            Grid.puff(q.x, q.y);
            nextPuff += CFG.puffSpacing;
          }
        }

        /* --- number reveal, driven purely by aircraft position --- */
        if (!opts.silentNumbers) {
          while (revX < plan.ax && Math.abs(at.x) >= revX + 1 - 1e-4) {
            revX++;
            Grid.markNumber('x', plan.sx * revX);
            gameState.revealedNumbers.x.push(plan.sx * revX);
          }
          while (revY < plan.ay && Math.abs(at.y) >= revY + 1 - 1e-4) {
            revY++;
            Grid.markNumber('y', plan.sy * revY);
            gameState.revealedNumbers.y.push(plan.sy * revY);
          }
        }

        /* one engine whoosh per grid line crossed. The points are NOT
           lit here: they belong to the recap, where the voice counts
           them out, not to the flight, where the trail already shows
           the route. */
        while (cellsDone < plan.total && s >= cellsDone + 1 - 1e-4) {
          cellsDone++;
          Audio.play('aircraftMove');
        }

        if (el2 < duration) { requestAnimationFrame(frame); return; }

        /* land exactly on the whole-cell destination, wings level */
        setAircraftPosition(dx, dy, false);
        applyHeading(heading, 0);
        endFlight(true);
      }

      function endFlight(ok) {
        dom.plane.classList.remove('flying');
        dom.planeSpin.classList.remove('free');
        Grid.setTargetClosing(false);
        Audio.engineStop();
        Audio.duck('flight', false);
        if (ok) setPlaneMood('settle');
        resolve(ok && token === animToken);
      }

      requestAnimationFrame(frame);
    });
  }

  async function onGo() {
    if (gameState.inputLocked) return;
    var sel = calculateSelectedCoordinate();
    if (!isFinite(sel.x) || !isFinite(sel.y)) { sel = { x: 0, y: 0 }; }

    clearIdleHint();
    UI.highlight(null);
    if (gameState.tutorialStep >= 0) finishTutorial();

    lockInput(true);
    gameState.screen = 'playing';
    gameState.animationState = 'flying';
    gameState.attemptNumber++;
    gameState.revealedNumbers = { x: [], y: [] };
    Grid.clearFx();
    Grid.clearPath();
    Grid.clearReveal();
    Grid.clearHint();
    UI.hideCoordTag();
    /* nothing is said while it flies: the PDF's pages 5-10 are silent */

    var ok = await animateAircraft(sel.x, sel.y);
    gameState.animationState = 'idle';
    if (!ok) {
      /* The flight was cancelled — by a level change, a reset, or a newer
         flight taking over. Each of those re-establishes the controls
         itself. But if none has, the learner would be left staring at a
         dead dock with no way to try again, so never return still locked. */
      if (gameState.screen === 'playing' && gameState.inputLocked) lockInput(false);
      return;
    }

    /* FLOW 11: the aircraft always flies to the SELECTED position — the
       learner has to see where their own numbers led. */
    var t = gameState.target;
    gameState.horizontalCorrect = sel.x === t.x;
    gameState.verticalCorrect = sel.y === t.y;
    var right = gameState.horizontalCorrect && gameState.verticalCorrect;
    if (gameState.direct) { if (right) directSuccess(sel); else directIncorrect(sel); return; }
    if (right) showSuccess(sel);
    else showIncorrect(sel);
  }

  /* ============================================================
     FEEDBACK
     ============================================================ */
  function coordText(p) { return '(' + p.x + ', ' + p.y + ')'; }
  function spoken(p) { return CG.Voice.numWord(p.x) + ', ' + CG.Voice.numWord(p.y); }

  /* dirWord() went with the recap it served: page 12 names the axis by
     orientation, so no direction word is needed anywhere now. */

  /* Small callout beside the aircraft: LOCATION / (3, 2) — never a
     popup that covers the grid (FLOW 09). */
  function locationCallout(pt) {
    var offX = pt.x >= 4 ? -1 : 1;
    UI.coordTag(Grid.stageX(pt.x) + offX * 130, Grid.stageY(pt.y) - 78,
                coordText(pt), 'LOCATION');
  }

  async function showSuccess(sel) {
    var tk = ++seqToken;
    gameState.screen = 'feedback';
    Grid.clearHint();
    Grid.successFx(gameState.target);
    Grid.highlightTarget(true);
    Audio.play('reached');        /* supplied arrival chime */
    /* Keyed to the mission, not appended: showSuccess records this before
       its first await, so a re-entry would otherwise duplicate the entry
       and the lesson arc would replay the same route twice. */
    gameState.reached[gameState.levelIndex] = { x: sel.x, y: sel.y };

    /* The final CFU is a check, not a lesson: it confirms and stops
       rather than replaying the route and naming the numbers again. */
    var fb = level().feedback;
    if (fb) {
      Grid.highlightRevealed('x', sel.x, true);
      Grid.highlightRevealed('y', sel.y, true);
      locationCallout(sel);
      UI.mission({ text: fb.correct, voice: fb.correctVoice || fb.correct, animate: 'words' });
      await wait(CFG.beatLong); if (tk !== seqToken) return;
      UI.hideCoordTag();
      /* FLOW 58 — the CFU is not the end. Direct co-ordinate mode is. */
      startDirectMode();
      return;
    }

    /* FLOW 09 — arrival, then the coordinate */
    UI.mission({ text: 'Target reached!', voice: 'Target reached.' });
    await wait(CFG.arrivalBeat); if (tk !== seqToken) return;

    locationCallout(sel);
    UI.mission({
      text: 'Location <span class="coord">' + coordText(sel) + '</span>',
      voice: 'The aircraft is at ' + spoken(sel) + '.',
      animate: 'words'
    });
    await wait(CFG.beatMed); if (tk !== seqToken) return;

    /* THE CALLOUT'S BEAT IS OVER, SO THE CALLOUT GOES. It was shown for
       "Location (3, −3)" and then never taken down on this path — only
       the CFU branch above hid it — so it sat over the chart through the
       whole route replay, the X and Y plates and the closing line, which
       is most of a minute, and outlived its own sentence by every one of
       them. Everything that follows is drawn ON the grid it was covering. */
    UI.hideCoordTag();

    /* FLOW 10 / PDF p14 — replay the route, one direction at a time, and
       do it after EVERY mission: "First, we moved 3 spaces horizontally.
       Then, we moved 2 spaces vertically." The horizontal run lights up
       on its own first, so each number is tied to one movement. */
    var q;
    Grid.clearReveal();
    for (q = 1; q <= Math.abs(sel.x); q++) Grid.highlightRevealed('x', Math.sign(sel.x) * q, true);
    /* ITEM 16 — light the SPAN of the x-axis the aircraft covered, with
       a pip per space and an arrowhead pointing the way it went. Not
       the whole axis, and not a column through the endpoint. */
    Grid.glowAxisSpan('x', sel.x);
    /* THE CROSSING IS SHOWN ALONG THE ROUTE, NEVER ACROSS THE CHART.
       Each crossed grid line was briefly lit full-height as well, on the
       reasoning that "three spaces" IS "three lines". It is — but three
       full-height lines up the plate buried the graticule, cut the chart
       into stripes and drowned the one mark that actually answers the
       question: the aircraft's own route along the bottom. The span
       already carries the count, a pip per line crossed, in the order
       they were crossed. That is the whole statement, drawn where the
       learner is looking. */
    Grid.clearRoutePoints();
    Grid.markLeg('x', sel.x);          /* the spaces it counted, in place */
    UI.mission({
      /* p12 word for word. It is "we", not "you", and the axis is named
         by its ORIENTATION — horizontally / vertically — not by the
         direction flown. The build had "you moved 3 spaces right", which
         is a different sentence and a different teaching point. */
      text: 'First, we moved <em>' + Math.abs(sel.x) + '</em> spaces horizontally.',
      voice: 'First, we moved ' + CG.Voice.numWord(Math.abs(sel.x)) + ' spaces horizontally.',
      animate: 'words'
    });
    await wait(CFG.beatMed); if (tk !== seqToken) return;

    for (q = 1; q <= Math.abs(sel.y); q++) Grid.highlightRevealed('y', Math.sign(sel.y) * q, true);
    Grid.glowAxisSpan('y', sel.y, sel.x);
    Grid.markLeg('y', sel.y, sel.x);
    UI.mission({
      text: 'Then, we moved <em>' + Math.abs(sel.y) + '</em> spaces vertically.',
      voice: 'Then, we moved ' + CG.Voice.numWord(Math.abs(sel.y)) + ' spaces vertically.',
      animate: 'words'
    });
    await wait(CFG.beatLong); if (tk !== seqToken) return;

    /* first success only: the movement is named as X and Y */
    if (level().coordinateReveal) {
      Grid.glowAxisSpan('x', sel.x);
      Grid.clearRoutePoints();
      Grid.markLeg('x', sel.x);
      /* "X = 3" IS A STATEMENT ABOUT THE CHART, SO IT IS SAID ON THE
         CHART. It used to be a sub-line under the question, which made
         it a caption: read at the top of the screen, then carried back
         down and matched to a 3 the learner had to find for themselves.
         The plate now sits on the x-axis at the point the aircraft
         reached, pulsing, with the axis lit underneath it — the number,
         the line it describes and the place it describes are one object
         in one glance. The voice-over is unchanged. */
      /* THE "X = 3 / Y = 2 / TOGETHER" TRIO IS GONE. Three sentences
         of my own sat here naming the numbers. The PDF names them once,
         much later and far more carefully, across pages 38 to 42 — and
         doing it here pre-empted that whole stretch with wording the
         deck never wrote. Page 11 shows the Location callout, page 12
         replays the route, and that is the entire arrival. */
      Grid.clearPulseLines();
      Grid.highlightAxis(null);
      Grid.clearRoutePoints();
    }


    Grid.clearPulseLines();
    Grid.clearRoutePoints();

    /* the sign lesson for a newly opened quadrant */
    if (level().signLesson) {
      UI.mission({ text: level().signLesson, voice: level().signLesson, animate: 'words' });
      await wait(CFG.beatLong); if (tk !== seqToken) return;
    }

    advanceLevel();
  }

  async function showIncorrect(sel) {
    var tk = ++seqToken;
    gameState.screen = 'feedback';
    Grid.errorFx(sel);
    Audio.play('incorrect');
    setPlaneMood('lost');     /* a slow search sweep, not a telling-off */
    /* THE RED FLASH IS NEW, AND IT DOES SOFTEN THAT. The wobble on its
       own was chosen to avoid scolding, and it is still the same gentle
       wobble — but it is the same motion whether the aircraft is lost or
       just idling oddly, so on its own it never actually said "wrong".
       Two red pulses, under the aircraft, over in under a second. */
    flashPlaneHit();
    locationCallout(sel);

    /* FLOW 12 — first miss: no answer, no hint, just try again */
    var fb = level().feedback;
    UI.mission(fb
      ? { text: gameState.attemptNumber >= 2 ? fb.second : fb.first,
          voice: gameState.attemptNumber >= 2 ? fb.second : fb.first }
      : { text: 'Not there yet. Try again.', voice: 'Not there yet. Try again.' });
    await wait(CFG.retryDelay); if (tk !== seqToken) return;

    UI.hideCoordTag();
    Grid.clearFx();
    returnHome();
    await wait(900); if (tk !== seqToken) return;

    /* FLOW 13 / 14 — progressive assistance from the second miss on:
       horizontal first, and only once that is right, vertical. */
    var t = gameState.target;
    if (gameState.attemptNumber >= 2) {
      if (!gameState.horizontalCorrect) {
        Grid.showHint('x', t.x);
        /* p13 specifies a DISPLAY for both misses — arrows, then arrows
           with the unit counts above them — and gives no words at all.
           showHint draws exactly that, so nothing is said over it. */
      } else {
        Grid.showHint('y', t.y);

      }
    } else {
      UI.mission({ text: level().mission, voice: false });
    }

    gameState.screen = 'playing';
    lockInput(false);
  }

  /* glide the aircraft back to the origin for another attempt */
  function returnHome() {
    gameState.animationState = 'returning';
    Grid.clearPath();
    setHeading(0);
    setAircraftPosition(0, 0, true);
    setPlaneMood('bob');
    window.setTimeout(function () {
      if (gameState.animationState === 'returning') gameState.animationState = 'idle';
    }, 600);
  }

  /* ============================================================
     LEVEL LIFECYCLE
     ============================================================ */
  function loadLevel(index) {
    animToken++; seqToken++; clearAuto(); clearIdleHint();
    idleHintShown = 0;               /* a new mission earns a new hand */
    Grid.clearPulseLines();          /* nothing survives a new mission */
    Grid.clearRoutePoints();
    Audio.engineStop();
    Audio.duck('flight', false);
    CG.Voice.cancel();
    gameState.levelIndex = clamp(index, 0, LEVELS.length - 1);
    var lv = level();

    gameState.target = { x: lv.target.x, y: lv.target.y };
    gameState.screen = 'playing';
    gameState.attemptNumber = 0;
    gameState.horizontalCorrect = false;
    gameState.verticalCorrect = false;
    gameState.revealedNumbers = { x: [], y: [] };
    gameState.currentQuadrant = lv.quadrant;
    gameState.animationState = 'idle';

    Grid.clearPath();
    Grid.clearReveal();
    Grid.clearFx();
    Grid.hideOriginLabel();
    Grid.highlightAxis(null);
    Grid.highlightOrigin(false);
    Grid.clearHint();
    Grid.clearPing();
    UI.hideCoordTag();
    UI.highlight(null);

    /* The axes are always drawn. The aircraft stands on the origin, so
       the two lines through it have to read as the axes from the first
       mission — brighter, glowing, arrow-tipped — and not as two more
       gridlines. Naming them is still the concept reveal's job. */
    Grid.showAxes(true);

    /* the coordinate plane unfolds one quadrant at a time */
    Grid.setStage(lv.quadrant, true);
    syncPlaneScale();
    Grid.setTarget(gameState.target);
    refreshTargetGlow();                   /* co-ordinate entry: glowing waypoint */

    UI.buildControls(lv.visible || lv.controls || [], lv.controls || []);
    resetControlValues();

    setHeading(0);
    setAircraftPosition(0, 0, true);
    setPlaneMood('bob');
    CG.showPlane(true);          /* the lesson may have sent it away */
    UI.setLevelPill(gameState.levelIndex + 1, LEVELS.length);
    UI.showDock(true);
    UI.showMission(true);

    /* THE OPENING BRIEF OWNS THE PANEL on the first mission, so the
       panel opens on the brief's OWN first line rather than on the
       mission line — otherwise the mission line is written, the console
       animation plays for it, and it is replaced a frame later by "You
       are the air traffic controller." The brief's step 0 therefore has
       nothing to write: the words are already here. */
    var briefTakesOver = lv.tutorial && gameState.tutorialStep < 0;
    /* THE NOTE COMES FIRST AND THE MISSION LINE COMES SECOND, because
       the panel now shows one line at a time and whichever is second is
       the one left on screen. "The airspace now extends to the left" is
       news — it is true once, and then it is over. "Guide the aircraft
       to the target" is the instruction, and it has to be readable for
       as long as the learner is working. So the news opens the panel and
       the instruction is what it settles on. */
    UI.mission({
      text: briefTakesOver ? briefText(0) : (lv.unlockNote || lv.mission),
      sub: (!briefTakesOver && lv.unlockNote) ? lv.mission : '',
      voice: briefTakesOver ? false
        : lv.unlockVoice ? lv.unlockVoice + ' ' + lv.mission
        : lv.mission
    });
    lockInput(false);

    if (briefTakesOver) startTutorial();
    else armIdleHint();      /* nothing touched yet; the nudge waits */
  }

  /* Reset: cancels flight safely, never restarts progression. */
  function resetLevel() {
    animToken++; seqToken++; clearAuto();
    idleHintShown = 0;               /* starting over earns a new hand */
    Audio.engineStop();
    Audio.duck('flight', false);
    CG.Voice.cancel();
    Grid.clearPath();
    Grid.clearReveal();
    Grid.clearFx();
    Grid.clearHint();
    Grid.clearPulseLines();
    UI.hideCoordTag();
    Grid.setTarget(gameState.target);
    refreshTargetGlow();
    resetControlValues();
    gameState.animationState = 'idle';
    setHeading(0);
    setAircraftPosition(0, 0, true);
    setPlaneMood('bob');
    gameState.screen = 'playing';
    lockInput(false);
    armIdleHint();
    var lv = level();
    UI.mission({ text: lv.mission, sub: '' });
    /* RESET is itself an interaction, so the brief has served its
       purpose — it ends here rather than replaying over the top. */
    if (gameState.tutorialStep >= 0) finishTutorial();
  }

  function advanceLevel() {
    clearAuto(); seqToken++;
    if (gameState.levelIndex + 1 >= LEVELS.length) { showComplete(); return; }
    var next = LEVELS[gameState.levelIndex + 1];
    /* The eight flight missions are arc 1. Between them and the final CFU
       sits the whole lesson arc: the recap, the names, the co-ordinates of
       a point and the quadrants. See js/lesson.js. */
    if (next.lessonBefore) { runLesson(); return; }
    Audio.play('levelTransition');
    loadLevel(gameState.levelIndex + 1);
  }

  /* arc 2 + arc 3, then hand back to the flight game for the final CFU */
  async function runLesson() {
    gameState.screen = 'lesson';
    lockInput(true);
    UI.hideCoordTag();     /* the lesson arc owns the chart from here */
    var flown = gameState.reached.filter(function (p) { return !!p; }).slice(0, 4);
    var ok = await CG.Lesson.run(flown);
    if (!ok) return;
    Audio.play('levelTransition');
    UI.showDock(true);
    loadLevel(gameState.levelIndex + 1);
  }

  /* ============================================================
     THE OPENING BRIEF

     Three lines, spoken in order, each one WRITTEN INTO THE QUESTION
     PANEL as it is said, and then the learner is on their own.

       1  "You are the air traffic controller."
       2  the mission's own line — "Guide the aircraft to the target."

     THERE USED TO BE A THIRD. Between those two sat "Guide each
     aircraft to its target.", and on screen it was the same sentence
     twice: the learner read "guide each aircraft to its target", then
     read "guide the aircraft to the target" a beat later. Spoken they
     were near enough identical, and written into the panel one after
     the other they were plainly the same instruction restated. The
     mission line is the one that has to stay — levels.js owns it and
     every later mission shows it — so the general one went.

     ALL OF IT AFTER THE LANDING, AND NONE OF IT DURING THE FLIGHT.
     Lines 1 and 2 used to play across the arrival cinematic, on the
     reasoning that nine seconds of picture was free airtime. It is not:
     the aircraft is flying, the learner is watching it, and a voice
     explaining their job arrives over the top of the one moment that
     needs no explaining. Worse, there is nowhere to PUT the words while
     it plays — the question panel is not on screen yet — so the lines
     were audio with nothing to read, which loses anyone who has the
     sound off or misses a sentence.

     So the brief now starts when the aircraft has landed and the chart
     is up. Every line is heard and read at once, and the cinematic is
     silent, which is what a cinematic should be.

     THERE IS NO BUTTON WALKTHROUGH. What stood here marched the learner
     through RIGHT, then UP, then GO, holding each control hostage until
     it had been used in the prescribed order — four prompts to explain
     a dock that says RIGHT, UP and GO on its own face. The learner is
     told who they are and what the job is, and the controls are handed
     over.

     WHY THE LINES ARE CHAINED AND NOT TIMED
     CG.Voice.say() cancels whatever is mid-sentence, so two calls in a
     row lose the first line, and a guessed delay between them is a
     guess about a voice, a rate and a device we do not control. Each
     line waits on the synthesiser's own `end` event for the one before
     it, and the panel text changes on that same event — so the words on
     screen and the words being spoken cannot drift apart.
     ============================================================ */
  /* `null` means "this step shows the level's own mission line", which
     is how step 3 stays in step with levels.js instead of restating it. */
  /* p1's line is one sentence, not two: the build had clipped it to
     "You are the air traffic controller." and dropped the half that
     tells the learner what to do. */
  var BRIEF = [
    { text: null }
  ];
  var BRIEF_GAP = 550;        /* ms of air between one line and the next */
  var BRIEF_MAX = 13000;      /* per-line deadline — see THE BACKSTOP    */
  /* NO HINT UNDER THE QUESTION. "That glowing waypoint is its
     destination." stood here and was answering a question nobody had:
     the waypoint is the only thing on the chart that glows, and the
     line above it already says to fly to the target. The question
     template asks; it does not also lean over and explain. */

  var briefToken = 0;         /* bumped to abandon a brief in flight */
  var briefAt = -1;           /* the step currently being spoken     */

  function briefText(i) {
    var b = BRIEF[i];
    return b && b.text !== null ? b.text : level().mission;
  }

  function cancelBrief() { briefToken++; briefAt = -1; clearAuto(); }

  function startTutorial() {
    gameState.screen = 'tutorial';
    gameState.tutorialStep = 0;
    UI.highlight('target');
    refreshTargetGlow(true);
    lockInput(true, true);  /* the controls wait — quietly — for the brief */
    clearIdleHint();
    runBriefStep(0, ++briefToken);
  }

  function runBriefStep(i, token) {
    if (token !== briefToken || gameState.tutorialStep < 0) return;
    if (i >= BRIEF.length) { finishTutorial(); return; }
    briefAt = i;

    /* Step 0's words are already on the panel: loadLevel() wrote them
       there along with the console's arrival animation, and rewriting
       them here would replay it. */
    if (i > 0) {
      UI.mission({ text: briefText(i), sub: '', voice: false, animate: 'words' });
    }

    /* advance exactly once, whichever of the two paths below gets here */
    function next() {
      if (token !== briefToken || briefAt !== i) return;
      briefAt = -1;
      clearAuto();
      window.setTimeout(function () { runBriefStep(i + 1, token); }, BRIEF_GAP);
    }

    /* THE BACKSTOP, PER LINE. Every path through CG.Voice settles its
       callback bar one: a browser that reports speech support and then
       never populates its voice list leaves the line queued for a
       `voiceschanged` that is not coming. The controls are behind this
       brief, so each line gets a hard deadline as well as a promise. */
    clearAuto();
    autoTimer = window.setTimeout(next, BRIEF_MAX);
    CG.Voice.say(briefText(i), true, next);
  }

  function finishTutorial() {
    clearAuto(); clearIdleHint();
    cancelBrief();
    gameState.tutorialStep = -1;
    UI.highlight(null);
    refreshTargetGlow();
    if (gameState.screen === 'tutorial') gameState.screen = 'playing';
    lockInput(false);
    armIdleHint();
  }

  /* THE IDLE NUDGE, BACK.

     It went out with the button walkthrough, and it should not have:
     the walkthrough was four prompts nobody asked for, but this is one
     hand that appears only after the learner has done nothing at all
     for five seconds. It answers "what do I press?" for a child who is
     stuck, and it is silent for everyone who is not.

     It points at the thing that is actually next: GO if a route is set,
     otherwise the first direction they can still use. Never during a
     teaching sequence, never while the aircraft is flying — armIdleHint
     checks the lock, so a nudge can never point at a dead control. */
  function onLearnerInteraction() {
    clearIdleHint();
    armIdleHint();
  }

  /* The hand may only ever land on something the learner can actually
     press. GO is only useful once a route is set; a direction is only
     useful if this mission arms it AND it is not already dialled in.
     Returning null means "say nothing", which is the right answer more
     often than pointing somewhere hopeful. */
  function nextUsefulControl() {
    if (routeIsSet()) return 'go';
    /* direct mode swapped the four directions for a signed X and Y —
       same DOM, different keys, so the nudge has to ask which it is */
    if (gameState.direct) {
      return !gameState.controls.x ? 'x' : (!gameState.controls.y ? 'y' : null);
    }

    /* POINT AT THE DIRECTION THE TARGET IS IN, NOT THE FIRST ONE ARMED.
       This walked level().controls in declaration order and pointed at
       whichever was still empty — so on a mission whose target is to
       the LEFT it happily pointed at RIGHT, because right came first in
       the list. The reviewer hit exactly that: "I have to move to the
       left but the nudge is saying to move to the right."

       The target's own sign decides it now: horizontal first, because
       that is the order every mission teaches and the order the route
       replay narrates. A direction this mission has not armed is never
       offered, so the hand still cannot land on a dead control. */
    var t = gameState.target || { x: 0, y: 0 };
    var armed = level().controls || [];
    var wantX = t.x < 0 ? 'left' : (t.x > 0 ? 'right' : null);
    var wantY = t.y < 0 ? 'down' : (t.y > 0 ? 'up' : null);

    if (wantX && armed.indexOf(wantX) !== -1 && !gameState.controls[wantX]) return wantX;
    if (wantY && armed.indexOf(wantY) !== -1 && !gameState.controls[wantY]) return wantY;
    /* both legs already carry a value, yet the route reads as unset —
       nothing here is worth pointing at */
    return null;
  }

  function armIdleHint() {
    clearIdleHint();
    if (gameState.inputLocked) return;
    if (gameState.screen !== 'playing' && gameState.screen !== 'direct') return;
    /* ONCE PER MISSION. Every tap re-armed this timer, so a learner who
       worked slowly got the hand again and again — the "not every time"
       complaint. The cap resets when the mission does, and on a reset,
       which are the two moments the learner genuinely starts over. */
    if (idleHintShown >= (CFG.idleHintPerMission || 1)) return;
    idleTimer = window.setTimeout(function () {
      idleTimer = null;
      /* re-checked on the way out, not just on the way in: ten seconds
         is long enough for a flight to have started since */
      if (gameState.inputLocked) return;
      if (gameState.screen !== 'playing' && gameState.screen !== 'direct') return;
      var what = nextUsefulControl();
      if (!what) return;
      idleHintShown++;
      UI.handAt(what);          /* always a live control — see below */
    }, CFG.idleHintDelay);
  }

  function clearIdleHint() {
    if (idleTimer) window.clearTimeout(idleTimer);
    idleTimer = null;
    UI.hideHand();
  }
  function clearAuto() {
    if (autoTimer) window.clearTimeout(autoTimer);
    autoTimer = null;
  }

  /* the origin becomes tappable for exactly one beat of the reveal */
  function showOriginTap(onTap) {
    var btn = dom.originTap;
    btn.hidden = false;
    btn.style.left = Grid.stageX(0) + 'px';
    btn.style.top = Grid.stageY(0) + 'px';
    function hit() {
      btn.removeEventListener('click', hit);
      btn.hidden = true;
      Grid.clearPing();
      Audio.play('uiClick');
      onTap();
    }
    btn.addEventListener('click', hit);
  }
  function hideOriginTap() {
    dom.originTap.hidden = true;
  }

  /* ============================================================
     COMPLETION  (PDF p50 outcomes)
     A restrained card over the same ocean and grid, recapping only the
     five things the whole flow set out to teach. The teaching itself now
     lives in js/lesson.js; this is the curtain, not the lesson.
     ============================================================ */
  function showComplete() {
    clearAuto(); seqToken++;
    gameState.screen = 'complete';
    gameState.coordinateMode = true;
    UI.showDock(false);
    UI.showMission(false);
    UI.hideCoordTag();
    Grid.clearLesson();
    Grid.setTarget(null);
    Grid.clearPath();
    Grid.showAxes(true);
    Grid.showPermanentNumbers(true);
    Grid.setLetter('x', true);
    Grid.setLetter('y', true);
    dom.screenComplete.hidden = false;
    Audio.play('success');
    CG.Voice.say('Mission complete. Two numbers can locate any point on the plane.');
  }

  /* the origin becomes tappable — used by the lesson arc */
  CG.originTap = function (cb) { showOriginTap(cb); };

  /* THE AIRCRAFT LEAVES DURING THE LESSON.

     It belongs to the missions: it is the thing the learner flies, and
     while they are flying it, it is the subject. The lesson arc is about
     the CHART — the axes, the origin, the quadrants — and every one of
     those beats asks the learner to look at, or tap, a place on the
     plane. An aircraft parked on the origin through all of it covers
     the one point the origin lesson is about, and reads as something
     they are meant to be doing something with.

     It stays for the recap flights at the top of the arc, which are
     nothing but the aircraft, and goes when the naming begins. */
  CG.showPlane = function (on) {
    dom.planeHolder.classList.toggle('plane-away', !on);
  };

  /* ---- the discovery recap's demonstration flights -----------------
     FLOW 32 wants three of the places the learner actually reached
     re-flown from the origin, quickly, before any explanation starts.
     It is the SAME flight machinery the missions use — one leg, a
     pivot, the other leg — with the number reveals suppressed, because
     the point here is the shape of the journey and not the counting.

     IT USED TO RUN AT TWO-AND-A-HALF TIMES SPEED and that was too fast
     to be a demonstration of anything. The learner is being shown a
     route they flew themselves several missions ago; at 0.40 the
     aircraft was across the chart before they had found it. At 0.80 it
     is still visibly quicker than a mission — this is a recap, not a
     re-run — but it can be followed. */
  CG.demoFlight = async function (x, y) {
    setHeading(0);
    setAircraftPosition(0, 0, false);
    Grid.clearPath();
    Grid.clearReveal();
    var ok = await animateAircraft(x, y, {
      cellMs: Math.round(CFG.cellDuration * 0.80),
      silentNumbers: true
    });
    gameState.animationState = 'idle';
    return ok;
  };

  /* and putting it back where the lesson expects to find it */
  CG.demoHome = function () {
    setHeading(0);
    setAircraftPosition(0, 0, true);
    Grid.clearPath();
    Grid.clearReveal();
  };

  /* ---- the takeoff's flight controls -------------------------------
     The approach is authored in STAGE PIXELS, not grid cells, because
     it begins below the stage where there is no chart yet. These five
     calls are everything it needs, and they route through the game's
     own heading and bank maths, so the aircraft carries exactly the
     weight in the approach that it carries in play. */
  CG.planeControl = {
    atStage: function (px, py) {
      dom.planeHolder.classList.remove('snap');
      dom.planeHolder.style.transitionDuration = '0ms';
      dom.planeHolder.style.transform =
        'translate3d(' + px.toFixed(2) + 'px,' + py.toFixed(2) + 'px,0)';
    },
    width: function (px) {
      dom.stage.style.setProperty('--plane-w', px.toFixed(1) + 'px');
    },
    heading: function (deg, bank) { applyHeading(deg, bank); },
    /* On the img, not the holder: the holder carries a 460ms opacity
       transition for the screen states, which would lag a value being
       driven every frame. */
    opacity: function (v) { dom.plane.style.opacity = v.toFixed(3); },
    /* per-frame driving needs the spin transition out of the way;
       putting it back is what lets the arrival straighten ease */
    free: function (on) { dom.planeSpin.classList.toggle('free', !!on); },
    /* Hand the aircraft back to the chart. It arrives off the circuit
       pointing roughly north-west, and straightens onto north with the
       same eased pivot the game uses after every landing. */
    home: function () {
      dom.planeSpin.classList.remove('free');
      dom.plane.style.opacity = '';      /* back to the stylesheet */
      setHeading(0);
      syncPlaneScale();
      setAircraftPosition(0, 0, false);
    }
  };

  /* ============================================================
     FLOW 58-61 — DIRECT CO-ORDINATE MODE

     The four direction controls come off and two signed steppers go on,
     so the learner stops choosing "how far right" and starts entering a
     co-ordinate. It reuses the mission loop wholesale — the same flight,
     the same number reveals, the same lock — and differs only in what
     the controls mean and what happens on a miss.
     ============================================================ */
  function directTarget() {
    return CG.DIRECT_TARGETS[gameState.direct.index] || null;
  }

  function startDirectMode() {
    clearAuto(); seqToken++; animToken++;
    gameState.direct = { index: 0 };
    CG.showPlane(true);
    gameState.screen = 'direct';
    gameState.coordinateMode = true;
    gameState.tutorialStep = -1;
    UI.showDock(true);
    UI.showMission(true);
    UI.buildAxisControls();
    Grid.showAxes(true);
    Grid.showPermanentNumbers(true);
    Grid.setLetter('x', true);
    Grid.setLetter('y', true);
    Grid.setStage(4, true);
    loadDirectTarget();
    UI.mission({
      /* p59, and only p59. The sub-line that used to sit here
         ("Enter the co-ordinate itself now") was not in the PDF. */
      text: 'You’re ready. Guide the aircraft to its position.',
      voice: 'You are ready. Guide the aircraft to its position.',
      animate: 'words'
    });
  }

  function loadDirectTarget() {
    var t = directTarget();
    if (!t) { showComplete(); return; }
    animToken++; seqToken++; clearAuto(); clearIdleHint();
    gameState.target = { x: t.x, y: t.y };
    gameState.attemptNumber = 0;
    gameState.animationState = 'idle';
    gameState.revealedNumbers = { x: [], y: [] };
    Grid.clearPath(); Grid.clearReveal(); Grid.clearFx();
    Grid.clearPulseLines(); Grid.clearRoutePoints(); Grid.clearHint();
    UI.hideCoordTag();
    Grid.setTarget(gameState.target);
    refreshTargetGlow(true);
    UI.setLevelPill(gameState.direct.index + 1, CG.DIRECT_TARGETS.length);
    resetControlValues();
    setHeading(0);
    setAircraftPosition(0, 0, true);
    setPlaneMood('bob');
    lockInput(false);
    armIdleHint();           /* direct mode gets the nudge too */
  }

  async function directSuccess(sel) {
    var tk = ++seqToken;
    Audio.play('success');
    Grid.successFx(sel);                     /* the same ring the missions use */
    setPlaneMood('settle');
    locationCallout(sel);
    UI.mission({
      text: 'Perfect landing!',
      sub: 'You reached <span class="coord">' + coordText(sel) + '</span>.',
      voice: 'Perfect landing.',
      animate: 'words'
    });
    await wait(CFG.beatLong); if (tk !== seqToken) return;
    UI.hideCoordTag();
    gameState.direct.index++;
    if (gameState.direct.index >= CG.DIRECT_TARGETS.length) { showComplete(); return; }
    Audio.play('levelTransition');
    loadDirectTarget();
    UI.mission({
      text: 'Next aircraft. Guide it to its position.',
      voice: 'Next aircraft. Guide it to its position.',
      animate: 'words'
    });
  }

  /* FLOW 61 — the aircraft has already flown to whatever the learner
     entered, because they have to see where their own co-ordinate led.
     Then: a wobble, a brief red flash, ONE pulse of where it should have
     gone, and it FLIES back to the origin rather than teleporting. */
  async function directIncorrect(sel) {
    var tk = ++seqToken;
    var t = gameState.target;
    Audio.play('incorrect');
    setPlaneMood('lost');
    flashPlaneHit();
    Grid.errorFx(sel);                       /* marks where they actually went */
    UI.mission({
      text: gameState.attemptNumber === 1
        ? 'Not quite. Try again!'
        : 'First find <span class="coord">x</span> along the bottom. Then move to <span class="coord">y</span>.',
      voice: gameState.attemptNumber === 1
        ? 'Not quite. Try again.'
        : 'First find x along the bottom. Then move to y.',
      animate: 'words'
    });
    await wait(CFG.beatMed); if (tk !== seqToken) return;

    /* ONE pulse of where it should have gone — not a loop, and not a
       label: the co-ordinate was on screen the whole time. */
    Grid.pingPoint(t.x, t.y);
    await wait(CFG.beatShort); if (tk !== seqToken) return;
    Grid.clearPing();

    /* the flight home, at the same speed as the demo flights */
    setPlaneMood(null);
    var back = await animateAircraft(-sel.x, -sel.y, {
      cellMs: Math.round(CFG.cellDuration * 0.80),
      silentNumbers: true
    });
    if (!back || tk !== seqToken) return;
    gameState.animationState = 'idle';
    Grid.clearPath(); Grid.clearReveal();
    setHeading(0);
    setAircraftPosition(0, 0, false);
    setPlaneMood('bob');
    resetControlValues();
    lockInput(false);
    UI.mission({
      text: 'Enter the co-ordinate again.',
      voice: 'Enter the co-ordinate again.',
      animate: 'words'
    });
  }

  /* FLOW §E — the aircraft arrives before its world does, and before the
     introduction. Nothing here is interactive: it plays, and then the
     introduction screen comes up with START. */
  /* ============================================================
     THE LOW-END TIER

     WHY THIS MEASURES INSTEAD OF ASKING. navigator.deviceMemory and
     navigator.hardwareConcurrency are the obvious test and they are the
     wrong one: deviceMemory is absent on Safari and iOS entirely, and
     hardwareConcurrency reports core COUNT, which on a throttled tablet
     or a laptop on battery says nothing about the frames it can
     actually paint. They are kept below only as a fallback for the case
     where the probe cannot run.

     WHAT IT MEASURES. The intro cinematic is the ideal probe: it runs
     unattended for ~4 seconds, it drives the aircraft, the ocean and
     the whole compositor at once, and nobody is waiting on input. If
     the average frame over the first 1.6s of it is worse than ~22ms
     (~45fps), this machine is not going to hold 60 through a mission
     either, and the ambient layers come off.

     THE FIRST FEW FRAMES ARE THROWN AWAY. Layer promotion, first paint
     and the tail of asset decoding all land in them, so they are slow
     on every machine and would mislabel a fast one.

     It never upgrades back. A tier that flickers between states as the
     load varies is worse than either tier — the ocean would start and
     stop moving while a child watched it. */
  var PROBE_WARMUP = 8;        /* frames discarded before timing starts */
  var PROBE_FRAMES = 90;       /* ~1.5s at 60fps, ~1.9s at 48           */
  var PROBE_BUDGET = 22;       /* ms per frame; above this, go lite     */

  function setPerfLite(on, why) {
    if (!on || dom.stage.classList.contains('perf-lite')) return;
    dom.stage.classList.add('perf-lite');
    console.info('[perf] lite mode on —', why);
  }

  function probeFrameRate() {
    if (!window.requestAnimationFrame || !window.performance) {
      /* No probe available, so fall back to what the device claims. */
      var cores = navigator.hardwareConcurrency;
      var mem = navigator.deviceMemory;
      if ((cores && cores <= 4) || (mem && mem <= 4)) {
        setPerfLite(true, 'no probe; device reports cores=' + cores + ' mem=' + mem);
      }
      return;
    }
    var seen = 0, t0 = 0;
    function frame(now) {
      seen++;
      if (seen === PROBE_WARMUP) { t0 = now; }
      if (seen < PROBE_WARMUP + PROBE_FRAMES) {
        window.requestAnimationFrame(frame);
        return;
      }
      var avg = (now - t0) / PROBE_FRAMES;
      if (avg > PROBE_BUDGET) {
        setPerfLite(true, avg.toFixed(1) + 'ms average frame over ' +
                          PROBE_FRAMES + ' frames');
      } else {
        console.info('[perf] full mode —', avg.toFixed(1) + 'ms average frame');
      }
    }
    window.requestAnimationFrame(frame);
  }

  function runApproach() {
    var toIntro = function () {
      dom.stage.dataset.screen = 'start';
      gameState.screen = 'start';
      releaseBoot();
    };
    if (!CG.Intro) { toIntro(); return; }
    gameState.screen = 'approach';
    dom.stage.dataset.screen = 'approach';
    Grid.setStage(1, false);
    probeFrameRate();          /* times the cinematic it runs alongside */
    CG.Intro.run().then(toIntro);
  }

  /* The single point at which the game becomes startable — reached
     either by the approach finishing or by the boot watchdog. Both the
     button and the flag are set here so the two can never disagree. */
  function releaseBoot() {
    if (bootReleased) return;
    bootReleased = true;
    var gauge = document.getElementById('loadGauge');
    if (gauge) gauge.hidden = true;
    dom.btnPlay.hidden = false;
    dom.btnPlay.disabled = false;
    void dom.btnPlay.offsetWidth;
    dom.btnPlay.classList.add('play-in');
    /* the expanding rings start only once the button is really there —
       a beacon around an empty slot would be pointing at nothing */
    var slot = dom.btnPlay.parentNode;
    if (slot) slot.classList.add('rings-live');
  }

  /* ============================================================
     SCREENS
     ============================================================ */
  function startGame() {
    /* ONE flag, checked by every route in. The button being disabled
       stops a click, but Enter/Space and anything calling startGame()
       directly would sail straight past it — so the flag is asked as
       well.

       It is a flag rather than CG.Preload.isDone() because the boot
       watchdog can also release the game, and asking the preloader
       directly would have left the watchdog revealing a button that
       this function then refused: a dead button, which is worse than a
       stuck bar. */
    if (!bootReleased) return;
    if (dom.btnPlay.disabled) return;
    Audio.unlock();
    CG.Voice.unlock();                     /* first real user gesture */
    CG.Voice.setEnabled(CG.Audio.isEnabled());
    Audio.play('uiClick');
    Audio.musicStart();                    /* the bed, from the first gesture */
    Audio.surfStart();                     /* and the shore break behind it   */
    dom.btnPlay.disabled = true;

    /* NOTHING IS SPOKEN HERE. The opening brief used to start on this
       click and play across the landing; it now waits for the aircraft
       to be down and the chart to be up, so the words can be read as
       well as heard. See THE OPENING BRIEF. */

    /* TWO CINEMATICS, AT THE TWO MOMENTS THEY BELONG TO.
       js/intro.js already played at boot: the aircraft climbing into
       frame while the world materialised around it (FLOW §E). START now
       plays the second, js/arrival.js — out over the sea, a fade, the
       runway, the landing — and hands over to the first mission. */
    var slot = dom.btnPlay.parentNode;
    if (slot) slot.classList.remove('rings-live');

    /* THE PRESS IS HELD FOR ONE BEAT.
       Everything the browser's autoplay and speech policies need from a
       gesture has already happened above, inside the handler. What is
       left is picture, and it waits 130ms so the button can be SEEN to
       go down — pressed and released inside a single frame is a button
       that never moved. See .play-btn.pressed. */
    dom.btnPlay.classList.add('pressed');
    window.setTimeout(function () {
      dom.btnPlay.classList.remove('pressed');
      /* The state goes on FIRST, then the fade. Both land in the same
         task, so nothing is painted in between either way — but ordering
         it this way means no future refactor that puts a paint between
         them can flash the bare game under the dissolving start screen. */
      beginFlightDeck();
      dom.screenStart.classList.add('leaving');
      window.setTimeout(function () {
        dom.screenStart.hidden = true;
        dom.btnPlay.disabled = false;
      }, 600);
    }, 130);
  }

  /* The opening state is set up BEFORE the takeoff plays, so the chart
     the cinematic hands over to is already built and correct underneath
     it. That is what makes the handoff a reveal instead of a cut — and
     it is also why the intro can be skipped at any point without
     landing the player in a half-assembled game. */
  function beginFlightDeck() {
    dom.stage.classList.remove('intro-land');
    gameState.coordinateMode = false;
    gameState.tutorialStep = -1;
    Grid.showPermanentNumbers(false);
    Grid.setLetter('x', false);
    Grid.setLetter('y', false);
    Grid.showQuadrants(null);
    /* the axes are NOT hidden here. They are permanent furniture now,
       and the whole chart is held back by the cinematic's stage state
       anyway — so hiding them only created a frame where they could
       pop in behind the handover. */
    Grid.setStage(1, false);

    function toGame() {
      dom.stage.dataset.screen = 'playing';
      UI.playDockEntry();                  /* slide-up, once per session */
      loadLevel(0);
    }

    if (!CG.Arrival) { toGame(); return; } /* the game still runs without it */
    gameState.screen = 'intro';
    dom.stage.dataset.screen = 'intro';
    CG.Arrival.run().then(toGame);
  }

  function playAgain() {
    CG.Voice.cancel();
    cancelBrief();
    if (CG.Lesson) CG.Lesson.cancel();
    dom.stage.classList.remove('intro-land');
    hideOriginTap();
    dom.screenComplete.hidden = true;
    UI.showMission(true);
    UI.showDock(true);
    gameState.coordinateMode = false;
    gameState.tutorialStep = -1;
    /* the flown-route markers are the whole run's history, so they clear
       here and nowhere else */
    gameState.reached = [];
    Grid.showPermanentNumbers(false);
    Grid.setLetter('x', false);
    Grid.setLetter('y', false);
    Grid.highlightAxis(null);
    Grid.highlightOrigin(false);
    Grid.hideOriginLabel();
    Grid.showQuadrants(null);
    Grid.clearLesson();
    Grid.clearPing();
    Grid.setStage(1, false);
    syncPlaneScale();
    loadLevel(0);
  }

  /* ============================================================
     RESPONSIVE STAGE
     ============================================================ */
  function fitStage() {
    var w = window.innerWidth, h = window.innerHeight;
    var s = Math.min(w / 1920, h / 1080);
    dom.stage.style.setProperty('--s', s);
    dom.rotateHint.hidden = !(w < 640 && h > w);
  }

  /* ============================================================
     ASSET PRELOAD
     ============================================================ */
  /* The asset list and the image-only preloader that used to live here
     are gone: js/preload.js owns fetching now, weights the bar by real
     byte counts, and swaps each asset to a blob so that "loaded" means
     local. Its size table is generated by tools/sizes.py. */

  /* ============================================================
     KEYBOARD
     ============================================================ */
  var KEYMAP = {
    ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down'
  };

  function onKeyDown(ev) {
    if (gameState.screen === 'loading') return;
    /* MUTE COMES FIRST, before every screen guard below. The icon
       button it replaced worked on every screen, and the two screens
       the guards would have excluded — the introduction and the
       completion card — are the two where the music is loudest and
       least wanted. During a cinematic the capture-phase handler gets
       the key first and skips the cinematic, which ends its audio
       anyway, so nothing is lost there either. */
    if (ev.key === 'm' || ev.key === 'M') {
      ev.preventDefault();
      if (handlers.onSoundToggle) handlers.onSoundToggle();
      return;
    }
    /* THE PERFORMANCE TIER, OVERRIDABLE. The probe decides at boot (see
       probeFrameRate) and it can be wrong in both directions — a machine
       busy with something else during the cinematic gets demoted, and a
       machine that coped with a cinematic can still struggle later. P
       flips it either way. It is sat here with mute, above the screen
       guards, because a game that has started stuttering is exactly when
       someone reaches for it. Nothing is remembered between sessions:
       the probe runs fresh each load. */
    if (ev.key === 'p' || ev.key === 'P') {
      ev.preventDefault();
      var lite = dom.stage.classList.toggle('perf-lite');
      console.info('[perf] lite mode ' + (lite ? 'on' : 'off') + ' (P)');
      return;
    }
    if (gameState.screen === 'start') {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); startGame(); }
      return;
    }
    /* both cinematics have their own capture-phase handler: any key
       skips them, and none may reach the stepper underneath */
    if (gameState.screen === 'intro' || gameState.screen === 'approach') return;
    if (gameState.screen === 'complete') return;
    var tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT') return;
    /* RESET, which the icon button used to do. Unlike mute it belongs
       down here behind the guards: there is nothing to reset on the
       introduction screen or the completion card, and a reset during a
       teaching sequence is already refused by the handler itself. */
    if (ev.key === 'r' || ev.key === 'R') {
      ev.preventDefault();
      if (handlers.onReset) handlers.onReset();
      return;
    }
    if (KEYMAP[ev.key]) {
      var dir = KEYMAP[ev.key];
      if ((level().controls || []).indexOf(dir) === -1) return;
      ev.preventDefault();
      updateControls(dir, ev.shiftKey ? -1 : +1);
      return;
    }
    if (ev.key === ' ' && tag !== 'BUTTON') {
      ev.preventDefault();
      if (!gameState.inputLocked) onGo();
    }
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    dom.stage = document.getElementById('stage');
    dom.planeHolder = document.getElementById('planeHolder');
    dom.planeSpin = document.getElementById('planeSpin');
    dom.plane = document.getElementById('plane');
    dom.screenStart = document.getElementById('screenStart');
    dom.screenComplete = document.getElementById('screenComplete');
    dom.btnPlay = document.getElementById('btnPlay');
    dom.btnPlayAgain = document.getElementById('btnPlayAgain');
    dom.rotateHint = document.getElementById('rotateHint');
    dom.originTap = document.getElementById('originTap');

    Grid.build();
    /* Re-place the aircraft on every frame of a stage change: it is an
       HTML element outside the chart's SVG, so it does not inherit the
       chart transform and would otherwise hold stale pixels while the
       plane unfolds beneath it. */
    Grid.onViewChange(function () {
      if (gameState.animationState === 'flying') return;   /* the flight owns it */
      setAircraftPosition(gameState.aircraft.x, gameState.aircraft.y, false);
      syncPlaneScale();
    });
    handlers = {
      onStep: updateControls,
      onGo: onGo,
      onReset: function () {
        /* teaching sequences are not interruptible by reset */
        if (gameState.screen === 'reveal' || gameState.screen === 'complete') return;
        resetLevel();
      },
      onCoordChange: function () { refreshGo(); onLearnerInteraction('coord'); },
      onSoundToggle: function () {
        var on = !CG.Audio.isEnabled();
        CG.Audio.setEnabled(on);       /* SFX  */
        CG.Voice.setEnabled(on);       /* + voice-over — one control */
        if (on) Audio.play('uiClick');
        /* Muting mid-brief kills the line the controls are waiting on.
           Silence is the learner's choice, but it must not cost them
           the dock — so the brief ends here rather than on its
           backstop. */
        if (!on && gameState.tutorialStep >= 0) finishTutorial();
      }
    };
    UI.init(handlers);

    syncPlaneScale();
    setAircraftPosition(0, 0, false);
    setHeading(0);
    UI.setLevelPill(1, LEVELS.length);

    /* The pointer drives the press directly, so the button is already
       down while the finger is still on it; startGame() then holds that
       same state through the click. Keyboard START gets it from the
       click handler alone, which is the whole of its gesture. */
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      dom.btnPlay.addEventListener(ev, function () {
        dom.btnPlay.classList.remove('pressed');
      });
    });
    dom.btnPlay.addEventListener('pointerdown', function () {
      if (!dom.btnPlay.disabled) dom.btnPlay.classList.add('pressed');
    });
    dom.btnPlay.addEventListener('click', startGame);
    dom.btnPlayAgain.addEventListener('click', playAgain);
    window.addEventListener('resize', fitStage);
    window.addEventListener('orientationchange', fitStage);
    window.addEventListener('keydown', onKeyDown);
    fitStage();

    /* THE ORDER IS THE PDF'S: loading, then the aircraft's approach,
       then the introduction, then the game.

       FLOW §E asks for the environment to materialise AROUND the
       aircraft — so the environment cannot already be on screen while
       the assets load, and neither can the title artwork, which is a
       picture of that environment. The gauge therefore sits on a bare
       stage, and each screen is shown exactly once. (This supersedes an
       earlier instruction to have the title art up early in the load:
       the two cannot both be true.) */
    dom.stage.dataset.screen = 'loading';
    gameState.screen = 'loading';

    var gauge = document.getElementById('loadGauge');
    var fill  = document.getElementById('loadGaugeFill');
    /* The gauge shows the progress and says nothing. The number is still
       reported, but only to aria-valuenow — it is for assistive tech,
       not for the screen. */
    var show = function (pct) {
      var v = Math.max(0, Math.min(100, pct));
      if (fill) fill.style.width = v.toFixed(1) + '%';
      if (gauge) gauge.setAttribute('aria-valuenow', String(Math.round(v)));
    };

    CG.Preload.run(show).then(function (res) {
      show(100);
      if (res.missing.indexOf('assets/start%20screen.webp') !== -1) {
        dom.screenStart.classList.add('art-missing');
      }
      if (res.missing.length) {
        console.warn('[assets] ' + res.missing.length + ' asset(s) could not be fetched; ' +
                     'the game runs on their original URLs: ' + res.missing.join(', '));
      }
      runApproach();
    });

    /* ---- §4: stop compositing when nobody is looking ----------------
       The water, caustics, glint and surf animate for the whole life of
       the page, and each one is a composited layer the GPU holds a
       texture for. There is no state in which they are unwanted while
       the page is visible — but a backgrounded tab is exactly that
       state, and browsers do not always stop CSS animations in one.
       Pausing them and dropping will-change hands the memory back. */
    document.addEventListener('visibilitychange', function () {
      dom.stage.classList.toggle('page-idle', document.hidden);
    });

    /* ---- §3: the button can never be withheld for ever --------------
       CG.Preload already treats every failure, stall and abort as done,
       so its promise is meant to settle no matter what. This is the
       backstop for the case that reasoning is wrong: after the hard cap
       every transfer is bounded by, plus a margin, the button is
       revealed regardless. A player must never be left looking at a bar
       that has stopped. */
    window.setTimeout(function () {
      if (bootReleased) return;
      console.warn('[preload] watchdog fired at ' + Math.round(CG.Preload.pct()) +
                   '% — releasing Play anyway');
      releaseBoot();
    }, 75000);

    /* expose for console debugging / level tweaking */
    CG.state = gameState;
    CG.loadLevel = loadLevel;
    /* the same narrow surface loadLevel is exposed on: it lets the
       direct-co-ordinate finale be entered without playing eight
       missions and a lesson arc first */
    CG.startDirectMode = startDirectMode;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
