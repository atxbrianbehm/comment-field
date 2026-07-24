import { describe, expect, it } from "vitest";
import {
  createDefaultProject,
  deserializeProject,
  evaluateCardWobble,
  resolveEntrancePath,
  resolveExitPath,
} from "@comment-field/engine";

describe("social post templates, path variation, and card wobble", () => {
  it("migrates v20 projects without changing their rendered motion", () => {
    const legacy = createDefaultProject();
    legacy.version = 20;
    delete (legacy.cardStyle as Partial<typeof legacy.cardStyle>).postType;
    delete (legacy.renderSettings as Partial<typeof legacy.renderSettings>).cardWobble;
    delete (legacy.entranceMotion as Partial<typeof legacy.entranceMotion>).pathVariation;
    for (const take of legacy.takes) {
      delete (take.population.exitMotion as Partial<typeof take.population.exitMotion>).pathVariation;
    }
    const migrated = deserializeProject(JSON.stringify(legacy));
    expect(migrated.version).toBe(21);
    expect(migrated.cardStyle.postType).toBe("x");
    expect(migrated.entranceMotion.pathVariation).toBe(0);
    expect(migrated.takes.every((take) => take.population.exitMotion.pathVariation === 0)).toBe(true);
    expect(migrated.renderSettings.cardWobble.enabled).toBe(false);
  });

  it("varies entrance and exit paths deterministically by card", () => {
    const project = createDefaultProject();
    const entranceA = resolveEntrancePath(project.entranceMotion, "seed", "a");
    expect(resolveEntrancePath(project.entranceMotion, "seed", "a")).toEqual(entranceA);
    expect(resolveEntrancePath(project.entranceMotion, "seed", "b")).not.toEqual(entranceA);

    const population = project.takes[0].population;
    const exitA = resolveExitPath(population, "a", 0);
    expect(resolveExitPath(population, "a", 0)).toEqual(exitA);
    expect(resolveExitPath(population, "b", 0)).not.toEqual(exitA);
  });

  it("returns exact shared paths when variation is disabled", () => {
    const project = createDefaultProject();
    const entrance = { ...project.entranceMotion, pathMode: "shared" as const, pathVariation: 0 };
    expect(resolveEntrancePath(entrance, "seed", "a")).toBe(entrance.path);
    const population = structuredClone(project.takes[0].population);
    population.exitMotion.pathMode = "shared";
    population.exitMotion.pathVariation = 0;
    expect(resolveExitPath(population, "a", 0)).toBe(population.exitMotion.path);
  });

  it("evaluates wobble from absolute time and stable card identity", () => {
    const settings = { enabled: true, amount: 0.12, speed: 0.7, variation: 0.5 };
    const first = evaluateCardWobble(settings, "seed", "a", 1.25);
    expect(evaluateCardWobble(settings, "seed", "a", 1.25)).toBe(first);
    expect(evaluateCardWobble(settings, "seed", "b", 1.25)).not.toBe(first);
    expect(evaluateCardWobble({ ...settings, enabled: false }, "seed", "a", 1.25)).toBe(0);
  });
});
