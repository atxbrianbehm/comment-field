import { describe, expect, it } from "vitest";
import { createDefaultProject, generateScatter } from "@comment-field/engine";

describe("oversized field scatter", () => {
  it("returns no placements for an empty comment list", () => {
    const project = createDefaultProject();
    const empty = generateScatter([], project.compositions[0].seed, project.compositions[0].scatter);
    expect(empty).toEqual([]);
  });

  it("defaults to a single-screen field", () => {
    const project = createDefaultProject();
    expect(project.compositions.every((composition) => composition.fieldBounds.width === 1 && composition.fieldBounds.height === 1)).toBe(true);
  });

  it("keeps a useful cohort inside the active camera frame on multi-screen fields", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    composition.fieldBounds = { width: 3, height: 3 };
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
