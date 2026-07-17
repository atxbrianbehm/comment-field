import * as THREE from "three";

export interface CardMaterial extends THREE.ShaderMaterial {
  uniforms: {
    uMap: { value: THREE.Texture };
    uOpacity: { value: number };
    uBlur: { value: number };
    uSelected: { value: number };
    uHero: { value: number };
  };
}

export function createCardMaterial(texture: THREE.Texture): CardMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    uniforms: {
      uMap: { value: texture },
      uOpacity: { value: 1 },
      uBlur: { value: 0 },
      uSelected: { value: 0 },
      uHero: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uOpacity;
      uniform float uBlur;
      uniform float uSelected;
      uniform float uHero;
      varying vec2 vUv;
      void main() {
        vec4 color = texture2D(uMap, vUv);
        if (uBlur > 0.01) {
          vec2 spread = vec2(uBlur * 0.0016);
          color *= 0.4;
          color += texture2D(uMap, vUv + vec2(spread.x, 0.0)) * 0.15;
          color += texture2D(uMap, vUv - vec2(spread.x, 0.0)) * 0.15;
          color += texture2D(uMap, vUv + vec2(0.0, spread.y)) * 0.15;
          color += texture2D(uMap, vUv - vec2(0.0, spread.y)) * 0.15;
        }
        float edge = step(vUv.x, 0.016) + step(0.984, vUv.x) + step(vUv.y, 0.022) + step(0.978, vUv.y);
        vec3 accent = mix(vec3(0.38, 0.92, 0.76), vec3(1.0, 0.67, 0.3), uHero);
        color.rgb = mix(color.rgb, accent, min(1.0, edge) * max(uSelected, uHero) * color.a);
        color.a *= uOpacity;
        if (color.a < 0.01) discard;
        gl_FragColor = color;
      }
    `,
  }) as CardMaterial;
}
