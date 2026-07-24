import type { SpatialBezierPath } from "../models/types";

function hashUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function signed(identity: string, channel: string) {
  return hashUnit(`${identity}:${channel}`) * 2 - 1;
}

/**
 * Perturbs a relative motion path without moving its resting destination.
 * The result depends only on the identity string, making scrubbing, caching,
 * and export produce identical paths.
 */
export function varySpatialPath(path: SpatialBezierPath, amount: number, identity: string): SpatialBezierPath {
  const variation = Math.max(0, Number.isFinite(amount) ? amount : 0);
  if (variation === 0) return path;
  return {
    start: {
      x: path.start.x + signed(identity, "start-x") * variation,
      y: path.start.y + signed(identity, "start-y") * variation,
    },
    control1: {
      x: path.control1.x + signed(identity, "control-1-x") * variation * 0.8,
      y: path.control1.y + signed(identity, "control-1-y") * variation * 0.8,
    },
    control2: {
      x: path.control2.x + signed(identity, "control-2-x") * variation * 0.45,
      y: path.control2.y + signed(identity, "control-2-y") * variation * 0.45,
    },
  };
}
