/* ============================================================
   THE SCRIPT  —  Air Traffic Control-4.pdf, VERBATIM
   ------------------------------------------------------------
   EVERY WORD THE GAME SAYS OR SHOWS IS IN THIS FILE, AND EVERY
   WORD IN THIS FILE IS COPIED FROM THE PDF.

   The brief was explicit: "use only the voice over who mention in
   this do not join your side". So this file is the contract, and
   the test suite asserts the other way round too — that no string
   reaches the learner unless it appears here. Nothing is written
   in lesson.js or game.js any more; they only choose WHEN a beat
   plays and WHAT the chart does while it plays.

   `p` is the PDF page each line came from, so any line on screen
   can be traced back to the source in one step.

   ---- ON `voice` ----------------------------------------------
   Page 12 says "Add these as Voice overs", so the on-screen line
   IS the spoken line. `voice` appears only where the written form
   contains a symbol a speech engine would mangle — (2, 3), (−, −),
   (+,+) — and it is a literal reading of those same words, never a
   different sentence. Where the text is plain, there is no `voice`
   field at all and the text is spoken as written.
   ============================================================ */
window.CG = window.CG || {};

/* ---- 1. THE OPENING (p1) ---------------------------------- */
CG.SCRIPT_START = {
  p: 1,
  text: 'You are the air traffic controller. Guide each aircraft to its target.',
  button: 'START'
};

/* ---- 2. EVERY MISSION (p2) -------------------------------- */
CG.SCRIPT_MISSION = { p: 2, text: 'Guide the aircraft to the target.' };

/* ---- 3. ARRIVAL (p11) ------------------------------------- */
CG.SCRIPT_REACHED = {
  p: 11,
  text: 'Target reached!',
  callout: 'Location'            /* the chip beside it carries (x,y) */
};

/* ---- 4. THE ROUTE REPLAY, AFTER EVERY TARGET (p12) --------
   "Once the target is reached, we can show again, how the aircraft
   moved from origin." — and the PDF marks both lines as voice
   overs, with the units highlighted as each is spoken. The numbers
   are substituted per mission; the sentences are not. */
CG.SCRIPT_REPLAY = [
  { p: 12, text: 'First, we moved {n} spaces horizontally.', highlight: 'x' },
  { p: 12, text: 'Then, we moved {n} spaces vertically.',    highlight: 'y' }
];

/* ---- 5. INCORRECT FEEDBACK (p13) --------------------------
   "Whatever numbers are selected, the plane will go to the selected
   position." The PDF gives no words for these two beats — only what
   to DISPLAY — so there are none here, and the game shows arrows
   rather than saying anything. */
CG.SCRIPT_WRONG = [
  { p: 13, show: 'arrows' },                 /* 1st: arrows, try again */
  { p: 13, show: 'arrows+counts' }           /* 2nd: arrows + units above each */
];

/* ---- 6. THE RECAP AND THE CONCEPT (p15-p56) --------------- */
CG.SCRIPT_LESSON = [
  { p: 15, text: 'Let’s see what we discovered' },

  /* p16: three points demonstrated from the origin, x first then y.
     The PDF gives no line for this beat, so nothing is spoken. */
  { p: 16, show: 'demo3' },

  /* p17: the whole plane, no text */
  { p: 17, show: 'plane' },

  { p: 18, text: 'We used four directions to locate every aircraft.' },
  { p: 19, text: 'Either we moved left and right.',  show: 'axis-x' },
  { p: 20, text: 'Or we moved up and down.',         show: 'axis-y' },
  { p: 21, text: 'To know exactly how much we moved…' },

  /* p22: the numbers appear on both axes. The page's title is a
     stray "z" — a placeholder, not a line — so nothing is spoken. */
  { p: 22, show: 'numbers' },

  { p: 23, text: 'The horizontal line is called the x-axis.', show: 'name-x' },
  { p: 24, text: 'The vertical line is called the y-axis.',   show: 'name-y' },
  { p: 25, text: 'Tap where the two axes meet.',              interact: 'tap-origin' },
  { p: 26, text: 'This point is the origin.',                 show: 'origin' },
  { p: 27, text: 'The axes are perpendicular to each other.', show: 'right-angle' },
  { p: 28, text: 'Together, they form the coordinate plane.' },
  { p: 29, text: 'Drag each label to the correct position.',
           interact: 'drag-labels', chips: ['x-axis', 'y-axis', 'Origin'] },

  { p: 30, text: 'Now, let’s locate a point.',                show: 'point-2-3' },
  { p: 31, text: 'The point is 2 units to the right.',        show: 'arrow-x' },
  /* p32/p33 are visual only: the "2 units" measure, then the (2, ) chip */
  { p: 32, show: 'measure-x' },
  { p: 33, show: 'chip-x' },
  { p: 34, text: 'The point is 3 units up.',                  show: 'arrow-y' },
  /* p35/p36 are visual only: the "3 units" measure, then (2, 3) */
  { p: 35, show: 'measure-y' },
  { p: 36, show: 'chip-xy' },
  { p: 37, text: 'So, the location of the point is (2,3).',
           voice: 'So, the location of the point is two, three.' },
  { p: 38, text: 'The first number is the x-coordinate.',     show: 'label-x' },
  { p: 39, text: 'It is the distance of the point from the y-axis.' },
  { p: 40, text: 'The second number is the y-coordinate.',    show: 'label-y' },
  { p: 41, text: 'It is the distance of the point from the x-axis.' },
  { p: 42, text: 'So, we write the coordinates of a point in the order (x, y).',
           voice: 'So, we write the coordinates of a point in the order x, y.' },
  { p: 43, text: 'Drag each label to the correct coordinate.',
           interact: 'drag-coords', point: { x: 4, y: 2 },
           chips: ['x-coordinate', 'y-coordinate'] },
  /* p44: "then we give another point in quadrant 2 and then in
     quadrant 4" — the same drag, twice more */
  { p: 44, interact: 'drag-coords', point: { x: -3, y: 2 },
           chips: ['x-coordinate', 'y-coordinate'] },
  { p: 44, interact: 'drag-coords', point: { x: 3, y: -2 },
           chips: ['x-coordinate', 'y-coordinate'] },

  { p: 45, text: 'The axes split the plane into four regions.', show: 'regions' },
  { p: 46, text: 'These regions are called quadrants.',         show: 'quadrant-names' },

  /* p47-p51 for quadrant I, then p52: "Similarly show for the other
     3 quadrants in a similar way." The two sentences are the PDF's;
     only the numeral and the two signs change, which is what "in a
     similar way" instructs. */
  { p: 47, text: 'Tap any point in this region.', interact: 'tap-region', q: 1 },
  { p: 48, text: 'x-coordinate: {sx}, y-coordinate: {sy}.' },
  { p: 49, text: 'Now tap another point in this region.', interact: 'tap-region', q: 1 },
  { p: 50, text: 'x-coordinate: {sx}, y-coordinate: {sy}.' },
  { p: 51, text: 'So, quadrant {roman} have the sign pattern ({px},{py}).',
           voice: 'So, quadrant {spoken} have the sign pattern {psx}, {psy}.',
           show: 'quadrant-only' },

  { p: 53, text: 'Drag each point to its correct position.',
           interact: 'drag-points',
           points: [{ x: -4, y: 3 }, { x: 3, y: 1 }, { x: 2, y: -1 }, { x: -1, y: -2 }] },

  { p: 55, text: 'A signal appears at (−4, −1). Tap the quadrant where it belongs.',
           voice: 'A signal appears at negative four, negative one. Tap the quadrant where it belongs.',
           interact: 'tap-quadrant', answer: 3 },

  /* p59 — the handover into the final activity */
  { p: 59, text: 'You’re ready. Guide the aircraft to its position.' }
];

