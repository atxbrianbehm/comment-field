import { describe, expect, it } from "vitest";
import { createDefaultProject, generateScatter } from "@comment-field/engine";

describe("oversized field scatter", () => {
  it("keeps a useful cohort inside the active camera frame", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    const placements = generateScatter(
      project.comments.map((comment) => comment.id),
      composition.seed,
      composition.scatter,
      composition.protectedRegions,
      composition.fieldBounds,
    );
    const inFrame = placements.filter((card) => card.x >= 0 && card.x <= 1 && card.y >= 0 && card.y <= 1);
    expect(inFrame.length).toBeGreaterThanOrEqual(10);
  });
});
