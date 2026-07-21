import type { CardPlacement, Point2D } from "../models/types";

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

function selectedUnlocked(cards: CardPlacement[], ids: string[]) {
  const idSet = new Set(ids);
  return cards.filter((card) => idSet.has(card.cardId) && !card.locked);
}

function boundsOf(cards: CardPlacement[]) {
  const xs = cards.map((card) => card.x);
  const ys = cards.map((card) => card.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    midX: (Math.min(...xs) + Math.max(...xs)) / 2,
    midY: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

/** Align selected card centers within their current selection bounds. */
export function alignCardPlacements(cards: CardPlacement[], ids: string[], mode: AlignMode): Record<string, Point2D> {
  const targets = selectedUnlocked(cards, ids);
  if (targets.length < 2) return {};
  const box = boundsOf(targets);
  const next: Record<string, Point2D> = {};
  for (const card of targets) {
    if (mode === "left") next[card.cardId] = { x: box.minX, y: card.y };
    else if (mode === "center") next[card.cardId] = { x: box.midX, y: card.y };
    else if (mode === "right") next[card.cardId] = { x: box.maxX, y: card.y };
    else if (mode === "top") next[card.cardId] = { x: card.x, y: box.minY };
    else if (mode === "middle") next[card.cardId] = { x: card.x, y: box.midY };
    else next[card.cardId] = { x: card.x, y: box.maxY };
  }
  return next;
}

/**
 * Evenly space selected cards between the first and last along an axis
 * (sorted by position), keeping the outer cards fixed.
 */
export function distributeCardPlacements(cards: CardPlacement[], ids: string[], axis: DistributeAxis): Record<string, Point2D> {
  const targets = selectedUnlocked(cards, ids);
  if (targets.length < 3) return {};
  const sorted = [...targets].sort((a, b) => (axis === "horizontal" ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = axis === "horizontal" ? last.x - first.x : last.y - first.y;
  if (Math.abs(span) < 1e-6) return {};
  const step = span / (sorted.length - 1);
  const next: Record<string, Point2D> = {};
  sorted.forEach((card, index) => {
    if (index === 0 || index === sorted.length - 1) return;
    if (axis === "horizontal") next[card.cardId] = { x: first.x + step * index, y: card.y };
    else next[card.cardId] = { x: card.x, y: first.y + step * index };
  });
  return next;
}
