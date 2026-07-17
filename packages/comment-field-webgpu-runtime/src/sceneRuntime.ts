import * as THREE from "three";
import {
  compositionWorldDimensions,
  evaluateScene,
  fieldPointToWorld,
  projectWorldPoint,
  unprojectScreenPoint,
  worldPointToField,
  type CameraPose,
  type CardStyle,
  type CommentRecord,
  type Composition,
  type EntranceMotionTemplate,
  type RenderSettings,
  type Take,
} from "@comment-field/engine";
import { createCardTextureKey } from "./cardCache";
import { createCardMaterial, setCardMaterialTexture, type CardMaterial } from "./cardMaterial.js";
import { createCardTextureFromSource } from "./cardTexture";
import { WebGPURenderer } from "./webgpuRenderer.js";
import { CardRasterService } from "./cardRasterService";
import { createPerformanceTelemetry, type PerformanceTelemetryRecorder, type PerformanceTelemetrySnapshot } from "./performanceTelemetry";

export interface RuntimeCacheStatus {
  state: "ready" | "rebuilding";
  ready: number;
  total: number;
  hits: number;
  misses: number;
  reason: string;
}

export interface SceneRenderInput {
  composition: Composition;
  take: Take;
  entranceMotion: EntranceMotionTemplate;
  comments: CommentRecord[];
  cardStyle: CardStyle;
  time: number;
  selectedCardId: string | null;
  mode: "select" | "record" | "reflow";
  viewMode: "camera" | "overview";
  showTransformHandles: boolean;
  renderSettings: RenderSettings;
}

export interface RuntimeSelectionOverlay {
  points: Array<{ x: number; y: number }>;
  center: { x: number; y: number };
  rotationHandle: { x: number; y: number };
  locked: boolean;
}

export interface RuntimeFieldOverlay {
  field: Array<{ x: number; y: number }>;
  camera: Array<{ x: number; y: number }>;
  protectedRegions: Array<{ id: string; name: string; points: Array<{ x: number; y: number }> }>;
}

interface CachedTexture { key: string; texture: THREE.Texture; aspect: number }

export interface SceneController {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cards: THREE.Group;
  meshes: Map<string, THREE.Mesh<THREE.PlaneGeometry, CardMaterial>>;
  cache: Map<string, CachedTexture>;
  frameWidth: number;
  frameHeight: number;
  exporting: boolean;
  previewTarget: THREE.RenderTarget | null;
  encodeCanvas: HTMLCanvasElement | null;
  telemetry: PerformanceTelemetryRecorder;
  rasterizer: CardRasterService;
  canvasPixelRatio: number;
  cardTexturePixelRatio: number;
}

export async function createSceneController(options: { canvasPixelRatio?: number; cardTexturePixelRatio?: number } = {}) {
  const canvasPixelRatio = options.canvasPixelRatio ?? 1;
  const cardTexturePixelRatio = options.cardTexturePixelRatio ?? 2;
  const renderer = new WebGPURenderer({ antialias: true, alpha: false });
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw new Error("WebGPU backend acquisition failed");
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(canvasPixelRatio);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 100);
  const cards = new THREE.Group();
  scene.add(cards);
  return { renderer, scene, camera, cards, meshes: new Map(), cache: new Map(), frameWidth: 0, frameHeight: 0, exporting: false, previewTarget: null, encodeCanvas: null, telemetry: createPerformanceTelemetry(), rasterizer: new CardRasterService(), canvasPixelRatio, cardTexturePixelRatio } satisfies SceneController;
}

export function getSceneTelemetry(controller: SceneController): PerformanceTelemetrySnapshot {
  return controller.telemetry.snapshot();
}

export function disposeSceneController(controller: SceneController) {
  controller.previewTarget?.dispose();
  controller.rasterizer.dispose();
  controller.cache.forEach(({ texture }) => texture.dispose());
  controller.meshes.forEach((mesh) => { mesh.geometry.dispose(); mesh.material.dispose(); });
  controller.renderer.dispose();
  controller.renderer.domElement.remove();
}

