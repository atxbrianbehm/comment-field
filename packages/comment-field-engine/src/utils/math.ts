import type { EasingName, Transform } from "../models/types";

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function ease(name: EasingName, t: number): number {
  const n = clamp(t);
  if (name === "ease-out") return 1 - (1 - n) ** 3;
  if (name === "ease-in-out") return n < 0.5 ? 4 * n ** 3 : 1 - ((-2 * n + 2) ** 3) / 2;
  return n;
}

export function lerpTransform(a: Transform, b: Transform, t: number): Transform {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    scale: lerp(a.scale, b.scale, t),
    rotation: lerp(a.rotation, b.rotation, t),
  };
}

export function distance(a: Pick<Transform, "x" | "y">, b: Pick<Transform, "x" | "y">) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
