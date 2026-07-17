import { afterEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import {
  clearHeroPerformance,
  createDefaultProject,
  cubicPoint,
  deserializeProject,
  evaluateAmbientDrift,
  evaluateBezierCurve,
  evaluateCamera,
  evaluateEntranceComponents,
  evaluateScene,
  evaluateSpatialPath,
  evaluateSpringOffset,
  fieldPointToWorld,
  findKeyframeAt,
  generateReflowTargets,
  generateScatter,
  moveKeyframe,
  parseCommentJson,
  parsePlainText,
  projectWorldPoint,
  resolveBuildTriggers,
  resolveGestureTriggers,
  segmentProgress,
  serializeProject,
  settleCameraOnHero,
  snapTime,
  upsertKeyframe,
  type HeroPerformance,
  type TimedKeyframe,
} from "@comment-field/engine";
import { exportPngSequence } from "../src/export/pngSequence";
import { avatarInitialForComment, createCardTextureKey, createSceneAssetKey, fitFrameWithinBounds, performanceProfileKey, selectPerformanceProfile } from "@comment-field/webgpu-runtime";
import { editorPointToMotion, frameEntrancePath, motionPointToEditor } from "../src/app/motionViewport";
import {
  choosePreviewDimensions,
  createPreviewCacheKey,
  nearestReadyPreviewFrame,
  progressivePreviewOrder,
  previewDecodeWindow,
  previewFrameIndex,
  wallClockPlaybackTime,
} from "@comment-field/webgpu-runtime";

describe("deterministic project core", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates new compositions at the primary 24 fps target", () => {
    const project = createDefaultProject();
    expect(project.compositions.every((composition) => composition.frameRate === 24)).toBe(true);
    expect(project.renderSettings.motionBlur).toEqual({ enabled: false, shutterAngle: 180, strength: 1 });
  });

  it("selects bounded desktop, tablet, and phone performance profiles", () => {
    const phone = selectPerformanceProfile({ viewportWidth: 390, viewportHeight: 844, devicePixelRatio: 3, deviceMemoryGb: 4 });
    const tablet = selectPerformanceProfile({ viewportWidth: 820, viewportHeight: 1180, devicePixelRatio: 2, deviceMemoryGb: 8 });
    const desktop = selectPerformanceProfile({ viewportWidth: 1920, viewportHeight: 1080, devicePixelRatio: 2, deviceMemoryGb: 16 });
    expect(phone).toMatchObject({ class: "phone", previewFrameRate: 24, canvasPixelRatio: 1 });
    expect(tablet).toMatchObject({ class: "tablet", previewFrameRate: 24 });
    expect(desktop).toMatchObject({ class: "desktop", previewFrameRate: 24 });
    expect(performanceProfileKey(phone)).not.toBe(performanceProfileKey(desktop));
  });
  it("snaps, replaces, and moves typed keyframes at frame precision", () => {
    const fps = 30;
    const easing = { x1: 0, y1: 0, x2: 1, y2: 1 };
    const first = { id: "a", time: 1, value: 10, interpolation: "linear" as const, easing, holdDuration: 0 };
    expect(snapTime(1.018, fps)).toBe(1.0333333333333334);
    expect(findKeyframeAt([first], 1.01, fps)?.id).toBe("a");
    const replaced = upsertKeyframe([first], { ...first, id: "b", time: 1.01, value: 20 }, fps);
    expect(replaced).toHaveLength(1);
    expect(replaced[0].id).toBe("b");
    expect(moveKeyframe(replaced, "b", 2.02, fps)[0].time).toBe(2.033333333333333);
  });

  it("evaluates holds, linear arrivals, and cuts deterministically", () => {
    const easing = { x1: 0, y1: 0, x2: 1, y2: 1 };
    const from: TimedKeyframe<number> = { id: "a", time: 0, value: 0, interpolation: "linear", easing, holdDuration: 1 };
    const linear: TimedKeyframe<number> = { id: "b", time: 3, value: 1, interpolation: "linear", easing, holdDuration: 0 };
    expect(segmentProgress(from, linear, 0.9)).toBe(0);
    expect(segmentProgress(from, linear, 2)).toBeCloseTo(0.5);
    expect(segmentProgress(from, { ...linear, interpolation: "cut" }, 2.9)).toBe(0);
  });
  it("parses stable records and reports malformed lines", () => {
    const a = parsePlainText("@One | Hello\n|\n@Two | World");
    const b = parsePlainText("@One | Hello\n|\n@Two | World");
    expect(a.records).toEqual(b.records);
    expect(a.errors).toHaveLength(1);
  });

  it("accepts campaign message-only copy and derives its avatar letter from the message", () => {
    const result = parsePlainText("**SEA OF TWEETS - FRAMES 1-4**\n**Bring back the chunky sausage already.**\nStill mourning Papa Murphy's Chunky Italian Sausage.");
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({ username: "", handle: "", message: "Bring back the chunky sausage already." });
    expect(avatarInitialForComment(result.records[0])).toBe("B");
    expect(avatarInitialForComment(result.records[1])).toBe("S");
  });

  it("keeps Papa Murphy's reply mentions in the body instead of treating them as author handles", () => {
    const result = parsePlainText("@PapaMurphys We want our chunky sausage back PLZ\nWhere is my Italian Sausage @PapaMurphys??????\n@PapaMurphys | Want. Chunky. Sausage. Back.");
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(3);
    expect(result.records[0]).toMatchObject({ username: "", handle: "", message: "@PapaMurphys We want our chunky sausage back PLZ" });
    expect(result.records[1]).toMatchObject({ username: "", handle: "", message: "Where is my Italian Sausage @PapaMurphys??????" });
    expect(result.records[2]).toMatchObject({ username: "", handle: "", message: "@PapaMurphys Want. Chunky. Sausage. Back." });
    expect(avatarInitialForComment(result.records[0])).toBe("P");
  });

  it("accepts JSON comments without fabricated handles", () => {
    const result = parseCommentJson(JSON.stringify([{ message: "Justice for chunky sausage." }]));
    expect(result.errors).toEqual([]);
    expect(result.records[0]).toMatchObject({ username: "", handle: "", message: "Justice for chunky sausage." });
    expect(avatarInitialForComment(result.records[0])).toBe("J");
  });

  it("returns identical scatter for identical seed and changes for another seed", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    const ids = project.comments.map((comment) => comment.id);
    const a = generateScatter(ids, "alpha", composition.scatter);
    expect(generateScatter(ids, "alpha", composition.scatter)).toEqual(a);
    expect(generateScatter(ids, "beta", composition.scatter)).not.toEqual(a);
  });

  it("scatters deterministically across oversized field bounds", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    composition.fieldBounds = { width: 4, height: 3 };
    const placements = generateScatter(project.comments.map((comment) => comment.id), "oversized", composition.scatter, [], composition.fieldBounds);
    expect(placements).toEqual(generateScatter(project.comments.map((comment) => comment.id), "oversized", composition.scatter, [], composition.fieldBounds));
    expect(placements.every((card) => card.x >= -1.5 && card.x <= 2.5 && card.y >= -1 && card.y <= 2)).toBe(true);
    expect(placements.some((card) => card.x < 0 || card.x > 1 || card.y < 0 || card.y > 1)).toBe(true);
  });

  it("evaluates camera arrivals, holds, and cuts from absolute time", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    const take = structuredClone(project.takes[0]);
    take.cameraKeyframes = [
      { id: "one", time: 1, pose: { ...composition.camera, x: 1 }, easing: { x1: 0, y1: 0, x2: 1, y2: 1 }, holdDuration: 1, cut: false },
      { id: "two", time: 3, pose: { ...composition.camera, x: 3 }, easing: { x1: 0, y1: 0, x2: 1, y2: 1 }, holdDuration: 0, cut: false },
      { id: "cut", time: 4, pose: { ...composition.camera, x: 9 }, easing: { x1: 0, y1: 0, x2: 1, y2: 1 }, holdDuration: 0, cut: true },
    ];
    expect(evaluateCamera(composition, take, 0.5).x).toBeCloseTo(0.5);
    expect(evaluateCamera(composition, take, 1.5).x).toBe(1);
    expect(evaluateCamera(composition, take, 2.5).x).toBeCloseTo(2);
    expect(evaluateCamera(composition, take, 3.9).x).toBe(3);
    expect(evaluateCamera(composition, take, 4).x).toBe(9);
  });

  it("produces stronger camera parallax for near cards", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    const stationary = composition.camera;
    const moved = { ...stationary, x: 0.8 };
    const point = fieldPointToWorld(composition, { x: 0.5, y: 0.5 });
    const nearBefore = projectWorldPoint(composition, stationary, { ...point, z: 1 });
    const nearAfter = projectWorldPoint(composition, moved, { ...point, z: 1 });
    const farBefore = projectWorldPoint(composition, stationary, { ...point, z: -1 });
    const farAfter = projectWorldPoint(composition, moved, { ...point, z: -1 });
    expect(Math.abs(nearAfter.x - nearBefore.x)).toBeGreaterThan(Math.abs(farAfter.x - farBefore.x));
  });

  it("resolves builds and gestures deterministically", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    const take = project.takes[0];
    expect(resolveBuildTriggers(composition.cards, take.build)).toEqual(resolveBuildTriggers(composition.cards, take.build));
    const samples = [{ time: 0, x: 0, y: 0 }, { time: 1, x: 1, y: 1 }];
    expect(resolveGestureTriggers(samples, composition.cards)).toEqual(resolveGestureTriggers(samples, composition.cards));
  });

  it("evaluates absolute time without accumulated state", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    const take = project.takes[0];
    const frame = evaluateScene(composition, take, project.entranceMotion, 1.25);
    evaluateScene(composition, take, project.entranceMotion, 7);
    expect(evaluateScene(composition, take, project.entranceMotion, 1.25)).toEqual(frame);
  });

  it("keeps gesture-unreached cards hidden until explicitly triggered", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    const take = { ...project.takes[0], gestureSamples: [{ time: 0, x: 0.1, y: 0.1 }], cardTriggers: [{ cardId: composition.cards[0].cardId, triggerTime: 0, influence: 1 }] };
    const frame = evaluateScene(composition, take, project.entranceMotion, 4);
    expect(frame.cards[0].opacity).toBeCloseTo(1, 10);
    expect(frame.cards[1].opacity).toBe(0);
  });

  it("round-trips project JSON and isolates take state", () => {
    const project = createDefaultProject();
    const restored = deserializeProject(serializeProject(project));
    expect(restored.compositions).toEqual(project.compositions);
    expect(restored.takes).toEqual(project.takes);
    expect(restored.takes[0]).not.toBe(restored.compositions[0]);
  });

  it("bakes reflow targets outside protected regions", () => {
    const project = createDefaultProject();
    const composition = { ...project.compositions[0], protectedRegions: [{ id: "safe", name: "Safe", x: 0.45, y: 0.45, width: 0.1, height: 0.1 }] };
    const hero = {
      cardId: composition.cards[0].cardId, startTime: 3, duration: 1, target: { x: 0.5, y: 0.5, z: 1.5, scale: 1.8, rotation: 0 },
      path: { start: { x: 0, y: 0 }, control1: { x: 0, y: 0.1 }, control2: { x: 0, y: -0.1 } },
      timingCurve: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
      targetSpace: "world" as const,
      surroundingDim: 0.25, surroundingBlur: 2, reflowRadius: 0.5, attraction: 0.5, falloff: 1.5,
      maxDisplacement: 0.12, overlapPasses: 3, reflowDuration: 1, easing: "ease-out" as const, reflowEasing: "ease-out" as const,
    };
    const a = generateReflowTargets(composition, hero);
    expect(generateReflowTargets(composition, hero)).toEqual(a);
  });

  it("packages deterministically numbered PNG frames", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    const progress: Array<{ frame: number; total: number }> = [];
    const archive = await exportPngSequence(
      async (time) => new Blob([`png:${time.toFixed(3)}`], { type: "image/png" }),
      { width: 64, height: 64, frameRate: 3, duration: 1, prefix: "take-01" },
      (value) => progress.push(value),
    );
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(Object.keys(files)).toEqual(["take-01_000001.png", "take-01_000002.png", "take-01_000003.png"]);
    expect(progress.at(-1)).toEqual({ frame: 3, total: 3 });
  });

  it("refits the renderer when switching between landscape and portrait", () => {
    expect(fitFrameWithinBounds(1000, 800, 1920, 1080)).toEqual({
      width: 1000,
      height: 562.5,
    });
    expect(fitFrameWithinBounds(1000, 800, 1080, 1920)).toEqual({
      width: 450,
      height: 800,
    });
  });

  it("keeps card render assets cached while placements move", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    const before = createSceneAssetKey(composition, project.comments, project.cardStyle);
    const moved = structuredClone(composition);
    moved.cards[0].x += 0.1;
    moved.cards[0].y -= 0.1;

    expect(createSceneAssetKey(moved, project.comments, project.cardStyle)).toBe(before);

    const editedComments = structuredClone(project.comments);
    editedComments[0].message = `${editedComments[0].message} edited`;
    expect(createSceneAssetKey(composition, editedComments, project.cardStyle)).not.toBe(before);
  });

  it("evaluates reusable spatial and timing bezier curves deterministically", () => {
    const project = createDefaultProject();
    const motion = project.entranceMotion;
    expect(evaluateBezierCurve(motion.easing, 0)).toBeCloseTo(0);
    expect(evaluateBezierCurve(motion.easing, 1)).toBeCloseTo(1);
    expect(evaluateSpatialPath(motion.path, 0)).toEqual(motion.path.start);
    expect(evaluateSpatialPath(motion.path, 1).x).toBeCloseTo(0);
    expect(evaluateSpatialPath(motion.path, 1).y).toBeCloseTo(0);
  });

  it("settles spring motion exactly while keeping opacity and blur monotonic", () => {
    const project = createDefaultProject();
    const motion = { ...project.entranceMotion, driftAmount: 0, driftRotation: 0 };
    expect(evaluateSpringOffset(1, motion)).toBe(0);
    const settled = evaluateEntranceComponents(motion, 1, 1, "seed", "card");
    expect(settled.position.x).toBeCloseTo(0, 12);
    expect(settled.position.y).toBeCloseTo(0, 12);
    expect(settled.scale).toBeCloseTo(1, 12);
    expect(settled.rotation).toBeCloseTo(0, 12);
    expect(settled.opacity).toBe(1);
    expect(settled.blur).toBe(0);
    const samples = [0.55, 0.7, 0.85, 1].map((progress) => evaluateEntranceComponents(motion, progress, progress, "seed", "card"));
    expect(samples.map((sample) => sample.opacity)).toEqual([...samples.map((sample) => sample.opacity)].sort((a, b) => a - b));
    expect(samples.map((sample) => sample.blur)).toEqual([...samples.map((sample) => sample.blur)].sort((a, b) => b - a));
  });

  it("evaluates opacity from its own curve without changing transform motion", () => {
    const project = createDefaultProject();
    const base = { ...project.entranceMotion, driftAmount: 0, driftRotation: 0 };
    const slowOpacity = { ...base, opacityEasing: { x1: 0.42, y1: 0, x2: 1, y2: 1 } };
    const fastOpacity = { ...base, opacityEasing: { x1: 0, y1: 1, x2: 0.3, y2: 1 } };
    const slow = evaluateEntranceComponents(slowOpacity, 0.35, 0.35, "seed", "card");
    const fast = evaluateEntranceComponents(fastOpacity, 0.35, 0.35, "seed", "card");
    expect(fast.opacity).toBeGreaterThan(slow.opacity);
    expect(fast.position).toEqual(slow.position);
    expect(fast.scale).toBe(slow.scale);
    expect(fast.rotation).toBe(slow.rotation);
    expect(fast.blur).toBe(slow.blur);
  });

  it("generates deterministic card-specific ambient drift and disables it cleanly", () => {
    const project = createDefaultProject();
    const motion = project.entranceMotion;
    const first = evaluateAmbientDrift("field", "one", 3.25, 1, motion);
    expect(evaluateAmbientDrift("field", "one", 3.25, 1, motion)).toEqual(first);
    expect(evaluateAmbientDrift("field", "two", 3.25, 1, motion)).not.toEqual(first);
    expect(evaluateAmbientDrift("field", "one", 3.25, 1, { ...motion, driftAmount: 0, driftRotation: 0 })).toEqual({ x: 0, y: 0, rotation: 0 });
  });

  it("reframes entrance paths without changing their stored motion coordinates", () => {
    const project = createDefaultProject();
    const viewport = { centerY: 0.35, spanY: 1.2 };
    const point = { x: -0.08, y: 0.72 };
    const restoredPoint = editorPointToMotion(motionPointToEditor(point, viewport), viewport);
    expect(restoredPoint.x).toBeCloseTo(point.x, 12);
    expect(restoredPoint.y).toBeCloseTo(point.y, 12);
    const framed = frameEntrancePath({
      ...project.entranceMotion.path,
      start: { x: 0, y: 0.9 },
    });
    expect(motionPointToEditor({ x: 0, y: 0 }, framed).y).toBeGreaterThanOrEqual(0);
    expect(motionPointToEditor({ x: 0, y: 0.9 }, framed).y).toBeLessThanOrEqual(1);
  });

  it("gives an active hero deterministic top-layer priority", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    const take = project.takes[0];
    const hero: HeroPerformance = {
      cardId: composition.cards[0].cardId,
      startTime: 1,
      duration: 1,
      target: { x: 0.5, y: 0.5, z: 1.5, scale: 1.8, rotation: 0 },
      path: { start: { x: 0, y: 0 }, control1: { x: 0, y: 0.1 }, control2: { x: 0, y: -0.1 } },
      timingCurve: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
      targetSpace: "world",
      surroundingDim: 0.25,
      surroundingBlur: 2,
      reflowRadius: 0.5,
      attraction: 0.5,
      falloff: 1.5,
      maxDisplacement: 0.12,
      overlapPasses: 3,
      reflowDuration: 1,
      easing: "ease-out",
      reflowEasing: "ease-out",
    };
    const frame = evaluateScene(composition, { ...take, hero }, project.entranceMotion, 1.5);
    expect(frame.cards.find((card) => card.cardId === hero.cardId)?.layerPriority).toBe(1_000_000);
  });

  it("freezes the hero source at its start-time drift position", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    const take = structuredClone(project.takes[0]);
    const cardId = composition.cards[0].cardId;
    const startTime = 1.2;
    const duration = 8;
    const target = { x: 0.5, y: 0.5, z: 1.5, scale: 1.8, rotation: 0 };
    const path = { start: { x: 0, y: 0 }, control1: { x: 0.1, y: 0.1 }, control2: { x: -0.1, y: -0.1 } };
    take.hero = {
      cardId, startTime, duration, target, path,
      timingCurve: { x1: 0, y1: 0, x2: 1, y2: 1 },
      targetSpace: "world",
      surroundingDim: 0, surroundingBlur: 0, reflowRadius: 0.3, attraction: 0, falloff: 1,
      maxDisplacement: 0, overlapPasses: 0, reflowDuration: 1, easing: "linear", reflowEasing: "linear",
    };
    const frozen = evaluateScene(composition, { ...take, hero: null }, project.entranceMotion, startTime).cards.find((card) => card.cardId === cardId)!;
    const currentTime = 2.2;
    const progress = (currentTime - startTime) / duration;
    const expected = cubicPoint(
      frozen,
      { x: frozen.x + path.control1.x, y: frozen.y + path.control1.y },
      { x: target.x + path.control2.x, y: target.y + path.control2.y },
      target,
      evaluateBezierCurve(take.hero!.timingCurve!, progress),
    );
    const evaluated = evaluateScene(composition, take, project.entranceMotion, currentTime).cards.find((card) => card.cardId === cardId)!;
    expect(evaluated.x).toBeCloseTo(expected.x, 9);
    expect(evaluated.y).toBeCloseTo(expected.y, 9);
  });

  it("keeps a screen-relative hero locked to its output-frame destination during camera motion", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    const take = structuredClone(project.takes[0]);
    const cardId = composition.cards[0].cardId;
    take.cameraKeyframes = [
      { id: "start", time: 1, pose: { ...composition.camera }, easing: { x1: 0, y1: 0, x2: 1, y2: 1 }, holdDuration: 0, cut: false },
      { id: "end", time: 2, pose: { ...composition.camera, x: 1.2, z: 4.2 }, easing: { x1: 0, y1: 0, x2: 1, y2: 1 }, holdDuration: 0, cut: false },
    ];
    take.hero = {
      cardId, startTime: 1, duration: 1,
      target: { x: 0.42, y: 0.58, z: 1.5, scale: 1.8, rotation: 0 },
      path: { start: { x: 0, y: 0 }, control1: { x: 0, y: 0.1 }, control2: { x: 0, y: -0.1 } },
      timingCurve: { x1: 0, y1: 0, x2: 1, y2: 1 }, targetSpace: "screen",
      surroundingDim: 0, surroundingBlur: 0, reflowRadius: 0.3, attraction: 0, falloff: 1,
      maxDisplacement: 0, overlapPasses: 0, reflowDuration: 1, easing: "linear", reflowEasing: "linear",
    };
    const scene = evaluateScene(composition, take, project.entranceMotion, 2);
    const hero = scene.cards.find((card) => card.cardId === cardId)!;
    const projected = projectWorldPoint(composition, scene.camera, { ...fieldPointToWorld(composition, hero), z: hero.z });
    expect(projected.x).toBeCloseTo(0.42, 8);
    expect(projected.y).toBeCloseTo(0.58, 8);
  });

  it("upserts a deterministic camera settle around the hero without removing unrelated shots", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    const take = structuredClone(project.takes[0]);
    take.hero = {
      cardId: composition.cards[0].cardId, startTime: 3, duration: 1,
      target: { x: 0.5, y: 0.5, z: 1.4, scale: 1.7, rotation: 0 }, targetSpace: "screen",
      path: { start: { x: 0, y: 0 }, control1: { x: 0, y: 0.1 }, control2: { x: 0, y: -0.08 } },
      timingCurve: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 }, surroundingDim: 0.4, surroundingBlur: 2.5,
      reflowRadius: 0.34, attraction: 0.48, falloff: 1.4, maxDisplacement: 0.12, overlapPasses: 4,
      reflowDuration: 1.1, easing: "ease-out", reflowEasing: "ease-out",
    };
    take.cameraKeyframes = [{ id: "opening", time: 1, pose: { ...composition.camera, x: -1 }, easing: { x1: 0, y1: 0, x2: 1, y2: 1 }, holdDuration: 0, cut: false }];
    const settled = settleCameraOnHero(composition, take);
    const repeated = settleCameraOnHero(composition, { ...take, cameraKeyframes: settled });
    expect(repeated).toEqual(settled);
    expect(settled.some((keyframe) => keyframe.id === "opening")).toBe(true);
    expect(settled.filter((keyframe) => keyframe.role === "hero-start")).toHaveLength(1);
    expect(settled.filter((keyframe) => keyframe.role === "hero-end")).toHaveLength(1);
    expect(settled.find((keyframe) => keyframe.role === "hero-end")?.value?.z).toBeLessThan(composition.camera.z);
  });

  it("clears hero and its generated reflow without deleting the card", () => {
    const project = createDefaultProject();
    const take = structuredClone(project.takes[0]);
    take.hero = {
      cardId: project.compositions[0].cards[0].cardId,
      startTime: 1,
      duration: 1,
      target: { x: 0.5, y: 0.5, z: 1.5, scale: 1.8, rotation: 0 },
      path: { start: { x: 0, y: 0 }, control1: { x: 0, y: 0.1 }, control2: { x: 0, y: -0.1 } },
      timingCurve: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
      targetSpace: "world",
      surroundingDim: 0.25, surroundingBlur: 2, reflowRadius: 0.5, attraction: 0.5, falloff: 1.5,
      maxDisplacement: 0.12, overlapPasses: 3, reflowDuration: 1, easing: "ease-out", reflowEasing: "ease-out",
    };
    take.reflowTargets = { other: { x: 0.2, y: 0.2, z: 0, scale: 1, rotation: 0 } };
    const cleared = clearHeroPerformance(take);
    expect(cleared.hero).toBeNull();
    expect(cleared.reflowTargets).toEqual({});
    expect(project.compositions[0].cards.some((card) => card.cardId === take.hero?.cardId)).toBe(true);
  });

  it("invalidates texture keys for content or visible template fields only", () => {
    const project = createDefaultProject();
    const comment = project.comments[0];
    const key = createCardTextureKey(comment, project.cardStyle);
    expect(createCardTextureKey(comment, project.cardStyle)).toBe(key);
    expect(createCardTextureKey({ ...comment, message: `${comment.message}!` }, project.cardStyle)).not.toBe(key);
    expect(createCardTextureKey(comment, { ...project.cardStyle, showAvatar: false })).not.toBe(key);
    expect(createCardTextureKey(comment, { ...project.cardStyle, strokeWidth: 2 })).not.toBe(key);
    expect(createCardTextureKey(comment, { ...project.cardStyle, strokeColor: "#FF0000" })).not.toBe(key);
  });

  it("keys and sizes RAM previews from render-affecting state only", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    const take = project.takes[0];
    const key = createPreviewCacheKey(composition, take, project.entranceMotion, project.comments, project.cardStyle);
    expect(createPreviewCacheKey(composition, { ...take, name: "Renamed", notes: "Review" }, project.entranceMotion, project.comments, project.cardStyle)).toBe(key);
    expect(createPreviewCacheKey({ ...composition, backgroundColor: "#000000" }, take, project.entranceMotion, project.comments, project.cardStyle)).not.toBe(key);
    expect(createPreviewCacheKey(composition, take, { ...project.entranceMotion, driftAmount: 0.02 }, project.comments, project.cardStyle)).not.toBe(key);
    expect(createPreviewCacheKey(composition, { ...take, duration: take.duration + 1 }, project.entranceMotion, project.comments, project.cardStyle)).not.toBe(key);
    expect(createPreviewCacheKey(composition, take, project.entranceMotion, project.comments, project.cardStyle, { motionBlur: { ...project.renderSettings.motionBlur, enabled: true } })).not.toBe(
      createPreviewCacheKey(composition, take, project.entranceMotion, project.comments, project.cardStyle, project.renderSettings),
    );
    expect(createPreviewCacheKey(composition, { ...take, cameraKeyframes: [{ id: "camera", time: 1, pose: { ...composition.camera, x: 1 }, easing: { x1: 0, y1: 0, x2: 1, y2: 1 }, holdDuration: 0, cut: false }] }, project.entranceMotion, project.comments, project.cardStyle)).not.toBe(key);
    const dimensions = choosePreviewDimensions(composition, take.duration);
    expect(Math.max(dimensions.width, dimensions.height)).toBeLessThanOrEqual(960);
    const constrained = choosePreviewDimensions(composition, take.duration, {
      idleDelayMs: 400, memoryBudgetBytes: 40 * 1024 * 1024, proxyLongEdges: [960, 720, 540],
      webpQuality: 0.82, decodeAheadSeconds: 1, decodeBehindSeconds: 0.25,
    });
    expect(Math.max(constrained.width, constrained.height)).toBe(540);
    expect(previewFrameIndex(take.duration, take.duration, composition.frameRate)).toBe(Math.round(take.duration * composition.frameRate) - 1);
    const window = previewDecodeWindow(30, 240, 30);
    expect(window.first).toBeLessThan(30);
    expect(window.last).toBeGreaterThan(30);
    expect(wallClockPlaybackTime(0, 1_000, 9_000, 8)).toBe(8);
    expect(wallClockPlaybackTime(2, 1_000, 4_000, 8)).toBe(5);
  });

  it("builds a playable draft pass before refining exact 24 fps frames", () => {
    const order = progressivePreviewOrder(8);
    expect(order).toEqual([0, 2, 4, 6, 1, 3, 5, 7]);
    const sparse = [new Blob(), null, new Blob(), null, new Blob()];
    expect(nearestReadyPreviewFrame(sparse, 3)).toBe(2);
    expect(nearestReadyPreviewFrame(sparse, 1)).toBe(0);
    expect(nearestReadyPreviewFrame([null, null], 1)).toBe(-1);
  });

});
