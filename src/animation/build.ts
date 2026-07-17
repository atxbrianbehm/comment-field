import type { BuildPerformance, CardPlacement, CardTrigger } from "../models/types";
import { createPrng } from "../utils/prng";

export function resolveBuildTriggers(cards: CardPlacement[], build: BuildPerformance): CardTrigger[] {
  const random = createPrng(build.seed);
  const randomized = cards.map((card) => ({ card, random: random() }));
  randomized.sort((a, b) => {
    if (build.order === "left-to-right") return a.card.x - b.card.x || a.card.cardId.localeCompare(b.card.cardId);
    if (build.order === "outside-in") {
      const da = Math.hypot(a.card.x - 0.5, a.card.y - 0.5);
      const db = Math.hypot(b.card.x - 0.5, b.card.y - 0.5);
      return db - da || a.card.cardId.localeCompare(b.card.cardId);
    }
    if (build.order === "depth") return a.card.z - b.card.z || a.card.cardId.localeCompare(b.card.cardId);
    return a.random - b.random || a.card.cardId.localeCompare(b.card.cardId);
  });
  const denominator = Math.max(1, randomized.length - 1);
  return randomized.map(({ card }, index) => ({
    cardId: card.cardId,
    triggerTime: build.staggerStart + (index / denominator) * (build.staggerEnd - build.staggerStart),
    influence: 1,
  }));
}
