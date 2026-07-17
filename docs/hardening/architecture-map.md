# Architecture Map

```text
Artist surface (src/app)
  | project commands and immutable edits
  v
Deterministic engine (@comment-field/engine)
  | evaluated scene state, camera state, layout, migration
  v
WebGPU adapter (@comment-field/webgpu-runtime)
  | WGSL node material, Three WebGPU backend, textures, picking, readback
  v
Browser WebGPU device
```

## Engine

Location: `packages/comment-field-engine`

The engine is pure ES2022 TypeScript. It has no React, DOM, Three.js, IndexedDB, archive, or browser-device dependency. Inputs and outputs are serializable data. Absolute-time evaluation remains deterministic, so live rendering, RAM preview, verification, and export share the same scene result.

Owned responsibilities:

- schema and reusable project types;
- defaults and schema migration;
- comment import and deterministic identity;
- scatter, reflow, protected regions, and field coordinates;
- build triggers, motion curves, spring/drift, camera, hero, and keyed evaluation;
- gesture resolution and deterministic math.

## WebGPU adapter

Location: `packages/comment-field-webgpu-runtime`

This package is the sole GPU boundary. It may depend on the engine and Three's WebGPU modules, but not React or application UI. The package owns controller lifetime, GPU scene resources, WGSL material creation, raster card textures, incremental asset caching, projection overlays, ray-based interaction queries, preview targets, and PNG/WebP readback.

The shader contract is explicit WGSL. Legacy graphics tokens are rejected by `scripts/verify-architecture.mjs`.

## Artist surface

Locations: `src/app`, `src/renderer`, `src/infrastructure`, and `src/export`

The surface may consume only the public package roots. It cannot import Three.js or package internals. `CommentScene.tsx` adapts React lifecycle and pointer events to the opaque runtime controller; it contains no GPU implementation.

Workspaces are separate modules:

- Field: composition layout and selected-card transforms;
- Design: shared social-card template;
- Entrance: shared motion, opacity, spring, and drift;
- Camera: take-specific camera keys and shot framing;
- Hero: hero segments, reflow, and lifecycle.

IndexedDB and archive export intentionally remain infrastructure adapters outside the engine.

## Drift prevention

`npm run verify:architecture` fails on:

- non-relative dependencies or browser globals inside the engine;
- React imports inside the WebGPU adapter;
- direct Three.js imports from the surface;
- deep imports across package public boundaries;
- relative-import cycles;
- WebGL, ShaderMaterial, or GLSL constructs in the runtime;
- absence of an explicit `.wgsl` shader loaded through `wgslFn`;
- production or test files exceeding their size caps.
