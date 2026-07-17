import type { Composition, HeroPerformance, ProtectedRegion, Transform } from "../models/types";
import { clamp, distance } from "../utils/math";
import { pointInRegion } from "../layout/scatter";

function rejectProtected(candidate: Transform, regions: ProtectedRegion[], fallback: Transform): Transform {
  return regions.some((region) => pointInRegion(candidate.x, candidate.y, region, 0.025)) ? fallback : candidate;
}

export function generateReflowTargets(composition: Composition, hero: HeroPerformance): Record<string, Transform> {
  const source = composition.cards.find((card) => card.cardId === hero.cardId);
  if (!source) return {};
  const targets: Record<string, Transform> = {};
  const neighbors = composition.cards.filter((card) => card.cardId !== hero.cardId && !card.locked && distance(card, source) <= hero.reflowRadius);
  for (const card of neighbors) {
    const normalized = clamp(1 - distance(card, source) / Math.max(0.001, hero.reflowRadius));
    const weight = normalized ** Math.max(0.1, hero.falloff) * hero.attraction;
    const dx = (source.x - card.x) * weight;
    const dy = (source.y - card.y) * weight;
    const magnitude = Math.hypot(dx, dy);
    const limit = magnitude > hero.maxDisplacement ? hero.maxDisplacement / magnitude : 1;
    const candidate: Transform = { ...card, x: card.x + dx * limit, y: card.y + dy * limit };
    targets[card.cardId] = rejectProtected(candidate, composition.protectedRegions, card);
  }

  for (let pass = 0; pass < hero.overlapPasses; pass += 1) {
    const ids = Object.keys(targets).sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = targets[ids[i]];
        const b = targets[ids[j]];
        const d = distance(a, b);
        const min = composition.scatter.minSpacing * 0.7;
        if (d > 0 && d < min) {
          const push = (min - d) / 2;
          const nx = (a.x - b.x) / d;
          const ny = (a.y - b.y) / d;
          targets[ids[i]] = rejectProtected({ ...a, x: a.x + nx * push, y: a.y + ny * push }, composition.protectedRegions, a);
          targets[ids[j]] = rejectProtected({ ...b, x: b.x - nx * push, y: b.y - ny * push }, composition.protectedRegions, b);
        }
      }
    }
  }
  return targets;
}
