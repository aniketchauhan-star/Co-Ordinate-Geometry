# PERFORMANCE BRIEF — Co-ordinate Geometry

You are a senior front-end performance engineer working on a 2D browser game for
children. It runs well on the machine it was built on and stutters on other
laptops and on tablets. Your job is to make it run smoothly on low-end hardware
**without changing how it looks or how it plays.**

---

## 0. WHAT YOU ARE WORKING ON

Vanilla HTML/CSS/JS, no framework, no build step. Open `index.html` and it runs.

- `index.html` — one fixed 1920x1080 "stage" containing every screen and layer.
- `styles.css` — ~2000 lines. All visuals.
- `js/` — `game.js` (flow), `grid.js` (SVG chart), `ui.js` (dock + panels),
  `levels.js` (data + tunables), `audio.js`, `voice.js`, `preload.js`,
  `intro.js` / `arrival.js` (cinematics), `lesson.js`.

The whole stage is scaled to fit the window by ONE transform:
`.stage { width:1920px; height:1080px; transform: translate(-50%,-50%) scale(var(--s)) }`.
Every size in the CSS is a design pixel on that canvas. **This is why there are
no `vw` units or `clamp()` sizes anywhere, and you must not add any** — a `vw`
inside the stage is measured against the window and then scaled a second time.

---

## 1. HARD CONSTRAINTS — DO NOT BREAK THESE

1. **No visual redesign.** Same colours, sizes, spacing, and timings. If a
   optimisation would visibly change the design, propose it, do not apply it.
2. **No gameplay changes.** Do not touch the flow in `game.js`, the level data
   in `levels.js`, or the teaching sequence.
3. **Preserve every DOM hook.** `#mission`, `#missionText`, `#missionSub`,
   `#missionActions`, `#dock`, `#controls`, `#btnGo`, `#field` and its layer
   groups, `.ctrl[data-dir][data-armed]`, `.ctrl-label`, `.ctrl-val`,
   `.stepper`, `.step-btn[data-limit]`, `.dock-enter` / `.dock-away` /
   `[data-locked]`. `ui.js` builds the dock at runtime and reads these.
4. **Keep the design-pixel model.** No `vw`, `vh`, or `clamp()` inside `.stage`.
5. **Keep it dependency-free.** No build step, no bundler, no libraries.
6. **Keep the existing `@media (prefers-reduced-motion: reduce)` block working.**
   There is exactly one such block in `styles.css` and it must stay the only one.

---

## 2. MEASURE BEFORE YOU CHANGE ANYTHING

Do not optimise from a list of suspects — including the one below. Profile first
and report numbers.

1. Chrome DevTools → **Performance**, record: page load through the two
   cinematics, then one full mission (set a direction, press GO, watch the
   flight, watch the reveal).
2. Enable **Rendering → Frame Rendering Stats**, **Paint flashing**, and
   **Layer borders**. Note where paint flashing covers large areas.
3. Throttle to **4x CPU slowdown** — that is roughly a low-end laptop or tablet.
4. Record: FPS during the flight animation, FPS during the post-arrival reveal,
   number of composited layers, total layer memory, and any long task > 50ms.
5. Write these numbers down. Every change below must be re-measured against them.

---

## 3. THE PRIME SUSPECTS (from reading the code, not from profiling)

These are the things most likely to be costing frames. Confirm each with the
profiler before acting.

### 3.1 Animated `filter: drop-shadow()` — probably the single biggest cost

`styles.css` uses `drop-shadow` in ~34 places. A drop-shadow is a blur, and a
blur cannot be GPU-composited the way `transform` and `opacity` can: every frame
of an animation that changes it, or that changes anything on an element carrying
it, is re-rasterised on the CPU.

Look at, at minimum: `.axis-span-line`, `.axis-span-head`, `.axis-pip`,
`.hint-span`, `.hint-pip`, `.named-val` / `.named-val-plate`, `#axisEnds`,
`#axisNums`, `#ticks`, `.pulse-line`, `.ctrl-label svg`, `.play-btn img`.

**The fix pattern:** never animate a filter. Put the glow on a second, stacked
element that is pre-rasterised once, and cross-fade it with `opacity`. Opacity is
free on the compositor; a blur is not.

### 3.2 Animated `box-shadow`

`@keyframes goReady` animates a 6-value box-shadow on `#btnGo` forever while a
route is set. `.ctrl.tut-hi .ctrl-label` and `.play-btn` do similar. Each frame
is a full repaint of the element.

**The fix pattern:** draw the ring as an absolutely positioned `::after` and
animate `transform: scale()` + `opacity` on it instead.

### 3.3 Animated `stroke-width` on SVG

