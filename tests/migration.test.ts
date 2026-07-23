import { describe, expect, it } from "vitest";
import { createDefaultProject, deserializeProject, evaluateCamera, type Project } from "@comment-field/engine";

describe("project schema migration", () => {
  it("migrates v1 visibility, stroke, and shared entrance data without redundant take overrides", () => {
    const legacy = createDefaultProject() as Project;
    legacy.version = 1;
    delete (legacy as Partial<Project>).entranceMotion;
    delete (legacy.cardStyle as Partial<typeof legacy.cardStyle>).strokeWidth;
    delete (legacy.cardStyle as Partial<typeof legacy.cardStyle>).strokeColor;
    delete (legacy.cardStyle as Partial<typeof legacy.cardStyle>).showAvatar;
    delete (legacy.cardStyle as Partial<typeof legacy.cardStyle>).showDisplayName;
    delete (legacy.cardStyle as Partial<typeof legacy.cardStyle>).showHandle;
    delete (legacy.cardStyle as Partial<typeof legacy.cardStyle>).showTimestamp;
    const restored = deserializeProject(JSON.stringify(legacy));
    expect(restored.version).toBe(16);
    expect(restored.cardStyle.strokeWidth).toBe(0);
    expect(restored.cardStyle.strokeColor).toBe("#1B1B18");
    expect(restored.cardStyle.showAvatar).toBe(true);
    expect(restored.entranceMotion.duration).toBe(legacy.takes[0].build.duration);
    expect(restored.entranceMotion.springAmount).toBe(0);
    expect(restored.entranceMotion.driftAmount).toBe(0);
    expect(restored.entranceMotion.pathMode).toBe("shared");
    expect(restored.takes[0].entranceOverride).toBeUndefined();
  });

  it("migrates schema-v3 projects with spring and drift disabled", () => {
    const legacy = createDefaultProject() as Project;
    legacy.version = 3;
    delete (legacy.entranceMotion as Partial<typeof legacy.entranceMotion>).springAmount;
    delete (legacy.entranceMotion as Partial<typeof legacy.entranceMotion>).springBounces;
    delete (legacy.entranceMotion as Partial<typeof legacy.entranceMotion>).springDamping;
    delete (legacy.entranceMotion as Partial<typeof legacy.entranceMotion>).driftAmount;
    delete (legacy.entranceMotion as Partial<typeof legacy.entranceMotion>).driftSpeed;
    delete (legacy.entranceMotion as Partial<typeof legacy.entranceMotion>).driftRotation;
    const restored = deserializeProject(JSON.stringify(legacy));
    expect(restored.version).toBe(16);
    expect(restored.entranceMotion).toMatchObject({ springAmount: 0, springBounces: 0, springDamping: 0, driftAmount: 0, driftSpeed: 0, driftRotation: 0 });
  });

  it("migrates schema-v4 projects to a one-frame field with a static camera fallback", () => {
    const legacy = createDefaultProject() as Project;
    legacy.version = 4;
    for (const composition of legacy.compositions) delete (composition as Partial<typeof composition>).fieldBounds;
    for (const take of legacy.takes) delete (take as Partial<typeof take>).cameraKeyframes;
    const restored = deserializeProject(JSON.stringify(legacy));
    expect(restored.version).toBe(16);
    expect(restored.compositions.every((composition) => composition.fieldBounds.width === 1 && composition.fieldBounds.height === 1)).toBe(true);
    expect(restored.takes.every((take) => take.cameraKeyframes.length === 0)).toBe(true);
    expect(evaluateCamera(restored.compositions[0], restored.takes[0], 3)).toEqual(restored.compositions[0].camera);
  });

  it("migrates schema-v5 composition duration and hero motion into take tracks", () => {
    const legacy = createDefaultProject() as Project & { version: number };
    legacy.version = 5;
    for (const composition of legacy.compositions) (composition as typeof composition & { duration: number }).duration = 12;
    for (const take of legacy.takes) delete (take as Partial<typeof take>).duration;
    const take = legacy.takes[0] as typeof legacy.takes[0] & Record<string, unknown>;
    take.hero = {
      cardId: legacy.compositions[0].cards[0].cardId, startTime: 3, duration: 1.5,
      target: { x: 0.5, y: 0.5, z: 1.4, scale: 1.7, rotation: 0 },
      path: { start: { x: 0, y: 0 }, control1: { x: 0, y: 0.1 }, control2: { x: 0, y: -0.08 } },
      timingCurve: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 }, surroundingDim: 0.4, surroundingBlur: 2.5, targetSpace: "screen",
      reflowRadius: 0.34, attraction: 0.48, falloff: 1.4, maxDisplacement: 0.12, overlapPasses: 4,
      reflowDuration: 1.1, easing: "ease-out", reflowEasing: "ease-out",
    };
    const restored = deserializeProject(JSON.stringify(legacy));
    expect(restored.version).toBe(16);
    expect(restored.takes.every((candidate) => candidate.duration === 12)).toBe(true);
    expect(restored.compositions.every((composition) => !("duration" in composition))).toBe(true);
    expect(restored.takes[0].hero?.keyframes).toHaveLength(2);
    expect(restored.takes[0].hero?.keyframes?.map((keyframe) => keyframe.time)).toEqual([3, 4.5]);
  });

  it("migrates schema-v6 opacity onto the legacy transform curve", () => {
    const legacy = createDefaultProject();
    legacy.version = 6;
    legacy.entranceMotion.easing = { x1: 0.65, y1: 0, x2: 0.35, y2: 1 };
    delete (legacy.entranceMotion as Partial<typeof legacy.entranceMotion>).opacityEasing;
    const restored = deserializeProject(JSON.stringify(legacy));
    expect(restored.version).toBe(16);
    expect(restored.entranceMotion.opacityEasing).toEqual(restored.entranceMotion.easing);
  });

  it("migrates schema-v7 projects with motion blur disabled and preserves authored frame rate", () => {
    const legacy = createDefaultProject() as Project;
    legacy.version = 7;
    legacy.compositions[0].frameRate = 30;
    delete (legacy as Partial<Project>).renderSettings;
    const restored = deserializeProject(JSON.stringify(legacy));
    expect(restored.version).toBe(16);
    expect(restored.compositions[0].frameRate).toBe(30);
    expect(restored.renderSettings.motionBlur).toEqual({ enabled: false, shutterAngle: 180, strength: 1 });
    expect(restored.renderSettings.sceneShadow).toMatchObject({ enabled: true, opacity: 0.28, softness: 0.55 });
    expect(restored.renderSettings.cardLighting).toMatchObject({ enabled: true, ambient: 1, intensity: 0.16 });
    expect(restored.renderSettings.transparentExport).toBe(false);
  });

  it("migrates schema-v8 projects with rain path mode defaults", () => {
    const legacy = createDefaultProject() as Project;
    legacy.version = 8;
    delete (legacy.entranceMotion as Partial<typeof legacy.entranceMotion>).pathMode;
    delete (legacy.entranceMotion as Partial<typeof legacy.entranceMotion>).rainDistance;
    delete (legacy.entranceMotion as Partial<typeof legacy.entranceMotion>).rainLateral;
    const restored = deserializeProject(JSON.stringify(legacy));
    expect(restored.version).toBe(16);
    expect(restored.entranceMotion.pathMode).toBe("shared");
    expect(restored.entranceMotion.rainDistance).toBe(0.55);
    expect(restored.entranceMotion.rainLateral).toBe(0.22);
  });

  it("migrates schema-v11 population cards with a separate out template", () => {
    const legacy = createDefaultProject();
    legacy.version = 11;
    for (const take of legacy.takes) delete (take.population as Partial<typeof take.population>).exitMotion;
    const restored = deserializeProject(JSON.stringify(legacy));
    expect(restored.version).toBe(16);
    expect(restored.takes.every((take) => take.population.exitMotion.pathMode === "scatter")).toBe(true);
    expect(restored.takes.every((take) => take.population.exitMotion.fade === 1)).toBe(true);
  });

  it("migrates schema-v12 Out opacity onto the legacy transform curve", () => {
    const legacy = createDefaultProject();
    legacy.version = 12;
    legacy.takes[0].population.exitMotion.easing = { x1: 0.2, y1: 0, x2: 0.8, y2: 1 };
    delete (legacy.takes[0].population.exitMotion as { opacityEasing?: unknown }).opacityEasing;
    const restored = deserializeProject(JSON.stringify(legacy));
    expect(restored.version).toBe(16);
    expect(restored.takes[0].population.exitMotion.opacityEasing).toEqual(restored.takes[0].population.exitMotion.easing);
  });

  it("migrates schema-v13 post-hero timing without changing its old lifecycle", () => {
    const legacy = createDefaultProject();
    legacy.version = 13;
    const population = legacy.takes[0].population;
    population.lifeMin = 1.1;
    population.lifeMax = 2.2;
    population.exitDuration = 0.6;
    const legacyPopulation = population as Partial<typeof population>;
    delete legacyPopulation.postHeroBurstStartTime;
    delete legacyPopulation.postHeroBurstEasing;
    delete legacyPopulation.postHeroEntranceDuration;
    delete legacyPopulation.postHeroLifeMin;
    delete legacyPopulation.postHeroLifeMax;
    delete legacyPopulation.postHeroExitDuration;
    const restored = deserializeProject(JSON.stringify(legacy));
    const migrated = restored.takes[0].population;
    expect(restored.version).toBe(16);
    expect(migrated.postHeroBurstStartTime).toBe(restored.takes[0].duration - 2);
    expect(migrated.postHeroBurstEasing).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(migrated.postHeroEntranceDuration).toBe(restored.entranceMotion.duration);
    expect(migrated.postHeroLifeMin).toBe(1.1);
    expect(migrated.postHeroLifeMax).toBe(2.2);
    expect(migrated.postHeroExitDuration).toBe(0.6);
  });
});
