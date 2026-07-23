import { clamp, lerp } from "../utils/math";

const LINEAR_DEPTH_LIMIT = 2;
const AUTHORING_DEPTH_MAX = 8;
const SAFE_WORLD_DEPTH_MAX = 3.5;

/**
 * Keeps the familiar -2..2 range linear, then compresses extended positive Z
 * into camera-safe world space. The default production camera sits at Z=5, so
 * literal values above 5 would cross behind it and stop producing useful motion.
 */
export function resolveAuthoringDepth(value: number) {
  if (value <= LINEAR_DEPTH_LIMIT) return value;
  const progress = clamp((value - LINEAR_DEPTH_LIMIT) / (AUTHORING_DEPTH_MAX - LINEAR_DEPTH_LIMIT));
  const smoothProgress = progress * progress * (3 - 2 * progress);
  return lerp(LINEAR_DEPTH_LIMIT, SAFE_WORLD_DEPTH_MAX, smoothProgress);
}
