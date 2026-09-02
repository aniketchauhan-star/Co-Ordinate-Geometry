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
  /* Both horizontal controls are usable from mission 1, so every stage
     has to chart x -5..+5 at least — otherwise the aircraft would fly
     into blank, unmapped ocean. The plane therefore no longer unfolds
     sideways; what still unfolds is the airspace BELOW the origin, which
     is where the negative-y idea actually lives.
     1 -> 2 widens the charted width; 2 -> 3 opens up below. */
  1: { cell: 119, origin: { x: 781, y: 770 }, extent: { xMin: -6,  xMax: 9,  yMin: -1, yMax: 5 } },
  2: { cell: 99,  origin: { x: 960, y: 730 }, extent: { xMin: -9,  xMax: 9,  yMin: -1, yMax: 5 } },
  3: { cell: 68,  origin: { x: 960, y: 498 }, extent: { xMin: -13, xMax: 13, yMin: -6, yMax: 5 } },
  4: { cell: 64,  origin: { x: 960, y: 532 }, extent: { xMin: -14, xMax: 14, yMin: -6, yMax: 6 } }
};

/* ============================================================
   MISSIONS — the PDF's target sequence, in order.
   Movement first; the words come after the learner has flown it.
   ============================================================ */
/* Both horizontal controls are shown AND usable in every mission, so
   choosing "right" is a real choice rather than the only option, and the
   dock keeps a constant width instead of shifting GO around. The vertical
   pair still follows the quadrant being taught: up while the plane is
   above the origin, down once it opens below.

   `controls` is both the visible and the usable set. It drives the dock,
   the keyboard, and the geometry audit that proves every destination the
   learner can select stays on the charted area. */
CG.LEVELS = [
  /* ---------- FIRST QUADRANT : right + up ---------- */
  {
    quadrant: 1, target: { x: 3, y: 2 }, controls: ['right', 'left', 'up'],
    mission: 'Guide the aircraft to the target.',
    tutorial: true,
    coordinateReveal: true          /* FLOW 10 — the "X = 3, Y = 2" moment */
  },
  {
    quadrant: 1, target: { x: 5, y: 4 }, controls: ['right', 'left', 'up'],
    mission: 'Guide the aircraft to the target.'
  },

  /* ---------- SECOND QUADRANT : left + up ---------- */
  {
    quadrant: 2, target: { x: -2, y: 4 }, controls: ['right', 'left', 'up'],
    mission: 'Guide the aircraft to the target.',
    unlockNote: 'The airspace now extends to the left.',
    unlockVoice: 'Now the airspace extends to the left.',
    signLesson: 'Moving left gives negative horizontal values.'
  },
  {
    quadrant: 2, target: { x: -5, y: 2 }, controls: ['right', 'left', 'up'],
    mission: 'Guide the aircraft to the target.'
  },

  /* ---------- THIRD QUADRANT : left + down ---------- */
  {
    quadrant: 3, target: { x: -4, y: -2 }, controls: ['right', 'left', 'down'],
    mission: 'Guide the aircraft to the target.',
    unlockNote: 'The airspace now extends below the origin.',
    unlockVoice: 'Now the airspace extends below the origin.',
    signLesson: 'Moving left gives a negative X value. Moving down gives a negative Y value.'
  },
  {
    quadrant: 3, target: { x: -5, y: -3 }, controls: ['right', 'left', 'down'],
    mission: 'Guide the aircraft to the target.'
  },

  /* ---------- FOURTH QUADRANT : right + down ---------- */
  {
    quadrant: 4, target: { x: 4, y: -5 }, controls: ['right', 'left', 'down'],
    mission: 'Guide the aircraft to the target.',
    unlockNote: 'The last part of the airspace is open.',
    unlockVoice: 'Use right and down to reach the target.',
    signLesson: 'Moving right keeps X positive. Moving down makes Y negative.'
  },
  {
    quadrant: 4, target: { x: 3, y: -3 }, controls: ['right', 'left', 'down'],
    mission: 'Guide the aircraft to the target.',
    conceptRevealAfter: true        /* "Let's see what we discovered" */
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
  turnMs: 200,         /* extra time granted to the corner transition   */
  accelFraction: 0.18, /* share of the flight spent easing in / out     */
  cornerCells: 0.42,   /* corner rounding radius, in cells              */
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
