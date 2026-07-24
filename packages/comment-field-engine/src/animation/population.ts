import type { CardPopulationSettings, SpatialBezierPath } from "../models/types";
import { clamp, lerp } from "../utils/math";
import { evaluateBezierCurve, invertBezierCurve, evaluateSpatialPath } from "./bezier";
import { resolveAuthoringDepth } from "./depth";
import { varySpatialPath } from "./pathVariation";

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

function allowsRespawn(settings: CardPopulationSettings) {
  return settings.respawn === true;
}

/**
 * Deterministic delay inside the burst arrival interval.
 * The bias curve is authored like every other ease in the app: x = time through the
 * interval, y = cumulative fraction of cards that should have arrived by then.
 * Ease-in (below the diagonal) starts sparse and accelerates; ease-out punches early.
 */
export function resolvePostHeroBurstDelay(settings: CardPopulationSettings, cardId: string) {
  const unit = hashUnit(`${settings.seed}:${cardId}:hero-burst-delay`);
  const curve = settings.postHeroBurstEasing ?? LINEAR_BURST_EASING;
  const weightedDelay = invertBezierCurve(curve, unit);
  return weightedDelay * Math.max(0, settings.postHeroBurstDuration);
}

function isBurstReserved(settings: CardPopulationSettings, cardId: string) {
  return settings.postHeroBurst > 0
    && hashUnit(`${settings.seed}:${cardId}:hero-burst`) < clamp(settings.postHeroBurst);
}

