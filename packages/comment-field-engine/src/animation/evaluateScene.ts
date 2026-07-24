import type { Composition, EntranceMotionTemplate, EvaluatedCard, HeroKeyframe, Point2D, SceneState, Take, Transform } from "../models/types";
import { clamp, ease, lerp, lerpTransform } from "../utils/math";
import { cubicPoint, evaluateBezierCurve } from "./bezier";
import { evaluateCamera, fieldPointToWorld, projectWorldPoint, unprojectScreenPoint, worldPointToField } from "./camera";
import { evaluateEntranceComponents } from "./motionDynamics";
import { evaluateCardPopulation } from "./population";
import { segmentProgress } from "./keyframes";
import { heroEndTime, heroStartTime, sortedHeroKeyframes } from "./hero";

export function evaluateScene(composition: Composition, take: Take, entranceMotion: EntranceMotionTemplate, absoluteTime: number): SceneState {
  const camera = evaluateCamera(composition, take, absoluteTime);
  const triggers = new Map(take.cardTriggers.map((trigger) => [trigger.cardId, trigger]));
  const hero = take.hero;
  const heroKeys = hero ? sortedHeroKeyframes(hero) : [];
  const heroStart = hero ? heroStartTime(hero) : Number.POSITIVE_INFINITY;
  const heroEnd = hero ? heroEndTime(hero) : undefined;
  const finalBurstStart = take.population.postHeroBurstStartTime ?? heroEnd ?? Math.max(0, take.duration - 2);
  function screenRelativeFieldPosition(base: Composition["cards"][number], z: number, offset: Point2D) {
    const baseWorld = fieldPointToWorld(composition, base);
    const baseScreen = projectWorldPoint(composition, camera, { ...baseWorld, z: base.z });
    const world = unprojectScreenPoint(composition, camera, {
      x: baseScreen.x + offset.x,
      y: baseScreen.y + offset.y,
    }, z);
    return worldPointToField(composition, world);
  }

  function evaluateOrdinary(base: Composition["cards"][number], time: number, forceReveal = false) {
    const trigger = triggers.get(base.cardId);
    const triggerTime = trigger?.triggerTime ?? 0;
    const population = evaluateCardPopulation(take.population, base.cardId, time, triggerTime, entranceMotion.duration, finalBurstStart);
    const rawBuild = trigger
      ? population.entranceProgress
      : take.gestureSamples.length > 0 && !forceReveal ? 0 : 1;
    const motion = evaluateEntranceComponents(entranceMotion, rawBuild, time, composition.seed, base.cardId);
    const z = base.z + motion.depth + population.depth;
    const baseOffset = {
      x: motion.position.x - motion.drift.x + population.x,
      y: motion.position.y - motion.drift.y + population.y,
    };
    const position = screenRelativeFieldPosition(base, z, {
      x: baseOffset.x + motion.drift.x,
      y: baseOffset.y + motion.drift.y,
    });
    const basePosition = screenRelativeFieldPosition(base, z, baseOffset);
    const baseTransform: Transform = {
      x: basePosition.x,
      y: basePosition.y,
      z,
      scale: base.scale * motion.scale * population.scale,
      rotation: base.rotation + motion.rotation - motion.drift.rotation + population.rotation,
    };
    return {
      baseTransform,
      transform: {
        ...baseTransform,
        x: position.x,
        y: position.y,
        rotation: baseTransform.rotation + motion.drift.rotation,
      },
      drift: {
        x: position.x - basePosition.x,
        y: position.y - basePosition.y,
        rotation: motion.drift.rotation,
      },
      opacity: population.visible ? motion.opacity * population.opacity : 0,
      blur: motion.blur + population.blur,
    };
  }
  const cards: EvaluatedCard[] = composition.cards.map((base) => {
    const isHero = hero?.cardId === base.cardId;
    const ordinary = evaluateOrdinary(base, absoluteTime, Boolean(isHero && hero && absoluteTime >= heroStart));
    let transform = ordinary.transform;
    let opacity = ordinary.opacity;
    let blur = ordinary.blur;
    let layerPriority = Math.round((base.z + 2) * 100);
    if (hero && absoluteTime >= heroStart && heroKeys.length) {
      const nextIndex = heroKeys.findIndex((keyframe) => keyframe.time > absoluteTime);
      const toIndex = nextIndex < 0 ? heroKeys.length - 1 : nextIndex;
      const fromIndex = Math.max(0, toIndex - 1);
      const fromKey = heroKeys[fromIndex];
      const toKey = heroKeys[toIndex];
      const heroProgress = fromKey.id === toKey.id ? 1 : segmentProgress(fromKey, toKey, absoluteTime);
      const presentation = interpolateHeroPresentation(fromKey, toKey, heroProgress);
      if (isHero) {
        const frozen = evaluateOrdinary(base, heroStart, true);
        const fromTransform = resolveHeroTransform(fromKey, frozen.transform);
        const toTransform = resolveHeroTransform(toKey, fromTransform);
        const interpolated = lerpTransform(fromTransform, toTransform, heroProgress);
        const targetSpace = toKey.value.kind === "pose" ? toKey.value.targetSpace : "world";
        if (targetSpace === "screen") {
          const startCamera = evaluateCamera(composition, take, fromKey.time);
          const sourceScreen = heroKeyScreenPoint(composition, startCamera, fromKey, fromTransform);
          const targetScreen = heroKeyScreenPoint(composition, evaluateCamera(composition, take, toKey.time), toKey, toTransform);
          const screenPosition = cubicPoint(
            sourceScreen,
            { x: sourceScreen.x + toKey.path.control1.x, y: sourceScreen.y + toKey.path.control1.y },
            { x: targetScreen.x + toKey.path.control2.x, y: targetScreen.y + toKey.path.control2.y },
            targetScreen,
            heroProgress,
          );
          const worldPosition = unprojectScreenPoint(composition, camera, screenPosition, interpolated.z);
          const fieldPosition = worldPointToField(composition, worldPosition);
          transform = { ...interpolated, x: fieldPosition.x, y: fieldPosition.y };
        } else {
          const source: Point2D = { x: frozen.transform.x, y: frozen.transform.y };
          const fromPoint: Point2D = { x: fromTransform.x, y: fromTransform.y };
          const targetPoint: Point2D = { x: toTransform.x, y: toTransform.y };
          const position = cubicPoint(
            fromPoint,
            { x: fromPoint.x + toKey.path.control1.x, y: fromPoint.y + toKey.path.control1.y },
            { x: targetPoint.x + toKey.path.control2.x, y: targetPoint.y + toKey.path.control2.y },
            targetPoint,
            heroProgress,
          );
          transform = { ...interpolated, x: position.x, y: position.y };
        }
        opacity = frozen.opacity;
        blur = frozen.blur;
        layerPriority = 1_000_000;
      }
      else {
        opacity *= 1 - presentation.dim;
        blur += presentation.blur;
        const target = take.reflowTargets[base.cardId];
        if (target) {
          const reflowProgress = ease(hero.reflowEasing, clamp((absoluteTime - heroStart) / Math.max(0.001, hero.reflowDuration)));
          const reflowBase = lerpTransform(ordinary.baseTransform, target, reflowProgress);
          transform = {
            ...reflowBase,
            x: reflowBase.x + ordinary.drift.x,
            y: reflowBase.y + ordinary.drift.y,
            rotation: reflowBase.rotation + ordinary.drift.rotation,
          };
        }
      }
    }
    return { ...transform, cardId: base.cardId, opacity, blur, isHero, layerPriority };
  });
  return { cards, camera, time: absoluteTime };
}

function resolveHeroTransform(keyframe: HeroKeyframe, fallback: Transform) {
  return keyframe.value.kind === "pose" ? keyframe.value.transform : fallback;
}

function heroKeyScreenPoint(composition: Composition, camera: ReturnType<typeof evaluateCamera>, keyframe: HeroKeyframe, transform: Transform) {
  if (keyframe.value.kind === "pose" && keyframe.value.targetSpace === "screen") return { x: transform.x, y: transform.y };
  const world = fieldPointToWorld(composition, transform);
  return projectWorldPoint(composition, camera, { ...world, z: transform.z });
}

function interpolateHeroPresentation(from: HeroKeyframe, to: HeroKeyframe, progress: number) {
  const fromDim = from.value.kind === "pose" ? from.value.surroundingDim : 0;
  const fromBlur = from.value.kind === "pose" ? from.value.surroundingBlur : 0;
  const toDim = to.value.kind === "pose" ? to.value.surroundingDim : fromDim;
  const toBlur = to.value.kind === "pose" ? to.value.surroundingBlur : fromBlur;
  return { dim: lerp(fromDim, toDim, progress), blur: lerp(fromBlur, toBlur, progress) };
}