`@keyframes linePulse` (`.pulse-line`) and `@keyframes axisNamed`
(`#axes line.axis-hot`) animate `stroke-width`. That is a geometry change: the
browser re-tessellates the path every frame.

**The fix pattern:** two stacked strokes at the two widths, cross-faded with
`opacity`.

### 3.4 Thirty-one `infinite` animations

Count them: `grep -c infinite styles.css`. Several run at once and forever — the
ocean (`.swell`, `.caustic`, `.glint`, `.surf-band`, `.cloud`), the target
beacon, the armed GO ring, the question bar's gold breath, the axis pulses.

The ambient water layers are full-stage composited surfaces. At 1920x1080x4
bytes that is ~8MB of GPU texture each, and six of them carry `will-change` on
top of that.

**Establish a budget** — for example, at most 4 infinite animations running at
any one time — and enforce it.

### 3.5 SVG group filters cover the whole chart

`#axisNums`, `#ticks` and `#axisEnds` each carry a `filter` on the **group**. An
SVG filter region is the bounding box of everything in the group, so a glow on
one number costs a filter pass across the entire chart. `#gridLines` already had
its filter removed for exactly this reason — see the note in the CSS.

### 3.6 Start-up cost

`js/preload.js` fetches 4.46MB before the play button appears, of which 3.5MB is
one background-music `.ogg`. On a slow connection that is a long stare at a
loading bar, which users experience as "the game is slow" even though it is
network, not rendering.

Consider: stream the music rather than blob-preloading it, re-encode it at a
lower bitrate, or release the play button once the images are in and let the
music finish in the background. The preloader is already sorted smallest-first,
so the images land at ~15% — that hook already exists.

---

## 4. ADD A LOW-END TIER

The reduced-motion block in `styles.css` is already a working list of "everything
expensive, off". Reuse that structure, keyed on a class instead of a media query.

1. Add `.stage.perf-lite` and put the ambient ocean animations, the glows and
   the infinite pulses behind it.
2. Detect a weak device at boot and set the class:
   - `navigator.hardwareConcurrency <= 4`
   - `navigator.deviceMemory <= 4`
   - or, more reliable than either, **measure**: sample
     `requestAnimationFrame` for the first ~2 seconds of the intro cinematic and
     switch to lite mode if the average frame time is over ~22ms.
3. The measured check is the one to trust. Device hints lie, especially on iPads.
4. Lite mode must still look like the same game: keep the artwork, the layout and
   every colour. Drop ambient motion and glows, never content.
5. Let the user override it. A key or a setting is fine; do not make it sticky
   across sessions without saying so.

## 5. EXTEND THE EXISTING IDLE PAUSE

`styles.css` already pauses the ocean on `.stage.page-idle`, set from a
`visibilitychange` listener in `game.js`. Extend the same idea:

- Pause ambient motion during the two cinematics, where it is not visible anyway.
- Pause it while a modal screen (start, complete) is over the stage.
- Drop `will-change` when a layer is not animating — it is currently declared in
  8 places and `will-change` held permanently is a memory leak by design.

---

## 6. WHAT NOT TO DO

- Do not add `will-change` to more elements. It is a promise to the compositor
  that costs memory; it is already over-used here.
- Do not replace CSS animations with JavaScript ones. That will be slower.
- Do not add `requestAnimationFrame` loops. There are already several
  (`intro.js`, `arrival.js`, `game.js`, `grid.js`, `audio.js`).
- Do not lower image quality or resolution as a first move — measure whether
  decode is actually on the critical path first.
- Do not introduce a canvas renderer. The SVG chart is not the problem until the
  profiler says it is.

---

## 7. ACCEPTANCE CRITERIA

With **4x CPU throttling** in Chrome:

- [ ] Sustained 60fps during the flight animation; no frame over 32ms.
- [ ] Sustained 60fps during the post-arrival reveal.
- [ ] No long task over 50ms after boot.
- [ ] Composited layer count and total layer memory both down from the baseline.
- [ ] Paint flashing does not cover the whole stage during ambient motion.

On a real tablet (iPad or mid-range Android):

- [ ] The aircraft moves smoothly with no visible stutter at the corner.
- [ ] Tapping a stepper responds within one frame.
- [ ] The game is playable within 10 seconds of a warm load.

And in every case:

- [ ] Side-by-side screenshots before and after are visually identical.
- [ ] Every mission still plays through to the completion screen.
- [ ] Voice-over, sound, reset and the keyboard controls all still work.

---

## 8. HOW TO REPORT

For each change: what you measured before, what you changed, what you measured
after. If a change did not help, say so and revert it. A list of applied
optimisations with no numbers attached is not a result.
