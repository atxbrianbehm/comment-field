import { evaluateCamera, fieldPointToWorld, projectWorldPoint } from "../animation/camera";
import type { CardPlacement, CardTrigger, Composition, GestureSample, Take } from "../models/types";
import { clamp } from "../utils/math";

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
