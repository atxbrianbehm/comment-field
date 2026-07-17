import type * as THREE from "three";

interface MutableUniformNode { value: number }
interface MutableTextureNode { value: THREE.Texture }

export interface CardMaterial extends THREE.Material {
  cardUniforms: {
    opacity: MutableUniformNode;
    blur: MutableUniformNode;
    selected: MutableUniformNode;
    hero: MutableUniformNode;
  };
  cardTextures: MutableTextureNode[];
}

export function createCardMaterial(texture: THREE.Texture): CardMaterial;
export function setCardMaterialTexture(material: CardMaterial, texture: THREE.Texture): void;
