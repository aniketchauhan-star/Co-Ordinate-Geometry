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
    controls: { right: 0, left: 0, up: 0, down: 0 },
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

  var animToken = 0;              /* bumped to cancel an in-flight sequence */
  var seqToken = 0;               /* bumped to cancel a teaching sequence   */
  var idleTimer = null;
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

  /* park the aircraft on a heading with the eased CSS transition */
  function setHeading(deg) {
    dom.planeSpin.classList.remove('free');
    applyHeading(unwrap(gameState.heading, deg));
  }

  function calculateSelectedCoordinate() {
    var c = gameState.controls;
    return { x: c.right - c.left, y: c.up - c.down };
  }

  /* FLOW 02: the target always glows — it is the thing to fly to */
  function refreshTargetGlow(force) {
    Grid.highlightTarget(force === undefined ? true : !!force);
  }

  function refreshGo() {
    if (gameState.inputLocked) { UI.setGoEnabled(false); return; }
    var c = gameState.controls;
    UI.setGoEnabled((c.right + c.left + c.up + c.down) > 0);
  }

  function lockInput(v) {
    gameState.inputLocked = !!v;
    UI.setControlsLocked(!!v);
    refreshGo();
  }

  /* ============================================================
     CONTROLS
     ============================================================ */
  function updateControls(dir, delta) {
    if (gameState.inputLocked) return;
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

    var cellMsNow = reduced ? 180 : CFG.cellDuration;
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

        /* one engine whoosh per grid line crossed */
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
    UI.mission({ text: 'Aircraft is en route…', animate: false, voice: false });

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
    if (gameState.horizontalCorrect && gameState.verticalCorrect) showSuccess(sel);
    else showIncorrect(sel);
  }

  /* ============================================================
     FEEDBACK
     ============================================================ */
  function coordText(p) { return '(' + p.x + ', ' + p.y + ')'; }
  function spoken(p) { return CG.Voice.numWord(p.x) + ', ' + CG.Voice.numWord(p.y); }

  function dirWord(axis, v) {
    if (axis === 'x') return (v > 0 ? 'RIGHT' : 'LEFT');
    return (v > 0 ? 'UP' : 'DOWN');
  }

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
      showComplete();
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

    /* FLOW 10 / PDF p14 — replay the route, one direction at a time, and
       do it after EVERY mission: "First, we moved 3 spaces horizontally.
       Then, we moved 2 spaces vertically." The horizontal run lights up
       on its own first, so each number is tied to one movement. */
    var q;
    Grid.clearReveal();
    for (q = 1; q <= Math.abs(sel.x); q++) Grid.highlightRevealed('x', Math.sign(sel.x) * q, true);
    UI.mission({
      text: 'First, you moved <em>' + Math.abs(sel.x) + '</em> spaces ' + dirWord('x', sel.x) + '.',
      voice: 'First, you moved ' + CG.Voice.numWord(Math.abs(sel.x)) + ' spaces ' +
             dirWord('x', sel.x).toLowerCase() + '.',
      animate: 'words'
    });
    await wait(CFG.beatMed); if (tk !== seqToken) return;

    for (q = 1; q <= Math.abs(sel.y); q++) Grid.highlightRevealed('y', Math.sign(sel.y) * q, true);
    UI.mission({
      text: 'Then, you moved <em>' + Math.abs(sel.y) + '</em> spaces ' + dirWord('y', sel.y) + '.',
      voice: 'Then, you moved ' + CG.Voice.numWord(Math.abs(sel.y)) + ' spaces ' +
             dirWord('y', sel.y).toLowerCase() + '.',
      animate: 'words'
    });
    await wait(CFG.beatLong); if (tk !== seqToken) return;

    /* first success only: the movement is named as X and Y */
    if (level().coordinateReveal) {
      UI.mission({
        text: 'That is <em>' + Math.abs(sel.x) + '</em> spaces across.',
        sub: 'X = ' + sel.x,
        voice: 'The first number tells us the horizontal position. X is ' +
               CG.Voice.numWord(sel.x) + '.',
        animate: 'words'
      });
      await wait(CFG.beatLong); if (tk !== seqToken) return;

      UI.mission({
        text: 'And <em>' + Math.abs(sel.y) + '</em> spaces up.',
        sub: 'Y = ' + sel.y,
        voice: 'The second number tells us the vertical position. Y is ' +
               CG.Voice.numWord(sel.y) + '.',
        animate: 'words'
      });
      await wait(CFG.beatLong); if (tk !== seqToken) return;

      UI.mission({
        text: 'Together: <span class="coord">' + coordText(sel) + '</span>',
        voice: 'Together, that is ' + spoken(sel) + '.',
        animate: 'words'
      });
      await wait(CFG.beatMed); if (tk !== seqToken) return;
    }

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
    setPlaneMood('lost');          /* a slow search sweep, not a telling-off */
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
        var wordX = t.x < 0 ? 'left' : 'right';
        UI.mission({
          text: 'Count the spaces to the ' + wordX + '.',
          voice: 'Count the spaces to the ' + wordX + '.'
        });
      } else {
        Grid.showHint('y', t.y);
        var wordY = t.y < 0 ? 'down' : 'up';
        UI.mission({
          text: 'Right is correct. Now count the spaces ' + wordY + '.',
          voice: 'Now count the spaces ' + wordY + '.'
        });
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

    /* Tutorial missions show a plain grid: the axes are not drawn until
       the concept reveal gives them their names. */
    if (!gameState.coordinateMode) Grid.showAxes(false);

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
    UI.setLevelPill(gameState.levelIndex + 1, LEVELS.length);
    UI.showDock(true);
    UI.showMission(true);

    /* If the tutorial is about to take over it owns the voice line, so
       the level's own line is not spoken and then cut off. */
    var tutorialTakesOver = lv.tutorial && gameState.tutorialStep < 0;
    UI.mission({
      text: lv.mission,
      sub: lv.unlockNote || '',
      voice: tutorialTakesOver ? false
        : lv.unlockVoice ? lv.unlockVoice + ' ' + lv.mission
        : lv.mission
    });
    lockInput(false);

    if (lv.tutorial && gameState.tutorialStep < 0) startTutorial();
  }

  /* Reset: cancels flight safely, never restarts progression. */
  function resetLevel() {
    animToken++; seqToken++; clearAuto();
    Audio.engineStop();
    Audio.duck('flight', false);
    CG.Voice.cancel();
    Grid.clearPath();
    Grid.clearReveal();
    Grid.clearFx();
    Grid.clearHint();
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
    var lv = level();
    UI.mission({ text: lv.mission, sub: '' });
    if (gameState.tutorialStep >= 0) applyTutorialStep(gameState.tutorialStep);
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
    var flown = gameState.reached.filter(function (p) { return !!p; }).slice(0, 4);
    var ok = await CG.Lesson.run(flown);
    if (!ok) return;
    Audio.play('levelTransition');
    UI.showDock(true);
    loadLevel(gameState.levelIndex + 1);
  }

  /* ============================================================
     TUTORIAL (short, progressive, never repeated)
     ============================================================ */
  var TUTORIAL = [
    { text: 'Guide the aircraft to the target.',
      sub: 'That glowing waypoint is its destination.',
      voice: 'Guide the aircraft to the target.',
      highlight: 'target', auto: 3800 },
    { text: 'Choose how many spaces to move RIGHT.',
      voice: 'Choose how many spaces to move right.',
      highlight: 'right', waitFor: 'right' },
    { text: 'Now choose how many spaces to move UP.',
      voice: 'Choose how many spaces to move up.',
      highlight: 'up', waitFor: 'up' },
    { text: 'Ready? Send the aircraft.',
      voice: 'Ready? Send the aircraft.',
      highlight: 'go', waitFor: 'go' }
  ];

  function startTutorial() {
    gameState.screen = 'tutorial';
    gameState.tutorialStep = 0;
    applyTutorialStep(0);
  }

  function applyTutorialStep(i) {
    var step = TUTORIAL[i];
    if (!step) return;

    /* The learner often gets ahead of the narration — they may have set
       RIGHT while step 1 was still on screen. Never ask for something
       that is already done, or the tutorial stalls on a satisfied step. */
    if (step.waitFor && step.waitFor !== 'go' && gameState.controls[step.waitFor] > 0) {
      gameState.tutorialStep = i;
      nextTutorialStep();
      return;
    }

    gameState.tutorialStep = i;
    UI.highlight(step.highlight);
    refreshTargetGlow(step.highlight === 'target' ? true : undefined);
    UI.mission({
      text: step.text,
      sub: step.sub || '',
      voice: step.voice
    });
    clearIdleHint();
    if (step.auto) {
      clearAuto();
      autoTimer = window.setTimeout(function () {
        if (gameState.tutorialStep === i) nextTutorialStep();
      }, step.auto);
    } else if (step.waitFor) {
      armIdleHint(step.waitFor === 'go' ? 'go' : step.waitFor);
    }
  }

  function nextTutorialStep() {
    clearAuto();
    var i = gameState.tutorialStep + 1;
    if (i >= TUTORIAL.length) { finishTutorial(); return; }
    applyTutorialStep(i);
  }

  function finishTutorial() {
    clearAuto(); clearIdleHint();
    CG.Voice.cancel();
    gameState.tutorialStep = -1;
    UI.highlight(null);
    refreshTargetGlow();
  }

  /* the learner did something — advance guidance, drop the nudge */
  function onLearnerInteraction(what) {
    clearIdleHint();
    var step = TUTORIAL[gameState.tutorialStep];
    if (!step || !step.waitFor) return;
    if (step.waitFor === what) nextTutorialStep();
    else armIdleHint(step.waitFor);
  }

  function armIdleHint(what) {
    clearIdleHint();
    if (!what) return;
    idleTimer = window.setTimeout(function () { UI.handAt(what); }, CFG.idleHintDelay);
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

  /* ============================================================
     SCREENS
     ============================================================ */
  function startGame() {
    if (dom.btnPlay.disabled) return;      /* assets are still loading */
    Audio.unlock();
    CG.Voice.unlock();                     /* first real user gesture */
    CG.Voice.setEnabled(CG.Audio.isEnabled());
    Audio.play('uiClick');
    Audio.musicStart();                    /* the bed, from the first gesture */
    /* FLOW 01 — the framing line, spoken over the transition */
    CG.Voice.say('You are the air traffic controller. Guide each aircraft to its target.');
    dom.btnPlay.disabled = true;
    dom.screenStart.classList.add('leaving');
    window.setTimeout(function () {
      dom.screenStart.hidden = true;
      dom.btnPlay.disabled = false;
      dom.stage.dataset.screen = 'playing';
      gameState.coordinateMode = false;
      gameState.tutorialStep = -1;
      Grid.showPermanentNumbers(false);
      Grid.setLetter('x', false);
      Grid.setLetter('y', false);
      Grid.showQuadrants(null);
      Grid.showAxes(false);
      Grid.setStage(1, false);
      UI.playDockEntry();                  /* slide-up, once per session */
      loadLevel(0);
    }, 520);
  }

  function playAgain() {
    CG.Voice.cancel();
    if (CG.Lesson) CG.Lesson.cancel();
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
    Grid.showAxes(false);
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
  var ASSETS = [
    'assets/background.png',
    'assets/mountain.png',
    'assets/airplane.png',
    'assets/start screen.png',
    'assets/start button.png'
  ];

  function preload() {
    var loaded = 0, missing = [];
    var total = ASSETS.length + 1;            /* +1 for the sound effects */
    return new Promise(function (resolve) {
      function tick() {
        loaded++;
        dom.loadFill.style.width = Math.round((loaded / total) * 100) + '%';
        if (loaded === total) resolve(missing);
      }
      Audio.preload().then(tick);
      ASSETS.forEach(function (src) {
        var img = new Image();
        img.onload = tick;
        img.onerror = function () {
          missing.push(src);
          console.warn('[assets] could not load "' + src + '" — using a temporary placeholder.');
          tick();
        };
        img.src = encodeURI(src);
      });
    });
  }

  /* ============================================================
     KEYBOARD
     ============================================================ */
  var KEYMAP = {
    ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down'
  };

  function onKeyDown(ev) {
    if (gameState.screen === 'loading') return;
    if (gameState.screen === 'start') {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); startGame(); }
      return;
    }
    if (gameState.screen === 'complete') return;
    var tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT') return;
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
    dom.screenLoad = document.getElementById('screenLoad');
    dom.screenComplete = document.getElementById('screenComplete');
    dom.btnPlay = document.getElementById('btnPlay');
    dom.btnPlayAgain = document.getElementById('btnPlayAgain');
    dom.loadFill = document.getElementById('loadFill');
    dom.rotateHint = document.getElementById('rotateHint');
    dom.originTap = document.getElementById('originTap');

    Grid.build();
    UI.init({
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
        UI.syncSoundButton();
        if (on) Audio.play('uiClick');
      }
    });

    syncPlaneScale();
    setAircraftPosition(0, 0, false);
    setHeading(0);
    UI.setLevelPill(1, LEVELS.length);

    dom.btnPlay.addEventListener('click', startGame);
    dom.btnPlayAgain.addEventListener('click', playAgain);
    window.addEventListener('resize', fitStage);
    window.addEventListener('orientationchange', fitStage);
    window.addEventListener('keydown', onKeyDown);
    fitStage();

    preload().then(function (missing) {
      if (missing.indexOf('assets/start screen.png') !== -1) {
        dom.screenStart.classList.add('art-missing');
      }
      dom.screenLoad.classList.add('leaving');
      window.setTimeout(function () {
        dom.screenLoad.hidden = true;
        dom.stage.dataset.screen = 'start';
        gameState.screen = 'start';
        dom.btnPlay.disabled = false;      /* only now is Play live */
      }, 420);
    });

    /* expose for console debugging / level tweaking */
    CG.state = gameState;
    CG.loadLevel = loadLevel;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
