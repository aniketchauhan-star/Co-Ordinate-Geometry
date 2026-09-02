/* ============================================================
   voice.js — mission voice-over via the browser SpeechSynthesis
   API. No audio files are fetched; if the API is missing the game
   simply runs silent.

   Rules (requirement 20):
     · never overlap — cancel() before every new line
     · never repeat the same line twice in a row
     · cancelled by mute, reset, level change and tutorial exit
     · nothing is ever spoken before the player presses PLAY
   ============================================================ */
window.CG = window.CG || {};

CG.Voice = (function () {
  var synth = window.speechSynthesis || null;
  var supported = !!(synth && window.SpeechSynthesisUtterance);
  var enabled = true;
  var unlocked = false;          /* set on the first real user gesture */
  var voice = null;
  var lastSaid = '';
  var pending = null;

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
        if (pending) { var p = pending; pending = null; say(p, true); }
      });
    }
  }

  /* the music bed steps down while an instruction is spoken */
  function duck(on) {
    if (CG.Audio && CG.Audio.duck) CG.Audio.duck('voice', on);
  }

  function cancel() {
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

  /* say(text, force) — force re-speaks a line even if it just played */
  function say(text, force) {
    if (!supported || !enabled || !unlocked) return;
    var line = clean(text);
    if (!line) return;
    if (!force && line === lastSaid) return;      /* don't nag */

    if (!voice) {                                  /* voices not ready yet */
      refreshVoice();
      if (!voice) { pending = text; return; }
    }

    cancel();                                      /* requirement 20 */
    lastSaid = line;
    try {
      var u = new window.SpeechSynthesisUtterance(line);
      u.onstart = function () { duck(true); };
      u.onend = function () { duck(false); };
      u.onerror = function () { duck(false); };
      u.voice = voice;
      u.lang = (voice && voice.lang) || 'en-GB';
      u.rate = 0.80;      /* unhurried, classroom pace */
      u.pitch = 1.0;
      u.volume = 0.9;
      synth.speak(u);
    } catch (err) {
      console.warn('[voice] could not speak:', err);
    }
  }

  return {
    isSupported: function () { return supported; },
    unlock: function () { unlocked = true; },
    say: say,
    cancel: cancel,
    numWord: numWord,
    setEnabled: function (v) {
      enabled = !!v;
      if (!enabled) cancel();
    }
  };
})();
