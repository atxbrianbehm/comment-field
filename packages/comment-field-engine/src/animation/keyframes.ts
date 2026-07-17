import type { CubicBezierCurve, TimedKeyframe } from "../models/types";
import { clamp } from "../utils/math";
import { evaluateBezierCurve } from "./bezier";

export const LINEAR_CURVE: CubicBezierCurve = { x1: 0, y1: 0, x2: 1, y2: 1 };

export function snapTime(time: number, frameRate: number) {
  return Math.max(0, Math.round(time * frameRate) / frameRate);
}

export function keyframeTolerance(frameRate: number) {
  return 0.5 / Math.max(1, frameRate);
}

export function sortKeyframes<K extends TimedKeyframe<unknown>>(keyframes: readonly K[]): K[] {
  return [...keyframes].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export function findKeyframeAt<K extends TimedKeyframe<unknown>>(keyframes: readonly K[], time: number, frameRate: number): K | undefined {
  const tolerance = keyframeTolerance(frameRate);
  return keyframes.find((keyframe) => Math.abs(keyframe.time - time) <= tolerance);
}

export function upsertKeyframe<K extends TimedKeyframe<unknown>>(keyframes: readonly K[], next: K, frameRate: number): K[] {
  const snapped = { ...next, time: snapTime(next.time, frameRate) };
  const tolerance = keyframeTolerance(frameRate);
  return sortKeyframes([
    ...keyframes.filter((keyframe) => keyframe.id !== snapped.id && Math.abs(keyframe.time - snapped.time) > tolerance),
    snapped,
  ]);
}

export function moveKeyframe<K extends TimedKeyframe<unknown>>(keyframes: readonly K[], id: string, time: number, frameRate: number): K[] {
  const source = keyframes.find((keyframe) => keyframe.id === id);
  return source ? upsertKeyframe(keyframes, { ...source, time }, frameRate) : sortKeyframes(keyframes);
}

export function removeKeyframe<K extends TimedKeyframe<unknown>>(keyframes: readonly K[], id: string): K[] {
  return sortKeyframes(keyframes.filter((keyframe) => keyframe.id !== id));
}

export function segmentProgress<K extends TimedKeyframe<unknown>>(from: K, to: K, time: number) {
  const departure = Math.min(to.time, from.time + Math.max(0, from.holdDuration));
  if (time <= departure || to.time <= departure) return 0;
  if (to.interpolation === "cut" || to.cut) return 0;
  const linear = clamp((time - departure) / Math.max(0.000001, to.time - departure));
  const isLinear = to.interpolation === "linear" || (!to.interpolation && to.easing.x1 === 0 && to.easing.y1 === 0 && to.easing.x2 === 1 && to.easing.y2 === 1);
  return isLinear ? linear : evaluateBezierCurve(to.easing, linear);
}
