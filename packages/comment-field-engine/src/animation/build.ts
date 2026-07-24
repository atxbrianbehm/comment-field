import type { BuildPerformance, CardPlacement, CardTrigger, CubicBezierCurve } from "../models/types";
import { createPrng } from "../utils/prng";
import { invertBezierCurve } from "./bezier";

const LINEAR_STAGGER: CubicBezierCurve = { x1: 0, y1: 0, x2: 1, y2: 1 };

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
  const span = build.staggerEnd - build.staggerStart;
  const curve = build.staggerEasing ?? LINEAR_STAGGER;
  return randomized.map(({ card }, index) => {
    // Rank is ordered position in the build (not a random delay sample). The curve is a
    // cumulative arrival map: ease-in packs more triggers toward stagger end (ramp up).
    const rank = index / denominator;
    const arrival = invertBezierCurve(curve, rank);
    return {
      cardId: card.cardId,
      triggerTime: build.staggerStart + arrival * span,
      influence: 1,
    };
  });
}
