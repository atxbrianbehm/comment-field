import { evaluateCamera, fieldPointToWorld, projectWorldPoint } from "../animation/camera";
import type { CardPlacement, CardTrigger, Composition, GestureSample, Take } from "../models/types";
import { clamp } from "../utils/math";

export function editGestureSample(
  samples: GestureSample[],
  index: number,
  patch: Partial<GestureSample>,
  frameRate: number,
): GestureSample[] {
  if (!samples[index]) return samples;
  const frame = 1 / frameRate;
  const previousTime = index > 0 ? samples[index - 1].time : 0;
  const nextTime = index < samples.length - 1 ? samples[index + 1].time : Number.POSITIVE_INFINITY;
  const requestedTime = patch.time === undefined ? samples[index].time : Math.round(patch.time * frameRate) * frame;
  const time = clamp(requestedTime, previousTime, nextTime);
  return samples.map((sample, sampleIndex) => sampleIndex === index ? {
    time,
    x: clamp(patch.x ?? sample.x, 0, 1),
    y: clamp(patch.y ?? sample.y, 0, 1),
  } : sample);
}

export function resolveGestureTriggers(
  samples: GestureSample[],
  cards: CardPlacement[],
  radius = 0.16,
  composition?: Composition,
  take?: Pick<Take, "cameraKeyframes">,
): CardTrigger[] {
  if (!samples.length) return [];
  return cards
    .map((card): CardTrigger | null => {
      let best: CardTrigger | null = null;
      for (const sample of samples) {
        const cardPoint = composition && take
          ? projectWorldPoint(composition, evaluateCamera(composition, take, sample.time), { ...fieldPointToWorld(composition, card), z: card.z })
          : card;
        const distance = Math.hypot(cardPoint.x - sample.x, cardPoint.y - sample.y);
        if (distance <= radius) {
          const trigger = { cardId: card.cardId, triggerTime: sample.time, influence: clamp(1 - distance / radius) };
          if (!best || trigger.triggerTime < best.triggerTime) best = trigger;
        }
      }
      return best;
    })
    .filter((trigger): trigger is CardTrigger => Boolean(trigger))
    .sort((a, b) => a.triggerTime - b.triggerTime || a.cardId.localeCompare(b.cardId));
}
