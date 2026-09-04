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
     top ............. 118px  (10.9% )  the question banner ends at 111
     bottom .......... 916px  (dock top 944 - 28px gap)

   The coordinate plane UNFOLDS across four stages (one per
   quadrant introduced). Each stage re-centres the origin and
   picks a cell size so the charted area still fills that box —
   so the grid is never a small card, and the learner watches the
   plane grow outwards exactly as the PDF flow describes.

   Within a stage nothing moves: cell size and origin are fixed
   for the whole mission.
   ============================================================ */
/* y=118: the artwork is an 8.091:1 banner standing only 107px tall at
   its 900px width, so the chart starts higher than it ever has. This
   slot has taken three artworks at three aspects — 3.68, 4.92, 8.09 —
   and each time this one number and the four rows below it were
   re-derived from the new one. Move the banner's width and it moves. */
CG.CHART = { rect: { x: 64, y: 118, w: 1792, h: 798 } };

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
     (1792 x 798):

       stage 1   cell 116  ->   696 x 696    36 cells
       stage 2   cell 116  ->  1392 x 696    72 cells — the SAME cell,
                                             so it is a pure sideways
                                             unfold with no zoom at all
       stage 3   cell  73  ->   730 x 730   100 cells  -- SQUARE
       stage 5   cell  73  ->  1022 x 730   140 cells  -- RECTANGLE
                                             (page 60's final activity)

     NONE OF THOSE NUMBERS IS CHOSEN; THEY ARE ALL DERIVED. The play box
     is 1792 x 756 because the question-template banner occupies y 4..154
     and the dock's clearance fixes the bottom at 916. Each cell is then
     the largest that fits its own shape with the panel's margin intact:

       stages 1 and 2 are 6 cells tall below an origin at y=870, so
         6c <= 870 - 118 - 38  ->  c = 116  (here the DOCK is binding,
                                    not the banner: 119 would fit)
       stage 3 is 10 cells tall inside the whole box, so
         10c <= 798 - 2*34     ->  c = 73

     and stage 1's origin x is 960 - 3c, which is what keeps its square
     panel centred. If the banner's width ever changes, re-deriving
     these four lines is the whole job — and the tests assert the
     results, not the arithmetic.

     Stage 3 takes pad 30 rather than 38 on purpose: 38 would cost it a
     whole cell step (56 instead of 58), and 30 still clears the origin
     beacon's ring, which is what the margin exists for.

     THE SHAPES COME FROM THE DECK, NOT FROM TASTE.

     Air Traffic Control-4.pdf draws the discovery section — pages 17
     through 57 — on a 10 x 10 plane labelled -4..4 on both axes. Every
     one of those forty slides uses that same square. Page 60, the final
     activity, is the one and only rectangle: x labelled -7..7 against y
     labelled -4..4.

     So stage 3/4 is the square and stage 5 is the rectangle, and the
     brief to "expand sideways, making it rectangular" is satisfied by
     the deck's own design rather than by widening the lesson.

     This also fixed a review comment. An earlier pass had stage 3 at
     x -11..11 by y -8..8 — 22 x 16 cells — which forced the cell down
     to 45px. The axis numerals live inside the chart's scale, so at
     that size they rendered around 11 screen px and the reviewer wrote
     "numbers are very small in size" twice. The deck's 10 x 10 puts the
     cell back to 73.
     --------------------------------------------------------------------- */
  1: { cell: 116, origin: { x: 612, y: 870 }, extent: { xMin: 0,   xMax: 6,  yMin: 0,  yMax: 6 } },
  2: { cell: 116, origin: { x: 960, y: 870 }, extent: { xMin: -6,  xMax: 6,  yMin: 0,  yMax: 6 } },
  3: { cell: 73,  origin: { x: 960, y: 517 }, extent: { xMin: -5,  xMax: 5,  yMin: -5, yMax: 5 },
       /* the deck numbers only -4..4 here, leaving the outer row bare */
       labels: { xMin: -4, xMax: 4, yMin: -4, yMax: 4 } },
  /* quadrant IV opens no new airspace beyond stage 3, so it shares the
     geometry and nothing lurches. */
  4: { cell: 73,  origin: { x: 960, y: 517 }, extent: { xMin: -5,  xMax: 5,  yMin: -5, yMax: 5 },
       labels: { xMin: -4, xMax: 4, yMin: -4, yMax: 4 } },
  /* STAGE 5 IS PAGE 60's PLANE, and it is the only rectangle in the
     deck: x runs -7..7 while y stays -5..5, which is why the final
     activity's chart is visibly wider than the lesson's. It shares the
     lesson's cell and origin, so switching to it is a pure sideways
     unfold with no zoom — the same trick as stage 1 -> 2. */
  5: { cell: 73,  origin: { x: 960, y: 517 }, extent: { xMin: -7,  xMax: 7,  yMin: -5, yMax: 5 },
       /* page 60 numbers x all the way to 7, y still only to 4 */
       labels: { xMin: -7, xMax: 7, yMin: -4, yMax: 4 } }
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
/* WHICH BUTTONS ARE LIVE, AND A DELIBERATE DEPARTURE FROM PAGE 14.
   The deck names exactly two buttons per quadrant — Left and Up for
   quadrant II, Left and Down for III, Right and Down for IV. That is
   right for quadrant I, where only right and up lead anywhere on a
   chart that has nothing to the left or below. It stops being right the
   moment the plane opens out: from quadrant II on, every direction is a
   legal move, and greying two of them teaches a restriction the
   mathematics does not have.

   So quadrant I arms right and up, and everything after it arms all
   four. Asked for directly: "in 1st quadrant left and down button
   desable gray and when we reach 2nd quadrant then enable all the
   buttons."

   THE WORDS ARE NOT HERE. Every line the learner sees or hears is
   in js/script.js, copied from the PDF; these rows carry only the
   geometry and which two buttons the PDF names for each quadrant
   (p2 and p14). That is what keeps the script auditable. */
CG.LEVELS = [
  /* ---------- FIRST QUADRANT : right + up ---------- */
  {
    quadrant: 1, target: { x: 3, y: 2 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'up'],
    tutorial: true,
    coordinateReveal: true          /* FLOW 10 — the "X = 3, Y = 2" moment */
  },
  {
    quadrant: 1, target: { x: 5, y: 4 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'up'],
  },

  /* ---------- SECOND QUADRANT : left + up ---------- */
  {
    quadrant: 2, target: { x: -2, y: 4 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'left', 'up', 'down'],
  },
  {
    quadrant: 2, target: { x: -5, y: 2 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'left', 'up', 'down'],
  },

  /* ---------- THIRD QUADRANT : left + down ---------- */
  {
    quadrant: 3, target: { x: -4, y: -2 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'left', 'up', 'down'],
  },
  {
    quadrant: 3, target: { x: -5, y: -3 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'left', 'up', 'down'],
  },

  /* ---------- FOURTH QUADRANT : right + down ---------- */
  {
    quadrant: 4, target: { x: 4, y: -5 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'left', 'up', 'down'],
  },
  {
    quadrant: 4, target: { x: 3, y: -3 },
    visible: ['right', 'left', 'up', 'down'], controls: ['right', 'left', 'up', 'down'],
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
    showTargetCoord: true,
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
/* p60 puts the first target at (-5, 3) on a plane running x -7..7 and
   y -4..4; p61 says "the same flow repeat with different points", so the
   rest are free but must fit that plane. Held in js/script.js with the
   rest of the PDF and mirrored here. */
CG.DIRECT_TARGETS = (CG.SCRIPT_DIRECT && CG.SCRIPT_DIRECT.targets) || [
  { x: -5, y:  3 },
  { x:  4, y: -3 },
  { x: -6, y: -2 },
  { x:  6, y:  2 }
];

/* the signed range the X and Y steppers travel through */
/* p60's plane is WIDER THAN IT IS TALL: x runs -7..7 and y runs -4..4,
   so the two steppers do not share one limit. They did (both 6), which
   let the learner dial a y the chart cannot show. */
CG.DIRECT_RANGE = { x: 7, y: 4 };
CG.DIRECT_RANGE_OF = function (dir) {
  var r = CG.DIRECT_RANGE;
  return typeof r === 'number' ? r : (r[dir] || r.x);
};

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

  /* THE HAND WAITS TEN SECONDS, AND COMES ONCE.
     Five was too eager: a learner reading the question, or counting
     squares with a finger on the screen, is not stuck — and the hand
     arrived mid-thought. Ten seconds of complete stillness is a real
     stall. It is also capped at one appearance per mission (see
     idleHintShown in game.js), because a hand that returns every ten
     seconds stops reading as help and starts reading as a nag. */
  idleHintDelay: 10000,
  idleHintPerMission: 1
};
