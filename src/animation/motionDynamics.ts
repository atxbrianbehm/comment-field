import type { EntranceMotionTemplate, Point2D } from "../models/types";
import { clamp, lerp } from "../utils/math";
import { evaluateBezierCurve, evaluateSpatialPath } from "./bezier";

const TAU = Math.PI * 2;

function hashUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const progress = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return progress * progress * (3 - 2 * progress);
}

export function evaluateSpringOffset(rawProgress: number, motion: EntranceMotionTemplate) {
  if (motion.springAmount === 0 || motion.springBounces === 0 || rawProgress <= 0.55 || rawProgress >= 1) return 0;
  const settleProgress = clamp((rawProgress - 0.55) / 0.45);
  const envelope = (1 - settleProgress) * Math.exp(-motion.springDamping * settleProgress);
  return Math.sin(settleProgress * TAU * motion.springBounces) * envelope * motion.springAmount;
}

export function evaluateAmbientDrift(
  seed: string,
  cardId: string,
  absoluteTime: number,
  fade: number,
  motion: EntranceMotionTemplate,
) {
  if (fade <= 0 || (motion.driftAmount === 0 && motion.driftRotation === 0) || motion.driftSpeed === 0) {
    return { x: 0, y: 0, rotation: 0 };
  }
  const phaseX = hashUnit(`${seed}:${cardId}:x`) * TAU;
  const phaseY = hashUnit(`${seed}:${cardId}:y`) * TAU;
  const phaseRotation = hashUnit(`${seed}:${cardId}:rotation`) * TAU;
  return {
    x: Math.sin(absoluteTime * TAU * motion.driftSpeed + phaseX) * motion.driftAmount * fade,
    y: Math.sin(absoluteTime * TAU * motion.driftSpeed * 0.83 + phaseY) * motion.driftAmount * fade,
    rotation: Math.sin(absoluteTime * TAU * motion.driftSpeed * 0.61 + phaseRotation) * motion.driftRotation * fade,
  };
}

export function evaluateEntranceComponents(
  motion: EntranceMotionTemplate,
  rawProgress: number,
  absoluteTime: number,
  seed: string,
  cardId: string,
) {
  const clampedProgress = clamp(rawProgress);
  const easedProgress = evaluateBezierCurve(motion.easing, clampedProgress);
  const springOffset = evaluateSpringOffset(rawProgress, motion);
  const transformProgress = easedProgress + springOffset;
  const pathOffset = evaluateSpatialPath(motion.path, easedProgress);
  const springPosition: Point2D = {
    x: -motion.path.start.x * springOffset,
    y: -motion.path.start.y * springOffset,
  };
  const driftFade = smoothstep(0.68, 1, rawProgress);
  const drift = evaluateAmbientDrift(seed, cardId, absoluteTime, driftFade, motion);
  return {
    easedProgress,
    transformProgress,
    position: {
      x: pathOffset.x + springPosition.x + drift.x,
      y: pathOffset.y + springPosition.y + drift.y,
    },
    drift,
    scale: lerp(motion.scaleFrom, 1, transformProgress),
    rotation: lerp(motion.rotationOffset, 0, transformProgress) + drift.rotation,
    depth: lerp(motion.depthOffset, 0, transformProgress),
    opacity: lerp(1 - motion.fade, 1, easedProgress),
    blur: lerp(motion.blur, 0, easedProgress),
  };
}
