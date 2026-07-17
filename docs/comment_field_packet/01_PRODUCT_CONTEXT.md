# Product Context: Comment Field

## Working title

**Comment Field**

A local-first web application for generating, arranging, animating, recording, and exporting fields of social-media-style comment cards for motion design and compositing.

The immediate use case is the Papa Murphy's spot shown in the storyboard references:

1. Generate a field of social comments over a background.
2. Animate the comments into the frame.
3. Select one comment and move it forward toward camera.
4. Reflow nearby comments into the negative space it leaves.
5. Save multiple timing and animation takes.
6. Export the resulting animation for editorial or compositing.

The system should be reusable, but the first build is not a general-purpose motion-design application.

## Product objective

Move quickly from:

- a defined social-card look
- a text file or pasted comments
- a small set of animation behaviors

to:

- a populated comment field
- an art-directable animate-on
- a hero-comment transition
- multiple saved takes
- deterministic output

The design priority is iteration speed. The user should be able to change copy, regenerate a layout, audition motion, record a manual reveal gesture, preserve successful takes, and export without rebuilding the scene.

## Core product model

### Template

Defines the appearance of an individual social card:

- avatar
- username and handle
- timestamp
- body copy
- engagement icons and counts
- background
- corner radius
- shadow
- typography
- padding
- card width rules

The first build supports one configurable generic social-card template.

### Data

Defines the content used to populate the cards.

Initial input:

- pasted text
- imported plain-text file
- a simple documented JSON schema

### Composition

Defines the spatial presentation:

- aspect ratio and resolution
- card positions
- card depth
- camera
- protected regions
- deterministic layout seed

### Motion

Defines how cards enter and how the hero transition behaves:

- global build-on preset
- randomized stagger
- mouse-triggered reveal
- hero move
- local reflow
- camera suppression or emphasis

### Take

A take stores performance-level differences while referencing the same underlying composition:

- build timing
- gesture samples and resolved triggers
- hero card
- hero timing
- reflow targets
- optional camera performance
- notes and favorite status

## Primary workflow

1. Create a composition.
2. Paste or import comments.
3. Generate a deterministic scattered field.
4. Drag cards and adjust depth.
5. Choose a global build-on preset.
6. Randomize or record the build.
7. Save the result as a take.
8. Select a hero card.
9. Set the hero destination and timing.
10. Generate local reflow targets.
11. Adjust reflow targets manually.
12. Preview and export.

## Long-term direction

Future versions may add:

- multiple card templates
- visual-reference style inference
- richer CSV and JSON import
- additional layout modes
- a conventional timeline
- multiple reflow solvers
- production render passes
- ProRes 4444
- After Effects reconstruction
- cloud rendering
- collaborative storage
- product-reveal scene states
- individually animated pizza slices

These are product context only. They are not part of the first build.
