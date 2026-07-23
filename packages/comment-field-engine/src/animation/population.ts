import type { CardPopulationSettings, SpatialBezierPath } from "../models/types";
import { clamp, lerp } from "../utils/math";
import { evaluateBezierCurve, evaluateSpatialPath } from "./bezier";
import { resolveAuthoringDepth } from "./depth";

const TAU = Math.PI * 2;
const LINEAR_BURST_EASING = { x1: 0, y1: 0, x2: 1, y2: 1 } as const;

function hashUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function randomRange(settings: CardPopulationSettings, cardId: string, cycle: number, name: string, min: number, max: number) {
  return lerp(Math.min(min, max), Math.max(min, max), hashUnit(`${settings.seed}:${cardId}:${cycle}:${name}`));
}

export function resolvePostHeroBurstDelay(settings: CardPopulationSettings, cardId: string) {
  const randomDelay = hashUnit(`${settings.seed}:${cardId}:hero-burst-delay`);
  const weightedDelay = evaluateBezierCurve(settings.postHeroBurstEasing ?? LINEAR_BURST_EASING, randomDelay);
  return weightedDelay * Math.max(0, settings.postHeroBurstDuration);
}

function isNormallyVisibleAt(
  settings: CardPopulationSettings,
  cardId: string,
  absoluteTime: number,
  triggerTime: number,
  entranceDuration: number,
) {
  const initial = hashUnit(`${settings.seed}:${cardId}:initial`) < clamp(settings.initialPopulation);
  const initialAge = entranceDuration + randomRange(settings, cardId, -1, "initial-age", 0, Math.max(0, settings.lifeMin * 0.8));
  let start = initial ? -initialAge : triggerTime;
  let cycle = 0;
  if (absoluteTime < start) return false;
  for (let guard = 0; guard < 2048; guard += 1) {
    const life = randomRange(settings, cardId, cycle, "life", settings.lifeMin, settings.lifeMax);
    const exitEnd = start + entranceDuration + Math.max(0.05, life) + Math.max(0.05, settings.exitDuration);
    if (absoluteTime < exitEnd) return true;
    const gap = randomRange(settings, cardId, cycle, "gap", settings.gapMin, settings.gapMax);
    start = exitEnd + Math.max(0, gap);
    cycle += 1;
    if (absoluteTime < start) return false;
  }
  return false;
}

export interface PopulationState {
  visible: boolean;
  entranceProgress: number;
  exitProgress: number;
  cycle: number;
  scale: number;
  depth: number;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  blur: number;
}

export function resolveExitPath(settings: CardPopulationSettings, cardId: string, cycle: number): SpatialBezierPath {
  if (settings.exitMotion.pathMode === "shared") return settings.exitMotion.path;
  const direction = hashUnit(`${settings.seed}:${cardId}:${cycle}:exit-angle`) * TAU;
  const distance = settings.exitDistance * lerp(0.55, 1, hashUnit(`${settings.seed}:${cardId}:${cycle}:exit-distance`));
  const destination = { x: Math.cos(direction) * distance, y: Math.sin(direction) * distance };
  const sway = (hashUnit(`${settings.seed}:${cardId}:${cycle}:exit-sway`) * 2 - 1) * distance * 0.28;
  const perpendicular = { x: -Math.sin(direction) * sway, y: Math.cos(direction) * sway };
  return {
    start: destination,
    control1: { x: destination.x * 0.68 + perpendicular.x, y: destination.y * 0.68 + perpendicular.y },
    control2: { x: destination.x * 0.24 - perpendicular.x * 0.35, y: destination.y * 0.24 - perpendicular.y * 0.35 },
  };
}

export function evaluateExitComponents(settings: CardPopulationSettings, cardId: string, cycle: number, rawProgress: number) {
  const progress = evaluateBezierCurve(settings.exitMotion.easing, clamp(rawProgress));
  const opacityProgress = evaluateBezierCurve(settings.exitMotion.opacityEasing ?? settings.exitMotion.easing, clamp(rawProgress));
  const path = resolveExitPath(settings, cardId, cycle);
  const position = evaluateSpatialPath(path, 1 - progress);
  return {
    progress,
    path,
    position,
    scale: lerp(1, settings.exitMotion.scaleTo, progress),
    rotation: settings.exitMotion.rotationOffset * progress,
    depth: resolveAuthoringDepth(settings.exitMotion.depthOffset * progress),
    opacity: lerp(1, 1 - settings.exitMotion.fade, opacityProgress),
    blur: settings.exitMotion.blur * progress,
  };
}

/**
 * Evaluates a seeded lifecycle from absolute time. It has no accumulated simulation state,
 * so cached playback, scrubbing, save/load, and production export all resolve the same frame.
 */
