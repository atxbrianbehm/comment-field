import type * as THREE from "three";

export class WebGPURenderer {
  constructor(options?: { antialias?: boolean; alpha?: boolean });
  readonly domElement: HTMLCanvasElement;
  readonly backend: { isWebGPUBackend?: boolean };
  outputColorSpace: string;
  init(): Promise<void>;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  setRenderTarget(target: THREE.RenderTarget | null): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  readRenderTargetPixelsAsync(target: THREE.RenderTarget, x: number, y: number, width: number, height: number): Promise<TypedArray>;
  dispose(): void;
}
