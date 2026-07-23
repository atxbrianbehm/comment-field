import { describe, expect, it } from "vitest";
import { createDefaultProject } from "@comment-field/engine";
import { createCardTextureKey, createPreviewCacheKey } from "@comment-field/webgpu-runtime";

describe("scene shadow and lighting", () => {
  it("invalidates preview frames without rebuilding card textures", () => {
    const project = createDefaultProject();
    const composition = project.compositions[0];
    const take = project.takes[0];
    const comment = project.comments[0];
    const textureKey = createCardTextureKey(comment, project.cardStyle);
    const previewKey = createPreviewCacheKey(
      composition,
      take,
      project.entranceMotion,
      project.comments,
      project.cardStyle,
      project.renderSettings,
    );
    const shadowSettings = {
      ...project.renderSettings,
      sceneShadow: { ...project.renderSettings.sceneShadow, softness: 0.9 },
    };
    const lightingSettings = {
      ...project.renderSettings,
      cardLighting: { ...project.renderSettings.cardLighting, angle: 90 },
    };
    expect(createCardTextureKey(comment, project.cardStyle)).toBe(textureKey);
    expect(createPreviewCacheKey(
      composition,
      take,
      project.entranceMotion,
      project.comments,
      project.cardStyle,
      shadowSettings,
    )).not.toBe(previewKey);
    expect(createPreviewCacheKey(
      composition,
      take,
      project.entranceMotion,
      project.comments,
      project.cardStyle,
      lightingSettings,
    )).not.toBe(previewKey);
  });
});