export function resizeScene(controller: SceneController, width: number, height: number) {
  controller.frameWidth = width;
  controller.frameHeight = height;
  controller.renderer.domElement.style.width = `${width}px`;
  controller.renderer.domElement.style.height = `${height}px`;
  controller.renderer.setPixelRatio(controller.exporting ? 1 : controller.canvasPixelRatio);
  controller.renderer.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), false);
}

export function beginSceneExport(controller: SceneController, width: number, height: number) {
  controller.exporting = true;
  controller.renderer.setPixelRatio(1);
  controller.renderer.setSize(width, height, false);
}

export async function renderPngBlob(
  controller: SceneController,
  input: SceneRenderInput,
  overviewCamera: CameraPose,
  width: number,
  height: number,
) {
  const temporaryExport = !controller.exporting;
  if (temporaryExport) {
    controller.renderer.setPixelRatio(1);
    controller.renderer.setSize(width, height, false);
  }
  renderScene(controller, input, overviewCamera, { clean: true, production: true });
  const blob = await new Promise<Blob>((resolve, reject) => controller.renderer.domElement.toBlob(
    (value) => value ? resolve(value) : reject(new Error("Frame capture failed")),
    "image/png",
  ));
  if (temporaryExport) resizeScene(controller, controller.frameWidth, controller.frameHeight);
  return blob;
}

export function endSceneExport(controller: SceneController) {
  controller.exporting = false;
  resizeScene(controller, controller.frameWidth, controller.frameHeight);
}

export function fittedOverviewCamera(composition: Composition): CameraPose {
  const scale = Math.max(composition.fieldBounds.width, composition.fieldBounds.height);
  return { ...composition.camera, x: 0, y: 0, z: Math.max(2, composition.camera.z * scale * 1.08) };
}

function screenPoint(point: THREE.Vector3, controller: SceneController) {
  const projected = point.project(controller.camera);
  return { x: (projected.x * 0.5 + 0.5) * controller.frameWidth, y: (-projected.y * 0.5 + 0.5) * controller.frameHeight };
}

function configureCamera(controller: SceneController, composition: Composition, pose: CameraPose) {
  controller.camera.aspect = composition.width / composition.height;
  controller.camera.fov = pose.fov;
  controller.camera.position.set(pose.x, pose.y, pose.z);
  controller.camera.updateProjectionMatrix();
  controller.renderer.setClearColor(composition.backgroundColor, 1);
}

function selectionOverlay(controller: SceneController, input: SceneRenderInput): RuntimeSelectionOverlay | null {
  const selected = input.selectedCardId ? controller.meshes.get(input.selectedCardId) : null;
  const placement = input.composition.cards.find((card) => card.cardId === input.selectedCardId);
  if (!selected || !placement || !input.showTransformHandles || input.mode !== "select") return null;
  const width = selected.geometry.parameters.width / 2;
  const height = selected.geometry.parameters.height / 2;
  selected.updateMatrixWorld(true);
  const points = [new THREE.Vector3(-width, -height, 0), new THREE.Vector3(width, -height, 0), new THREE.Vector3(width, height, 0), new THREE.Vector3(-width, height, 0)]
    .map((point) => screenPoint(point.applyMatrix4(selected.matrixWorld), controller));
  const center = screenPoint(new THREE.Vector3(0, 0, 0).applyMatrix4(selected.matrixWorld), controller);
  const topCenter = screenPoint(new THREE.Vector3(0, height, 0).applyMatrix4(selected.matrixWorld), controller);
  const vector = { x: topCenter.x - center.x, y: topCenter.y - center.y };
  const magnitude = Math.max(1, Math.hypot(vector.x, vector.y));
  return { points, center, rotationHandle: { x: topCenter.x + (vector.x / magnitude) * 36, y: topCenter.y + (vector.y / magnitude) * 36 }, locked: placement.locked };
}

