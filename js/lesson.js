/* ===========================================================================
   CO-ORDINATE GEOMETRY — the lesson arc
   ---------------------------------------------------------------------------
   The flight missions in game.js are arc 1: PLAY. This file is arcs 2 and 3.

     arc 2  DISCOVER   the recap of what the learner just did, then the names:
                       x-axis, y-axis, origin, perpendicular, co-ordinate
                       plane, and the co-ordinates of a point built one
                       number at a time — (2, ) before (2, 3).
     arc 3  APPLY      the four quadrants discovered by tapping rather than
                       announced, their sign patterns, and the quadrant CFU.

   The final aircraft CFU is NOT here: it is the 9th entry in CG.LEVELS, so
   it reuses the real flight machinery, the real dock and the real
   attempt-based feedback rather than a copy of them.

   Everything stays inside the game world. The ocean, the panel, the grid and
   the aircraft never go away; only the dock steps aside.
   ========================================================================= */
(function () {
  'use strict';

  var CG = window.CG = window.CG || {};
  var Grid, UI, Audio, Voice, CFG;

  var token = 0;          /* cancels a sequence if the learner restarts */
  var gate = null;        /* resolve fn for whatever we are waiting on   */

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function alive(tk) { return tk === token; }

  /* Waits for the learner to do something. Resolves with whatever the
     interaction hands back. */
  function waitForAction() {
    return new Promise(function (resolve) { gate = resolve; });
  }
  function release(v) {
    var g = gate; gate = null;
    if (g) g(v);
  }

  /* ---- a single narrated beat ---------------------------------------- */
  function say(tk, opts) {
    if (!alive(tk)) return Promise.resolve(false);
    UI.mission({
      text: opts.text,
      sub: opts.sub || '',
      voice: opts.voice || stripTags(opts.text),
      animate: 'words'
    });
    return wait(opts.beat || CFG.beatMed).then(function () { return alive(tk); });
  }

  function stripTags(html) {
    return String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  function coordText(p) { return '(' + p.x + ', ' + p.y + ')'; }

  /* THREE of the learner's own destinations, spread across the
     quadrants they visited rather than the first three in the list —
     re-flying (3,2) then (5,4) then (-2,4) would be three journeys that
     all look the same. Whatever they actually reached is what is used;
     nothing is invented. */
  function pickDemos(reached) {
    var pts = (reached || []).filter(function (p) { return p && (p.x || p.y); });
    if (pts.length <= 3) return pts.slice();
    var seen = {}, out = [];
    pts.forEach(function (p) {
      var q = (p.x >= 0 ? 1 : 0) * 2 + (p.y >= 0 ? 1 : 0);
      if (!seen[q]) { seen[q] = 1; out.push(p); }
    });
    while (out.length < 3) {
      var p = pts[out.length];
      if (out.indexOf(p) === -1) out.push(p); else break;
    }
    return out.slice(0, 3);
  }

  /* =====================================================================
     ARC 2 — DISCOVER
     ===================================================================== */

  async function discover(tk, reached) {
    /* --- 20. leave the controls behind, keep the world ---------------- */
    UI.showDock(false);
    Grid.setTarget(null);
    Grid.clearPath(); Grid.clearReveal(); Grid.clearFx(); Grid.clearHint();
    Grid.clearLesson();
    Grid.setStage(4, true);
    Grid.showAxes(false);
    Grid.showPermanentNumbers(false);
    await wait(700); if (!alive(tk)) return false;

    if (!await say(tk, { text: 'Let’s see what we discovered.', beat: CFG.beatMed })) return false;

    /* --- 21. FLOW 32 — RE-FLY THREE OF THEM, BEFORE ANY EXPLANATION.
       The learner has just spent eight missions doing this; the recap
       has to remind them of the DOING before it starts naming things.
       So three of the places they actually reached are flown again from
       the origin, fast, with the numbers suppressed — the shape of the
       journey is the point here, not the counting. Their own routes,
       not invented ones: `reached` is what they flew. */
    var demo = pickDemos(reached);
    if (demo.length) {
      UI.mission({
        text: 'Here is where you took them.',
        voice: 'Here is where you took them.', animate: 'words'
      });
      for (var d = 0; d < demo.length; d++) {
        Grid.setTarget(demo[d]);
        if (!await CG.demoFlight(demo[d].x, demo[d].y)) return false;
        if (!alive(tk)) return false;
        Grid.plotPoint(demo[d].x, demo[d].y, { cls: 'plot-lesson' });
        Audio.play('reached');
        await wait(420); if (!alive(tk)) return false;
      }
      Grid.setTarget(null);
      CG.demoHome();
      await wait(360); if (!alive(tk)) return false;
    }

    /* and now the whole set, as markers */
    Grid.clearLesson();
    Grid.showRecapMarkers(reached);
    Audio.play('reveal');
    if (!await say(tk, {
      /* FLOW 33 says FOUR directions, and it is right to: the learner
         pressed RIGHT, LEFT, UP and DOWN. The pairing into two axes is
         the next two lines' job, not this one's. */
      text: 'You used four directions to locate every aircraft.',
      beat: CFG.beatLong
    })) return false;

    /* --- 22/23. pair them, without naming the axes yet ------------- */
    Grid.showAxes(true);
    Grid.highlightAxis('x');
    if (!await say(tk, { text: 'Either you moved left and right.', beat: CFG.beatMed })) return false;

    Grid.highlightAxis('y');
    if (!await say(tk, { text: 'Or you moved up and down.', beat: CFG.beatMed })) return false;

    Grid.highlightAxis(null);
    Grid.clearRecapMarkers();
    Grid.showPermanentNumbers(true);
    if (!await say(tk, { text: 'Now these two lines have special names.', beat: CFG.beatMed })) return false;

    /* --- 25/26. x-axis, then y-axis ---------------------------------- */
    Grid.highlightAxis('x'); Grid.setLetter('x', true); Audio.play('reveal');
    if (!await say(tk, {
      text: 'The horizontal line you used to move left and right is the <em>x-axis</em>.',
      beat: CFG.beatLong
    })) return false;

    Grid.highlightAxis('y'); Grid.setLetter('y', true); Audio.play('reveal');
    if (!await say(tk, {
      text: 'The vertical line you used to move up and down is the <em>y-axis</em>.',
      beat: CFG.beatLong
    })) return false;

    /* --- 27/28. the learner finds the origin themselves -------------- */
    Grid.highlightAxis(null);
    Grid.pingPoint(0, 0);
    UI.mission({ text: 'Tap where the two axes meet.',
                 voice: 'Tap where the two axes meet.', animate: 'words' });
    /* the intersection is made tappable but never labelled beforehand */
    CG.originTap(function () { release(true); });
    await waitForAction(); if (!alive(tk)) return false;

    Grid.clearPing();
    Grid.highlightOrigin(true);
    Grid.showOriginLabel('(0, 0)');
    Audio.play('reveal');
    if (!await say(tk, { text: 'That point is the <em>origin</em>.', beat: CFG.beatMed })) return false;

    /* --- 29. right angle, then the word for it ----------------------- */
    Grid.showRightAngle(true);
    if (!await say(tk, { text: 'The axes meet at a right angle.', beat: CFG.beatMed })) return false;
    if (!await say(tk, { text: 'So, the axes are <em>perpendicular</em>.', beat: CFG.beatMed })) return false;

    /* --- 30. the whole structure ------------------------------------- */
    Grid.showRightAngle(false);
    Grid.highlightOrigin(false);
    if (!await say(tk, {
      text: 'Together, they form the <em>co-ordinate plane</em>.', beat: CFG.beatLong
    })) return false;

    /* --- 31. label the plane ----------------------------------------- */
    if (!await dragActivity(tk, {
      prompt: 'Drag each label to the correct position.',
      zones: [
        { key: 'xaxis',  x: 8,  y: 0.9, lead: { x: 8, y: 0 } },
        { key: 'yaxis',  x: -4, y: 5.2, lead: { x: 0, y: 4.6 } },
        { key: 'origin', x: 4,  y: 2.2, lead: { x: 0, y: 0 } }
      ],
      chips: [
        { key: 'xaxis',  label: 'x-axis' },
        { key: 'yaxis',  label: 'y-axis' },
        { key: 'origin', label: 'Origin' }
      ]
    })) return false;

    Grid.hideOriginLabel();
    return await locatePoint(tk);
  }

  /* ---------------------------------------------------------------------
     Steps 32–39: the co-ordinates of a point, built one number at a time.
     ------------------------------------------------------------------- */
  async function locatePoint(tk) {
    var P = { x: 2, y: 3 };
    Grid.clearLesson();
    Grid.plotPoint(P.x, P.y, { cls: 'plot-lesson' });
    if (!await say(tk, { text: 'Now, let’s locate a point.', beat: CFG.beatShort })) return false;
    if (!await say(tk, { text: 'We need two numbers to locate a point.', beat: CFG.beatMed })) return false;

    /* --- the first number ------------------------------------------- */
    if (!await say(tk, { text: 'First, move along the <em>x-axis</em>.', beat: CFG.beatShort })) return false;
    Grid.measure('x', P.x, P.y);
    Grid.pulseLine('x', P.x);          /* the line that number names */
    Grid.markLeg('x', P.x);            /* and the units it counted    */
    Audio.play('reveal');
    if (!await say(tk, {
      text: 'The point is <em>2</em> units to the right.', beat: CFG.beatMed
    })) return false;

    /* the tag is deliberately incomplete — (2, ) before (2, 3) */
    tagAt(P, '(2,  )');
    if (!await say(tk, { text: 'So, the first number is <em>2</em>.', beat: CFG.beatMed })) return false;

    /* --- the second number ------------------------------------------ */
    if (!await say(tk, { text: 'Now move along the <em>y-axis</em>.', beat: CFG.beatShort })) return false;
    Grid.measure('y', P.x, P.y);
    Grid.pulseLine('y', P.y);
    Grid.markLeg('y', P.y, P.x);
    Audio.play('reveal');
    if (!await say(tk, { text: 'The point is <em>3</em> units up.', beat: CFG.beatMed })) return false;

    Grid.clearPulseLines();
    Grid.clearRoutePoints();
    tagAt(P, '(2, 3)');
    Audio.play('reveal');
    if (!await say(tk, { text: 'So, the second number is <em>3</em>.', beat: CFG.beatMed })) return false;
    if (!await say(tk, {
      text: 'The location of the point is <span class="coord">(2, 3)</span>.', beat: CFG.beatLong
    })) return false;

    /* --- 37/38. formalise each co-ordinate -------------------------- */
    tagAt(P, '(2, 3)', 'x');
    Grid.pulseLine('x', P.x);
    if (!await say(tk, { text: 'The first number gives the <em>x-co-ordinate</em>.', beat: CFG.beatMed })) return false;
    if (!await say(tk, {
      text: 'The x-co-ordinate is the distance of the point from the <em>y-axis</em>.',
      beat: CFG.beatLong
    })) return false;

    tagAt(P, '(2, 3)', 'y');
    Grid.pulseLine('y', P.y);
    if (!await say(tk, { text: 'The second number gives the <em>y-co-ordinate</em>.', beat: CFG.beatMed })) return false;
    if (!await say(tk, {
      text: 'The y-co-ordinate is the distance of the point from the <em>x-axis</em>.',
      beat: CFG.beatLong
    })) return false;

    /* --- 39. the order ---------------------------------------------- */
    Grid.clearPulseLines();
    tagAt(P, '(2, 3)', 'both');
    if (!await say(tk, {
      text: 'We write the co-ordinates of a point in the order <span class="coord">(x, y)</span>.',
      beat: CFG.beatLong
    })) return false;

    /* --- 40. the drag challenge, in three quadrants ------------------ */
    var trials = [
      { p: { x: 4,  y: 2  } },
      { p: { x: -3, y: 3  } },
      { p: { x: 3,  y: -2 } }
    ];
    for (var i = 0; i < trials.length; i++) {
      if (!await coordDrag(tk, trials[i].p)) return false;
    }
    return await quadrants(tk);
  }

  function tagAt(P, text, emph) {
    var sx = Grid.stageX(P.x), sy = Grid.stageY(P.y);
    UI.coordTag(sx + 116, sy - 74, text, 'Location');
    UI.emphasiseCoord(emph || null);
  }

  /* one "drag each label to the correct co-ordinate" trial ------------- */
  async function coordDrag(tk, P) {
    Grid.clearLesson();
    UI.hideCoordTag();
    Grid.plotPoint(P.x, P.y, { cls: 'plot-lesson', label: coordText(P) });
    var above = P.y >= 0;
    return await dragActivity(tk, {
      prompt: 'Drag each label to the correct co-ordinate.',
      zones: [
        { key: 'xc', x: P.x + (P.x >= 0 ? 3.2 : -3.2), y: P.y + (above ? 2.1 : -1.2),
          lead: { x: P.x, y: P.y } },
        { key: 'yc', x: P.x + (P.x >= 0 ? 3.2 : -3.2), y: P.y + (above ? 0.5 : -2.8),
          lead: { x: P.x, y: P.y } }
      ],
      chips: [
        { key: 'xc', label: 'x-co-ordinate' },
        { key: 'yc', label: 'y-co-ordinate' }
      ],
      answer: { xc: String(P.x), yc: String(P.y) }
    });
  }

  /* ---------------------------------------------------------------------
     A drag activity with the PDF's three-tier feedback:
       correct            "Yay! That's correct."
       first incorrect    "Not quite. Try again."
       second incorrect   "The first number is the x-co-ordinate, and the
                           second number is the y-co-ordinate. Try again."
     ------------------------------------------------------------------- */
  async function dragActivity(tk, spec) {
    Grid.dropZones(spec.zones);
    var placed = {}, wrongs = 0;
    var keys = spec.chips.map(function (c) { return c.key; });

    UI.mission({ text: spec.prompt, voice: stripTags(spec.prompt), animate: 'words' });

    UI.dragTray(spec.chips, spec.zones.map(function (z) { return z.key; }),
      function (chipKey, zoneKey) {
        if (placed[zoneKey]) return;
        if (chipKey === zoneKey) {
          placed[zoneKey] = true;
          var label = spec.answer ? spec.answer[zoneKey]
                                  : chipLabel(spec.chips, chipKey);
          Grid.fillDropZone(zoneKey, label, true);
          UI.chipDone(chipKey);
          Audio.play('reveal');
          if (Object.keys(placed).length === keys.length) release(true);
        } else {
          wrongs++;
          Grid.fillDropZone(zoneKey, '', false);
          UI.chipWrong(chipKey);
          Audio.play('incorrect');
          /* FLOW 50 / 55 — attempt 1 is "try again", attempt 2 names
             the two numbers. Each activity can supply its own second
             line, because "the first number is the x-co-ordinate" is
             the right scaffold when the learner is labelling numbers
             and the wrong one when they are placing points. */
          var h2  = spec.hint2 ||
            'The first number is the <em>x-co-ordinate</em>, and the second number is the <em>y-co-ordinate</em>. Try again.';
          var h2v = spec.hint2Voice ||
            'The first number is the x co-ordinate, and the second number is the y co-ordinate. Try again.';
          UI.mission({
            text:  wrongs === 1 ? 'Not quite. Try again.' : h2,
            voice: wrongs === 1 ? 'Not quite. Try again.' : h2v,
            animate: 'words'
          });
        }
      });

    await waitForAction(); if (!alive(tk)) return false;
    UI.clearDragTray();
    if (!await say(tk, { text: 'Yay! That’s correct.', beat: CFG.beatShort })) return false;
    Grid.clearDropZones();
    return true;
  }

  function chipLabel(chips, key) {
    for (var i = 0; i < chips.length; i++) if (chips[i].key === key) return chips[i].label;
    return '';
  }

  /* =====================================================================
     ARC 3 — APPLY: the quadrants, discovered by tapping
     ===================================================================== */

  var QUAD = [
    { q: 1, roman: 'Quadrant I',   signs: '(+, +)', pts: [{ x: 3, y: 4 }, { x: 1, y: 2 }],
      words: 'positive, and the y-co-ordinate is positive' },
    { q: 2, roman: 'Quadrant II',  signs: '(−, +)', pts: [{ x: -3, y: 4 }, { x: -1, y: 2 }],
      words: 'negative, and the y-co-ordinate is positive' },
    { q: 3, roman: 'Quadrant III', signs: '(−, −)', pts: [{ x: -3, y: -4 }, { x: -1, y: -2 }],
      words: 'negative, and the y-co-ordinate is negative' },
    { q: 4, roman: 'Quadrant IV',  signs: '(+, −)', pts: [{ x: 3, y: -4 }, { x: 1, y: -2 }],
      words: 'positive, and the y-co-ordinate is negative' }
  ];

  async function quadrants(tk) {
    Grid.clearLesson();
    UI.hideCoordTag();
    if (!await say(tk, {
      text: 'The axes split the plane into four regions.', beat: CFG.beatMed
    })) return false;

    for (var i = 0; i < QUAD.length; i++) {
      if (!await oneQuadrant(tk, QUAD[i])) return false;
    }
    /* FLOW 54 — put the sign patterns to work before the CFU asks for
       them cold: four coordinates, dragged onto their own points. */
    if (!await pointDrag(tk)) return false;
    return await quadrantCFU(tk);
  }

  async function oneQuadrant(tk, spec) {
    Grid.clearPoints();
    Grid.showRegions(spec.q, null);

    for (var n = 0; n < spec.pts.length; n++) {
      var first = n === 0;
      UI.mission({
        text: first ? 'Tap any point in this region.' : 'Now tap another point in this region.',
        voice: first ? 'Tap any point in this region.' : 'Now tap another point in this region.',
        animate: 'words'
      });
      Grid.showTapPoints(spec.q, function (x, y) { release({ x: x, y: y }); });
      var picked = await waitForAction(); if (!alive(tk)) return false;
      Grid.clearTapPoints();

      Grid.plotPoint(picked.x, picked.y, { cls: 'plot-lesson', label: coordText(picked) });
      Audio.play('reveal');
      if (!await say(tk, {
        text: (first ? 'The x-co-ordinate is ' : 'Here too, the x-co-ordinate is ') +
              signWord(picked.x) + ', and the y-co-ordinate is ' + signWord(picked.y) + '.',
        beat: CFG.beatMed
      })) return false;
    }

    /* only now is the region named */
    Grid.showRegionLabel(spec.q, spec.roman);
    Audio.play('reveal');
    if (!await say(tk, { text: 'This region is <em>' + spec.roman + '</em>.', beat: CFG.beatMed })) return false;

    Grid.showRegionLabel(spec.q, spec.roman, spec.signs);
    if (!await say(tk, {
      text: 'So, points in this quadrant have the sign pattern <span class="coord">' +
            spec.signs + '</span>.',
      voice: 'So, points in this quadrant have the sign pattern ' + spokenSigns(spec.signs) + '.',
      beat: CFG.beatLong
    })) return false;

    Grid.clearPoints();
    Grid.showRegions(null);
    return true;
  }

  function signWord(v) { return v < 0 ? 'negative' : 'positive'; }
  function spokenSigns(s) {
    return s.replace('(', '').replace(')', '')
            .replace(/−/g, 'negative').replace(/\+/g, 'positive')
            .replace(',', ' ');
  }

  /* ---- CFU 1: which quadrant does (-4,-1) belong to? ----------------- */
  async function quadrantCFU(tk) {
    Grid.clearLesson();
    var SIGNAL = { x: -4, y: -1 }, ANSWER = 3;
    Grid.showRegionLabels(QUAD.map(function (s) {
      return { q: s.q, roman: s.roman, signs: s.signs };
    }));

    /* The regions stay live the whole time. An earlier version re-armed
       them only after the feedback beat, which silently swallowed a
       learner's second tap if they answered quickly. */
    var attempt = 0, resolved = false;
    UI.mission({
      text: 'A signal appears at <span class="coord">(−4, −1)</span>. Tap the quadrant where it belongs.',
      voice: 'A signal appears at negative four, negative one. Tap the quadrant where it belongs.',
      animate: 'words'
    });

    Grid.showRegions('all', function (q) {
      if (resolved) return;
      if (q === ANSWER) { resolved = true; release(q); return; }
      attempt++;
      Grid.flashRegion(q, false);
      Audio.play('incorrect');
      UI.mission({
        text: attempt === 1
          ? 'Not quite. Check the signs.'
          : 'Both signs are negative. Find <span class="coord">(−, −)</span>.',
        voice: attempt === 1
          ? 'Not quite. Check the signs.'
          : 'Both signs are negative. Find negative, negative.',
        animate: 'words'
      });
    });

    await waitForAction(); if (!alive(tk)) return false;

    Grid.flashRegion(ANSWER, true);
    Audio.play('success');
    Grid.plotPoint(SIGNAL.x, SIGNAL.y, { cls: 'plot-lesson', label: coordText(SIGNAL) });
    Grid.showRegions(null);
    if (!await say(tk, {
      text: 'Yes! The signal is in <em>Quadrant III</em>.', beat: CFG.beatMed
    })) return false;
    Grid.clearLesson();
    return true;
  }

  /* =====================================================================
     FLOW 54 / 55 — DRAG FOUR POINTS ONTO THE PLANE

     The four coordinates are the PDF's own, so they are not in a
     practice config: they are the source of truth for this activity.
     The drop targets are grid points rather than label slots, which is
     what pointZones gives us, and the chips carry the coordinate text
     so matching a chip to a zone IS the exercise.
     ===================================================================== */
  var POINT_DRAG = [
    { x: -4, y:  3 },
    { x:  3, y:  1 },
    { x:  2, y: -1 },
    { x: -1, y: -2 }
  ];

  async function pointDrag(tk) {
    Grid.clearLesson();
    UI.hideCoordTag();
    /* the quadrant names and sign patterns stay up: the learner has just
       discovered them, and this activity is where they get used */
    Grid.showRegionLabels(QUAD.map(function (sg) {
      return { q: sg.q, roman: sg.roman, signs: sg.signs };
    }));

    var zones = POINT_DRAG.map(function (p) {
      return { key: coordText(p), x: p.x, y: p.y, point: true };
    });
    /* dragTray reads `label`, not `text` — chipLabel() does too */
    var chips = POINT_DRAG.map(function (p) {
      return { key: coordText(p), label: coordText(p) };
    });

    return await dragActivity(tk, {
      prompt: 'Drag each point to its correct position.',
      zones: zones,
      chips: shuffle(chips),
      /* the caption that lands in the zone is the coordinate itself */
      answer: zones.reduce(function (a, z) { a[z.key] = z.key; return a; }, {}),
      /* FLOW 55's second-attempt scaffold: name the two numbers rather
         than repeat "try again" */
      hint2: 'Read the first number along the <em>x-axis</em>, then the second up the <em>y-axis</em>.',
      hint2Voice: 'Read the first number along the x-axis, then the second up the y-axis.'
    });
  }

  /* so the cards are not already in reading order */
  function shuffle(a) {
    var out = a.slice(), i, j, t;
    for (i = out.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /* =====================================================================
     public surface
     ===================================================================== */
  function run(reached) {
    Grid = CG.Grid; UI = CG.UI; Audio = CG.Audio; Voice = CG.Voice; CFG = CG.CONFIG;
    var tk = ++token;
    return discover(tk, reached).then(function (ok) {
      if (!ok) return false;
      Grid.clearLesson();
      UI.hideCoordTag();
      return true;
    });
  }

  function cancel() { token++; release(null); UI && UI.clearDragTray && UI.clearDragTray(); }

  CG.Lesson = { run: run, cancel: cancel };
}());
