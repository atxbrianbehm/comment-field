# Comment Field Acceptance Results

Date: 2026-07-16

## Automated evidence

- `npm.cmd run test:run`: 8 tests passing.
- `npm.cmd run build`: production TypeScript and Vite build passing.
- Repeated same-state, nonzero-time browser frame: matching SHA-256 prefix `b65621ac`.
- Actual quarter-resolution 30-frame PNG sequence smokes completed for both landscape and portrait with the application status `PNG sequence exported` (about 1.1 s and 0.6 s respectively in the verification browser).

The automated suite covers stable comment parsing, deterministic seeded scatter, deterministic build and gesture resolution, absolute-time repeatability, gesture-unreached card behavior, project save/load equality, deterministic reflow generation, and deterministic PNG numbering/packaging.

## Acceptance checklist

| # | Requirement | Result | Evidence |
|---:|---|---|---|
| 1 | Create 16:9 composition | Pass | Default `1920 × 1080` landscape composition. |
| 2 | Paste at least 30 comments | Pass | Default fixture and browser preview contain 30 valid comments; paste and file import use the same parser. |
| 3 | Generate plausible deterministic field | Pass | Seeded scatter is unit-tested and rendered in Three.js. |
| 4 | Change seed for visibly different field | Pass | Browser seed changed from `papas-169-01` to `papas-169-02`; pure scatter test confirms different transforms. |
| 5 | Restore original seed and layout | Pass | Browser restored `papas-169-01`; pure scatter test proves exact equality for identical seed and state. Locked manual transforms intentionally remain locked. |
| 6 | Drag cards | Pass | Browser drag changed a selected card from `(0.7346, 0.6421)` to `(0.8208, 0.6028)`. |
| 7 | Adjust depth | Pass | Selected-card depth control is connected to composition state and browser-visible. |
| 8 | Define protected central region | Pass | Browser created editable `Protected 1` at `x .38`, `y .36`, `w .24`, `h .28`. |
| 9 | Preview randomized global build | Pass | Four ordering modes, stored seed, randomize action, absolute-time playback, fade/scale/blur/drift controls. |
| 10 | Record mouse-directed build | Pass | Browser recorded 7 normalized samples and baked 12 triggers. |
| 11 | Save Take 01 | Pass | Default Take 01 persisted through IndexedDB autosave and project JSON model. |
| 12 | Record/create Take 02 and Take 03 | Pass | Browser created Take 02 and Take 03. |
| 13 | Switch takes without base-layout change | Pass | Browser switched back to Take 01 and recovered its 7-sample/12-trigger performance; composition state is separate. |
| 14 | Select hero | Pass | Browser selected `@PapaMurphys` as hero. |
| 15 | Animate hero to target | Pass | Browser rendered hero at the configured center target, scale, and forward depth. |
| 16 | Generate local reflow | Pass | Browser baked 10 local targets; solver is protected-region-aware and unit-tested. |
| 17 | Manually adjust reflow target | Pass | Edit-reflow canvas drag changed a baked target; new code restricts edits to generated targets. |
| 18 | Save and reload project | Pass | JSON serialize/deserialize equality test; IndexedDB reload restored authored browser state. |
| 19 | Same take identical after reload | Pass | Absolute-time test and browser repeated-frame SHA-256 verification. |
| 20 | Export H.264 or numbered PNGs | Pass | Required PNG ZIP lane completed a real 30-frame browser export; file numbering/packaging is unit-tested. |
| 21 | Separate 9:16 composition using same data/style | Pass | Browser switched to isolated `1080 × 1920` composition and its own portrait take. |
| 22 | Export useful preview for both ratios | Pass technically; creative review pending | Real 30-frame PNG ZIP exports completed for both landscape and portrait. Final editorial usefulness requires approved copy/background and human timing review. |

## Completion-standard boundary

The software path can create, save, replay, and export at least three distinct takes without source edits. Final editorial approval of three client-ready takes is still human-owned because the packet contains only six approved sample records, synthetic filler copy, phone screenshots of the storyboard, and no clean production background plate.

## Deliberate non-goals

No time was spent on a general timeline, node graph, template authoring, style inference, CSV expansion, ProRes, After Effects reconstruction, cloud rendering/storage, automatic aspect-ratio adaptation, or individually animated pizza slices.