function fieldOverlay(controller: SceneController, input: SceneRenderInput, outputCamera: CameraPose): RuntimeFieldOverlay {
  const projectPoint = (point: { x: number; y: number }) => {
    const world = fieldPointToWorld(input.composition, point);
    return screenPoint(new THREE.Vector3(world.x, world.y, 0), controller);
  };
  const bounds = input.composition.fieldBounds;
  const minX = 0.5 - bounds.width / 2;
  const maxX = 0.5 + bounds.width / 2;
  const minY = 0.5 - bounds.height / 2;
  const maxY = 0.5 + bounds.height / 2;
  const field = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }].map(projectPoint);
  const camera = input.viewMode === "overview"
    ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((point) => {
        const world = unprojectScreenPoint(input.composition, outputCamera, point, 0);
        return screenPoint(new THREE.Vector3(world.x, world.y, 0), controller);
      })
    : [];
  const protectedRegions = input.composition.protectedRegions.map((region) => ({
    id: region.id, name: region.name,
    points: [{ x: region.x, y: region.y }, { x: region.x + region.width, y: region.y }, { x: region.x + region.width, y: region.y + region.height }, { x: region.x, y: region.y + region.height }].map(projectPoint),
  }));
  return { field, camera, protectedRegions };
}

export function renderScene(controller: SceneController, input: SceneRenderInput, overviewCamera: CameraPose, options: { target?: THREE.RenderTarget | null; clean?: boolean; production?: boolean } = {}) {
  const startedAt = performance.now();
  const dimensions = compositionWorldDimensions(input.composition);
  const entrance = input.take.entranceOverride ?? input.entranceMotion;
  const state = evaluateScene(input.composition, input.take, entrance, input.time);
  const motionBlur = input.renderSettings.motionBlur;
  const shutterSeconds = motionBlur.enabled ? (motionBlur.shutterAngle / 360) / input.composition.frameRate : 0;
  const previousState = shutterSeconds > 0 && input.time > 0
    ? evaluateScene(input.composition, input.take, entrance, Math.max(0, input.time - shutterSeconds))
    : null;
  const previousCards = new Map(previousState?.cards.map((card) => [card.cardId, card]) ?? []);
  const renderCamera = input.viewMode === "overview" && !options.production && !options.target ? overviewCamera : state.camera;
  configureCamera(controller, input.composition, renderCamera);
  for (const card of state.cards) {
    const mesh = controller.meshes.get(card.cardId);
    if (!mesh) continue;
    mesh.position.set((card.x - 0.5) * dimensions.width, (0.5 - card.y) * dimensions.height, card.z);
    mesh.rotation.z = -card.rotation;
    mesh.scale.setScalar(card.scale);
    mesh.visible = card.opacity > 0.005;
    const previous = previousCards.get(card.cardId);
    let motionX = 0;
    let motionY = 0;
    let motionAmount = 0;
    if (previous && input.viewMode !== "overview") {
      const currentWorld = fieldPointToWorld(input.composition, card);
      const previousWorld = fieldPointToWorld(input.composition, previous);
      const currentScreen = projectWorldPoint(input.composition, state.camera, { ...currentWorld, z: card.z });
      const previousScreen = projectWorldPoint(input.composition, previousState!.camera, { ...previousWorld, z: previous.z });
      const strength = motionBlur.strength;
      motionX = THREE.MathUtils.clamp((currentScreen.x - previousScreen.x) * strength * 3, -0.12, 0.12);
      motionY = THREE.MathUtils.clamp((currentScreen.y - previousScreen.y) * strength * 3, -0.12, 0.12);
      motionAmount = Math.min(1, Math.hypot(currentScreen.x - previousScreen.x, currentScreen.y - previousScreen.y) * strength * 20);
    }
    const effects = card.blur > 0.01 || motionAmount > 0.0001;
    if (mesh.material.cardEffectMode !== effects) {
      const texture = controller.cache.get(card.cardId)?.texture;
      if (texture) { mesh.material.dispose(); mesh.material = createCardMaterial(texture, effects); }
    }
    mesh.material.cardUniforms.opacity.value = card.opacity;
    mesh.material.cardUniforms.blur.value = card.blur;
    mesh.material.cardUniforms.selected.value = !options.clean && input.selectedCardId === card.cardId ? 1 : 0;
    mesh.material.cardUniforms.hero.value = input.take.hero?.cardId === card.cardId ? 1 : 0;
    mesh.material.cardUniforms.motionX.value = motionX;
    mesh.material.cardUniforms.motionY.value = motionY;
    mesh.material.cardUniforms.motionAmount.value = motionAmount;
    mesh.renderOrder = card.layerPriority;
  }
  controller.renderer.setRenderTarget(options.target ?? null);
  controller.renderer.render(controller.scene, controller.camera);
  controller.renderer.setRenderTarget(null);
  controller.telemetry.record("sceneRender", performance.now() - startedAt);
  return options.target ? { selection: null, field: null } : { selection: selectionOverlay(controller, input), field: fieldOverlay(controller, input, state.camera) };
}

