/* ============================================================
   levels.js — all tunable content lives here.
   Edit freely: the engine reads this data, nothing is hardcoded
   inside the UI or animation logic.
   ============================================================ */
window.CG = window.CG || {};

/* ============================================================
   CHART GEOMETRY

   The navigation field always fills the play area between the
   mission strip and the control dock:

     left / right ....  64px  ( 3.3% )
     top ............. 148px  (13.7% )
     bottom .......... 916px  (dock top 944 - 28px gap)

   The coordinate plane UNFOLDS across four stages (one per
   quadrant introduced). Each stage re-centres the origin and
   picks a cell size so the charted area still fills that box —
   so the grid is never a small card, and the learner watches the
   plane grow outwards exactly as the PDF flow describes.

   Within a stage nothing moves: cell size and origin are fixed
   for the whole mission.
   ============================================================ */
CG.CHART = { rect: { x: 64, y: 148, w: 1792, h: 768 } };

CG.STAGES = {
  /* ---------------------------------------------------------------------
     THE PLANE UNFOLDS IN THREE SHAPES

       stage 1   quadrant I only        7 x 7   cells   ->  SQUARE
       stage 2   quadrants I + II      12 x 7   cells   ->  RECTANGLE
       stage 3   all four quadrants    12 x 12  cells   ->  SQUARE

     The shapes are not decoration: if quadrant I is an N x N square then
     I + II is necessarily 2N x N, and all four is 2N x 2N. The learner
     watches the same plane grow, and the shape itself says how much of
     the plane exists.

     Cells are always square (one `cell` value for both axes), and each
     stage takes the largest cell its shape allows inside the play box
     (1792 x 768):

       stage 1   cell 116  ->   696 x 696   SQUARE
       stage 2   cell 116  ->  1392 x 696   exactly 2:1, and the SAME
                                            cell: a pure sideways unfold
                                            with no zoom at all
       stage 3   cell  59  ->   708 x 708   SQUARE again; the one zoom

     In stage 1 the origin sits ON the grid's bottom-left corner, so the
     aircraft starts in the corner of its own airspace the way the PDF
     shows it. That is what fixes stage 1's cell size: the aircraft at
     (0,0) hangs half its body below the origin, and it has to clear the
     control dock at y=940. 116 is the largest cell that does, while
     still leaving 26px for the panel edge on every side.

     When quadrant II unfolds the origin slides to the bottom CENTRE —
     the new airspace is all to the left — and only when the plane opens
     downwards does it move up to the middle.

     So 1 -> 2 is motion without scale, and 2 -> 3 is the one zoom in the
     whole game. The origin stays put from 1 to 2 (804) and only moves
     when the airspace opens below it (787 -> 532).
     --------------------------------------------------------------------- */
  1: { cell: 116, origin: { x: 612, y: 870 }, extent: { xMin: 0,  xMax: 6, yMin: 0,  yMax: 6 } },
  2: { cell: 116, origin: { x: 960, y: 870 }, extent: { xMin: -6, xMax: 6, yMin: 0,  yMax: 6 } },
  3: { cell: 59,  origin: { x: 960, y: 532 }, extent: { xMin: -6, xMax: 6, yMin: -6, yMax: 6 } },
  /* quadrant IV opens no new airspace beyond stage 3 — x and y already
     span both signs — so it shares the geometry and nothing lurches. */
  4: { cell: 59,  origin: { x: 960, y: 532 }, extent: { xMin: -6, xMax: 6, yMin: -6, yMax: 6 } }
};

/* ============================================================
   MISSIONS — the PDF's target sequence, in order.
   Movement first; the words come after the learner has flown it.
   ============================================================ */
/* All four direction controls are on screen in every mission, so the dock
   never changes width and the learner can see the whole system from the
   start. What changes is which of them are ARMED, and that follows the
   airspace: a direction is only usable once the plane extends that way.
   Flying left in stage 1 would send the aircraft into unmapped ocean, so
   LEFT waits until quadrant II unfolds, and DOWN until quadrants III/IV.

     `visible`   what the dock draws        (constant: all four)
     `controls`  what the learner can use   (grows with the plane)

   `controls` drives the keyboard and the geometry audit, which proves
   every destination the learner can select stays on the charted area. */
