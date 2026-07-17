# Architecture Notes

## Primary technical requirement

The renderer must be deterministic.

Every frame should be derived from absolute time:

```ts
const frameState = evaluateScene(project, composition, take, absoluteTime);
```

Avoid animation logic that depends on accumulated frame-to-frame simulation:

```ts
scene.update(deltaTime);
```

Interactive motion may be simulated during authoring, but any accepted result should be baked into explicit trigger times, targets, or recorded samples before save and export.

## Suggested implementation

- React for the application shell
- HTML or SVG for the card editor and static preview
- cached card textures for spatial playback
- Three.js planes for depth, perspective, camera, and spatial animation
- one deterministic animation clock
- seeded randomness stored in project state
- IndexedDB plus downloadable project JSON
- WebCodecs where available
- numbered PNG frame fallback

## Rendering strategy

Avoid relying on live DOM cards as the only production render path.

Recommended hybrid:

1. Edit card content and styling through HTML or SVG.
2. Rasterize each card into a cached texture whenever content or styling changes.
3. Use textured Three.js planes for spatial playback.
4. Reuse the same renderer for preview and frame export.

This reduces synchronization problems between DOM layout, a Three.js camera, depth blur, perspective, and capture.

## State separation

### Project state

- content
- card styling
- assets
- compositions
- takes
- schema version

### Composition state

- aspect ratio
- resolution
- frame rate
- duration
- base card positions
- scale and depth
- camera
- layout seed
- protected regions

### Take state

- build settings
- randomized trigger times
- gesture samples
- resolved card triggers
- hero card
- hero timing
- hero target
- reflow targets
- optional camera performance
- notes

A take must not duplicate the full project or composition.

## Suggested TypeScript model

```ts
interface Project {
  version: number;
  id: string;
  name: string;
  comments: CommentRecord[];
  cardStyle: CardStyle;
  assets: AssetReference[];
  compositions: Composition[];
  takes: Take[];
}

interface Composition {
  id: string;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  seed: string;
  cards: CardPlacement[];
  camera: CameraState;
  protectedRegions: ProtectedRegion[];
}

interface Take {
  id: string;
  compositionId: string;
  name: string;
  build: BuildPerformance;
  gestureSamples: GestureSample[];
  cardTriggers: CardTrigger[];
  hero: HeroPerformance | null;
  reflowTargets: Record<string, Transform>;
  notes?: string;
  favorite?: boolean;
}
```

## First interface

Keep the first interface narrow.

### Left panel

- comments
- background
- card style
- compositions

### Center

- composition viewer
- card selection
- direct manipulation
- protected-region overlay
- record-build mode

### Right panel

- layout seed and scatter
- selected-card controls
- build controls
- hero controls
- reflow controls
- export settings

### Bottom

- play and pause
- scrubber
- take selector
- event markers

Do not build a conventional timeline in the first version.

## Recommended repository structure

```text
src/
  app/
  components/
  editor/
  renderer/
  animation/
  layout/
  reflow/
  recording/
  persistence/
  export/
  models/
  utils/
fixtures/
  comments/
  projects/
docs/
tests/
```

## Testing priorities

- deterministic seeded layout
- repeatable absolute-time playback
- save/load equality
- take isolation
- gesture-to-trigger resolution
- identical PNG output for identical state
- protected-region rejection
- reflow overlap resolution
