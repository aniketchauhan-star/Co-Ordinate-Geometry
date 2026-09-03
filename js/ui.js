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
    el.levelNow = q('levelNow');
    el.levelTotal = q('levelTotal');
    el.btnSound = q('btnSound');
    el.btnReset = q('btnReset');
    el.hand = q('hand');
    el.coordTag = q('coordTag');

    el.go.addEventListener('click', function () {
      if (el.go.disabled) return;
      if (handlers.onGo) handlers.onGo();
    });
    el.btnReset.addEventListener('click', function () {
      el.btnReset.classList.remove('spin');
      void el.btnReset.offsetWidth;
      el.btnReset.classList.add('spin');
      if (handlers.onReset) handlers.onReset();
    });
    el.btnSound.addEventListener('click', function () {
      if (handlers.onSoundToggle) handlers.onSoundToggle();
    });
    syncSoundButton();
  }

  function syncSoundButton() {
    var on = CG.Audio.isEnabled();
    el.btnSound.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.btnSound.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  }

  /* ---------------- direction controls ---------------- */
  function buildControls(list) {
    el.controls.innerHTML = '';
    ctrlMap = {};
    CG.DIRECTIONS.forEach(function (d) {
      if (list.indexOf(d.key) === -1) return;

      var wrap = document.createElement('div');
      wrap.className = 'ctrl';
      wrap.dataset.dir = d.key;
      wrap.dataset.armed = '1';
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', d.label + ' spaces');

      var label = document.createElement('div');
      label.className = 'ctrl-label';
      label.appendChild(svgIcon(d.glyph));
      var span = document.createElement('span');
      span.textContent = d.label;
      label.appendChild(span);

      var val = document.createElement('output');
      val.className = 'ctrl-val';
      val.id = 'val-' + d.key;
      val.textContent = '0';
      val.setAttribute('aria-live', 'polite');
      val.setAttribute('aria-label', d.label + ' value');

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

      ctrlMap[d.key] = { root: wrap, val: val, up: up, down: dn };
    });
  }

  function setValue(dir, v, bump) {
    var c = ctrlMap[dir];
    if (!c) return;
    c.val.textContent = String(v);
    if (bump) {
      c.val.classList.remove('bump');
      void c.val.offsetWidth;
      c.val.classList.add('bump');
    }
    c.up.dataset.limit = v >= CG.CONFIG.maxStep ? '1' : '0';
    c.down.dataset.limit = v <= 0 ? '1' : '0';
    applyLock(c);
  }

  /* Two different reasons a stepper can be unavailable, and the learner
     must be able to tell them apart: LIMIT is "that is as far as it
     goes" (styled as an end stop), LOCKED is "not right now, the
     aircraft is flying" (the whole dock hatches). */
  function applyLock(c) {
    c.up.disabled = locked || c.up.dataset.limit === '1';
    c.down.disabled = locked || c.down.dataset.limit === '1';
    c.up.setAttribute('aria-disabled', String(c.up.disabled));
    c.down.setAttribute('aria-disabled', String(c.down.disabled));
  }

  /* Layer 41 — state locking while the aircraft is in the air. */
  function setControlsLocked(v) {
    locked = !!v;
    if (locked) el.dock.dataset.locked = '1'; else delete el.dock.dataset.locked;
    Object.keys(ctrlMap).forEach(function (k) { applyLock(ctrlMap[k]); });
  }

  function setGoEnabled(on) {
    el.go.disabled = !on;
    /* armed = a route is set and the aircraft can be sent */
    el.go.classList.toggle('armed', !!on && !locked);
    el.go.setAttribute('aria-disabled', String(!on));
  }

  /* the dock steps aside during the concept reveal and final recap */
  function showDock(on) { el.dock.classList.toggle('dock-away', !on); }

  /* and the mission strip steps aside for the completion card */
  function showMission(on) { el.mission.classList.toggle('mission-away', !on); }

  /* dock slide-up — played once when the gameplay screen opens */
  function playDockEntry() {
    el.dock.classList.remove('dock-enter');
    void el.dock.offsetWidth;
    el.dock.classList.add('dock-enter');
  }

  /* ---------------- mission panel ---------------- */
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
          s.style.animationDelay = (i++ * 70) + 'ms';
          node.appendChild(s);
        });
      } else {
        /* inline markup (<em>, .coord) fades in as one unit. No space is
           appended — the surrounding text nodes already carry the real
           spacing, so punctuation stays tight against it. */
        var c = child.cloneNode(true);
        c.classList.add('fadeword');
        c.style.animationDelay = (i++ * 70) + 'ms';
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
    if (opts.voice !== false) {
      CG.Voice.say(opts.voice || opts.text || '');
    }
    if (opts.animate === 'words') {
      fadeWords(el.missionText, opts.text || '');
      if (opts.sub) fadeWords(el.missionSub, opts.sub); else el.missionSub.innerHTML = '';
    } else {
      el.missionText.innerHTML = opts.text || '';
      el.missionSub.innerHTML = opts.sub || '';
      if (opts.animate !== false) {
        el.mission.classList.remove('enter');
        void el.mission.offsetWidth;
        el.mission.classList.add('enter');
      }
    }
    /* The question template carries no buttons: the flow is paced by
       voice-over and by the learner's own next action. */
    el.missionActions.innerHTML = '';
  }

  function setLevelPill(now, total) {
    el.levelNow.textContent = String(now);
    el.levelTotal.textContent = String(total);
  }

  /* ---------------- coordinate tag beside the aircraft ---------------- */
  function coordTag(stageX, stageY, text, kicker) {
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
    window.setTimeout(function () { el.coordTag.hidden = true; }, 280);
  }

  /* ---------------- tutorial highlight + hand ---------------- */
  function highlight(what) {
    Array.prototype.forEach.call(
      document.querySelectorAll('.tut-hi'),
      function (n) { n.classList.remove('tut-hi'); }
    );
    if (!what || what === 'target') return;   /* the waypoint glow lives in grid.js */
    if (what === 'go') { el.go.classList.add('tut-hi'); return; }
    if (ctrlMap[what]) ctrlMap[what].root.classList.add('tut-hi');
  }

  /* anchor the hand under a control's stepper (stage-space coords) */
  function handAt(what) {
    var node = null;
    if (what === 'go') node = el.go;
    else if (ctrlMap[what]) node = ctrlMap[what].up;
    if (!node) { hideHand(); return; }

    var sRect = el.stage.getBoundingClientRect();
    var scale = sRect.width / 1920;
    var r = node.getBoundingClientRect();
    var x = (r.left + r.width / 2 - sRect.left) / scale;
    var y = (r.top + r.height / 2 - sRect.top) / scale;

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

  function bindChip(b) {
    var drag = null;

    b.addEventListener('pointerdown', function (e) {
      if (b.disabled) return;
      b.setPointerCapture(e.pointerId);
      var r = b.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
      b.classList.add('chip-dragging');
    });

    b.addEventListener('pointermove', function (e) {
      if (!drag) return;
      drag.moved = true;
      /* lift the chip out of the tray and let it follow the pointer in
         viewport space — the stage is scaled, so a transform in stage
         units would drift away from the cursor */
      b.style.position = 'fixed';
      b.style.left = (e.clientX - drag.dx) + 'px';
      b.style.top = (e.clientY - drag.dy) + 'px';
      b.style.zIndex = 40;
      highlightNearestZone(e.clientX, e.clientY);
    });

    b.addEventListener('pointerup', function (e) {
      if (!drag) return;
      b.classList.remove('chip-dragging');
      var hit = drag.moved ? nearestZone(e.clientX, e.clientY) : null;
      b.style.position = ''; b.style.left = ''; b.style.top = '';
      b.style.zIndex = '';
      clearZoneHighlight();
      drag = null;
      /* dropped on empty water: the chip simply returns to the tray */
      if (hit && tray.onDrop) tray.onDrop(b.dataset.key, hit);
    });

    b.addEventListener('pointercancel', function () {
      if (!drag) return;
      b.classList.remove('chip-dragging');
      b.style.position = ''; b.style.left = ''; b.style.top = '';
      b.style.zIndex = '';
      clearZoneHighlight(); drag = null;
    });

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

  function nearestZone(cx, cy) {
    var best = null, bestD = Infinity;
    tray.zones.forEach(function (k) {
      var r = CG.Grid.dropZoneRect(k);
      if (!r) return;
      var d = Math.hypot(cx - r.cx, cy - r.cy);
      /* generous: anywhere within roughly a zone's width counts */
      if (d < bestD && d < 190) { bestD = d; best = k; }
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
    setValue: setValue,
    setControlsLocked: setControlsLocked,
    setGoEnabled: setGoEnabled,
    showDock: showDock,
    showMission: showMission,
    playDockEntry: playDockEntry,
    mission: mission,
    setLevelPill: setLevelPill,
    coordTag: coordTag,
    emphasiseCoord: emphasiseCoord,
    hideCoordTag: hideCoordTag,
    highlight: highlight,
    handAt: handAt,
    hideHand: hideHand,
    syncSoundButton: syncSoundButton,
    dragTray: dragTray, clearDragTray: clearDragTray,
    chipDone: chipDone, chipWrong: chipWrong
  };
})();
