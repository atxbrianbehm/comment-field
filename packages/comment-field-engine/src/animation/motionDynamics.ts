import type { EntranceMotionTemplate, Point2D, SpatialBezierPath } from "../models/types";
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

/**
 * Builds a deterministic bottom-to-top entrance path for one card.
 * Lateral start is random in [-rainLateral, rainLateral]; vertical start is below settle (positive field y).
 * Control points introduce mild left/right sway so arrivals don't all follow the same line.
 */
export function resolveEntrancePath(
  motion: EntranceMotionTemplate,
  seed: string,
  cardId: string,
): SpatialBezierPath {
  if (motion.pathMode !== "rain") return motion.path;
  // Positive field Y is down-screen; start below settle so cards pop up into place.
  const distance = Math.max(0.05, Number.isFinite(motion.rainDistance) ? motion.rainDistance : 0.55);
  const spread = Math.max(0, Number.isFinite(motion.rainLateral) ? motion.rainLateral : 0.22);
  const lateral = (hashUnit(`${seed}:${cardId}:rain-x`) * 2 - 1) * spread;
  const sway = (hashUnit(`${seed}:${cardId}:rain-sway`) * 2 - 1) * spread * 0.45;
  const midSway = (hashUnit(`${seed}:${cardId}:rain-mid`) * 2 - 1) * spread * 0.35;
  return {
    start: { x: lateral, y: distance },
    control1: { x: lateral * 0.75 + sway, y: distance * 0.68 },
    control2: { x: midSway * 0.5, y: distance * 0.28 },
  };
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
  const opacityProgress = evaluateBezierCurve(motion.opacityEasing, clampedProgress);
  const springOffset = evaluateSpringOffset(rawProgress, motion);
  const transformProgress = easedProgress + springOffset;
  const path = resolveEntrancePath(motion, seed, cardId);
  const pathOffset = evaluateSpatialPath(path, easedProgress);
  const springPosition: Point2D = {
    x: -path.start.x * springOffset,
    y: -path.start.y * springOffset,
  };
  const driftFade = smoothstep(0.68, 1, rawProgress);
  const drift = evaluateAmbientDrift(seed, cardId, absoluteTime, driftFade, motion);
  return {
    easedProgress,
    transformProgress,
    path,
    position: {
      x: pathOffset.x + springPosition.x + drift.x,
      y: pathOffset.y + springPosition.y + drift.y,
    },
    drift,
    scale: lerp(motion.scaleFrom, 1, transformProgress),
    rotation: lerp(motion.rotationOffset, 0, transformProgress) + drift.rotation,
    depth: lerp(motion.depthOffset, 0, transformProgress),
    opacity: lerp(1 - motion.fade, 1, opacityProgress),
    blur: lerp(motion.blur, 0, easedProgress),
  };
}
