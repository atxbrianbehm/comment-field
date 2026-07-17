# Comment Field Hardening Packet

This packet records the current architecture, enforcement, and proof lane for the agency-facing Comment Field authoring tool.

## Release posture

- The browser renderer is WebGPU-only. Startup acquires `navigator.gpu`, requests an adapter, initializes Three's WebGPU backend, and stops on an unsupported-device screen if any step fails.
- Custom card compositing is explicit WGSL in `packages/comment-field-webgpu-runtime/src/shaders/card-composite.wgsl`, loaded through `wgslFn`. There is no WebGL or GLSL fallback.
- The deterministic comment-field engine is a DOM-free internal package. It owns project models, migration, layout, animation evaluation, gestures, and reflow.
- React is the artist-facing surface. It owns workspaces, controls, persistence orchestration, timeline interaction, and export commands.
- The WebGPU runtime is the only adapter allowed to touch Three.js, GPU resources, texture generation, picking, projection, or frame readback.

## Required verification

Run `npm run verify`. It executes:

1. architecture boundaries, import cycles, graphics-generation rules, and file-size caps;
2. standalone engine typecheck;
3. standalone WebGPU runtime typecheck;
4. deterministic unit and migration tests;
5. full application typecheck and production build.

The same command is a blocking step in the GitHub Pages deployment workflow.

## Current evidence

- Architecture gate: 57 production files and 2 test files checked; no boundary drift or cycles.
- Tests: 39 passing across deterministic behavior, migrations, performance profiles, motion blur, and progressive preview ordering.
- Production build: successful with Vite 8.1.4.
- Startup is split into a 186 KB bootstrap, a 56 KB authoring surface, lazy workspaces/export, and two sub-3 KB workers. The lazy Three.js/WebGPU runtime remains an 885 KB advisory chunk.
- Browser deterministic verification after the final surface split produced hash `80d12bda` on the WebGPU renderer.
- Both compositions passed live acceptance: landscape rendered through the production WebGPU path, and portrait completed all 240 RAM-preview frames at 540×960. The portrait pass also exercises padded WebGPU readback rows.
- The help surface opens from the global toolbar and exposes Field, Design, and Animate guidance.
- The 24 fps performance lane includes deterministic toggleable motion blur, worker card rasterization, a persistent 12 fps draft refined to exact 24 fps, worker WebCodecs decode, and adaptive phone/tablet/desktop density.
- The responsive authoring shell passed a 390x844 surface capture with fixed Stage/Comments/Controls navigation and a compact shot timeline.

See [architecture-map.md](./architecture-map.md) for ownership and [hardening-status.json](./hardening-status.json) for machine-readable status.
See [performance-mobile.md](./performance-mobile.md) for the playback, worker, mobile, and atlas decisions.

## Refactor evidence

Largest pre-hardening modules were decomposed without changing the project schema:

| Module | Before | Current responsibility |
|---|---:|---|
| `src/app/App.tsx` | 847 logical lines | 254 logical lines; composition root only |
| `src/app/AuthoringWorkspaces.tsx` | 584 | 4; public workspace barrel |
| `src/renderer/CommentScene.tsx` | 722 | 332 logical lines; React lifecycle and input adapter |
| `tests/core.test.ts` | 514 | 429 logical lines; migration coverage moved to a dedicated suite |

The hard cap is 400 physical lines for production source and 500 for tests. Declarations, generated output, vendor code, and shader assets are excluded.
