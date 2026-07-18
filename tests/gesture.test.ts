import { describe, expect, it } from "vitest";
import { editGestureSample } from "@comment-field/engine";

describe("gesture path editing", () => {
  it("frame-snaps time and bounds screen-space values", () => {
    const samples = [
      { time: 0, x: 0.1, y: 0.2 },
      { time: 1, x: 0.5, y: 0.5 },
      { time: 2, x: 0.9, y: 0.8 },
    ];
    expect(editGestureSample(samples, 1, { time: 1.27, x: 1.4, y: -0.2 }, 24)[1]).toEqual({
      time: 1.25,
      x: 1,
      y: 0,
    });
    expect(samples[1]).toEqual({ time: 1, x: 0.5, y: 0.5 });
  });
});
