import { describe, expect, it } from "vitest";
import { createDefaultProject } from "@comment-field/engine";
import { computeCardMotionBlur } from "@comment-field/webgpu-runtime";

describe("transform-aware motion blur", () => {
  it("stays disabled for a still card", () => {
    const composition = createDefaultProject().compositions[0];
    const settled = { x: 0.5, y: 0.5, z: 0, scale: 1, rotation: 0 };
    const motion = computeCardMotionBlur(
      composition,
      composition.camera,
      composition.camera,
      settled,
      settled,
      1.2,
      0.6,
      1,
    );
    expect(motion.amount).toBe(0);
  });

  it("captures translation, depth, scale, rotation, and camera dolly", () => {
    const composition = createDefaultProject().compositions[0];
    const camera = composition.camera;
    const settled = { x: 0.5, y: 0.5, z: 0, scale: 1, rotation: 0 };
    const translated = computeCardMotionBlur(
      composition,
      camera,
      camera,
      { ...settled, x: 0.52 },
      settled,
      1.2,
      0.6,
      1,
    );
    expect(translated.amount).toBeGreaterThan(0);
    expect(Math.hypot(translated.center.x, translated.center.y)).toBeGreaterThan(0);

    const depthAndScale = computeCardMotionBlur(
      composition,
      camera,
      camera,
      { ...settled, z: 1, scale: 1.2 },
      settled,
      1.2,
      0.6,
      1,
    );
    expect(depthAndScale.amount).toBeGreaterThan(0);
    expect(Math.hypot(depthAndScale.uAxis.x, depthAndScale.uAxis.y)).toBeGreaterThan(0);
    expect(Math.hypot(depthAndScale.vAxis.x, depthAndScale.vAxis.y)).toBeGreaterThan(0);

    const rotated = computeCardMotionBlur(
      composition,
      camera,
      camera,
      { ...settled, rotation: 0.2 },
      settled,
      1.2,
      0.6,
      1,
    );
    expect(rotated.amount).toBeGreaterThan(0);
    expect(Math.abs(rotated.uAxis.y) + Math.abs(rotated.vAxis.x)).toBeGreaterThan(0);

    const cameraDolly = computeCardMotionBlur(
      composition,
      { ...camera, z: camera.z - 0.5 },
      camera,
      settled,
      settled,
      1.2,
      0.6,
      1,
    );
    expect(cameraDolly.amount).toBeGreaterThan(0);
    expect(cameraDolly.maxOffset).toBeLessThanOrEqual(0.35);
  });
});
