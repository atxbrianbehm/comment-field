import type { CardWobbleSettings } from "../models/types";

const TAU = Math.PI * 2;

function hashUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

/**
 * Absolute-time, per-card bend adapted from Transform Scatter's leaf model.
 * There is deliberately no accumulated simulation state.
 */
export function evaluateCardWobble(
  settings: CardWobbleSettings,
  seed: string,
  cardId: string,
  absoluteTime: number,
) {
  if (!settings.enabled || settings.amount === 0 || settings.speed === 0) return 0;
  const variation = Math.max(0, Math.min(1, settings.variation));
  const amplitude = settings.amount * (1 + (hashUnit(`${seed}:${cardId}:wobble-amplitude`) * 2 - 1) * variation);
  const speed = settings.speed * (1 + (hashUnit(`${seed}:${cardId}:wobble-speed`) * 2 - 1) * variation * 0.6);
  const phase = hashUnit(`${seed}:${cardId}:wobble-phase`) * TAU;
  const primary = Math.sin(absoluteTime * TAU * speed + phase);
  const flutter = Math.sin(absoluteTime * TAU * speed * 1.83 + phase * 0.61) * 0.22;
  return amplitude * (primary + flutter);
}
