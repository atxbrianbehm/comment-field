import { MeshBasicNodeMaterial } from "three/webgpu";
import * as TSL from "three/tsl";
import composeCardSource from "./shaders/card-composite.wgsl?raw";
import composeBasicCardSource from "./shaders/card-basic.wgsl?raw";
import cardWobbleSource from "./shaders/card-wobble.wgsl?raw";

const composeCard = TSL.wgslFn(composeCardSource);
const composeBasicCard = TSL.wgslFn(composeBasicCardSource);
const deformCard = TSL.wgslFn(cardWobbleSource);

export function createCardMaterial(texture, effects = false) {
  const opacity = TSL.uniform(1);
  const blur = TSL.uniform(0);
  const selected = TSL.uniform(0);
  const hero = TSL.uniform(0);
  const motionCenterX = TSL.uniform(0);
  const motionCenterY = TSL.uniform(0);
  const motionUAxisX = TSL.uniform(0);
  const motionUAxisY = TSL.uniform(0);
  const motionVAxisX = TSL.uniform(0);
  const motionVAxisY = TSL.uniform(0);
  const motionAmount = TSL.uniform(0);
  const lightDirectionX = TSL.uniform(0.707);
  const lightDirectionY = TSL.uniform(0.707);
  const lightAmbient = TSL.uniform(1);
  const lightIntensity = TSL.uniform(0);
  const lightEdge = TSL.uniform(0);
  const wobbleBend = TSL.uniform(0);
  const cardHeight = TSL.uniform(1);
  const cardUv = TSL.uv();
  const spread = blur.mul(0.0016);
  const center = TSL.texture(texture, cardUv);
  const centeredUv = cardUv.sub(TSL.vec2(0.5, 0.5));
  const motionOffset = TSL.vec2(motionCenterX, motionCenterY)
    .add(TSL.vec2(motionUAxisX, motionUAxisY).mul(centeredUv.x))
    .add(TSL.vec2(motionVAxisX, motionVAxisY).mul(centeredUv.y));
  const samples = effects ? [
    center,
    TSL.texture(texture, cardUv.add(TSL.vec2(spread, 0))), TSL.texture(texture, cardUv.sub(TSL.vec2(spread, 0))),
    TSL.texture(texture, cardUv.add(TSL.vec2(0, spread))), TSL.texture(texture, cardUv.sub(TSL.vec2(0, spread))),
    TSL.texture(texture, cardUv.add(motionOffset.mul(0.25))),
    TSL.texture(texture, cardUv.add(motionOffset.mul(0.5))),
    TSL.texture(texture, cardUv.add(motionOffset.mul(0.75))),
    TSL.texture(texture, cardUv.add(motionOffset)),
  ] : [center];
  const composed = effects ? composeCard({
    center: samples[0],
    positive_x: samples[1],
    negative_x: samples[2],
    positive_y: samples[3],
    negative_y: samples[4],
    motion_sample_1: samples[5],
    motion_sample_2: samples[6],
    motion_sample_3: samples[7],
    motion_sample_4: samples[8],
    card_uv: cardUv,
    blur_amount: blur,
    motion_amount: motionAmount,
    light_direction_x: lightDirectionX,
    light_direction_y: lightDirectionY,
    light_ambient: lightAmbient,
    light_intensity: lightIntensity,
    light_edge: lightEdge,
    selected_amount: selected,
    hero_amount: hero,
    opacity_amount: opacity,
  }) : composeBasicCard({
    center,
    card_uv: cardUv,
    light_direction_x: lightDirectionX,
    light_direction_y: lightDirectionY,
    light_ambient: lightAmbient,
    light_intensity: lightIntensity,
    light_edge: lightEdge,
    selected_amount: selected,
    hero_amount: hero,
    opacity_amount: opacity,
  });
  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: false });
  material.colorNode = composed.rgb;
  material.opacityNode = composed.a;
  material.positionNode = deformCard({
    local_position: TSL.positionLocal,
    card_uv: cardUv,
    bend: wobbleBend,
    card_height: cardHeight,
  });
  material.alphaTest = 0.01;
  material.cardUniforms = {
    opacity,
    blur,
    selected,
    hero,
    motionCenterX,
    motionCenterY,
    motionUAxisX,
    motionUAxisY,
    motionVAxisX,
    motionVAxisY,
    motionAmount,
    lightDirectionX,
    lightDirectionY,
    lightAmbient,
    lightIntensity,
    lightEdge,
    wobbleBend,
    cardHeight,
  };
  material.cardTextures = samples;
  material.cardEffectMode = effects;
  return material;
}

export function setCardMaterialTexture(material, texture) {
  for (const sample of material.cardTextures) sample.value = texture;
}
