/* ============================================================
   voice.js — mission voice-over via the browser SpeechSynthesis
   API. No audio files are fetched; if the API is missing the game
   simply runs silent.

   Rules (requirement 20):
     · never overlap — cancel() before every new line
     · never repeat the same line twice in a row
     · cancelled by mute, reset, level change and tutorial exit
     · nothing is ever spoken before the player presses PLAY
     · sequence() chains lines on the synthesiser's own `end` event,
       so a second line can never be started over a slow first one
   ============================================================ */
window.CG = window.CG || {};

CG.Voice = (function () {
  var synth = window.speechSynthesis || null;
  var supported = !!(synth && window.SpeechSynthesisUtterance);
  var enabled = true;
  var unlocked = false;          /* set on the first real user gesture */
  var voice = null;
  var lastSaid = '';
  var pending = null;             /* {text, done} — voices not ready yet   */
  var chainToken = 0;             /* bumped by cancel(); abandons a chain  */

  if (!supported) console.info('[voice] SpeechSynthesis unavailable — voice-over disabled.');

  /* Prefer a natural en-* voice; fall back to whatever English exists. */
  var PREFERRED = [
    'Samantha', 'Serena', 'Karen', 'Moira', 'Tessa', 'Daniel',
    'Google UK English Female', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny'
  ];

  function pickVoice() {
    if (!supported) return null;
    var list = synth.getVoices() || [];
    if (!list.length) return null;
    var i, v;
    for (i = 0; i < PREFERRED.length; i++) {
      v = list.filter(function (o) { return o.name.indexOf(PREFERRED[i]) === 0; })[0];
      if (v) return v;
    }
    v = list.filter(function (o) { return /^en[-_]GB/i.test(o.lang); })[0];
    if (v) return v;
    v = list.filter(function (o) { return /^en/i.test(o.lang); })[0];
    return v || list[0];
  }

  function refreshVoice() { voice = pickVoice(); }
  if (supported) {
    refreshVoice();
    /* voice list is populated asynchronously in most browsers */
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', function () {
        refreshVoice();
        if (pending) { var p = pending; pending = null; say(p.text, true, p.done); }
      });
    }
  }

  /* the music bed steps down while an instruction is spoken */
  function duck(on) {
    if (CG.Audio && CG.Audio.duck) CG.Audio.duck('voice', on);
  }

  function cancel() {
    chainToken++;             /* whatever was queued behind this is off */
    pending = null;
    lastSaid = '';
    duck(false);              /* cancel does not always fire onend */
    if (!supported) return;
    try { synth.cancel(); } catch (e) { /* nothing queued */ }
  }

  /* Strip the inline markup the mission panel uses so the reader does
     not pronounce tags, and expand the co-ordinate shorthand. */
  function clean(text) {
    return String(text)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g,
               function (m, a, b) { return numWord(+a) + ', ' + numWord(+b); })
      .replace(/\s+/g, ' ')
      .trim();
  }

  var WORDS = ['zero', 'one', 'two', 'three', 'four', 'five',
               'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
               'twelve', 'thirteen', 'fourteen'];

  function numWord(n) {
    var neg = n < 0, a = Math.abs(n);
    var w = WORDS[a] != null ? WORDS[a] : String(a);
    return neg ? 'negative ' + w : w;
  }

  /* Roughly how long a line will take to speak, in ms. Only ever used
     as a BACKSTOP: speechSynthesis is known to drop `end` entirely if
     the tab is backgrounded mid-utterance, and a chain waiting on an
     event that is never coming would hang the game behind it. */
  function estimate(line) {
    var words = line.split(/\s+/).length;
    return 1200 + Math.round(words * 620);
  }

  /* say(text, force, done)
       force — re-speak a line even if it just played
       done  — called once the line has finished, been abandoned, or was
               never speakable at all. It always fires exactly once, so
               a caller can safely gate the next thing on it. */
  function say(text, force, done) {
    var settled = false;
    function settle() {
      if (settled) return;
      settled = true;
      if (done) done();
    }

    if (!supported || !enabled || !unlocked) { settle(); return; }
    var line = clean(text);
    if (!line) { settle(); return; }
    if (!force && line === lastSaid) { settle(); return; }   /* don't nag */

    if (!voice) {                                  /* voices not ready yet */
      refreshVoice();
      if (!voice) { pending = { text: text, done: done }; return; }
    }

    cancel();                                      /* requirement 20 */
    var mine = chainToken;
    lastSaid = line;
    try {
      var u = new window.SpeechSynthesisUtterance(line);
      var guard = window.setTimeout(function () {
        if (mine === chainToken) settle();
      }, estimate(line) + 4000);
      var finish = function () {
        window.clearTimeout(guard);
        duck(false);
        if (mine === chainToken) settle();         /* a cancel owns it now */
      };
      u.onstart = function () { duck(true); };
      u.onend = finish;
      u.onerror = finish;
      u.voice = voice;
      u.lang = (voice && voice.lang) || 'en-GB';
      /* ITEM 12: "slow, not too fast". Below the 0.88-0.95 band an
         earlier brief gave, and now below the 0.84 that replaced it —
         each revision has asked for slower, and this is a game read
         aloud to children who are also being asked to count. */
      u.rate = 0.76;
      u.pitch = 1.0;
      u.volume = 0.9;
      synth.speak(u);
    } catch (err) {
      console.warn('[voice] could not speak:', err);
      settle();
    }
  }

  /* sequence(lines, done) — speak the lines IN ORDER, each one starting
     only when the one before it has actually finished, then call done().
     This is the only correct way to say two sentences in a row: say()
     cancels whatever is speaking, so two back-to-back calls play the
     second line and lose the first.

     If speech is unavailable or muted there is nothing to wait for and
     done() runs immediately — anything gated on the narration has to
     stay reachable with the sound off. */
  function sequence(lines, done) {
    var list = (lines || []).slice();
    var token = chainToken;
    function step() {
      if (token !== chainToken) return;            /* cancelled — drop it */
      if (!list.length) { if (done) done(); return; }
      var line = list.shift();
      say(line, true, function () {
        token = chainToken;                        /* say() bumped it */
        step();
      });
    }
    step();
  }

  return {
    isSupported: function () { return supported; },
    unlock: function () { unlocked = true; },
    say: say,
    sequence: sequence,
    cancel: cancel,
    numWord: numWord,
    setEnabled: function (v) {
      enabled = !!v;
      if (!enabled) cancel();
    }
  };
})();
