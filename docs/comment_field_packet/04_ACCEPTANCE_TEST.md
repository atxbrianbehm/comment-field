# Acceptance Test

The build is successful when a user can sit down with the Papa Murphy's copy and, without editing code:

1. Create a 16:9 composition.
2. Paste at least 30 comments.
3. Generate a plausible deterministic field.
4. Change the seed and generate a visibly different field.
5. Return to the original seed and recover the original field.
6. Drag cards into a stronger composition.
7. Adjust selected cards in depth.
8. Define a protected central region.
9. Preview a randomized global build-on.
10. Record a mouse-directed build.
11. Save that performance as Take 01.
12. Record two additional builds as Take 02 and Take 03.
13. Switch among takes without changing the base layout.
14. Select one card as the hero.
15. Animate the hero toward a configurable target.
16. Generate a local reflow around the vacancy.
17. Manually adjust at least one reflow target.
18. Save and reload the project.
19. Verify that the same take plays identically after reload.
20. Export an H.264 preview or numbered PNG sequence.
21. Create a separate 9:16 composition using the same comment data and card style.
22. Export an editorially useful preview for both aspect ratios.

## Completion standard

The application is not accepted merely because the interface exists.

It is accepted when it can produce at least three distinct, editorially useful takes of the Papa Murphy's social-comment build and hero transition without source-code changes.

## Determinism checks

Given identical:

- project JSON
- composition ID
- take ID
- random seed
- absolute time

the rendered frame must be identical.

## Scope check

Reject the build if time has been spent on non-goal systems while any acceptance item remains incomplete.
