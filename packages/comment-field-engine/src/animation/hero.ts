import type { HeroKeyframe, HeroPerformance, Take } from "../models/types";
import { sortKeyframes } from "./keyframes";

export function clearHeroPerformance(take: Take): Take {
  return { ...take, hero: null, reflowTargets: {} };
}

export function sortedHeroKeyframes(hero: HeroPerformance) {
  if (hero.keyframes?.length) return sortKeyframes(hero.keyframes);
  const startTime = hero.startTime ?? 0;
  const duration = hero.duration ?? 1;
  const path = hero.path ?? { start: { x: 0, y: 0 }, control1: { x: 0, y: 0 }, control2: { x: 0, y: 0 } };
  const easing = hero.timingCurve ?? { x1: 0.16, y1: 1, x2: 0.3, y2: 1 };
  return sortKeyframes<HeroKeyframe>([
    { id: `hero-source-${hero.cardId}`, time: startTime, value: { kind: "source" }, interpolation: "bezier", easing, holdDuration: 0, path },
    { id: `hero-pose-${hero.cardId}`, time: startTime + duration, value: { kind: "pose", transform: hero.target ?? { x: 0.5, y: 0.5, z: 1.5, scale: 1.8, rotation: 0 }, targetSpace: hero.targetSpace ?? "world", surroundingDim: hero.surroundingDim ?? 0, surroundingBlur: hero.surroundingBlur ?? 0 }, interpolation: "bezier", easing, holdDuration: 0, path },
  ]);
}

export function heroStartTime(hero: HeroPerformance) {
  return sortedHeroKeyframes(hero)[0]?.time ?? 0;
}

export function heroEndTime(hero: HeroPerformance) {
  return sortedHeroKeyframes(hero).at(-1)?.time ?? heroStartTime(hero);
}

export function heroPoseKeyframes(hero: HeroPerformance): HeroKeyframe[] {
  return sortedHeroKeyframes(hero).filter((keyframe) => keyframe.value.kind === "pose");
}
