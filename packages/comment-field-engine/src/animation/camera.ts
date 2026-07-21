import type { CameraKeyframe, CameraPose, Composition, Point2D, Take } from "../models/types";
import { clamp, lerp } from "../utils/math";
import { evaluateBezierCurve } from "./bezier";
import { segmentProgress, sortKeyframes, upsertKeyframe } from "./keyframes";
import { heroEndTime, heroStartTime } from "./hero";

/**
 * Default "smooth" camera arrival: gentle ease-in-out.
 * (Old default {0.16,1,0.3,1} was a near-step ease-out — ~97% of the move by midpoint —
 * so every "smooth" pan felt like a hard ramp then coast.)
 */
export const DEFAULT_CAMERA_EASING = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 } as const;

/** Strong ease-out for intentional snappy arrivals (preset). */
export const CAMERA_EASE_OUT = { x1: 0.2, y1: 0.9, x2: 0.35, y2: 1 } as const;

/** Legacy default that shipped as "smooth" — treated as DEFAULT_CAMERA_EASING at evaluate/migrate. */
export const LEGACY_CAMERA_SNAP_EASING = { x1: 0.16, y1: 1, x2: 0.3, y2: 1 } as const;

export function isLegacyCameraSnapEasing(easing: { x1: number; y1: number; x2: number; y2: number } | undefined | null) {
  if (!easing) return false;
  return (
    Math.abs(easing.x1 - LEGACY_CAMERA_SNAP_EASING.x1) < 1e-6
    && Math.abs(easing.y1 - LEGACY_CAMERA_SNAP_EASING.y1) < 1e-6
    && Math.abs(easing.x2 - LEGACY_CAMERA_SNAP_EASING.x2) < 1e-6
    && Math.abs(easing.y2 - LEGACY_CAMERA_SNAP_EASING.y2) < 1e-6
  );
}

export function resolveCameraEasing(easing: { x1: number; y1: number; x2: number; y2: number } | undefined | null) {
  if (!easing || isLegacyCameraSnapEasing(easing)) return { ...DEFAULT_CAMERA_EASING };
  return { ...easing };
}

export function compositionWorldDimensions(composition: Pick<Composition, "width" | "height">) {
  const height = 4;
  return { width: height * (composition.width / composition.height), height };
}

export function fieldPointToWorld(composition: Pick<Composition, "width" | "height">, point: Point2D) {
  const dimensions = compositionWorldDimensions(composition);
  return { x: (point.x - 0.5) * dimensions.width, y: (0.5 - point.y) * dimensions.height };
}

export function worldPointToField(composition: Pick<Composition, "width" | "height">, point: Point2D) {
  const dimensions = compositionWorldDimensions(composition);
  return { x: point.x / dimensions.width + 0.5, y: 0.5 - point.y / dimensions.height };
}

export function projectWorldPoint(
  composition: Pick<Composition, "width" | "height">,
  camera: CameraPose,
  point: { x: number; y: number; z: number },
): Point2D {
  const depth = Math.max(0.001, camera.z - point.z);
  const halfHeight = depth * Math.tan((camera.fov * Math.PI) / 360);
  const halfWidth = halfHeight * (composition.width / composition.height);
  return {
    x: 0.5 + (point.x - camera.x) / (2 * halfWidth),
    y: 0.5 - (point.y - camera.y) / (2 * halfHeight),
  };
}

export function unprojectScreenPoint(
  composition: Pick<Composition, "width" | "height">,
  camera: CameraPose,
  point: Point2D,
  z: number,
) {
  const depth = Math.max(0.001, camera.z - z);
  const halfHeight = depth * Math.tan((camera.fov * Math.PI) / 360);
  const halfWidth = halfHeight * (composition.width / composition.height);
  return {
    x: camera.x + (point.x - 0.5) * 2 * halfWidth,
    y: camera.y - (point.y - 0.5) * 2 * halfHeight,
    z,
  };
}

function interpolatePose(from: CameraPose, to: CameraPose, progress: number): CameraPose {
  return {
    x: lerp(from.x, to.x, progress),
    y: lerp(from.y, to.y, progress),
    z: lerp(from.z, to.z, progress),
    fov: lerp(from.fov, to.fov, progress),
  };
}

function cameraPoseOf(keyframe: CameraKeyframe, fallback: CameraPose): CameraPose {
  return { ...(keyframe.value ?? keyframe.pose ?? fallback) };
}

