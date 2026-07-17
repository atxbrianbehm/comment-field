# MVP Build Specification

## Build contract

Build a local-first web application called **Comment Field** that can produce the Papa Murphy's social-comment sequence.

The first working version must support:

1. Paste or import 20 to 50 comments.
2. Render them using one configurable generic social-card template.
3. Generate a deterministic scattered field using a visible random seed.
4. Let the user drag cards and adjust their depth manually.
5. Create separate 16:9 and 9:16 compositions that reference the same content and style.
6. Animate cards on using one global fade, scale, blur, and drift preset with randomized stagger.
7. Record a normalized mouse path that triggers nearby cards.
8. Resolve the mouse path into deterministic per-card trigger events.
9. Select one card as the hero.
10. Animate the hero toward a configurable target.
11. Move nearby cards toward the vacancy using local relaxation.
12. Let the user manually adjust generated reflow targets.
13. Save and reload the project as JSON.
14. Save multiple takes that reference the same underlying composition.
15. Export a deterministic H.264 preview or, if video export is unreliable, numbered PNG frames.

## Explicit non-goals

Do not build:

- a general template authoring system
- inferred styling from uploaded references
- CSV import beyond the documented first schema
- ProRes export
- server-side rendering
- After Effects reconstruction
- render passes
- a conventional keyframe timeline
- pressure-sensitive stylus input
- multiple reflow solvers
- individually animated pizza slices
- collaborative or cloud project storage
- automatic 16:9 to 9:16 layout adaptation
- a node graph
- a general-purpose animation editor

Anything not required by the acceptance test should remain unimplemented in the first interface.

## Functional requirements

### Comment ingestion

Support:

- multiline paste
- plain-text import
- a documented JSON format

Suggested plain-text format:

```text
@PizzaFan88 | We need chunky sausage back
@SauceBoss | This was the best topping
@CrustCritic | Ordering somewhere else
```

The importer should:

- preview parsed records
- flag malformed lines
- assign stable IDs
- provide fallback avatars and engagement values

### Generic social-card template

Expose only the controls needed for this spot:

- card width
- background and opacity
- corner radius
- shadow
- avatar size
- body type size
- display-name weight
- internal padding
- engagement-row visibility

### Scattered field

Controls:

- seed
- density
- minimum spacing
- size variation
- rotation variation
- depth range
- edge margin
- center exclusion zone
- overlap allowance

The same seed and composition state must produce the same layout.

### Manual composition

The user can:

- select cards
- drag cards
- adjust depth
- adjust scale
- lock cards
- define protected regions

### Build-on

One global preset with controls for:

- fade
- scale
- blur
- drift distance
- duration
- easing
- randomized stagger range
- build order mode
- random seed

Initial ordering modes:

- random
- left to right
- outside inward
- depth order

### Mouse-directed build

Record normalized samples:

```ts
interface GestureSample {
  time: number;
  x: number;
  y: number;
}
```

Resolve them into deterministic trigger events:

```ts
interface CardTrigger {
  cardId: string;
  triggerTime: number;
  influence: number;
}
```

Playback and export should use resolved trigger events, not repeatedly reinterpret the raw gesture.

### Hero transition

The user can:

- select a hero-eligible card
- define start time
- define duration
- choose a target position
- set final scale
- set forward depth
- tune surrounding-card dimming or blur

Support separate target positions for each composition.

### Local reflow

First-version algorithm:

1. Identify cards within a configurable radius of the departing hero.
2. Use the hero's former center as an attraction target.
3. Weight neighbors by distance.
4. Move neighbors toward the vacancy by a limited percentage.
5. Run a small number of overlap-resolution passes.
6. Reject movement into protected regions.
7. Bake the result as explicit reflow targets.
8. Tween from base positions to those targets.

Controls:

- radius
- attraction strength
- falloff
- maximum displacement
- overlap pass count
- reflow duration
- reflow easing

Generated targets must be manually editable.

### Takes

A take references a composition and stores only performance-level differences.

Required take features:

- create
- duplicate
- rename
- delete
- favorite
- notes
- switch between takes
- preserve common underlying layout

### Persistence

Support:

- save project JSON
- load project JSON
- autosave to IndexedDB
- project version field for migrations

### Export

Preferred:

- H.264 preview

Required fallback:

- numbered PNG frames

Export must be deterministic from:

```text
project state
+ composition state
+ take state
+ absolute time
```
