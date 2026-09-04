/* ============================================================
   ui.js — chrome: mission panel, control dock, HUD, tutorial
   affordances. Emits intents through handlers; holds no rules.
   ============================================================ */
window.CG = window.CG || {};

CG.UI = (function () {
  var SVGNS = 'http://www.w3.org/2000/svg';
  var el = {}, handlers = {}, ctrlMap = {};
  var locked = false;

  function q(id) { return document.getElementById(id); }

  function svgIcon(d) {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    var p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
    return s;
  }

  /* ---------------- init ---------------- */
  function init(h) {
    handlers = h || {};
    el.stage = q('stage');
    el.mission = q('mission');
    el.missionText = q('missionText');
    el.missionSub = q('missionSub');
    el.missionActions = q('missionActions');
    el.controls = q('controls');
    el.go = q('btnGo');
    el.dock = q('dock');
    el.tray = q('dragTray');
    el.hand = q('hand');
    el.coordTag = q('coordTag');

    /* THE SPEAKER REPLAYS THE LINE ON SCREEN. It reads #missionText
       rather than holding its own copy, so it can never say something
       different from what the learner is looking at. */
    var say = q('btnSay');
    if (say) say.addEventListener('click', function () {
      var line = (el.missionText.textContent || '').trim();
      if (line) CG.Voice.say(line);
    });

    el.go.addEventListener('click', function () {
      if (el.go.disabled) return;
      if (handlers.onGo) handlers.onGo();
    });
  }

  /* The sound and reset buttons are gone from the screen, so there is
     nothing left to keep in sync. Both actions survive on the keyboard
     — see onKeyDown() in game.js — because a game that talks needs a
     way to be quietened, and §BE requires a reset to exist. */


  /* ---------------- direction controls ---------------- */
  /* buildControls(visible, usable) — everything in `visible` is drawn so
     the dock keeps a constant width, but a direction not in `usable` is
     drawn in a "not yet" state: its airspace has not unfolded, and flying
     that way would leave the chart. */
  /* ---------------- direction controls ----------------
     ONE ARROW BUTTON AND ONE COUNTER PER DIRECTION.

     The stepper is gone. It was a value plus a pair of small
     up/down chevrons, and the brief rules those out for this age
     group: "DO NOT use tiny HTML number-input spinner arrows... The
     child should NOT see desktop-style up/down inside the number
     field." A Grade 2 learner taps the big arrow and the counter goes
     up; that is the whole model.

     Tapping the COUNTER takes one back off. The brief makes that
     conditional — "only implement this if the existing game's
     mechanic requires it" — and it does: a learner who overshoots has
     to be able to correct without resetting the whole mission, and
     the engine already supports a -1 step (Shift+Arrow uses it).

     Everything not in `usable` is still drawn so the bar keeps a
     constant width, but it is dimmed and disabled: its airspace has
     not unfolded and flying that way would leave the chart. */
  var ARROW = {
    right: 'M14 30h22l-9-11 5-3 15 16-15 16-5-3 9-11H14z',
    left:  'M50 30H28l9-11-5-3-15 16 15 16 5-3-9-11h22z',
    up:    'M30 50V28l-11 9-3-5 16-15 16 15-3 5-11-9v22z',
    down:  'M30 14v22l-11-9-3 5 16 15 16-15-3-5-11 9V14z'
  };

  function bigArrow(dir) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ARROW[dir] || ARROW.right);
    svg.appendChild(p);
    return svg;
  }

  function buildControls(visible, usable) {
    usable = usable || visible;
    el.controls.innerHTML = '';
    ctrlMap = {};
    CG.DIRECTIONS.forEach(function (d) {
      if (visible.indexOf(d.key) === -1) return;
      var armed = usable.indexOf(d.key) !== -1;

      var wrap = document.createElement('div');
      wrap.className = 'control-group ctrl';
      wrap.dataset.dir = d.key;
      wrap.dataset.armed = armed ? '1' : '0';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'direction-button step-btn direction-button--' + d.key;
      btn.appendChild(bigArrow(d.key));
      btn.setAttribute('aria-label', armed
        ? 'Move ' + d.label.toLowerCase()
        : 'Move ' + d.label.toLowerCase() + ' \u2014 this part of the airspace has not opened yet');

      var val = document.createElement('output');
      val.className = 'move-counter ctrl-val';
      val.id = 'val-' + d.key;
      val.textContent = '0';
      val.setAttribute('aria-live', 'polite');
      val.setAttribute('aria-label', d.label + ' moves');

      if (armed) {
        btn.addEventListener('click', function () {
          if (handlers.onStep) handlers.onStep(d.key, +1);
        });
        /* the counter is the correction, not a spinner */
        val.style.cursor = 'pointer';
        val.setAttribute('title', 'Tap to take one off');
        val.addEventListener('click', function () {
          if (handlers.onStep) handlers.onStep(d.key, -1);
        });
      } else {
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
      }

      var label = document.createElement('span');
      label.className = 'control-label';
      label.textContent = d.label;

      wrap.appendChild(btn);
      wrap.appendChild(val);
      wrap.appendChild(label);
      el.controls.appendChild(wrap);

      /* `up` and `down` are kept pointing at the one button so every
         existing caller — applyLock, the tests, the idle nudge — keeps
         working without knowing the stepper went away. */
      ctrlMap[d.key] = { root: wrap, val: val, up: btn, down: btn,
                         armed: armed, signed: false, dir: d.key };
    });
  }


  /* =====================================================================
     FLOW 58 — THE X / Y STEPPERS

     Deliberately the same DOM as buildControls(): the same .ctrl wrapper
     with a data-dir, the same .ctrl-label plate, the same .ctrl-val
     output, the same .stepper of two .step-btn keys. Everything already
     built on that structure — setValue, the lock states, the tutorial
     highlight, the whole redesigned look — therefore works here with no
     second implementation to keep in step.

     The one real difference is the range: these values are SIGNED, so a
     stepper runs from -RANGE to +RANGE and the label shows a co-ordinate
     letter instead of a direction word. */
  function buildAxisControls() {
    el.controls.innerHTML = '';
    ctrlMap = {};
    [{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }].forEach(function (d) {
      var wrap = document.createElement('div');
      wrap.className = 'ctrl ctrl-axis';
      wrap.dataset.dir = d.key;
      wrap.dataset.armed = '1';
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', d.label + ' co-ordinate');

      var label = document.createElement('div');
      label.className = 'ctrl-label';
      var span = document.createElement('span');
      span.textContent = d.label;
      label.appendChild(span);

      var val = document.createElement('output');
      val.className = 'ctrl-val';
      val.id = 'val-' + d.key;
      val.textContent = '0';
      val.setAttribute('aria-live', 'polite');
      val.setAttribute('aria-label', d.label + ' co-ordinate value');

      var stepper = document.createElement('div');
      stepper.className = 'stepper';
      var up = document.createElement('button');
      up.type = 'button';
      up.className = 'step-btn';
      up.appendChild(svgIcon('M12 6l7 9H5z'));
      up.setAttribute('aria-label', 'Increase ' + d.label);
      var dn = document.createElement('button');
      dn.type = 'button';
      dn.className = 'step-btn';
      dn.appendChild(svgIcon('M12 18l7-9H5z'));
      dn.setAttribute('aria-label', 'Decrease ' + d.label);
      up.addEventListener('click', function () { if (handlers.onStep) handlers.onStep(d.key, +1); });
      dn.addEventListener('click', function () { if (handlers.onStep) handlers.onStep(d.key, -1); });

      stepper.appendChild(up);
      stepper.appendChild(dn);
      wrap.appendChild(label);
      wrap.appendChild(val);
      wrap.appendChild(stepper);
      el.controls.appendChild(wrap);
      ctrlMap[d.key] = { root: wrap, val: val, up: up, down: dn, armed: true,
                         signed: true, dir: d.key };   /* dir: p60's x and y have different limits */
    });
  }

  function setValue(dir, v, bump) {
    var c = ctrlMap[dir];
    if (!c || !c.armed) return;
    c.val.textContent = String(v);
    if (bump) {
      c.val.classList.remove('bump');
      void c.val.offsetWidth;
      c.val.classList.add('bump');
    }
    /* a signed stepper stops at -RANGE, not at zero */
    var hi = c.signed ? CG.DIRECT_RANGE_OF(c.dir) : CG.CONFIG.maxStep;
    var lo = c.signed ? -CG.DIRECT_RANGE_OF(c.dir) : 0;
    /* QUEUED. A control with moves entered gets a quiet ring so the
       learner can see at a glance which directions they have asked for
       — the brief's "selected / queued direction", on the module rather
       than as a glow on the whole button. */
    if (c.root) c.root.classList.toggle('is-queued', v > 0);
    if (c.up === c.down) {
      /* ONE BUTTON, so there is only one limit worth showing. Writing
         both flags to the same element let the second overwrite the
         first, and "at zero" would have masked "at maximum" on every
         direction control. The arrow only ever adds, so its limit is
         the ceiling; the counter shows the floor by reading 0. */
      c.up.dataset.limit = v >= hi ? '1' : '0';
      c.val.dataset.limit = v <= lo ? '1' : '0';
    } else {
      c.up.dataset.limit = v >= hi ? '1' : '0';
      c.down.dataset.limit = v <= lo ? '1' : '0';
    }
    applyLock(c);
  }

  /* Two different reasons a stepper can be unavailable, and the learner
     must be able to tell them apart: LIMIT is "that is as far as it
     goes" (styled as an end stop), LOCKED is "not right now, the
     aircraft is flying" (the whole dock hatches). */
  function applyLock(c) {
    if (!c.armed) { c.up.disabled = c.down.disabled = true; return; }
    c.up.disabled = locked || c.up.dataset.limit === '1';
    c.down.disabled = locked || c.down.dataset.limit === '1';
    c.up.setAttribute('aria-disabled', String(c.up.disabled));
    c.down.setAttribute('aria-disabled', String(c.down.disabled));
  }

  /* Layer 41 — state locking while the aircraft is in the air. */
  /* setControlsLocked(on, quiet)
       The console has TWO reasons to be closed and they do not look
       alike. '1' is "the aircraft is flying" — hatched, unmistakably
       out of action, because the learner has just pressed GO and needs
       to see that pressing it again does nothing. 'brief' is "wait, I
       am still talking", which is nine seconds at the very start of the
       game; hatching the whole console for that reads as a fault, so
       the quiet lock takes the buttons out without dressing them up.
       Both set the same `locked` flag — only the styling differs. */
  function setControlsLocked(v, quiet) {
    locked = !!v;
    if (locked) el.dock.dataset.locked = quiet ? 'brief' : '1';
    else delete el.dock.dataset.locked;
    Object.keys(ctrlMap).forEach(function (k) { applyLock(ctrlMap[k]); });
  }

  var goWasOn = false;
  function setGoEnabled(on) {
    el.go.disabled = !on;
    /* armed = a route is set and the aircraft can be sent */
    el.go.classList.toggle('armed', !!on && !locked);
    el.go.setAttribute('aria-disabled', String(!on));
    /* ONE pulse on the transition into enabled, never a loop: the brief
       asks for a single 400ms activation and explicitly rules out a
       continuous one. Keyed off the change, so re-asserting the same
       state does not re-fire it. */
    if (!!on && !goWasOn) {
      el.go.classList.remove('go-armed-pop');
      void el.go.offsetWidth;
      el.go.classList.add('go-armed-pop');
    }
    goWasOn = !!on;
  }

  /* the dock steps aside during the concept reveal and final recap */
  function showDock(on) { el.dock.classList.toggle('dock-away', !on); }

  /* and the mission strip steps aside for the completion card */
  function showMission(on) { el.mission.classList.toggle('mission-away', !on); }

  /* dock slide-up — played once when the gameplay screen opens */
  /* ARRIVAL vs TEXT CHANGE. The dock slides up once a session, and the
     question bar arrives with it — but the bar's arrival and its first
     sentence land in the same frame (game.js calls this, then
     loadLevel), so they cannot be two animations. The flag hands the
     next mission() call the long arrival; every call after it gets the
     short lift that a changed sentence deserves. See .gq-in / .enter. */
  var barArriving = false;

  function playDockEntry() {
    el.dock.classList.remove('dock-enter');
    void el.dock.offsetWidth;
    el.dock.classList.add('dock-enter');
    barArriving = true;
  }

  /* ---------------- mission panel ----------------
     ONE LINE AT A TIME, ALWAYS.

     The panel used to stack a main line and a sub-line, and a child
     reading the first one had the second one already sitting under it —
     two sentences competing for the same glance, in a template that is
     meant to ask exactly one thing. A `sub` is now a SECOND BEAT: the
     main line is shown, held, and then replaced by it. Nothing else
     changed for callers — they still pass {text, sub} and the panel
     does the sequencing, so no game code had to learn about this.

     WORD_STEP and SUB_HOLD are the two pacing knobs. They are here
     rather than in levels.js because they are properties of reading a
     line, not of the flow between lines — CFG.beat* owns that. */
  var WORD_STEP = 110;     /* ms between one word appearing and the next */
  var SUB_HOLD  = 2800;    /* how long the first line holds before the second */
  var subTimer  = null;

  /* ---- fitting a line to the painted plate --------------------------
     The banner is one image at a fixed size, so a long instruction
     cannot be allowed to push the text box open — it would spill over
     the rivets and, once the box grew past the artwork, onto the chart
     below. Instead the type steps down until the block fits.

     It measures with the WHOLE sentence in place, before the word-by-word
     animation starts, because the words arrive one at a time and a
     partial line always fits. The size is written to a custom property
     so .mission-sub can follow it.

     30 and 20 rather than 21 and 15: the replacement artwork has no
     crest, so the plate is writable top to bottom and the box went
     from 516x54 to 547x115. At 30px the longest line in the game wraps
     to three lines and still fits with 11px to spare, and 20px is a
     real readability floor for a class reading this off a projector —
     a line that cannot fit at 20px is a content problem, not a layout
     one. */
  var FS_MAX = 30, FS_MIN = 20;

  function fitPlate(html) {
    var plate = el.mission && el.mission.querySelector('.banner-plate');
    if (!plate || !el.missionText) return;
    var probe = el.missionText.cloneNode(false);
    probe.id = '';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.width = plate.clientWidth + 'px';
    probe.innerHTML = html;
    plate.appendChild(probe);
    var fs = FS_MAX, room = plate.clientHeight;
    /* clientHeight is 0 before the artwork has laid out; leave the
       stylesheet's size alone rather than shrinking to the floor */
    if (room > 0) {
      for (; fs > FS_MIN; fs--) {
        probe.style.fontSize = fs + 'px';
        if (probe.scrollHeight <= room) break;
      }
    }
    plate.removeChild(probe);
    el.mission.style.setProperty('--qb-fs', fs + 'px');
  }

  function fadeWords(node, html) {
    node.innerHTML = '';
    /* split on spaces but keep inline markup groups intact */
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var i = 0;
    Array.prototype.forEach.call(tmp.childNodes, function (child) {
      if (child.nodeType === 3) {
        child.nodeValue.split(/(\s+)/).forEach(function (w) {
          if (!w) return;
          if (/^\s+$/.test(w)) { node.appendChild(document.createTextNode(' ')); return; }
          var s = document.createElement('span');
          s.className = 'fadeword';
          s.textContent = w;
          s.style.animationDelay = (i++ * WORD_STEP) + 'ms';
          node.appendChild(s);
        });
      } else {
        /* inline markup (<em>, .coord) fades in as one unit. No space is
           appended — the surrounding text nodes already carry the real
           spacing, so punctuation stays tight against it. */
        var c = child.cloneNode(true);
        c.classList.add('fadeword');
        c.style.animationDelay = (i++ * WORD_STEP) + 'ms';
        node.appendChild(c);
      }
    });
  }

  /* opts: {text, sub, actions:[…], animate:'panel'|'words'|false, voice}
     `voice` is the spoken form of the same instruction; pass voice:false
     to stay silent. Keeping it here means the panel and the voice-over
     can never drift apart (requirement 22). */
  function mission(opts) {
    opts = opts || {};

    /* A queued sub-line belongs to the message being replaced, so it
       goes with it. Without this, a sub scheduled by the previous call
       would land on top of whatever is on screen by then. */
    if (subTimer) { window.clearTimeout(subTimer); subTimer = null; }

    if (opts.voice !== false) {
      CG.Voice.say(opts.voice || opts.text || '');
    }

    /* #missionSub is kept in the markup — it is a hook the game and the
       tests know — but it is never written to any more. Two lines in
       this panel is the thing this rewrite exists to prevent. */
    el.missionSub.innerHTML = '';

    /* The badge pulse went with the CSS reconstruction: the crest is
       painted into the artwork now, so it cannot be scaled on its own,
       and pulsing the whole plaque is exactly the movement the banner
       is not allowed to make. The message animation below is what
       acknowledges each new instruction. */

    /* THE LINE IS FITTED TO THE PLATE BEFORE IT IS ANIMATED. The plaque
       is a painted image: it cannot grow, so the text has to be what
       gives. This is measured rather than guessed because the strings
       come from LEVELS and the lesson arc and range from four words to
       the fourteen of the co-ordinate definitions. */
    fitPlate(opts.text || '');

    if (opts.animate === 'words') {
      fadeWords(el.missionText, opts.text || '');
    } else {
      el.missionText.innerHTML = opts.text || '';
      if (opts.animate !== false) {
        var arrival = barArriving ? 'gq-in' : 'enter';
        barArriving = false;
        el.mission.classList.remove('enter', 'gq-in');
        void el.mission.offsetWidth;
        el.mission.classList.add(arrival);
      }
    }

    /* the second beat */
    if (opts.sub) {
      subTimer = window.setTimeout(function () {
        subTimer = null;
        fadeWords(el.missionText, opts.sub);
      }, SUB_HOLD);
    }

    /* The question template carries no buttons: the flow is paced by
       voice-over and by the learner's own next action. */
    el.missionActions.innerHTML = '';
  }

  /* The mission counter was removed from the screen. A no-op is kept
     rather than making every caller check, and it is the one place to
     put a counter back if one is ever wanted again. */
  function setLevelPill() {}


  /* ---------------- coordinate tag beside the aircraft ----------------
     hideCoordTag() fades the tag out and only takes it out of the
     document once the fade has finished. That trailing timer has to be
     cancellable: show the tag again inside those 280ms and the stale
     timer would otherwise fire and hide the one that had just been
     put up. */
  var coordTagHide = null;

  function coordTag(stageX, stageY, text, kicker) {
    if (coordTagHide) { window.clearTimeout(coordTagHide); coordTagHide = null; }
    el.coordTag.hidden = false;
    el.coordTag.innerHTML = '';
    if (kicker) {
      var k = document.createElement('span');
      k.className = 'coord-kicker';
      k.textContent = kicker;
      el.coordTag.appendChild(k);
    }
    var v = document.createElement('span');
    v.className = 'coord-val';
    v.textContent = text;
    el.coordTag.appendChild(v);
    el.coordTag.style.left = stageX + 'px';
    el.coordTag.style.top = stageY + 'px';
    void el.coordTag.offsetWidth;
    el.coordTag.classList.add('show');
  }
  /* Emphasises one half of a co-ordinate tag, so "(2, 3)" can have its
     first number called out while the second stays quiet — the PDF
     highlights them one at a time before naming either. */
  function emphasiseCoord(which) {
    var v = el.coordTag.querySelector('.coord-val');
    if (!v) return;
    var m = /^\(\s*(-?\d+|)\s*,\s*(-?\d+|)\s*\)$/.exec(v.textContent.trim());
    if (!which || !m) { v.classList.remove('coord-split'); return; }
    var xs = m[1], ys = m[2];
    v.classList.add('coord-split');
    v.innerHTML = '(<span class="cx' + (which === 'x' || which === 'both' ? ' on' : '') +
                  '">' + xs + '</span>, <span class="cy' +
                  (which === 'y' || which === 'both' ? ' on' : '') + '">' + ys + '</span>)';
  }

  function hideCoordTag() {
    el.coordTag.classList.remove('show');
    if (coordTagHide) window.clearTimeout(coordTagHide);
    coordTagHide = window.setTimeout(function () {
      coordTagHide = null;
      el.coordTag.hidden = true;
    }, 280);
  }

  /* ---------------- tutorial highlight + hand ---------------- */
  function highlight(what) {
    Array.prototype.forEach.call(
      document.querySelectorAll('.tut-hi'),
      function (n) { n.classList.remove('tut-hi'); }
    );
    if (!what || what === 'target') return;   /* the waypoint glow lives in grid.js */
    if (what === 'go') { el.go.classList.add('tut-hi'); return; }
    if (ctrlMap[what] && ctrlMap[what].armed) ctrlMap[what].root.classList.add('tut-hi');
  }

  /* anchor the hand under a control's stepper (stage-space coords) */
  /* handAt(target) — put the nudge on anything.

     It used to take one of five hard-coded names, which is why it was
     only ever usable on the control dock. The lesson arc is full of
     things that have to be TAPPED — the origin, a point inside a
     quadrant, a label's drop zone — and none of them are dock buttons,
     so none of them could be nudged. Three forms now:

       'go' | 'right' | 'left' | 'up' | 'down'   a dock control
       {x, y}                                     stage co-ordinates
       an Element                                 its own centre

     Stage co-ordinates are the useful one on the chart: Grid.stageX()
     and Grid.stageY() convert a chart position into them, so a caller
     can say "nudge (0,0)" without knowing anything about the DOM. */
  function handAt(target) {
    var x, y;

    if (target && typeof target === 'object' &&
        typeof target.x === 'number' && typeof target.y === 'number') {
      x = target.x; y = target.y;
    } else {
      var node = null;
      if (target === 'go') node = el.go;
      else if (typeof target === 'string' && ctrlMap[target]) node = ctrlMap[target].up;
      else if (target && target.getBoundingClientRect) node = target;
      if (!node) { hideHand(); return; }

      /* A DOM node's position has to come back through the stage's own
         scale: the stage is a 1920x1080 canvas scaled by one transform,
         and .hand is positioned in those design pixels. */
      var sRect = el.stage.getBoundingClientRect();
      var scale = sRect.width / 1920;
      var r = node.getBoundingClientRect();
      x = (r.left + r.width / 2 - sRect.left) / scale;
      y = (r.top + r.height / 2 - sRect.top) / scale;
    }

    el.hand.hidden = false;
    el.hand.style.left = x + 'px';
    el.hand.style.top = y + 'px';
    void el.hand.offsetWidth;
    el.hand.classList.add('show');
  }
  function hideHand() {
    el.hand.classList.remove('show');
    window.setTimeout(function () { el.hand.hidden = true; }, 260);
  }

  /* =====================================================================
     DRAG TRAY  (PDF p30 and p45)
     Chips the learner drags onto drop zones drawn on the chart. Pointer
     events so it works with mouse, pen and touch from one code path, and
     a full keyboard route (Tab to a chip, arrow keys to pick a zone,
     Enter to place) because a drag-only interaction is unusable without
     a pointing device.
     ===================================================================== */
  var tray = { items: [], onDrop: null, sel: 0, zone: 0, zones: [] };

  function dragTray(items, zones, onDrop) {
    clearDragTray();
    tray.items = items.slice();
    tray.zones = zones.slice();
    tray.onDrop = onDrop || null;
    el.tray.hidden = false;
    el.tray.innerHTML = '';
    items.forEach(function (it, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = it.label;
      b.dataset.key = it.key;
      b.setAttribute('aria-label', it.label + ' — drag onto the chart, or press Enter to place');
      bindChip(b);
      el.tray.appendChild(b);
    });
  }

  function chipDone(key) {
    var b = el.tray.querySelector('.chip[data-key="' + key + '"]');
    if (b) { b.classList.add('chip-placed'); b.disabled = true; }
  }

  function chipWrong(key) {
    var b = el.tray.querySelector('.chip[data-key="' + key + '"]');
    if (!b) return;
    b.classList.add('chip-wrong');
    setTimeout(function () { b.classList.remove('chip-wrong'); }, 620);
  }

  /* THE CHIP HAS TO MOVE IN STAGE UNITS, NOT VIEWPORT UNITS.
     ------------------------------------------------------------------
     This used to set `position:fixed` and then write the raw clientX /
     clientY into left/top, on the reasoning that fixed positioning
     escapes the stage's scale. It does not: a transformed element is
     the containing block for its fixed-position descendants, and
     .stage carries `translate(-50%,-50%) scale(var(--s))`. So the
     coordinates were resolved against the stage's own 1920x1080 box
     and then scaled again — on a 1366-wide window the chip tracked the
     pointer at about 70% speed and sat a few hundred px away from it.
     That is the "when I am picking something, it's not moving" in the
     review.

     A transform in stage units is the honest fix. The chip stays where
     it is in the tray and is translated by the pointer's movement
     DIVIDED by the stage scale, so a finger moving 100 viewport px
     moves the chip 100 viewport px whatever the window size. It also
     keeps the drag on the compositor, which is the "not smooth" half. */
  var DRAG_SLOP = 3;          /* px of movement before it counts as a drag */

  function stageScale() {
    var r = el.stage.getBoundingClientRect();
    return r.width ? r.width / 1920 : 1;
  }

  function bindChip(b) {
    var drag = null;

    b.addEventListener('pointerdown', function (e) {
      if (b.disabled) return;
      e.preventDefault();              /* no native text-selection drag */
      b.setPointerCapture(e.pointerId);
      drag = { x0: e.clientX, y0: e.clientY, s: stageScale(), moved: false };
      /* the stylesheet transitions `transform`, which would make every
         pointermove a 120ms animation and lag the finger */
      b.style.transition = 'none';
      b.style.zIndex = 40;
      b.classList.add('chip-dragging');
    });

    b.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = (e.clientX - drag.x0) / drag.s;
      var dy = (e.clientY - drag.y0) / drag.s;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_SLOP) return;
      drag.moved = true;
      /* inline, so it beats both .chip:hover and .chip-dragging without
         a specificity fight */
      b.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) +
                          'px) scale(1.06) rotate(-1.5deg)';
      highlightNearestZone(e.clientX, e.clientY);
    });

    function endDrag(e, drop) {
      if (!drag) return;
      var moved = drag.moved;
      drag = null;
      b.classList.remove('chip-dragging');
      b.style.transform = ''; b.style.transition = ''; b.style.zIndex = '';
      clearZoneHighlight();
      /* dropped on empty water: the chip simply returns to the tray */
      if (drop && moved) {
        var hit = nearestZone(e.clientX, e.clientY);
        if (hit && tray.onDrop) tray.onDrop(b.dataset.key, hit);
      }
    }
    b.addEventListener('pointerup', function (e) { endDrag(e, true); });
    b.addEventListener('pointercancel', function (e) { endDrag(e, false); });

    /* keyboard route */
    b.addEventListener('keydown', function (e) {
      if (b.disabled) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        tray.zone = (tray.zone + 1) % tray.zones.length; highlightZone(); e.preventDefault();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        tray.zone = (tray.zone - 1 + tray.zones.length) % tray.zones.length;
        highlightZone(); e.preventDefault();
      } else if (e.key === 'Enter' || e.key === ' ') {
        clearZoneHighlight();
        if (tray.onDrop) tray.onDrop(b.dataset.key, tray.zones[tray.zone]);
        e.preventDefault();
      }
    });
    b.addEventListener('focus', function () {
      /* every chip starts its zone selection at the first zone, so which
         zone Enter targets never depends on what was pressed before */
      tray.zone = 0;
      highlightZone();
    });
    b.addEventListener('blur', clearZoneHighlight);
  }

  /* 190 STAGE px, not 190 viewport px. dropZoneRect returns viewport
     coordinates, so the distance has to be divided back by the stage
     scale before it is compared to a design-pixel tolerance — otherwise
     the catch radius silently grew on small windows and shrank on large
     ones, and "where to drag?" depended on the browser size. */
  var DROP_REACH = 190;

  function nearestZone(cx, cy) {
    var best = null, bestD = Infinity, s = stageScale();
    tray.zones.forEach(function (k) {
      var r = CG.Grid.dropZoneRect(k);
      if (!r) return;
      var d = Math.hypot(cx - r.cx, cy - r.cy) / s;
      if (d < bestD && d < DROP_REACH) { bestD = d; best = k; }
    });
    return best;
  }

  function highlightNearestZone(cx, cy) {
    var k = nearestZone(cx, cy);
    tray.zones.forEach(function (z) {
      var g = document.querySelector('.dz[data-key="' + z + '"]');
      if (g) g.classList.toggle('dz-over', z === k);
    });
  }

  function highlightZone() {
    tray.zones.forEach(function (z, i) {
      var g = document.querySelector('.dz[data-key="' + z + '"]');
      if (g) g.classList.toggle('dz-over', i === tray.zone);
    });
  }

  function clearZoneHighlight() {
    var n = document.querySelectorAll('.dz-over');
    for (var i = 0; i < n.length; i++) n[i].classList.remove('dz-over');
  }

  function clearDragTray() {
    tray.items = []; tray.zones = []; tray.onDrop = null; tray.zone = 0;
    if (el.tray) { el.tray.innerHTML = ''; el.tray.hidden = true; }
    clearZoneHighlight();
  }

  return {
    init: init,
    buildControls: buildControls,
    buildAxisControls: buildAxisControls,
    setValue: setValue,
    setControlsLocked: setControlsLocked,
    setGoEnabled: setGoEnabled,
    showDock: showDock,
    showMission: showMission,
    playDockEntry: playDockEntry,
    mission: mission,
    /* setInstruction(text) — the banner's own name for the one thing
       most callers want: swap the sentence, keep everything else. It is
       a thin front on mission(), not a second path, so the voice, the
       badge pulse and the one-line rule all still apply. */
    setInstruction: function (text, voice) {
      mission({ text: text, voice: voice === undefined ? text : voice });
    },
    setLevelPill: setLevelPill,
    coordTag: coordTag,
    emphasiseCoord: emphasiseCoord,
    hideCoordTag: hideCoordTag,
    highlight: highlight,
    handAt: handAt,
    hideHand: hideHand,
    dragTray: dragTray, clearDragTray: clearDragTray,
    chipDone: chipDone, chipWrong: chipWrong
  };
})();