export function normalizedCanvasPoint(controller: SceneController, clientX: number, clientY: number) {
  const rect = controller.renderer.domElement.getBoundingClientRect();
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}

export function hitTestCard(controller: SceneController, clientX: number, clientY: number) {
  const point = normalizedCanvasPoint(controller, clientX, clientY);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(point.x * 2 - 1, -(point.y * 2 - 1)), controller.camera);
  return raycaster.intersectObjects([...controller.meshes.values()], false)[0]?.object.userData.cardId as string | undefined;
}

export function fieldPointAt(controller: SceneController, composition: Composition, clientX: number, clientY: number, z = 0) {
  const point = normalizedCanvasPoint(controller, clientX, clientY);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(point.x * 2 - 1, -(point.y * 2 - 1)), controller.camera);
  const world = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), world)) return null;
  return worldPointToField(composition, world);
}

export function syncSceneAssets(controller: SceneController, input: Pick<SceneRenderInput, "composition" | "comments" | "cardStyle">, previous: { style: string; comments: string; cards: string } | null, onStatus: (status: RuntimeCacheStatus) => void, onRender: () => void) {
  const style = JSON.stringify(input.cardStyle);
  const commentsSignature = JSON.stringify(input.comments);
  const cards = JSON.stringify({ id: input.composition.id, width: input.composition.width, height: input.composition.height, ids: input.composition.cards.map((card) => card.cardId) });
  const commentsById = new Map(input.comments.map((comment) => [comment.id, comment]));
  const desiredIds = new Set(input.composition.cards.map((card) => card.cardId));
  const dimensions = compositionWorldDimensions(input.composition);
  for (const [cardId, mesh] of controller.meshes) {
    if (desiredIds.has(cardId)) continue;
    controller.cards.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); controller.meshes.delete(cardId);
    controller.cache.get(cardId)?.texture.dispose(); controller.cache.delete(cardId);
  }
  const dirty = input.composition.cards.filter((placement) => {
    const comment = commentsById.get(placement.cardId);
    return Boolean(comment && (controller.cache.get(placement.cardId)?.key !== createCardTextureKey(comment, input.cardStyle) || !controller.meshes.has(placement.cardId)));
  });
  const reason = !previous ? "initial texture build" : previous.style !== style ? "card template changed" : previous.comments !== commentsSignature ? "comment content changed" : "composition card set changed";
  const total = input.composition.cards.length;
  const hits = total - dirty.length;
  let completed = 0;
  let cancelled = false;
  let frame: number | null = null;
  onStatus({ state: dirty.length ? "rebuilding" : "ready", ready: hits, total, hits, misses: dirty.length, reason: dirty.length ? reason : "cache hit" });
  const process = async () => {
    if (cancelled) return;
    const batch = dirty.slice(completed, completed + 4);
    await Promise.all(batch.map(async (placement) => {
      const comment = commentsById.get(placement.cardId);
      if (!comment) return;
      const key = createCardTextureKey(comment, input.cardStyle);
      const rasterStartedAt = performance.now();
      const raster = await controller.rasterizer.rasterize(comment, input.cardStyle, controller.cardTexturePixelRatio);
      controller.telemetry.record("textureRaster", performance.now() - rasterStartedAt);
      if (cancelled) { raster.dispose(); return; }
      const rendered = createCardTextureFromSource(raster.source, raster.width, raster.height);
      rendered.texture.addEventListener("dispose", raster.dispose);
      const planeWidth = Math.min(dimensions.width * 0.24, 1.2);
      const geometry = new THREE.PlaneGeometry(planeWidth, planeWidth / rendered.aspect);
      const existing = controller.meshes.get(placement.cardId);
      if (existing) { existing.geometry.dispose(); existing.geometry = geometry; setCardMaterialTexture(existing.material, rendered.texture); }
      else { const mesh = new THREE.Mesh(geometry, createCardMaterial(rendered.texture)); mesh.userData.cardId = placement.cardId; controller.cards.add(mesh); controller.meshes.set(placement.cardId, mesh); }
      controller.cache.get(placement.cardId)?.texture.dispose();
      controller.cache.set(placement.cardId, { key, texture: rendered.texture, aspect: rendered.aspect });
    }));
    completed += batch.length;
    onStatus({ state: completed < dirty.length ? "rebuilding" : "ready", ready: hits + completed, total, hits, misses: dirty.length, reason });
    onRender();
    frame = completed < dirty.length ? requestAnimationFrame(() => { void process(); }) : null;
  };
  void process();
  return { signatures: { style, comments: commentsSignature, cards }, cancel: () => { cancelled = true; if (frame !== null) cancelAnimationFrame(frame); } };
}

