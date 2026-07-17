import { MeshBasicNodeMaterial } from "three/webgpu";
import * as TSL from "three/tsl";
import composeCardSource from "./shaders/card-composite.wgsl?raw";

const composeCard = TSL.wgslFn(composeCardSource);

export function createCardMaterial(texture) {
  const opacity = TSL.uniform(1);
  const blur = TSL.uniform(0);
  const selected = TSL.uniform(0);
  const hero = TSL.uniform(0);
  const motionX = TSL.uniform(0);
  const motionY = TSL.uniform(0);
  const motionAmount = TSL.uniform(0);
  const cardUv = TSL.uv();
  const spread = blur.mul(0.0016);
  const samples = [
    TSL.texture(texture, cardUv),
    TSL.texture(texture, cardUv.add(TSL.vec2(spread, 0))),
    TSL.texture(texture, cardUv.sub(TSL.vec2(spread, 0))),
    TSL.texture(texture, cardUv.add(TSL.vec2(0, spread))),
    TSL.texture(texture, cardUv.sub(TSL.vec2(0, spread))),
    TSL.texture(texture, cardUv.add(TSL.vec2(motionX, motionY))),
    TSL.texture(texture, cardUv.sub(TSL.vec2(motionX, motionY))),
  ];
  const composed = composeCard({
    center: samples[0],
    positive_x: samples[1],
    negative_x: samples[2],
    positive_y: samples[3],
    negative_y: samples[4],
    motion_positive: samples[5],
    motion_negative: samples[6],
    card_uv: cardUv,
    blur_amount: blur,
    motion_amount: motionAmount,
    selected_amount: selected,
    hero_amount: hero,
    opacity_amount: opacity,
  });
  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: false });
  material.colorNode = composed.rgb;
  material.opacityNode = composed.a;
  material.alphaTest = 0.01;
  material.cardUniforms = { opacity, blur, selected, hero, motionX, motionY, motionAmount };
  material.cardTextures = samples;
  return material;
}

export function setCardMaterialTexture(material, texture) {
  for (const sample of material.cardTextures) sample.value = texture;
}
