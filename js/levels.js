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
     top ............. 160px  (14.8% )  the question banner ends at 154
     bottom .......... 916px  (dock top 944 - 28px gap)

   The coordinate plane UNFOLDS across four stages (one per
   quadrant introduced). Each stage re-centres the origin and
   picks a cell size so the charted area still fills that box —
   so the grid is never a small card, and the learner watches the
   plane grow outwards exactly as the PDF flow describes.

   Within a stage nothing moves: cell size and origin are fixed
   for the whole mission.
   ============================================================ */
/* y=160: the question-template artwork is a 4.923:1 banner and stands
   150px tall at its 760px width, so the chart starts just below it.
   The replaced artwork was 3.68:1 and needed 207px, which had pushed
   this to 212 — the 52px it gave back is why the cells below returned
   to 112. Move the banner's width and this moves with it. */
CG.CHART = { rect: { x: 64, y: 160, w: 1792, h: 756 } };

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
     (1792 x 756):

       stage 1   cell 112  ->   672 x 672    36 cells
       stage 2   cell 112  ->  1344 x 672    72 cells — the SAME cell,
                                             so it is a pure sideways
                                             unfold with no zoom at all
       stage 3   cell  58  ->   696 x 696   144 cells  -- SQUARE

     NONE OF THOSE NUMBERS IS CHOSEN; THEY ARE ALL DERIVED. The play box
     is 1792 x 756 because the question-template banner occupies y 4..154
     and the dock's clearance fixes the bottom at 916. Each cell is then
     the largest that fits its own shape with the panel's margin intact:

       stages 1 and 2 are 6 cells tall below an origin at y=870, so
         6c <= 870 - 160 - 38  ->  c = 112
       stage 3 is 12 cells tall inside the whole box, so
         12c <= 756 - 2*30     ->  c = 58

     and stage 1's origin x is 960 - 3c, which is what keeps its square
     panel centred. If the banner's width ever changes, re-deriving
     these four lines is the whole job — and the tests assert the
     results, not the arithmetic.

     Stage 3 takes pad 30 rather than 38 on purpose: 38 would cost it a
     whole cell step (56 instead of 58), and 30 still clears the origin
     beacon's ring, which is what the margin exists for.

     THE THIRD STAGE IS A SQUARE, AND IT COSTS WIDTH TO BE ONE.

     It used to run x from -14 to 14 and fill the width on the argument
     that a four-quadrant square is bounded by the play box's height and
     would therefore be narrower than stage 2, so the chart would
     visibly shrink at the exact moment the airspace doubles. That
     shrink is real and it is what you now see: the panel goes from
     1420px wide at stage 2 to 756px at stage 3.

     It is the right trade anyway, because the old shape made the two
     axes different lengths — 1624px of x against 696px of y — and this
     is the screen where the lesson finally names them as a matched pair
     of perpendicular lines. A plane whose axes are visibly unequal
     argues against the thing being taught. Equal axes win; the width
     was decoration.

     Reverting is the same one-line change it always was: set stage 3
     and 4 extent back to xMin -14, xMax 14.

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
  1: { cell: 112, origin: { x: 624, y: 870 }, extent: { xMin: 0,   xMax: 6,  yMin: 0,  yMax: 6 } },
  2: { cell: 112, origin: { x: 960, y: 870 }, extent: { xMin: -6,  xMax: 6,  yMin: 0,  yMax: 6 } },
  3: { cell: 58,  origin: { x: 960, y: 538 }, extent: { xMin: -6,  xMax: 6,  yMin: -6, yMax: 6 } },
  /* quadrant IV opens no new airspace beyond stage 3, so it shares the
     geometry and nothing lurches. */
  4: { cell: 58,  origin: { x: 960, y: 538 }, extent: { xMin: -6,  xMax: 6,  yMin: -6, yMax: 6 } }
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
   every destination the learner can select stays on the charted area.

   AND IT IS NOW ACTUALLY USED. Every level used to list all four in
   BOTH lists, which made the split decorative and left two real
   problems on screen: in quadrant I the learner could set LEFT or DOWN
   and send the aircraft off a chart that has no left or down — the
   audit this comment claims exists would have failed — and the dock
   gave no sign that the airspace was going to grow. It grows now, one
   direction at a time, and each one arrives in the mission that needs
   it:

     quadrant I     right, up                 LEFT and DOWN wait
     quadrant II    right, left, up           LEFT arrives with it
     quadrant III   all four                  DOWN arrives with it
     quadrant IV    all four

   `visible` stays all four throughout, so the dock never changes width
   and a direction that is coming is visible as a thing that is coming
   — see the NOT YET state in styles.css. */
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

/* =====================================================================
   FLOW 58-61 — DIRECT CO-ORDINATE MODE

   The finale. The four direction controls come off and are replaced by
   one signed X stepper and one signed Y stepper, so the learner is no
   longer choosing "how far right" — they are entering a co-ordinate.

   THESE TARGET VALUES ARE IMPLEMENTATION EXAMPLES, NOT FROM THE PDF.
   The source specifies the mode and its feedback but names no targets,
   so rather than pretend otherwise they live here, clearly labelled and
   trivially editable. One per quadrant, so the mode exercises all four
   sign patterns the learner has just discovered.                       */
CG.DIRECT_TARGETS = [
  { x:  4, y:  3 },
  { x: -3, y:  2 },
  { x: -2, y: -4 },
  { x:  5, y: -2 }
];

/* the signed range the X and Y steppers travel through */
CG.DIRECT_RANGE = 6;

CG.CONFIG = {
  maxStep: 5,          /* highest value a single direction stepper can reach */

  /* --- flight: one continuous timeline (see animateAircraft) ---
     Deliberately unhurried: the learner has to be able to watch the
     aircraft cross each grid line and read the number as it appears. */
  cellDuration: 760,   /* ms of travel per grid cell, at cruise speed   */
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
     place to speed the whole game up or slow it down.

     SLOWED THROUGHOUT, ON PURPOSE. The whole flow used to run about a
     third quicker, and it was quick for the wrong audience: an adult
     who already knows what a co-ordinate is can follow it, and the
     child it is built for is still reading the first half of a sentence
     when the second one replaces it. A beat here is not dead time — it
     is the time the learner spends looking at the chart the sentence is
     about, which is where the teaching actually happens.

     If it ever needs to move again, move it HERE. Nothing else in the
     game holds a hard-coded pause. */
  beatShort: 3000,
  beatMed: 4600,
  beatLong: 6200,
  arrivalBeat: 2200,   /* pause between landing and naming the location */
  retryDelay: 4000,    /* wait before the aircraft glides home to retry */
  quadrantBeat: 11500, /* the four sign patterns need reading time      */

  idleHintDelay: 5000  /* ms of inactivity before the hand nudge appears */
};
