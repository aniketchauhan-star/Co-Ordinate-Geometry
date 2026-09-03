/* ============================================================
   grid.js — the navigation field: grid, axes, origin beacon,
   target, live flight path and chart effects.

   Pure rendering. It knows geometry, never game rules.

   The coordinate plane UNFOLDS over four stages (CG.STAGES): each
   one re-centres the origin and picks a cell size so the charted
   area keeps filling the play box. Geometry is authored once in
   canonical space and the whole chart is translated + scaled, so
   nothing is ever re-laid out; within a stage it never moves.
   ============================================================ */
window.CG = window.CG || {};

CG.Grid = (function () {
  var NS = 'http://www.w3.org/2000/svg';

  /* canonical space: 1 cell = 100px, origin at (0,0) */
  var CELL = 100;
  var MAX = { xMin: -14, xMax: 14, yMin: -6, yMax: 6 };   /* widest drawable */
  var LAB = { xMin: -10, xMax: 10, yMin: -6, yMax: 6 };   /* numbered range  */

  var el = {};
  var view = { k: 1, px: 960, py: 532 };   /* chart transform, stage px */
  var charted = { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  var stageKey = null;
  var tweenToken = 0;
  var permanentNums = false;

  /* ---------------- helpers ---------------- */
  function mk(tag, attrs, cls) {
    var n = document.createElementNS(NS, tag);
    if (attrs) for (var a in attrs) n.setAttribute(a, attrs[a]);
    if (cls) n.setAttribute('class', cls);
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* canonical coordinates (inside #chart) */
  function toX(x) { return x * CELL; }
  function toY(y) { return -y * CELL; }
  /* absolute stage px — what HTML overlays (aircraft, callouts) need.
     Fractional input is fine: the aircraft flies continuous positions. */
  function stageX(x) { return view.px + view.k * toX(x); }
  function stageY(y) { return view.py + view.k * toY(y); }
  function cellPx() { return view.k * CELL; }
  function scale() { return view.k; }

  function tween(ms, step) {
    var token = ++tweenToken;
    return new Promise(function (resolve) {
      var t0 = performance.now();
      function frame(now) {
        if (token !== tweenToken) return resolve();
        var p = Math.min(1, (now - t0) / ms);
        var e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        step(e);
        if (p < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  /* ---------------- build (once) ---------------- */
  function build() {
    el.svg = document.getElementById('field');
    el.chart = document.getElementById('chart');
    el.lines = document.getElementById('gridLines');
    el.axes = document.getElementById('axes');
    el.ticks = document.getElementById('ticks');
    el.nums = document.getElementById('axisNums');
    el.ends = document.getElementById('axisEnds');
    el.hint = document.getElementById('hintLayer');
    el.path = document.getElementById('pathLayer');
    el.trail = document.getElementById('trailLayer');
    el.reveal = document.getElementById('revealLayer');
    el.markers = document.getElementById('markerLayer');
    el.fx = document.getElementById('fxLayer');
    el.clip = document.getElementById('chartedRect');
    el.regionLayer = document.getElementById('regionLayer');
    el.lessonLayer = document.getElementById('lessonLayer');
    el.field = el.svg;                       /* the <svg>, for pointer-events */
    el.veil = document.getElementById('chartVeil');
    el.panelClip = document.querySelector('#panelClip rect');

    drawLines(el.lines);

    var i, nss = { 'vector-effect': 'non-scaling-stroke' };
    el.axisX = mk('line', Object.assign(
      { x1: toX(MAX.xMin), y1: toY(0), x2: toX(MAX.xMax), y2: toY(0) }, nss));
    el.axisY = mk('line', Object.assign(
      { x1: toX(0), y1: toY(MAX.yMax), x2: toX(0), y2: toY(MAX.yMin) }, nss));
    el.axes.appendChild(el.axisX);
    el.axes.appendChild(el.axisY);

    /* ticks + permanent numbers; numbers stay hidden until the concept
       reveal names them (the grid must not read as graph paper) */
    for (i = LAB.xMin; i <= LAB.xMax; i++) {
      if (i === 0) continue;
      el.ticks.appendChild(mk('line', Object.assign(
        { x1: toX(i), y1: toY(0) - 11, x2: toX(i), y2: toY(0) + 11 }, nss)));
      var tx = mk('text', { x: toX(i), y: toY(0) + 46, 'data-axis': 'x', 'data-v': i }, 'axis-num');
      tx.textContent = String(i);
      el.nums.appendChild(tx);
    }
    for (i = LAB.yMin; i <= LAB.yMax; i++) {
      if (i === 0) continue;
      el.ticks.appendChild(mk('line', Object.assign(
        { x1: toX(0) - 11, y1: toY(i), x2: toX(0) + 11, y2: toY(i) }, nss)));
      var ty = mk('text', { x: toX(0) - 42, y: toY(i), 'data-axis': 'y', 'data-v': i }, 'axis-num');
      ty.textContent = String(i);
      el.nums.appendChild(ty);
    }

    el.arrows = {
      xp: mk('path', { d: 'M0,-13 L26,0 L0,13 Z' }),
      xn: mk('path', { d: 'M0,-13 L-26,0 L0,13 Z' }),
      yp: mk('path', { d: 'M-13,0 L0,-26 L13,0 Z' }),
      yn: mk('path', { d: 'M-13,0 L0,26 L13,0 Z' })
    };
    el.letters = {
      x: mk('text', { 'text-anchor': 'start', 'dominant-baseline': 'middle' }),
      y: mk('text', { 'text-anchor': 'start', 'dominant-baseline': 'middle' })
    };
    el.letters.x.textContent = 'x';
    el.letters.y.textContent = 'y';
    Object.keys(el.arrows).forEach(function (k) { el.ends.appendChild(el.arrows[k]); });
    el.ends.appendChild(el.letters.x);
    el.ends.appendChild(el.letters.y);

    drawOrigin();
    setStage(1, false);
    showAxes(false);          /* tutorial missions show a plain grid */
  }

  /* Every integer line, including 0: during the missions the learner
     sees a plain, even grid of solid white lines. The axes are a separate
     emphasis layer that stays hidden until the concept reveal names
     them. */
  /* Three weights, because the palette carries three: every integer gets
     a minor line, every fifth gets a major one, and the two centre lines
     get the heaviest.

     The centre lines matter before they have names. When quadrant II
     unfolds, the line through the origin becomes the middle of the chart,
     and the learner has to be able to see the plane split in two — so
     x=0 and y=0 are drawn at the major weight from the start, even while
     the #axes layer is still hidden and the words "x-axis" and "y-axis"
     have not been said. Fives earn their weight too: the steppers stop
     at 5, so a route is counted in exactly those blocks. */
  function drawLines(host) {
    var i, nss = { 'vector-effect': 'non-scaling-stroke' };
    var weight = function (n) {
      return n === 0 ? 'grid-centre' : (n % 5 === 0 ? 'grid-major' : null);
    };
    for (i = MAX.xMin; i <= MAX.xMax; i++) {
      host.appendChild(mk('line', Object.assign(
        { x1: toX(i), y1: toY(MAX.yMax), x2: toX(i), y2: toY(MAX.yMin) }, nss),
        weight(i)));
    }
    for (i = MAX.yMin; i <= MAX.yMax; i++) {
      host.appendChild(mk('line', Object.assign(
        { x1: toX(MAX.xMin), y1: toY(i), x2: toX(MAX.xMax), y2: toY(i) }, nss),
        weight(i)));
    }
  }

  /* Axes, ticks and arrowheads are an overlay revealed at concept time. */
  function showAxes(on) {
    [el.axes, el.ticks, el.ends].forEach(function (g) {
      g.classList.toggle('axes-shown', !!on);
    });
  }

  /* ---------------- stage unfolding ---------------- */
  /* The panel is the chart the grid is drawn on, so it tracks the charted
     area rather than sitting at a fixed size: square for quadrant I, a
     rectangle once quadrant II unfolds, square again with all four. Both
     the visible tint and the clip that stops the grid at the rounded
     corner are driven from the same rect, so they can never disagree. */
  var PLAY = { x: 64, y: 148, w: 1792, h: 768 };
  var PANEL_PAD = 26;
  /* canonical px of slack around the charted rect: half the widest line
     (the axes, 3.4 screen px) at the smallest stage scale, rounded up */
  var STROKE_PAD = 6;

  function panelRect(c, v) {
    var l = v.px + toX(c.xMin) * v.k;
    var r = v.px + toX(c.xMax) * v.k;
    var t = v.py + toY(c.yMax) * v.k;
    var b = v.py + toY(c.yMin) * v.k;
    /* One padding value for all four sides, limited by the tightest room
       available. Padding each side independently would let the panel grow
       wider than it is tall and a square grid would sit on an oblong
       panel — the shape of the panel has to say the same thing as the
       shape of the grid. */
    var pad = Math.min(PANEL_PAD,
                       l - PLAY.x, (PLAY.x + PLAY.w) - r,
                       t - PLAY.y, (PLAY.y + PLAY.h) - b);
    if (!(pad > 0)) pad = 0;
    return { x: l - pad, y: t - pad,
             w: Math.max(1, (r - l) + pad * 2),
             h: Math.max(1, (b - t) + pad * 2) };
  }

  function applyPanel(c, v) {
    var p = panelRect(c, v);
    if (el.veil) {
      el.veil.style.left = p.x.toFixed(1) + 'px';
      el.veil.style.top = p.y.toFixed(1) + 'px';
      el.veil.style.width = p.w.toFixed(1) + 'px';
      el.veil.style.height = p.h.toFixed(1) + 'px';
    }
    if (el.panelClip) {
      el.panelClip.setAttribute('x', p.x.toFixed(1));
      el.panelClip.setAttribute('y', p.y.toFixed(1));
      el.panelClip.setAttribute('width', p.w.toFixed(1));
      el.panelClip.setAttribute('height', p.h.toFixed(1));
    }
  }

  var viewWatchers = [];
  function onViewChange(fn) { if (fn) viewWatchers.push(fn); }

  function apply(c, v) {
    view = v;
    el.chart.setAttribute('transform',
      'translate(' + v.px.toFixed(2) + ',' + v.py.toFixed(2) + ') scale(' + v.k.toFixed(5) + ')');
    applyPanel(c, v);

    /* The clip is what makes the plane unfold: nothing outside the
       charted quadrants is drawn at all.

       The pad is only enough to keep the OUTERMOST line's stroke from
       being shaved — it must not spill a partial cell past the last line.
       It used to be 0.42 of a cell, sized for the rounded flight corner
       that no longer exists, which pushed the grid ~17px beyond the panel
       and left the panel's 28px rounding slicing stubs off the corners.
       Whole cells only, entirely inside the plate. */
    var pad = STROKE_PAD;
    el.clip.setAttribute('x', toX(c.xMin) - pad);
    el.clip.setAttribute('y', toY(c.yMax) - pad);
    el.clip.setAttribute('width', (c.xMax - c.xMin) * CELL + pad * 2);
    el.clip.setAttribute('height', (c.yMax - c.yMin) * CELL + pad * 2);

    el.arrows.xp.setAttribute('transform', 'translate(' + (toX(c.xMax) - 4) + ',' + toY(0) + ')');
    el.arrows.xn.setAttribute('transform', 'translate(' + (toX(c.xMin) + 4) + ',' + toY(0) + ')');
    el.arrows.yp.setAttribute('transform', 'translate(' + toX(0) + ',' + (toY(c.yMax) + 4) + ')');
    el.arrows.yn.setAttribute('transform', 'translate(' + toX(0) + ',' + (toY(c.yMin) - 4) + ')');
    el.letters.x.setAttribute('x', toX(c.xMax) - 62);
    el.letters.x.setAttribute('y', toY(0) - 44);
    el.letters.y.setAttribute('x', toX(0) + 40);
    el.letters.y.setAttribute('y', toY(c.yMax) + 54);
    /* an axis only grows an arrowhead once that direction exists */
    el.arrows.xn.style.opacity = c.xMin <= -2 ? 1 : 0;
    el.arrows.yn.style.opacity = c.yMin <= -2 ? 1 : 0;

    /* The aircraft lives outside this SVG, so it does not inherit the
       chart transform. Without this it keeps the pixel position it had
       before the stage changed — which is why it appeared to drift off
       the origin as a quadrant unfolded. */
    for (var w = 0; w < viewWatchers.length; w++) viewWatchers[w]();
  }

  function viewFor(st) {
    return { k: st.cell / CELL, px: st.origin.x, py: st.origin.y };
  }

  /* Unfold to a stage. Animated between missions, never during one. */
  function setStage(key, animate) {
    var st = CG.STAGES[key];
    if (!st) { console.warn('[grid] unknown stage:', key); return Promise.resolve(); }
    if (key === stageKey && charted.xMax) { apply(charted, viewFor(st)); return Promise.resolve(); }

    var toC = st.extent, toV = viewFor(st);
    var fromC = Object.assign({}, charted), fromV = Object.assign({}, view);
    var first = stageKey === null;
    stageKey = key;
    charted = Object.assign({}, toC);

    if (first || !animate) { apply(charted, toV); return Promise.resolve(); }

    /* Two overlapping phases, so it reads as a chart being unrolled
       rather than a box being resized: the view eases across and settles,
       and the new airspace sweeps open behind it while it travels.

       The pan uses a soft ease-out — it leaves quickly and arrives slowly,
       which is what makes it feel like the chart is being drawn open
       rather than snapped to a new size. The unroll trails it and lands
       last, so the final thing the eye sees is the new quadrant
       appearing, not the camera stopping. */
    var lerp = function (a, b, e) { return a + (b - a) * e; };
    var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
    var easeOut = function (v) { return 1 - Math.pow(1 - v, 3); };
    var ease = function (v) { return v < .5 ? 4*v*v*v : 1 - Math.pow(-2*v+2,3)/2; };
    return tween(1260, function (e) {
      var v = easeOut(clamp01(e / 0.70));       /* pan + zoom: 0 -> 70%  */
      var g = ease(clamp01((e - 0.18) / 0.82)); /* unroll:    18% -> 100% */
      apply({
        xMin: lerp(fromC.xMin, toC.xMin, g), xMax: lerp(fromC.xMax, toC.xMax, g),
        yMin: lerp(fromC.yMin, toC.yMin, g), yMax: lerp(fromC.yMax, toC.yMax, g)
      }, {
        k: lerp(fromV.k, toV.k, v), px: lerp(fromV.px, toV.px, v), py: lerp(fromV.py, toV.py, v)
      });
    });
  }

  /* ---------------- "count the spaces" hint (FLOW 13/14) ----------------
     Highlights the distance from the origin to the target along one axis,
     with a pip on every interval — the learner still has to count. */
  function showHint(axis, value) {
    clearHint();
    if (!value) return;
    var n = Math.abs(value), sgn = value < 0 ? -1 : 1, i;
    var g = mk('g', null, 'hint-run');
    if (axis === 'x') {
      g.appendChild(mk('line', { x1: toX(0), y1: toY(0), x2: toX(value), y2: toY(0),
                                 'vector-effect': 'non-scaling-stroke' }, 'hint-span'));
      for (i = 1; i <= n; i++) g.appendChild(mk('circle', { cx: toX(i * sgn), cy: toY(0), r: 9 }, 'hint-pip'));
    } else {
      g.appendChild(mk('line', { x1: toX(0), y1: toY(0), x2: toX(0), y2: toY(value),
                                 'vector-effect': 'non-scaling-stroke' }, 'hint-span'));
      for (i = 1; i <= n; i++) g.appendChild(mk('circle', { cx: toX(0), cy: toY(i * sgn), r: 9 }, 'hint-pip'));
    }
    el.hint.appendChild(g);
  }
  function clearHint() { clear(el.hint); }

  /* ---------------- origin beacon ---------------- */
  function drawOrigin() {
    var g = mk('g', { transform: 'translate(' + toX(0) + ',' + toY(0) + ')' }, 'beacon');
    g.appendChild(mk('circle', { r: 25, filter: 'url(#beaconGlow)' }, 'beacon-glow'));
    g.appendChild(mk('circle', { r: 13 }, 'beacon-core'));
    g.appendChild(mk('circle', { r: 25 }, 'beacon-ring'));
    el.beacon = g;
    el.markers.appendChild(g);
  }
  function highlightOrigin(on) { el.beacon.classList.toggle('beacon-hot', !!on); }

  function showOriginLabel(text) {
    hideOriginLabel();
    var t = mk('text', { x: toX(0) + 52, y: toY(0) + 84, id: 'originLabel' },
               'beacon-label reveal-num');
    t.textContent = text;
    el.reveal.appendChild(t);
  }
  function hideOriginLabel() {
    var old = document.getElementById('originLabel');
    if (old) old.remove();
  }

  /* ---------------- target waypoint ---------------- */
  function setTarget(pt) {
    if (!el.wpHost) { el.wpHost = mk('g'); el.markers.appendChild(el.wpHost); }
    clear(el.wpHost);
    el.wp = null;
    if (!pt) return;
    /* A small glowing point, with outline rings that expand out of it —
       never a big disc sitting on the grid. */
    var g = mk('g', { transform: 'translate(' + toX(pt.x) + ',' + toY(pt.y) + ')' }, 'waypoint');
    g.appendChild(mk('circle', { r: 17, filter: 'url(#beaconGlow)' }, 'wp-glow'));
    var inner = mk('g', null, 'wp-pulse');
    inner.appendChild(mk('circle', { r: 11 }, 'wp-core'));
    g.appendChild(inner);
    g.appendChild(mk('circle', { r: 15 }, 'wp-ping'));
    g.appendChild(mk('circle', { r: 15 }, 'wp-ping wp-ping-2'));
    el.wpHost.appendChild(g);
    el.wp = g;
  }
  function highlightTarget(on) {
    if (!el.wp) return;
    el.wp.classList.toggle('wp-hi', !!on);
  }

  /* the waypoint tightens and quickens as the aircraft closes in */
  function setTargetClosing(on) {
    if (el.wp) el.wp.classList.toggle('wp-closing', !!on);
  }

  /* A "look here" marker: one small glowing point with outline circles
     expanding out of it. Used for the tap-the-origin beat, so the hit
     area can stay large for touch while the mark itself stays small. */
  function pingPoint(x, y) {
    clearPing();
    var g = mk('g', { transform: 'translate(' + toX(x) + ',' + toY(y) + ')', id: 'pingPoint' },
               'ping-mark');
    g.appendChild(mk('circle', { r: 16, filter: 'url(#beaconGlow)' }, 'ping-glow'));
    g.appendChild(mk('circle', { r: 10 }, 'ping-core'));
    g.appendChild(mk('circle', { r: 14 }, 'ping-ring'));
    g.appendChild(mk('circle', { r: 14 }, 'ping-ring ping-ring-2'));
    el.fx.appendChild(g);
  }
  function clearPing() {
    var old = document.getElementById('pingPoint');
    if (old) old.remove();
  }

  /* ---------------- live flight path + contrail ---------------- */
  function clearPath() { clear(el.path); clear(el.trail); }

  /* one dot laid at the aircraft's current position — called from the
     flight loop, so the route grows exactly as fast as the aircraft */
  function addPathDot(x, y) {
    el.path.appendChild(mk('circle', { cx: toX(x), cy: toY(y), r: 3.6 }, 'path-dot'));
  }

  function puff(x, y) {
    var p = mk('circle', {
      cx: toX(x) + (Math.random() * 16 - 8),
      cy: toY(y) + (Math.random() * 16 - 8),
      r: 13 + Math.random() * 6
    }, 'puff');
    el.trail.appendChild(p);
    window.setTimeout(function () { if (p.parentNode) p.remove(); }, 1300);
  }

  /* ---------------- movement number reveal ---------------- */
  function markNumber(axis, value) {
    if (value === 0) return;
    if (permanentNums) { highlightRevealed(axis, value, true); return; }
    if (el.reveal.querySelector('text[data-rv="' + axis + value + '"]')) return;
    var t = (axis === 'x')
      ? mk('text', { x: toX(value), y: toY(0) + 46 }, 'reveal-num')
      : mk('text', { x: toX(0) - 42, y: toY(value) }, 'reveal-num');
    t.setAttribute('data-rv', axis + value);
    t.textContent = String(value);
    el.reveal.appendChild(t);
  }

  function highlightRevealed(axis, value, on) {
    var host = permanentNums ? el.nums : el.reveal;
    var sel = permanentNums
      ? 'text[data-axis="' + axis + '"][data-v="' + value + '"]'
      : 'text[data-rv="' + axis + value + '"]';
    var node = host.querySelector(sel);
    if (!node) return;
    node.classList.remove('num-hot');
    if (on) { void node.getBoundingClientRect(); node.classList.add('num-hot'); }
  }

  function clearReveal() { clear(el.reveal); }

  function showPermanentNumbers(on) {
    permanentNums = !!on;
    el.nums.classList.toggle('shown', permanentNums);
    if (permanentNums) clearReveal();
  }

  function setLetter(axis, on) {
    var node = el.letters[axis];
    if (node) node.style.opacity = on ? 1 : 0;
  }

  /* Roman numerals / sign patterns, one per quadrant (concept reveal) */
  function showQuadrants(mode) {
    if (!el.quads) { el.quads = mk('g'); el.markers.appendChild(el.quads); }
    clear(el.quads);
    if (!mode) return;
    var spots = [
      { x:  6.5, y:  3.2, roman: 'I',   signs: '(+, +)' },
      { x: -6.5, y:  3.2, roman: 'II',  signs: '(\u2212, +)' },
      { x: -6.5, y: -3.2, roman: 'III', signs: '(\u2212, \u2212)' },
      { x:  6.5, y: -3.2, roman: 'IV',  signs: '(+, \u2212)' }
    ];
    spots.forEach(function (q, i) {
      var g = mk('g', { transform: 'translate(' + toX(q.x) + ',' + toY(q.y) + ')' }, 'quad');
      var r = mk('text', { y: mode === 'signs' ? -26 : 0 }, 'quad-roman');
      r.textContent = q.roman;
      g.appendChild(r);
      if (mode === 'signs') {
        var t = mk('text', { y: 34 }, 'quad-signs');
        t.textContent = q.signs;
        g.appendChild(t);
      }
      g.style.animationDelay = (i * 130) + 'ms';
      el.quads.appendChild(g);
    });
  }

  function highlightAxis(which) {
    el.axisX.classList.toggle('axis-hot', which === 'x');
    el.axisY.classList.toggle('axis-hot', which === 'y');
  }

  /* ---------------- effects ---------------- */
  function successFx(pt) {
    var cx = toX(pt.x), cy = toY(pt.y);
    el.fx.appendChild(mk('circle', { cx: cx, cy: cy, r: 44 }, 'ring-fx ring-ok'));
    for (var i = 0; i < 10; i++) {
      var a = (Math.PI * 2 * i) / 10 + Math.random() * 0.4;
      var dist = 82 + Math.random() * 56;
      var s = mk('circle', { cx: cx, cy: cy, r: 7, fill: i % 2 ? '#FFF0CC' : '#A9F58C' }, 'spark');
      s.style.setProperty('--dx', Math.cos(a) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(a) * dist + 'px');
      s.style.animationDelay = i * 22 + 'ms';
      el.fx.appendChild(s);
    }
    window.setTimeout(function () { clear(el.fx); }, 1000);
  }

  function errorFx(pt) {
    var cx = toX(pt.x), cy = toY(pt.y);
    el.fx.appendChild(mk('circle', { cx: cx, cy: cy, r: 38 }, 'ring-fx ring-bad'));
    el.fx.appendChild(mk('circle', { cx: cx, cy: cy, r: 47, id: 'endMark' }, 'endmark'));
    window.setTimeout(function () {
      var r = el.fx.querySelector('.ring-fx');
      if (r) r.remove();
    }, 800);
  }
  function clearFx() { clear(el.fx); }

  /* =====================================================================
     THE LESSON ARC
     Primitives the Discover / Apply arcs need on top of the flight game:
     plotted points, dashed unit measurements, drop zones for the drag
     activities, tappable quadrant regions, and the recap markers showing
     where the aircraft actually reached during the missions.
     Everything is authored in canonical space and inherits #chart's
     transform, so it pans and scales with the plane like the grid does.
     ===================================================================== */

  var regionTap = null;
  var pointTap = null;

  /* ---- plotted points -------------------------------------------------- */
  function plotPoint(x, y, opts) {
    opts = opts || {};
    var g = mk('g', { transform: 'translate(' + (x * CELL) + ',' + (-y * CELL) + ')' },
               'plot' + (opts.cls ? ' ' + opts.cls : ''));
    g.dataset.px = x; g.dataset.py = y;
    g.appendChild(mk('circle', { r: 15 }, 'plot-glow'));
    g.appendChild(mk('circle', { r: 9 }, 'plot-core'));
    if (opts.label) {
      var t = mk('text', { x: 22, y: -16 }, 'plot-label');
      t.textContent = opts.label;
      g.appendChild(t);
    }
    el.lessonLayer.appendChild(g);
    return g;
  }

  function clearPoints() {
    var n = el.lessonLayer.querySelectorAll('.plot');
    for (var i = 0; i < n.length; i++) n[i].parentNode.removeChild(n[i]);
  }

  /* ---- dashed unit measurement ----------------------------------------
     measure('x', 2, 3) draws the run from the y-axis out to the point and
     labels it "2 units" — the PDF's dashed green/blue measurement. */
  function measure(axis, x, y, label) {
    var g = mk('g', null, 'measure measure-' + axis);
    var len, mid;
    if (axis === 'x') {
      g.appendChild(mk('line', { x1: 0, y1: -y * CELL, x2: x * CELL, y2: -y * CELL }, 'measure-line'));
      len = Math.abs(x); mid = { x: (x * CELL) / 2, y: -y * CELL - 20 };
    } else {
      g.appendChild(mk('line', { x1: x * CELL, y1: 0, x2: x * CELL, y2: -y * CELL }, 'measure-line'));
      len = Math.abs(y); mid = { x: x * CELL + 20, y: (-y * CELL) / 2 };
    }
    var t = mk('text', { x: mid.x, y: mid.y }, 'measure-label');
    t.textContent = label || (len + (len === 1 ? ' unit' : ' units'));
    if (axis === 'y') t.setAttribute('text-anchor', 'start');
    g.appendChild(t);
    el.lessonLayer.appendChild(g);
    /* draw it on, so the eye follows the direction of travel */
    var ln = g.querySelector('.measure-line');
    var L = axis === 'x' ? Math.abs(x * CELL) : Math.abs(y * CELL);
    ln.style.strokeDasharray = '9 8';
    ln.style.strokeDashoffset = L;
    ln.style.animation = 'measureDraw 620ms var(--ease-out) forwards';
    ln.style.setProperty('--dash-len', L);
    return g;
  }

  function clearMeasures() {
    var n = el.lessonLayer.querySelectorAll('.measure');
    for (var i = 0; i < n.length; i++) n[i].parentNode.removeChild(n[i]);
  }

  /* ---- drop zones for the drag activities ------------------------------ */
  function dropZones(list) {
    clearDropZones();
    list.forEach(function (z) {
      var g = mk('g', { transform: 'translate(' + (z.x * CELL) + ',' + (-z.y * CELL) + ')' }, 'dz');
      g.dataset.key = z.key;
      if (z.lead) {
        g.appendChild(mk('line', { x1: z.lead.x * CELL - z.x * CELL,
                                   y1: -z.lead.y * CELL + z.y * CELL, x2: 0, y2: 0 }, 'dz-lead'));
      }
      g.appendChild(mk('rect', { x: -108, y: -30, width: 216, height: 60, rx: 12 }, 'dz-box'));
      var t = mk('text', { x: 0, y: 9 }, 'dz-text');
      g.appendChild(t);
      el.lessonLayer.appendChild(g);
    });
  }

  function fillDropZone(key, text, ok) {
    var g = el.lessonLayer.querySelector('.dz[data-key="' + key + '"]');
    if (!g) return;
    g.querySelector('.dz-text').textContent = text || '';
    g.classList.toggle('dz-filled', !!text);
    if (ok === false) {
      g.classList.add('dz-wrong');
      setTimeout(function () { g.classList.remove('dz-wrong'); }, 620);
    }
  }

  /* stage-space centre of a drop zone, so the HTML chips can be hit-tested
     against it without duplicating the chart transform */
  function dropZoneRect(key) {
    var g = el.lessonLayer.querySelector('.dz[data-key="' + key + '"]');
    if (!g) return null;
    var b = g.querySelector('.dz-box').getBoundingClientRect();
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom,
             cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  }

  function clearDropZones() {
    var n = el.lessonLayer.querySelectorAll('.dz');
    for (var i = 0; i < n.length; i++) n[i].parentNode.removeChild(n[i]);
  }

  /* ---- tappable quadrant regions --------------------------------------- */
  function showRegions(mode, onTap) {
    el.regionLayer.innerHTML = '';
    regionTap = onTap || null;
    if (!mode) { el.field.classList.remove('field-live'); return; }
    var only = typeof mode === 'number' ? mode : 0;   /* 0 = every region live */
    var span = MAX.xMax * CELL, spanY = MAX.yMax * CELL;
    [1, 2, 3, 4].forEach(function (q) {
      var sx = (q === 1 || q === 4) ? 0 : -span;
      var sy = (q === 1 || q === 2) ? -spanY : 0;
      var r = mk('rect', { x: sx, y: sy, width: span, height: spanY }, 'region region-q' + q);
      r.dataset.q = q;
      if (only && only !== q) r.classList.add('region-idle');
      if (!only || only === q) r.classList.add('region-live');
      r.addEventListener('click', function () {
        if (regionTap) regionTap(q);
      });
      el.regionLayer.appendChild(r);
    });
    el.field.classList.add('field-live');
  }

  function flashRegion(q, ok) {
    var r = el.regionLayer.querySelector('.region-q' + q);
    if (!r) return;
    r.classList.add(ok ? 'region-ok' : 'region-bad');
    setTimeout(function () { r.classList.remove('region-ok', 'region-bad'); }, 700);
  }

  function clearRegions() { showRegions(null); }

  /* ---- a whole quadrant made tappable per lattice point ---------------- */
  function showTapPoints(q, onTap) {
    clearTapPoints();
    pointTap = onTap || null;
    var sx = (q === 1 || q === 4) ? 1 : -1;
    var sy = (q === 1 || q === 2) ? 1 : -1;
    for (var i = 1; i <= 4; i++) {
      for (var j = 1; j <= 4; j++) {
        var x = sx * i, y = sy * j;
        var c = mk('circle', { cx: x * CELL, cy: -y * CELL, r: 26 }, 'tapdot');
        c.dataset.tx = x; c.dataset.ty = y;
        (function (px, py) {
          c.addEventListener('click', function () { if (pointTap) pointTap(px, py); });
        })(x, y);
        el.lessonLayer.appendChild(c);
      }
    }
    el.field.classList.add('field-live');
  }

  function clearTapPoints() {
    pointTap = null;
    var n = el.lessonLayer.querySelectorAll('.tapdot');
    for (var i = 0; i < n.length; i++) n[i].parentNode.removeChild(n[i]);
  }

  /* ---- recap markers: where the aircraft actually reached -------------- */
  function showRecapMarkers(list) {
    clearRecapMarkers();
    list.forEach(function (p, i) {
      var g = mk('g', { transform: 'translate(' + (p.x * CELL) + ',' + (-p.y * CELL) + ')' },
                 'recap');
      g.style.animationDelay = (i * 180) + 'ms';
      g.appendChild(mk('circle', { r: 13 }, 'recap-dot'));
      var lx = p.x < 0 ? -150 : 26, ly = p.y < 0 ? 44 : -34;
      var box = mk('rect', { x: lx, y: ly - 26, width: 126, height: 38, rx: 9 }, 'recap-box');
      g.appendChild(box);
      var t = mk('text', { x: lx + 63, y: ly }, 'recap-text');
      t.textContent = '(' + p.x + ', ' + p.y + ')';
      g.appendChild(t);
      el.lessonLayer.appendChild(g);
    });
  }

  function clearRecapMarkers() {
    var n = el.lessonLayer.querySelectorAll('.recap');
    for (var i = 0; i < n.length; i++) n[i].parentNode.removeChild(n[i]);
  }

  /* ---- the right-angle mark at the origin (PDF p27) -------------------- */
  function showRightAngle(on) {
    var old = el.lessonLayer.querySelector('.rightangle');
    if (old) old.parentNode.removeChild(old);
    if (!on) return;
    var d = 34;
    var g = mk('g', null, 'rightangle');
    g.appendChild(mk('path', { d: 'M ' + d + ' 0 L ' + d + ' ' + (-d) + ' L 0 ' + (-d) }, 'ra-mark'));
    el.lessonLayer.appendChild(g);
  }

  /* ---- per-quadrant labels, revealed one at a time --------------------- */
  function regionLabelPos(q) {
    var x = (q === 1 || q === 4) ? 5.6 : -5.6;
    var y = (q === 1 || q === 2) ? 3.4 : -3.4;
    return { x: x * CELL, y: -y * CELL };
  }

  function showRegionLabel(q, roman, signs) {
    var sel = '.qlabel[data-q="' + q + '"]';
    var old = el.lessonLayer.querySelector(sel);
    if (old) old.parentNode.removeChild(old);
    if (!roman) return;
    var p = regionLabelPos(q);
    var g = mk('g', { transform: 'translate(' + p.x + ',' + p.y + ')' }, 'qlabel');
    g.dataset.q = q;
    var t = mk('text', { x: 0, y: signs ? -12 : 6 }, 'qlabel-roman');
    t.textContent = roman;
    g.appendChild(t);
    if (signs) {
      var sg = mk('text', { x: 0, y: 28 }, 'qlabel-signs');
      sg.textContent = signs;
      g.appendChild(sg);
    }
    el.lessonLayer.appendChild(g);
  }

  function showRegionLabels(list) {
    clearRegionLabels();
    list.forEach(function (o) { showRegionLabel(o.q, o.roman, o.signs); });
  }

  function clearRegionLabels() {
    var n = el.lessonLayer.querySelectorAll('.qlabel');
    for (var i = 0; i < n.length; i++) n[i].parentNode.removeChild(n[i]);
  }

  function clearLesson() {
    clearPoints(); clearMeasures(); clearDropZones();
    clearTapPoints(); clearRecapMarkers(); clearRegions();
    clearRegionLabels(); showRightAngle(false);
    el.field.classList.remove('field-live');
  }

  return {
    build: build,
    stageX: stageX, stageY: stageY,
    cellPx: cellPx,
    setStage: setStage,
    getCharted: function () { return Object.assign({}, charted); },
    showHint: showHint,
    clearHint: clearHint,
    setTarget: setTarget,
    highlightTarget: highlightTarget,
    setTargetClosing: setTargetClosing,
    highlightOrigin: highlightOrigin,
    showOriginLabel: showOriginLabel,
    hideOriginLabel: hideOriginLabel,
    clearPath: clearPath,
    addPathDot: addPathDot,
    puff: puff,
    markNumber: markNumber,
    highlightRevealed: highlightRevealed,
    clearReveal: clearReveal,
    showPermanentNumbers: showPermanentNumbers,
    setLetter: setLetter,
    highlightAxis: highlightAxis,
    showQuadrants: showQuadrants,
    showAxes: showAxes,
    pingPoint: pingPoint,
    clearPing: clearPing,
    successFx: successFx,
    errorFx: errorFx,
    clearFx: clearFx,
    plotPoint: plotPoint, clearPoints: clearPoints,
    measure: measure, clearMeasures: clearMeasures,
    dropZones: dropZones, fillDropZone: fillDropZone,
    dropZoneRect: dropZoneRect, clearDropZones: clearDropZones,
    showRegions: showRegions, flashRegion: flashRegion, clearRegions: clearRegions,
    showTapPoints: showTapPoints, clearTapPoints: clearTapPoints,
    showRecapMarkers: showRecapMarkers, clearRecapMarkers: clearRecapMarkers,
    showRightAngle: showRightAngle,
    showRegionLabel: showRegionLabel, showRegionLabels: showRegionLabels,
    clearRegionLabels: clearRegionLabels,
    clearLesson: clearLesson,
    panelRect: function () { return panelRect(charted, view); },
    onViewChange: onViewChange
  };
})();
