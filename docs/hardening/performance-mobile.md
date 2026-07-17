# Performance and Mobile Proof

## Playback target

- New compositions author and preview at 24 fps.
- Preview caching renders a complete 12 fps draft pass first, then fills the missing frames to exact 24 fps.
- A playable draft remains available while refinement is paused for playback.
- The compressed active draft is persisted by render key; selection, playhead, workspace, and inspector changes do not invalidate it.
- Rolling decode runs in a worker through WebCodecs `ImageDecoder` when available, then worker `createImageBitmap`, then a main-thread fallback.

## Render cost controls

- Live canvas density is selected from phone, tablet, and desktop profiles. Phone is 1x; desktop is capped at 1.5x. Production PNG export remains exact resolution at 1x export dimensions.
- Card texture rasterization runs in an `OffscreenCanvas` worker and keeps old textures visible during replacement.
- Cards without blur or motion blur use the basic one-sample WGSL material. The multi-sample WGSL path is selected only when an effect is visible.
- Design, Animate workspaces, help, export, card raster, and preview decode are split out of startup.

## Mobile surface

- Phone portrait uses a one-column `100dvh` shell with safe-area padding.
- Comments and field controls are dismissible bottom sheets; the stage remains the default surface.
- Field transform targets and timeline key/out-point targets are at least 48px.
- Overview supports one-pointer pan plus two-pointer pan/zoom. Card translation remains one-pointer direct manipulation.
- The compact timeline retains scrubbing, cache progress, playback, and the draggable out-point. Take length is also editable from the Controls sheet.
- A development-only `?surface-proof=1` gate bypass allows responsive surface capture when headless Chrome has no WebGPU adapter. Production builds cannot bypass the WebGPU requirement.

## Acceptance evidence

- Live WebGPU browser: 30/30 card textures reached Ready through worker rasterization.
- Progressive preview: the status changed from `building fast 12 fps draft pass` to `12 fps draft ready; refining exact 24 fps preview`; RAM playback was active at 103/192 frames.
- Mobile layout: isolated headless Chrome capture at 390x844 confirmed the responsive shell and fixed mobile navigation. The headless renderer correctly reported WebGPU unavailable while the development-only surface harness remained inspectable.
- Repository gate: 57 production files, 2 test files, 39 passing tests, standalone engine/runtime typechecks, and a successful production build.

## Atlas and instancing decision

Texture atlasing is deliberately deferred. Every visible card has independently invalidated text content, and the current cache replaces one texture without disturbing the others. An atlas would turn a one-card content edit into atlas repacking or introduce fragmentation and indirection. The current field size is better served by worker rasterization, texture reuse, conditional shaders, adaptive pixel density, and cached playback. Atlas/instancing should be reconsidered only if captured GPU timing identifies bind or draw submission as the remaining 24 fps bottleneck.
