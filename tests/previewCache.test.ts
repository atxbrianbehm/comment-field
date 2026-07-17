import { describe, expect, it } from "vitest";
import { flipWebGpuReadback } from "@comment-field/webgpu-runtime";

describe("WebGPU preview readback", () => {
  it("compacts and flips rows when only the final row is unpadded", () => {
    const width = 3;
    const height = 3;
    const rowBytes = width * 4;
    const stride = 256;
    const pixels = new Uint8Array((height - 1) * stride + rowBytes);
    pixels.fill(11, 0, rowBytes);
    pixels.fill(22, stride, stride + rowBytes);
    pixels.fill(33, stride * 2, stride * 2 + rowBytes);
    const flipped = flipWebGpuReadback(pixels, width, height);
    expect([...flipped.slice(0, rowBytes)]).toEqual(Array(rowBytes).fill(33));
    expect([...flipped.slice(rowBytes, rowBytes * 2)]).toEqual(Array(rowBytes).fill(22));
    expect([...flipped.slice(rowBytes * 2)]).toEqual(Array(rowBytes).fill(11));
  });

  it("rejects incomplete or impossible row layouts", () => {
    expect(() => flipWebGpuReadback(new Uint8Array(10), 3, 1)).toThrow("incomplete");
    expect(() => flipWebGpuReadback(new Uint8Array(37), 3, 3)).toThrow("invalid row stride");
  });
});
