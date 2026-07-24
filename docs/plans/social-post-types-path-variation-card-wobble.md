# Social Post Types, Path Variation, and Card Wobble

## Outcome

Extend Comment Field without weakening the engine/runtime/surface boundary:

- One shared text-post template can render as X / Twitter, Instagram, or Facebook.
- Shared entrance and exit lines can produce stable per-card variants.
- Cards can optionally flex in 3D using an absolute-time WebGPU wobble adapted from Transform Scatter's leaf deformation.

Existing projects must render as before after migration.

## Architecture

| Layer | Responsibility |
| --- | --- |
| Engine | Schema, defaults, migration, stable hashing, path perturbation, and absolute-time wobble evaluation |
| WebGPU runtime | Shared card rasterization, subdivided card geometry, WGSL vertex deformation, texture and preview cache invalidation |
| Surface | Platform selector, path-variation sliders, wobble controls, help copy, and touch-sized controls |

The engine remains renderer-independent. WGSL remains runtime-only. React authoring code only patches project values.

## Persistence and compatibility

- Schema version 21 adds `CardStyle.postType`, entrance and exit `pathVariation`, and `RenderSettings.cardWobble`.
- New projects default to X cards with subtle path variance and wobble disabled.
- Version 20 and older projects migrate to X cards, zero path variance, and disabled wobble. This keeps their existing raster and motion output stable.
- Preview cache evaluation is incremented because deformation and card layout affect pixels.

## Social post setups

All layouts consume the existing `CommentRecord` and shared `CardStyle`; media posts are deliberately out of scope until comments can own media assets.

- X / Twitter retains the current header, copy, and reply/repost/like row.
- Instagram uses a ringed avatar, lighter copy treatment, and Instagram-like engagement order.
- Facebook uses its metadata order, darker blue-black text, a divider, and Like/Comment/Share actions.

`renderCardSurface` remains the single raster source used by Design preview, workers, cached textures, RAM preview, and production export.

## Path variation

- `pathVariation = 0` returns the original authored path exactly.
- A stable identity (`composition seed + card ID` for entrances, `population seed + card ID + cycle` for exits) perturbs start and control points.
- The final resting destination remains fixed.
- Control-point variance tapers toward the destination to avoid noisy landings.
- Shared and generated Rain/Scatter paths both accept variation.

## Card wobble

Transform Scatter's useful construction is preserved:

- Six by eight plane subdivisions.
- Stable per-card phase, speed, and amplitude derived from seed and card ID.
- Exact absolute-time evaluation with no simulation history.
- A WGSL vertex function bends the card away from its lower edge and adds real local Z displacement.

Comment Field intentionally omits leaf-specific curl/twist and picking geometry. Its existing selection quad remains the authoring envelope, and the planar soft shadow remains a restrained approximation.

## Authoring and acceptance

- Design exposes Post setup plus Wobble enabled, amount, speed, and variation.
- Shared entrance and Shared exit each expose Path variation.
- Range controls retain a small visual rail while receiving a 40px touch target.
- Help explains which settings are shared and deterministic.

Acceptance requires engine/runtime/application typechecks, unit migration and determinism coverage, a production bundle, and a live WebGPU browser pass with no console errors.
