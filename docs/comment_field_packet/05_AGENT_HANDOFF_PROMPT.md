# Agent Handoff Prompt

Build the first working version of **Comment Field** using the documents in this packet.

Read in this order:

1. `01_PRODUCT_CONTEXT.md`
2. `02_MVP_BUILD_SPEC.md`
3. `03_ARCHITECTURE_NOTES.md`
4. `04_ACCEPTANCE_TEST.md`

Use the storyboard screenshots in `references/` as visual and behavioral context.

## Priority

The application must get the Papa Murphy's shot made. Do not expand the product surface beyond the first-build contract.

## Hard requirements

- local-first
- deterministic
- absolute-time animation evaluation
- visible seeded randomness
- separate project, composition, and take state
- raw gesture samples resolved into deterministic card triggers
- local reflow baked into editable targets
- save/load project JSON
- multiple takes referencing the same composition
- PNG frame export fallback if video export is unreliable

## Process

1. Create a concise implementation plan mapped to the acceptance test.
2. Build the smallest vertical slice that can:
   - ingest comments
   - generate a field
   - preview one deterministic build
3. Add direct manipulation and persistence.
4. Add gesture recording and take management.
5. Add hero selection and local reflow.
6. Add deterministic export.
7. Run the complete acceptance test.
8. Document any incomplete item explicitly.

Do not substitute placeholder architecture for working interaction.

Do not build any listed non-goal until every acceptance item is complete.
