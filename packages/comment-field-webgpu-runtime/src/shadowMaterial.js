import { MeshBasicNodeMaterial } from "three/webgpu";
import * as TSL from "three/tsl";
import composeCardShadowSource from "./shaders/card-shadow.wgsl?raw";

const composeCardShadow = TSL.wgslFn(composeCardShadowSource);

export function createShadowMaterial(texture) {
  const opacity = TSL.uniform(0);
  const softness = TSL.uniform(0.5);
  const red = TSL.uniform(0.07);
  const green = TSL.uniform(0.05);
  const blue = TSL.uniform(0.04);
  const cardUv = TSL.uv();
  const spread = softness.mul(0.018);
  const samples = [
    TSL.texture(texture, cardUv),
    TSL.texture(texture, cardUv.add(TSL.vec2(spread, 0))),
    TSL.texture(texture, cardUv.sub(TSL.vec2(spread, 0))),
    TSL.texture(texture, cardUv.add(TSL.vec2(0, spread))),
    TSL.texture(texture, cardUv.sub(TSL.vec2(0, spread))),
  ];
  const composed = composeCardShadow({
    center: samples[0],
    positive_x: samples[1],
    negative_x: samples[2],
    positive_y: samples[3],
    negative_y: samples[4],
    shadow_red: red,
    shadow_green: green,
    shadow_blue: blue,
    opacity_amount: opacity,
  });
  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: false });
  material.colorNode = composed.rgb;
  material.opacityNode = composed.a;
  material.alphaTest = 0.002;
  material.shadowUniforms = { opacity, softness, red, green, blue };
  material.shadowTextures = samples;
  return material;
}

export function setShadowMaterialTexture(material, texture) {
  for (const sample of material.shadowTextures) sample.value = texture;
}
