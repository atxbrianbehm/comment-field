import type { CardPlacement, Composition, FieldBounds, ProtectedRegion, ScatterSettings } from "../models/types";
import { createPrng } from "../utils/prng";

export function pointInRegion(x: number, y: number, region: ProtectedRegion, padding = 0) {
  return x >= region.x - padding && x <= region.x + region.width + padding && y >= region.y - padding && y <= region.y + region.height + padding;
}

export function generateScatter(
  cardIds: string[],
  seed: string,
  settings: ScatterSettings,
  protectedRegions: ProtectedRegion[] = [],
  fieldBounds: FieldBounds = { width: 1, height: 1 },
): CardPlacement[] {
  const random = createPrng(seed);
  const placements: CardPlacement[] = [];
  const visibleCount = Math.max(1, Math.min(cardIds.length, Math.round(cardIds.length * settings.density)));
  const edge = settings.edgeMargin;
  const minX = 0.5 - fieldBounds.width / 2 + edge;
  const maxX = 0.5 + fieldBounds.width / 2 - edge;
  const minY = 0.5 - fieldBounds.height / 2 + edge;
  const maxY = 0.5 + fieldBounds.height / 2 - edge;

  for (let index = 0; index < visibleCount; index += 1) {
    let best = { x: minX + random() * (maxX - minX), y: minY + random() * (maxY - minY) };
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const candidate = { x: minX + random() * (maxX - minX), y: minY + random() * (maxY - minY) };
      const centerDistance = Math.hypot(candidate.x - 0.5, candidate.y - 0.5);
      if (centerDistance < settings.centerExclusion) continue;
      if (protectedRegions.some((region) => pointInRegion(candidate.x, candidate.y, region, settings.minSpacing * 0.35))) continue;
      const nearest = placements.length
        ? Math.min(...placements.map((placement) => Math.hypot(candidate.x - placement.x, candidate.y - placement.y)))
        : 1;
      const score = nearest + random() * settings.overlapAllowance * 0.05;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
      if (nearest >= settings.minSpacing * (1 - settings.overlapAllowance)) break;
    }
    const sizeDelta = (random() * 2 - 1) * settings.sizeVariation;
    placements.push({
      cardId: cardIds[index],
      x: best.x,
      y: best.y,
      z: settings.depthMin + random() * (settings.depthMax - settings.depthMin),
      scale: 1 + sizeDelta,
      rotation: (random() * 2 - 1) * settings.rotationVariation,
      locked: false,
    });
  }
  return placements;
}

export function regenerateComposition(composition: Composition, cardIds: string[]): Composition {
  const generated = generateScatter(cardIds, composition.seed, composition.scatter, composition.protectedRegions, composition.fieldBounds);
  const locked = new Map(composition.cards.filter((card) => card.locked).map((card) => [card.cardId, card]));
  return { ...composition, cards: generated.map((card) => locked.get(card.cardId) ?? card) };
}

export function fitFieldBoundsToComments(cardCount: number, aspect: number): FieldBounds {
  const targetArea = Math.max(1, cardCount / 12);
  const width = Math.sqrt(targetArea * Math.max(0.5, aspect));
  const height = targetArea / Math.max(1, width);
  return {
    width: Math.min(8, Math.max(1, Math.ceil(width))),
    height: Math.min(8, Math.max(1, Math.ceil(height))),
  };
}