export function setSceneBackground(controller: SceneController, source: string | undefined, onReady: () => void) {
  let texture: THREE.Texture | null = null;
  let cancelled = false;
  if (!source) { controller.scene.background = null; onReady(); return () => undefined; }
  new THREE.TextureLoader().load(source, (loaded) => {
    if (cancelled) { loaded.dispose(); return; }
    texture = loaded; loaded.colorSpace = THREE.SRGBColorSpace; controller.scene.background = loaded; onReady();
  });
  return () => { cancelled = true; if (controller.scene.background === texture) controller.scene.background = null; texture?.dispose(); };
}

export async function renderPreviewBlob(controller: SceneController, input: SceneRenderInput, overviewCamera: CameraPose, width: number, height: number, quality: number) {
  let target = controller.previewTarget;
  if (!target || target.width !== width || target.height !== height) {
    target?.dispose(); target = new THREE.RenderTarget(width, height, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.UnsignedByteType, depthBuffer: true });
    target.texture.colorSpace = THREE.SRGBColorSpace; controller.previewTarget = target;
  }
  renderScene(controller, { ...input, time: input.time }, overviewCamera, { target, clean: true, production: true });
  const readbackStartedAt = performance.now();
  const pixels = await controller.renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height) as Uint8Array;
  controller.telemetry.record("gpuReadback", performance.now() - readbackStartedAt);
  const rowBytes = width * 4;
  const sourceStride = pixels.length % height === 0 ? pixels.length / height : rowBytes;
  if (sourceStride < rowBytes) throw new Error("WebGPU preview readback returned an incomplete row");
  const flipped = new Uint8ClampedArray(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    flipped.set(pixels.subarray(row * sourceStride, row * sourceStride + rowBytes), (height - row - 1) * rowBytes);
  }
  const canvas = controller.encodeCanvas ?? document.createElement("canvas"); controller.encodeCanvas = canvas; canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false }); if (!context) throw new Error("Preview encoder is unavailable");
  context.putImageData(new ImageData(flipped, width, height), 0, 0);
  const encodeStartedAt = performance.now();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    controller.telemetry.record("frameEncode", performance.now() - encodeStartedAt);
    blob ? resolve(blob) : reject(new Error("Preview frame encoding failed"));
  }, "image/webp", quality));
}
