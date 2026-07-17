# Comment Field

Comment Field is a local-first motion-design workbench for building the Papa Murphy's social-comment sequence described in [`docs/comment_field_packet`](docs/comment_field_packet/00_START_HERE.md).

The application ingests comment copy, generates deterministic spatial layouts, supports direct card art direction, records mouse-directed build performances, promotes a hero card, bakes editable local reflow targets, stores multiple takes, and exports deterministic numbered PNG frames.

## Agency preview

The repository includes a GitHub Pages deployment workflow. Once Pages is enabled with **GitHub Actions** as its source, every push to `main` runs the test suite, builds the production app, and updates the browser-based preview. The hosted app remains local-first: project work is saved in that browser's IndexedDB and is not uploaded to a server.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open the URL printed by Vite. The project autosaves in the browser through IndexedDB. No server or account is required.

Production verification:

```powershell
npm.cmd run test:run
npm.cmd run build
npm.cmd run preview
```

## First workflow

1. Paste comments or import a `.txt` / `.json` comment file.
2. Review the valid and malformed counts, then choose **Apply**.
3. Choose a composition and set a visible layout seed.
4. Generate the field, drag cards, adjust depth/scale/rotation, and lock approved cards.
5. Add and edit protected regions.
6. Configure or randomize a global build, or record a mouse path through the field.
7. Create and switch among takes without duplicating the composition.
8. Select a card, choose **Make hero**, set its target, and generate local reflow.
9. In **Edit reflow** mode, drag generated neighbor targets to refine them.
10. Verify the current frame hash, save the project JSON, and export numbered PNGs.

The viewer opens at the end of the current take so the field is immediately available for art direction. Pressing **Play** from the end resets playback to frame zero.

## Plain-text comment format

```text
@PizzaFan88 | We need chunky sausage back
@SauceBoss | This was the best topping
@CrustCritic | Ordering somewhere else
```

Malformed lines remain visible in the preview report and are not imported.

## JSON comment format

The importer accepts an array. `handle` and `message` are required; other values receive deterministic fallbacks.

```json
[
  {
    "id": "comment-001",
    "username": "PizzaFan88",
    "handle": "@PizzaFan88",
    "message": "We need chunky sausage back",
    "timestamp": "2m",
    "replies": 1,
    "reposts": 2,
    "likes": 7,
    "heroEligible": true
  }
]
```

## Deterministic rendering contract

Every rendered frame is evaluated from absolute state and time:

```ts
evaluateScene(composition, take, absoluteTime)
```

The renderer does not accumulate frame-to-frame simulation. Layouts use stored seeds and explicit placements. Global builds and gestures resolve to stored per-card triggers. Reflow resolves to stored target transforms. Preview, frame verification, and PNG export use the same Three.js scene.

## State ownership

- Project: comments, card style, entrance motion, embedded assets, compositions, takes, schema version.
- Composition: resolution, frame rate, field bounds, seed, base placements, static camera, background, protected regions.
- Take: duration, camera and hero keyframes, build controls, recorded samples, resolved triggers, reflow targets, favorite, notes.

A take references a composition and does not duplicate the common layout.

## Export

The required export lane is a ZIP containing numbered PNG frames such as:

```text
landscape-16-9-take-01_000001.png
landscape-16-9-take-01_000002.png
landscape-16-9-take-01_000003.png
```

Quarter-, half-, and full-resolution export scales are available. H.264 is intentionally not implemented in this first build because the implementation packet makes PNG frames the required reliable fallback.

## Current boundaries

- Final client-approved comment copy and clean production background imagery are not included in the packet.
- Cross-browser or cross-GPU byte identity is not claimed. Same-state, same-runtime frame identity is verified in the workbench with SHA-256.
- After Effects reconstruction, ProRes, cloud project storage, per-card keyframe tracks, and a general layer timeline remain out of scope.

See [`docs/ACCEPTANCE_RESULTS.md`](docs/ACCEPTANCE_RESULTS.md) for the requirement-by-requirement verification record and [`docs/MORNING_HANDOFF.md`](docs/MORNING_HANDOFF.md) for the dial-in handoff.
