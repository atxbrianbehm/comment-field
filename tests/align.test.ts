import { describe, expect, it } from "vitest";
import { alignCardPlacements, distributeCardPlacements, type CardPlacement } from "@comment-field/engine";

function card(id: string, x: number, y: number, locked = false): CardPlacement {
  return { cardId: id, x, y, z: 0, scale: 1, rotation: 0, locked };
}

describe("align and distribute", () => {
  it("aligns selected cards within their selection bounds", () => {
    const cards = [card("a", 0.2, 0.1), card("b", 0.8, 0.5), card("c", 0.4, 0.9)];
    const left = alignCardPlacements(cards, ["a", "b", "c"], "left");
    expect(left.a.x).toBeCloseTo(0.2);
    expect(left.b.x).toBeCloseTo(0.2);
    expect(left.c.x).toBeCloseTo(0.2);
    expect(left.b.y).toBeCloseTo(0.5);
    const middle = alignCardPlacements(cards, ["a", "b", "c"], "middle");
    expect(middle.a.y).toBeCloseTo(0.5);
    expect(middle.b.y).toBeCloseTo(0.5);
    expect(middle.c.y).toBeCloseTo(0.5);
  });

  it("distributes cards evenly between the outer selected posts", () => {
    const cards = [card("a", 0.1, 0.2), card("b", 0.2, 0.8), card("c", 0.9, 0.4)];
    const horizontal = distributeCardPlacements(cards, ["a", "b", "c"], "horizontal");
    expect(horizontal.b.x).toBeCloseTo(0.5);
    expect(horizontal.a).toBeUndefined();
    expect(horizontal.c).toBeUndefined();
    const vertical = distributeCardPlacements(cards, ["a", "b", "c"], "vertical");
    expect(vertical.c.y).toBeCloseTo(0.5);
  });

  it("skips locked cards", () => {
    const cards = [card("a", 0.1, 0.1), card("b", 0.5, 0.5, true), card("c", 0.9, 0.9)];
    const aligned = alignCardPlacements(cards, ["a", "b", "c"], "left");
    expect(aligned.b).toBeUndefined();
    expect(aligned.a.x).toBeCloseTo(0.1);
    expect(aligned.c.x).toBeCloseTo(0.1);
  });
});