function normalizeCameraKeyframe(keyframe: CameraKeyframe): CameraKeyframe {
  // Normalize legacy UI value "smooth" → bezier so curve always applies.
  return {
    ...keyframe,
    interpolation: keyframe.interpolation === "cut" || keyframe.cut
      ? "cut"
      : keyframe.interpolation === "linear"
        ? "linear"
        : "bezier",
    cut: keyframe.interpolation === "cut" || Boolean(keyframe.cut),
    // Soften the old "smooth" snap curve so playback matches the new default.
    easing: resolveCameraEasing(keyframe.easing),
  };
}

/**
 * Evaluate camera pose at absolute time.
 *
 * Important: before the first authored key we HOLD that first pose.
 * We do NOT animate from composition.camera (center default) — that phantom
 * pan made every take feel like it "came in from upper-left" whenever keys
 * lived away from the field origin.
 */
export function evaluateCamera(composition: Composition, take: Pick<Take, "cameraKeyframes">, absoluteTime: number): CameraPose {
  const keyframes = sortKeyframes(take.cameraKeyframes ?? []).map(normalizeCameraKeyframe);
  if (!keyframes.length) return { ...composition.camera };
  const time = Math.max(0, absoluteTime);
  const first = keyframes[0]!;
  // Hold first key from t=0 until its arrival (and through its hold).
  if (time < first.time) {
    return cameraPoseOf(first, composition.camera);
  }

  let previous = first;
  for (let index = 1; index < keyframes.length; index += 1) {
    const arrival = keyframes[index]!;
    if (time >= arrival.time) {
      previous = arrival;
      continue;
    }
    const progress = segmentProgress(previous, arrival, time);
    return interpolatePose(
      cameraPoseOf(previous, composition.camera),
      cameraPoseOf(arrival, composition.camera),
      progress,
    );
  }
  return cameraPoseOf(previous, composition.camera);
}

export function cameraFrameInField(composition: Composition, pose: CameraPose) {
  const world = unprojectScreenPoint(composition, pose, { x: 0, y: 0 }, 0);
  const opposite = unprojectScreenPoint(composition, pose, { x: 1, y: 1 }, 0);
  const first = worldPointToField(composition, world);
  const second = worldPointToField(composition, opposite);
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  };
}

export function cameraPoseCenteredOnFieldPoint(composition: Composition, base: CameraPose, point: Point2D, dolly = 0.1): CameraPose {
  const world = fieldPointToWorld(composition, point);
  return { ...base, x: world.x, y: world.y, z: Math.max(1.75, base.z * (1 - dolly)) };
}

export function upsertCameraKeyframe(keyframes: CameraKeyframe[], keyframe: CameraKeyframe, frameRate = 30) {
  const withoutMatch = keyframes.filter((item) => {
    const sameRole = keyframe.role !== undefined && item.role === keyframe.role;
    return item.id !== keyframe.id && !sameRole && Math.abs(item.time - keyframe.time) > 0.0001;
  });
  return upsertKeyframe(withoutMatch, keyframe, frameRate);
}

export function settleCameraOnHero(composition: Composition, take: Take, dolly = 0.1) {
  if (!take.hero) return take.cameraKeyframes;
  const source = composition.cards.find((card) => card.cardId === take.hero?.cardId);
  if (!source) return take.cameraKeyframes;
  const startTime = heroStartTime(take.hero);
  const endTime = Math.min(take.duration, heroEndTime(take.hero));
  const startPose = evaluateCamera(composition, take, startTime);
  let cameraKeyframes = upsertCameraKeyframe(take.cameraKeyframes, {
    id: `camera-hero-start-${take.hero.cardId}`,
    role: "hero-start",
    time: startTime,
    value: startPose,
    easing: { ...DEFAULT_CAMERA_EASING },
    holdDuration: 0,
    interpolation: "bezier",
  }, composition.frameRate);
  cameraKeyframes = cameraKeyframes.filter((keyframe) => keyframe.role !== "hero-end");
  const endBase = evaluateCamera(composition, { ...take, cameraKeyframes }, endTime);
  cameraKeyframes = upsertCameraKeyframe(cameraKeyframes, {
    id: `camera-hero-end-${take.hero.cardId}`,
    role: "hero-end",
    time: endTime,
    value: cameraPoseCenteredOnFieldPoint(composition, endBase, source, dolly),
    easing: { ...DEFAULT_CAMERA_EASING },
    holdDuration: 0,
    interpolation: "bezier",
  }, composition.frameRate);
  return cameraKeyframes;
}