/* ---- 7. FEEDBACK, WORD FOR WORD --------------------------- */
/* the drag/label activities (p44, p54) */
CG.SCRIPT_FB_LABEL = {
  p: 44,
  correct: 'Yay! That’s correct.',
  first:   'Not quite. Try again.',
  /* p44 second attempt gives an ACTION, not a line: "In a point
     highlight one by one and tell labelling x-coordinate,
     y-coordinate." So the second miss walks the labels instead. */
  second:  null, secondShow: 'label-one-by-one'
};
/* the quadrant tap (p56) */
CG.SCRIPT_FB_QUADRANT = {
  p: 56,
  correct: 'Yes! The signal is in Quadrant III.',
  first:   'Not quite. Check the signs.',
  second:  'Both signs are negative. Find (−, −).',
  secondVoice: 'Both signs are negative. Find negative, negative.'
};
/* the CFU flight (p58) */
CG.SCRIPT_FB_CFU = {
  p: 58,
  correct: 'Perfect! You reached (2, −3).',
  correctVoice: 'Perfect! You reached two, negative three.',
  first:  'Not quite. Try again!',
  second: 'First find x. Then move to y.'
};
/* the direct-entry flights (p61) */
CG.SCRIPT_FB_DIRECT = {
  p: 61,
  correct: 'Perfect landing!'
  /* "Incorrect: The aircraft reach the selected point, wobble/flash
     red for a moment, then automatically fly back to the starting
     position. At the same time, the correct target point can pulse
     once subtly on the grid." — an action, no words, so none here. */
};

/* ---- 8. THE CFU AND THE FINAL ACTIVITY (p57, p60) --------- */
CG.SCRIPT_CFU = {
  p: 57,
  text: 'The target is (2, −3). Move the aircraft to its position.',
  voice: 'The target is two, negative three. Move the aircraft to its position.',
  target: { x: 2, y: -3 }
};
/* p60: two steppers with a comma between them and GO; the grid runs
   x -7..7 and y -4..4, aircraft parked on the origin. p61: "Then
   again the same flow repeat with different points." */
CG.SCRIPT_DIRECT = {
  p: 60,
  extent: { xMin: -7, xMax: 7, yMin: -4, yMax: 4 },
  targets: [{ x: -5, y: 3 }, { x: 4, y: -3 }, { x: -6, y: -2 }, { x: 6, y: 2 }]
};

/* ---- 9. THE WHOLE VOCABULARY, FOR THE TESTS ---------------
   Every literal the learner can be shown or told. The suite asserts
   that nothing outside this set ever reaches UI.mission() or
   CG.Voice.say(), which is what enforces "only what is in the PDF". */
CG.SCRIPT_ALL = (function () {
  var out = [], seen = {};
  function add(s) {
    if (typeof s !== 'string' || !s) return;
    if (!seen[s]) { seen[s] = 1; out.push(s); }
  }
  add(CG.SCRIPT_START.text);
  add(CG.SCRIPT_MISSION.text);
  add(CG.SCRIPT_REACHED.text);
  add(CG.SCRIPT_REACHED.callout);
  CG.SCRIPT_REPLAY.forEach(function (b) { add(b.text); });
  CG.SCRIPT_LESSON.forEach(function (b) { add(b.text); add(b.voice); });
  [CG.SCRIPT_FB_LABEL, CG.SCRIPT_FB_QUADRANT, CG.SCRIPT_FB_CFU, CG.SCRIPT_FB_DIRECT]
    .forEach(function (f) { add(f.correct); add(f.correctVoice); add(f.first);
                            add(f.second); add(f.secondVoice); });
  add(CG.SCRIPT_CFU.text); add(CG.SCRIPT_CFU.voice);
  return out;
})();