function isNormallyVisibleAt(
  settings: CardPopulationSettings,
  cardId: string,
  absoluteTime: number,
  triggerTime: number,
  entranceDuration: number,
) {
  const initial = hashUnit(`${settings.seed}:${cardId}:initial`) < clamp(settings.initialPopulation);
  // Hold mode: initial cards are always "living"; burst-reserved cards stay off until the bloom;
  // everyone else appears at their build trigger and stays.
  if (!allowsRespawn(settings)) {
    if (initial) return true;
    if (isBurstReserved(settings, cardId)) return false;
    return absoluteTime >= triggerTime;
  }

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
  const identity = `${settings.seed}:${cardId}:${cycle}:exit`;
  if (settings.exitMotion.pathMode === "shared") {
    return varySpatialPath(settings.exitMotion.path, settings.exitMotion.pathVariation, identity);
  }
  const direction = hashUnit(`${settings.seed}:${cardId}:${cycle}:exit-angle`) * TAU;
  const distance = settings.exitDistance * lerp(0.55, 1, hashUnit(`${settings.seed}:${cardId}:${cycle}:exit-distance`));
  const destination = { x: Math.cos(direction) * distance, y: Math.sin(direction) * distance };
  const sway = (hashUnit(`${settings.seed}:${cardId}:${cycle}:exit-sway`) * 2 - 1) * distance * 0.28;
  const perpendicular = { x: -Math.sin(direction) * sway, y: Math.cos(direction) * sway };
  const path = {
    start: destination,
    control1: { x: destination.x * 0.68 + perpendicular.x, y: destination.y * 0.68 + perpendicular.y },
    control2: { x: destination.x * 0.24 - perpendicular.x * 0.35, y: destination.y * 0.24 - perpendicular.y * 0.35 },
  };
  return varySpatialPath(path, settings.exitMotion.pathVariation, identity);
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

function livingState(
  settings: CardPopulationSettings,
  cardId: string,
  absoluteTime: number,
  start: number,
  cycle: number,
  entranceDuration: number,
  life: number,
  exitDuration: number,
): PopulationState {
  const exitStart = start + entranceDuration + Math.max(0.05, life);
  const exitProgress = clamp((absoluteTime - exitStart) / Math.max(0.05, exitDuration));
  const depthNoise = hashUnit(`${settings.seed}:${cardId}:${cycle}:depth`) * 2 - 1;
  const phaseX = hashUnit(`${settings.seed}:${cardId}:${cycle}:wander-x`) * TAU;
  const phaseY = hashUnit(`${settings.seed}:${cardId}:${cycle}:wander-y`) * TAU;
  const phaseR = hashUnit(`${settings.seed}:${cardId}:${cycle}:wander-r`) * TAU;
  const age = Math.max(0, absoluteTime - start);
  const wanderFade = Math.min(1, Math.max(0, age / Math.max(0.05, entranceDuration)));
  const exit = evaluateExitComponents(settings, cardId, cycle, exitProgress);
  return {
    visible: true,
    entranceProgress: (absoluteTime - start) / Math.max(0.001, entranceDuration),
    exitProgress,
    cycle,
    scale: Math.max(0.2, (1 + depthNoise * settings.scaleVariation) * exit.scale),
    depth: depthNoise * settings.depthVariation + exit.depth,
    x: Math.sin(age * 0.73 + phaseX) * settings.wanderAmount * wanderFade + exit.position.x,
    y: Math.sin(age * 0.61 + phaseY) * settings.wanderAmount * wanderFade + exit.position.y,
    rotation: Math.sin(age * 0.47 + phaseR) * settings.wanderAmount * 0.7 + exit.rotation,
    opacity: exit.opacity,
    blur: exit.blur,
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
  const neutral: PopulationState = {
    visible: true,
    entranceProgress: (absoluteTime - triggerTime) / Math.max(0.001, entranceDuration),
    exitProgress: 0,
    cycle: 0,
    scale: 1,
    depth: 0,
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    blur: 0,
  };
  if (!settings.enabled) return neutral;

  const initial = hashUnit(`${settings.seed}:${cardId}:initial`) < clamp(settings.initialPopulation);
  const initialAge = entranceDuration + randomRange(settings, cardId, -1, "initial-age", 0, Math.max(0, settings.lifeMin * 0.8));
  const holdMode = !allowsRespawn(settings);
  const burstReserved = isBurstReserved(settings, cardId);

  // ── Hold mode (default): appear once → live → animate out once. No re-entry.
  // Shared out template still runs; only the mid-shot leave/return loop is disabled.
  if (holdMode) {
    let start: number;
    let cycle = 0;

    if (initial) {
      start = -initialAge;
    } else if (burstReserved && burstStartTime !== undefined && settings.postHeroBurst > 0) {
      start = burstStartTime + resolvePostHeroBurstDelay(settings, cardId);
      cycle = 10_000;
    } else {
      start = triggerTime;
    }

    if (absoluteTime < start) {
      return { ...neutral, visible: false, entranceProgress: 0, cycle };
    }

    const isBurstCycle = cycle >= 10_000;
    const activeEntrance = isBurstCycle ? (settings.postHeroEntranceDuration ?? entranceDuration) : entranceDuration;
    const activeExit = isBurstCycle ? (settings.postHeroExitDuration ?? settings.exitDuration) : settings.exitDuration;
    const lifeMin = isBurstCycle ? (settings.postHeroLifeMin ?? settings.lifeMin) : settings.lifeMin;
    const lifeMax = isBurstCycle ? (settings.postHeroLifeMax ?? settings.lifeMax) : settings.lifeMax;
    const life = randomRange(settings, cardId, cycle, "life", lifeMin, lifeMax);
    const exitEnd = start + activeEntrance + Math.max(0.05, life) + Math.max(0.05, activeExit);

    // After the single out finishes, stay gone (no gap → return).
    if (absoluteTime >= exitEnd) {
      return { ...neutral, visible: false, entranceProgress: 0, cycle };
    }

    return livingState(settings, cardId, absoluteTime, start, cycle, activeEntrance, life, activeExit);
  }

  // ── Classic continuous field with life/gap respawn (advanced). ──
  let start = initial ? -initialAge : triggerTime;
  let cycle = 0;
  const burstCandidate = burstStartTime !== undefined
    && settings.postHeroBurst > 0
    && burstReserved
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
    if (isBurstCycle) return { ...neutral, visible: false, entranceProgress: 0, cycle };
    const gap = randomRange(settings, cardId, cycle, "gap", settings.gapMin, settings.gapMax);
    start = exitEnd + Math.max(0, gap);
    cycle += 1;
    if (absoluteTime < start) return { ...neutral, visible: false, entranceProgress: 0, cycle };
  }

  return livingState(settings, cardId, absoluteTime, start, cycle, activeEntranceDuration, life, activeExitDuration);
}
