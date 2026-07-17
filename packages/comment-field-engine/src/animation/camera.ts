import type { CameraKeyframe, CameraPose, Composition, Point2D, Take } from "../models/types";
import { clamp, lerp } from "../utils/math";
import { evaluateBezierCurve } from "./bezier";
import { segmentProgress, sortKeyframes, upsertKeyframe } from "./keyframes";
import { heroEndTime, heroStartTime } from "./hero";

export const DEFAULT_CAMERA_EASING = { x1: 0.16, y1: 1, x2: 0.3, y2: 1 } as const;

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

export function evaluateCamera(composition: Composition, take: Pick<Take, "cameraKeyframes">, absoluteTime: number): CameraPose {
  const keyframes = sortKeyframes(take.cameraKeyframes ?? []);
  if (!keyframes.length) return { ...composition.camera };
  const time = Math.max(0, absoluteTime);
  let previous: CameraKeyframe = {
    id: "composition-camera",
    time: 0,
    value: composition.camera,
    easing: DEFAULT_CAMERA_EASING,
    holdDuration: 0,
    interpolation: "bezier",
  };
  for (const next of keyframes) {
    if (time >= next.time) {
      previous = next;
      continue;
    }
    const progress = segmentProgress(previous, next, time);
    return interpolatePose(previous.value ?? previous.pose ?? composition.camera, next.value ?? next.pose ?? composition.camera, progress);
  }
  return { ...(previous.value ?? previous.pose ?? composition.camera) };
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
