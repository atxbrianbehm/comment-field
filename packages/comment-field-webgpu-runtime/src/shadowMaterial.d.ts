import type * as THREE from "three";

interface ShadowUniformNode { value: number }
interface ShadowTextureNode { value: THREE.Texture }

export interface ShadowMaterial extends THREE.Material {
  shadowUniforms: {
    opacity: ShadowUniformNode;
    softness: ShadowUniformNode;
    red: ShadowUniformNode;
    green: ShadowUniformNode;
    blue: ShadowUniformNode;
  };
  shadowTextures: ShadowTextureNode[];
}

export function createShadowMaterial(texture: THREE.Texture): ShadowMaterial;
export function setShadowMaterialTexture(material: ShadowMaterial, texture: THREE.Texture): void;