CG.LEVELS = [
  /* ---------- FIRST QUADRANT : right + up ---------- */
  {
    quadrant: 1, target: { x: 3, y: 2 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'up'],
    mission: 'Guide the aircraft to the target.',
    tutorial: true,
    coordinateReveal: true          /* FLOW 10 — the "X = 3, Y = 2" moment */
  },
  {
    quadrant: 1, target: { x: 5, y: 4 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'up'],
    mission: 'Guide the aircraft to the target.'
  },

  /* ---------- SECOND QUADRANT : left + up ---------- */
  {
    quadrant: 2, target: { x: -2, y: 4 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'left', 'up'],
    mission: 'Guide the aircraft to the target.',
    unlockNote: 'The airspace now extends to the left.',
    unlockVoice: 'Now the airspace extends to the left.',
    signLesson: 'Moving left gives negative horizontal values.'
  },
  {
    quadrant: 2, target: { x: -5, y: 2 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'left', 'up'],
    mission: 'Guide the aircraft to the target.'
  },

  /* ---------- THIRD QUADRANT : left + down ---------- */
  {
    quadrant: 3, target: { x: -4, y: -2 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'left', 'up', 'down'],
    mission: 'Guide the aircraft to the target.',
    unlockNote: 'The airspace now extends below the origin.',
    unlockVoice: 'Now the airspace extends below the origin.',
    signLesson: 'Moving left gives a negative X value. Moving down gives a negative Y value.'
  },
  {
    quadrant: 3, target: { x: -5, y: -3 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'left', 'up', 'down'],
    mission: 'Guide the aircraft to the target.'
  },

  /* ---------- FOURTH QUADRANT : right + down ---------- */
  {
    quadrant: 4, target: { x: 4, y: -5 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'left', 'up', 'down'],
    mission: 'Guide the aircraft to the target.',
    unlockNote: 'The last part of the airspace is open.',
    unlockVoice: 'Use right and down to reach the target.',
    signLesson: 'Moving right keeps X positive. Moving down makes Y negative.'
  },
  {
    quadrant: 4, target: { x: 3, y: -3 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'left', 'up', 'down'],
    mission: 'Guide the aircraft to the target.'
  },

  /* ---- CFU 3 (PDF p58) ------------------------------------------------
     The final check. It comes AFTER the lesson arc, so the learner is
     told the co-ordinate outright and has to work out the route — the
     inverse of every mission before it, where they had a target on the
     chart and discovered the numbers. Its feedback is the PDF's own. */
  {
    quadrant: 4, target: { x: 2, y: -3 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'left', 'up', 'down'],
    cfu: true,
    lessonBefore: true,
    mission: 'The target is (2, −3). Move the aircraft to its position.',
    voice: 'The target is two, negative three. Move the aircraft to its position.',
    showTargetCoord: true,
    feedback: {
      correct: 'Perfect! You reached (2, −3).',
      correctVoice: 'Perfect! You reached two, negative three.',
      first: 'Not quite. Try again!',
      second: 'First find x. Then move to y.'
    }
  }
];

/* Direction metadata used to build the control dock. */
CG.DIRECTIONS = [
  { key: 'right', label: 'RIGHT', axis: 'x', sign: +1, glyph: 'M8 4l9 8-9 8z' },
  { key: 'left',  label: 'LEFT',  axis: 'x', sign: -1, glyph: 'M16 4l-9 8 9 8z' },
  { key: 'up',    label: 'UP',    axis: 'y', sign: +1, glyph: 'M12 4l8 9H4z' },
  { key: 'down',  label: 'DOWN',  axis: 'y', sign: -1, glyph: 'M12 20l8-9H4z' }
];

CG.CONFIG = {
  maxStep: 5,          /* highest value a single direction stepper can reach */

  /* --- flight: one continuous timeline (see animateAircraft) ---
     Deliberately unhurried: the learner has to be able to watch the
     aircraft cross each grid line and read the number as it appears. */
  cellDuration: 640,   /* ms of travel per grid cell, at cruise speed   */
  accelFraction: 0.18, /* share of the flight spent easing in / out     */
  pivotMs: 420,        /* pause-and-turn on the corner point, in ms.
                          The aircraft stops dead on the corner, rotates
                          through 90 degrees, then sets off again — so the
                          horizontal count and the vertical count read as
                          two separate movements rather than one sweep. */
  rotateMs: 360,       /* time to swing onto the first heading          */
  dotSpacing: 0.12,    /* flight-path dot every N cells travelled       */
  puffSpacing: 0.55,   /* contrail puff every N cells travelled         */

  /* --- pacing of the button-free flow ---
     Every teaching line waits one of these beats. They are the single
     place to speed the whole game up or slow it down. */
  beatShort: 2300,
  beatMed: 3500,
  beatLong: 4800,
  arrivalBeat: 1600,   /* pause between landing and naming the location */
  retryDelay: 3200,    /* wait before the aircraft glides home to retry */
  quadrantBeat: 9500,  /* the four sign patterns need reading time      */

  idleHintDelay: 7000  /* ms of inactivity before the hand nudge appears */
};
