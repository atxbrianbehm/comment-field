import { PROJECT_VERSION, type Project, type Take } from "../models/types";
import { DEFAULT_ENTRANCE_MOTION, DEFAULT_RENDER_SETTINGS } from "../models/defaults";
import { cloneValue } from "../utils/clone";

export function serializeProject(project: Project): string {
  return JSON.stringify({ ...project, updatedAt: new Date().toISOString() }, null, 2);
}

export function deserializeProject(source: string): Project {
  const parsed = JSON.parse(source) as Project;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.compositions) || !Array.isArray(parsed.takes)) {
    throw new Error("This file is not a Comment Field project.");
  }
  if (parsed.version > PROJECT_VERSION) throw new Error(`Project version ${parsed.version} is newer than this app supports.`);
  return migrateProject(parsed);
}

export function migrateProject(project: Project): Project {
  const migrated = cloneValue(project);
  const legacyVersion = migrated.version;
  migrated.version = PROJECT_VERSION;
  migrated.renderSettings ??= cloneValue(DEFAULT_RENDER_SETTINGS);
  migrated.renderSettings.motionBlur ??= cloneValue(DEFAULT_RENDER_SETTINGS.motionBlur);
  migrated.renderSettings.motionBlur.enabled ??= false;
  migrated.renderSettings.motionBlur.shutterAngle ??= DEFAULT_RENDER_SETTINGS.motionBlur.shutterAngle;
  migrated.renderSettings.motionBlur.strength ??= DEFAULT_RENDER_SETTINGS.motionBlur.strength;
  const legacyDurations = new Map<string, number>();
  for (const composition of migrated.compositions) {
    const legacyComposition = composition as CompositionWithLegacyDuration;
    legacyDurations.set(composition.id, legacyComposition.duration ?? 8);
    composition.fieldBounds ??= legacyVersion < 5 ? { width: 1, height: 1 } : { width: 3, height: 3 };
    delete legacyComposition.duration;
  }
  migrated.cardStyle.strokeWidth ??= 0;
  migrated.cardStyle.strokeColor ??= "#1B1B18";
  migrated.cardStyle.showAvatar ??= true;
  migrated.cardStyle.showDisplayName ??= true;
  migrated.cardStyle.showHandle ??= true;
  migrated.cardStyle.showTimestamp ??= true;
  migrated.cardStyle.showEngagement ??= true;
  if (legacyVersion < 2) {
    const legacyMotions = migrated.takes.map((take) => {
      const legacyBuild = take.build as Take["build"] & Partial<{
        duration: number; fade: number; blur: number; scaleFrom: number; drift: number; easing: string;
      }>;
      const drift = legacyBuild.drift ?? 0;
      const easing = legacyBuild.easing === "linear"
        ? { x1: 0, y1: 0, x2: 1, y2: 1 }
        : legacyBuild.easing === "ease-in-out"
          ? { x1: 0.65, y1: 0, x2: 0.35, y2: 1 }
          : { x1: 0.16, y1: 1, x2: 0.3, y2: 1 };
      return {
        ...cloneValue(DEFAULT_ENTRANCE_MOTION),
        duration: legacyBuild.duration ?? DEFAULT_ENTRANCE_MOTION.duration,
        fade: legacyBuild.fade ?? DEFAULT_ENTRANCE_MOTION.fade,
        blur: legacyBuild.blur ?? DEFAULT_ENTRANCE_MOTION.blur,
        scaleFrom: legacyBuild.scaleFrom ?? DEFAULT_ENTRANCE_MOTION.scaleFrom,
        path: {
          start: { x: baseDirection(drift), y: drift * 0.35 },
          control1: { x: baseDirection(drift) * 0.7, y: drift * 0.25 },
          control2: { x: baseDirection(drift) * 0.25, y: drift * 0.1 },
        },
        easing,
      };
    });
    migrated.entranceMotion = legacyMotions[0] ?? cloneValue(DEFAULT_ENTRANCE_MOTION);
    migrated.takes.forEach((take, index) => {
      take.entranceOverride = JSON.stringify(legacyMotions[index]) === JSON.stringify(migrated.entranceMotion)
        ? undefined
        : legacyMotions[index];
    });
  } else {
    migrated.entranceMotion ??= cloneValue(DEFAULT_ENTRANCE_MOTION);
  }
  migrated.entranceMotion.opacityEasing ??= cloneValue(migrated.entranceMotion.easing);
  for (const take of migrated.takes) {
    if (take.entranceOverride) take.entranceOverride.opacityEasing ??= cloneValue(take.entranceOverride.easing);
  }
  if (legacyVersion < 4) {
    const preserveLegacyMotion = (motion: Project["entranceMotion"]) => {
      motion.springAmount = 0;
      motion.springBounces = 0;
      motion.springDamping = 0;
      motion.driftAmount = 0;
      motion.driftSpeed = 0;
      motion.driftRotation = 0;
    };
    preserveLegacyMotion(migrated.entranceMotion);
    for (const take of migrated.takes) {
      if (take.entranceOverride) preserveLegacyMotion(take.entranceOverride);
    }
  } else {
    migrated.entranceMotion.springAmount ??= DEFAULT_ENTRANCE_MOTION.springAmount;
    migrated.entranceMotion.springBounces ??= DEFAULT_ENTRANCE_MOTION.springBounces;
    migrated.entranceMotion.springDamping ??= DEFAULT_ENTRANCE_MOTION.springDamping;
    migrated.entranceMotion.driftAmount ??= DEFAULT_ENTRANCE_MOTION.driftAmount;
    migrated.entranceMotion.driftSpeed ??= DEFAULT_ENTRANCE_MOTION.driftSpeed;
    migrated.entranceMotion.driftRotation ??= DEFAULT_ENTRANCE_MOTION.driftRotation;
  }
  for (const take of migrated.takes) {
    take.duration ??= legacyDurations.get(take.compositionId) ?? 8;
    take.cameraKeyframes ??= [];
    take.cameraKeyframes = take.cameraKeyframes.map((keyframe) => {
      const legacy = keyframe as typeof keyframe & { pose?: typeof keyframe.value; cut?: boolean };
      const value = keyframe.value ?? legacy.pose;
      const isLinear = keyframe.easing?.x1 === 0 && keyframe.easing?.y1 === 0 && keyframe.easing?.x2 === 1 && keyframe.easing?.y2 === 1;
      const interpolation = keyframe.interpolation ?? (legacy.cut ? "cut" : isLinear ? "linear" : "bezier");
      const next = { ...keyframe, value, interpolation };
      delete (next as typeof legacy).pose;
      delete (next as typeof legacy).cut;
      return next;
    });
    if (take.hero) {
      const legacyHero = take.hero as typeof take.hero & {
        startTime?: number;
        duration?: number;
        target?: import("../models/types").Transform;
        path?: import("../models/types").SpatialBezierPath;
        timingCurve?: import("../models/types").CubicBezierCurve;
        surroundingDim?: number;
        surroundingBlur?: number;
        targetSpace?: "world" | "screen";
      };
      take.hero.reflowEasing ??= take.hero.easing ?? "ease-out";
      const path = legacyHero.path ?? {
        start: { x: 0, y: 0 },
        control1: { x: 0, y: 0.08 },
        control2: { x: 0, y: -0.08 },
      };
      const timingCurve = legacyHero.timingCurve ?? { x1: 0.16, y1: 1, x2: 0.3, y2: 1 };
      if (!Array.isArray(take.hero.keyframes)) {
        const startTime = legacyHero.startTime ?? Math.min(4, take.duration * 0.55);
        const endTime = startTime + (legacyHero.duration ?? 1.2);
        const target = legacyHero.target ?? { x: 0.5, y: 0.5, z: 1.5, scale: 1.8, rotation: 0 };
        take.hero.keyframes = [
          { id: `hero-source-${take.hero.cardId}`, time: startTime, value: { kind: "source" }, interpolation: "bezier", easing: timingCurve, holdDuration: 0, path },
          { id: `hero-pose-${take.hero.cardId}`, time: endTime, value: { kind: "pose", transform: target, targetSpace: legacyHero.targetSpace ?? (legacyVersion < 5 ? "world" : "screen"), surroundingDim: legacyHero.surroundingDim ?? 0, surroundingBlur: legacyHero.surroundingBlur ?? 0 }, interpolation: "bezier", easing: timingCurve, holdDuration: 0, path },
        ];
      }
      delete legacyHero.startTime;
      delete legacyHero.duration;
      delete legacyHero.target;
      delete legacyHero.path;
      delete legacyHero.timingCurve;
      delete legacyHero.surroundingDim;
      delete legacyHero.surroundingBlur;
      delete legacyHero.targetSpace;
    }
  }
  return migrated;
}

type CompositionWithLegacyDuration = Project["compositions"][number] & { duration?: number };

function baseDirection(drift: number) {
  return drift;
}