export function evaluateCardPopulation(
  settings: CardPopulationSettings,
  cardId: string,
  absoluteTime: number,
  triggerTime: number,
  entranceDuration: number,
  burstStartTime?: number,
): PopulationState {
  const neutral: PopulationState = { visible: true, entranceProgress: (absoluteTime - triggerTime) / Math.max(0.001, entranceDuration), exitProgress: 0, cycle: 0, scale: 1, depth: 0, x: 0, y: 0, rotation: 0, opacity: 1, blur: 0 };
  if (!settings.enabled) return neutral;

  const initial = hashUnit(`${settings.seed}:${cardId}:initial`) < clamp(settings.initialPopulation);
  const initialAge = entranceDuration + randomRange(settings, cardId, -1, "initial-age", 0, Math.max(0, settings.lifeMin * 0.8));
  let start = initial ? -initialAge : triggerTime;
  let cycle = 0;
  const burstCandidate = burstStartTime !== undefined
    && settings.postHeroBurst > 0
    && hashUnit(`${settings.seed}:${cardId}:hero-burst`) < clamp(settings.postHeroBurst)
    && !isNormallyVisibleAt(settings, cardId, burstStartTime - 1e-6, triggerTime, entranceDuration);

  if (burstCandidate && burstStartTime !== undefined) {
    if (absoluteTime >= burstStartTime) {
      start = burstStartTime + resolvePostHeroBurstDelay(settings, cardId);
      cycle = 10_000;
    }
  }

  if (absoluteTime < start) return { ...neutral, visible: false, entranceProgress: 0, cycle };

  let life = 0;
  let exitEnd = 0;
  let activeEntranceDuration = entranceDuration;
  let activeExitDuration = settings.exitDuration;
  for (let guard = 0; guard < 2048; guard += 1) {
    const isBurstCycle = cycle >= 10_000;
    activeEntranceDuration = isBurstCycle ? (settings.postHeroEntranceDuration ?? entranceDuration) : entranceDuration;
    activeExitDuration = isBurstCycle ? (settings.postHeroExitDuration ?? settings.exitDuration) : settings.exitDuration;
    const lifeMin = isBurstCycle ? (settings.postHeroLifeMin ?? settings.lifeMin) : settings.lifeMin;
    const lifeMax = isBurstCycle ? (settings.postHeroLifeMax ?? settings.lifeMax) : settings.lifeMax;
    life = randomRange(settings, cardId, cycle, "life", lifeMin, lifeMax);
    exitEnd = start + activeEntranceDuration + Math.max(0.05, life) + Math.max(0.05, activeExitDuration);
    if (absoluteTime < exitEnd) break;
    const gap = randomRange(settings, cardId, cycle, "gap", settings.gapMin, settings.gapMax);
    start = exitEnd + Math.max(0, gap);
    cycle += 1;
    if (absoluteTime < start) return { ...neutral, visible: false, entranceProgress: 0, cycle };
  }

  const exitStart = start + activeEntranceDuration + Math.max(0.05, life);
  const exitProgress = clamp((absoluteTime - exitStart) / Math.max(0.05, activeExitDuration));

  const depthNoise = hashUnit(`${settings.seed}:${cardId}:${cycle}:depth`) * 2 - 1;
  const phaseX = hashUnit(`${settings.seed}:${cardId}:${cycle}:wander-x`) * TAU;
  const phaseY = hashUnit(`${settings.seed}:${cardId}:${cycle}:wander-y`) * TAU;
  const phaseR = hashUnit(`${settings.seed}:${cardId}:${cycle}:wander-r`) * TAU;
  const age = Math.max(0, absoluteTime - start);
  const wanderFade = Math.min(1, Math.max(0, age / Math.max(0.05, activeEntranceDuration)));
  const exit = evaluateExitComponents(settings, cardId, cycle, exitProgress);

  return {
    visible: true,
    entranceProgress: (absoluteTime - start) / Math.max(0.001, activeEntranceDuration),
    exitProgress,
    cycle,
    // Keep card design sizing consistent; residual scale jitter follows Z so apparent size reads as perspective.
    scale: Math.max(0.2, (1 + depthNoise * settings.scaleVariation) * exit.scale),
    depth: depthNoise * settings.depthVariation + exit.depth,
    x: Math.sin(age * 0.73 + phaseX) * settings.wanderAmount * wanderFade + exit.position.x,
    y: Math.sin(age * 0.61 + phaseY) * settings.wanderAmount * wanderFade + exit.position.y,
    rotation: Math.sin(age * 0.47 + phaseR) * settings.wanderAmount * 0.7 + exit.rotation,
    opacity: exit.opacity,
    blur: exit.blur,
  };
}
