# Morning Handoff: Comment Field

## What is ready

The first working Comment Field application is implemented as a local React/TypeScript workbench with a Three.js spatial renderer. It supports the full documented MVP path:

- 30-comment paste, `.txt`, and JSON ingestion with preview/error counts
- configurable generic social-card styling
- visible deterministic scatter seed and all documented scatter controls
- direct card drag plus X/Y, depth, scale, rotation, and locking
- editable protected regions
- separate 16:9 and 9:16 compositions sharing copy and style
- global absolute-time build with four order modes and randomized seed
- normalized mouse-path recording resolved into baked per-card triggers
- create, duplicate, rename, delete, favorite, annotate, and switch takes
- hero targeting, surrounding dim/blur, local relaxation, and editable baked reflow targets
- IndexedDB autosave and downloadable/reloadable versioned project JSON
- repeated-frame SHA-256 determinism check
- numbered PNG sequence export using the same renderer as preview

## Start here

```powershell
cd "C:\Users\behmb\Documents\Cascade Projects\SocialPost"
npm.cmd run dev
```

Open the Vite URL. The stage starts at the completed frame so cards are ready to art-direct. Press Play to audition from frame zero.

## Verification already run

- 8 deterministic/core/export tests pass.
- Production build passes.
- Real browser interaction verified card selection and drag, locking, protected regions, gesture recording, three takes, portrait isolation, Papa Murphy's hero targeting, baked local reflow, and manual target editing.
- Same nonzero frame rendered twice with matching SHA-256 prefix `b65621ac`.
- Real 30-frame quarter-resolution PNG ZIPs completed for both landscape and portrait after export lifecycle optimization (about 1.1 s and 0.6 s in the verification browser).

## Best dial-in sequence tomorrow

1. Replace the synthetic filler comments with approved final copy.
2. Import the clean background plate or still.
3. Tune card width/type/avatar/padding against the reference frame.
4. Dial the 16:9 seed and manual composition; lock approved cards.
5. Record three build gestures or random builds and favorite the strongest takes.
6. Tune the Papa Murphy's hero target and reflow while viewing the final background.
7. Repeat the art direction independently in 9:16.
8. Run the deterministic-frame check, save project JSON, and export half-resolution PNGs for editorial review before committing to full resolution.

## Remaining human-owned gaps

- The packet does not include 30 approved production comments, a clean background plate, or final brand font/logo assets.
- The three takes are functionally creatable and exportable, but their editorial usefulness requires visual and timing approval.
- H.264 is not included; numbered PNGs are the required reliable first-build export.

## Engineering note

The workspace's `.git` directory was present but not initialized and was read-only in the execution environment, so no commit was created. All implementation files are directly in the workspace and the build artifacts are reproducible with the commands above.
