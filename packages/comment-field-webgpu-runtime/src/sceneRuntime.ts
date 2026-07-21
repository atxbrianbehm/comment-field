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
import { packReadbackPixels } from "./previewCache";

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
  /** Multi-select set; when empty, falls back to selectedCardId. */
  selectedCardIds?: string[];
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
  /** Additional selected card outlines (screen-space quads) for multi-select. */
  extras?: Array<{ points: Array<{ x: number; y: number }> }>;
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
  // alpha: true so PNG export can clear to transparent without a plate behind the cards.
  const renderer = new WebGPURenderer({ antialias: true, alpha: true });
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
  options: { transparent?: boolean } = {},
) {
  const temporaryExport = !controller.exporting;
  if (temporaryExport) {
    controller.renderer.setPixelRatio(1);
    controller.renderer.setSize(width, height, false);
  }
  const previousBackground = controller.scene.background;
  if (options.transparent) controller.scene.background = null;
  try {
    renderScene(controller, input, overviewCamera, {
      clean: true,
      production: true,
      transparentBackground: Boolean(options.transparent),
    });
    const blob = await new Promise<Blob>((resolve, reject) => controller.renderer.domElement.toBlob(
      (value) => value ? resolve(value) : reject(new Error("Frame capture failed")),
      "image/png",
    ));
    return blob;
  } finally {
    if (options.transparent) controller.scene.background = previousBackground;
    if (temporaryExport) resizeScene(controller, controller.frameWidth, controller.frameHeight);
  }
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

function configureCamera(
  controller: SceneController,
  composition: Composition,
  pose: CameraPose,
  options: { transparentBackground?: boolean } = {},
) {
  controller.camera.aspect = composition.width / composition.height;
  controller.camera.fov = pose.fov;
  controller.camera.position.set(pose.x, pose.y, pose.z);
  controller.camera.updateProjectionMatrix();
  if (options.transparentBackground) controller.renderer.setClearColor(0x000000, 0);
  else controller.renderer.setClearColor(composition.backgroundColor, 1);
}

function selectedIdsFromInput(input: SceneRenderInput) {
  if (input.selectedCardIds?.length) return input.selectedCardIds;
  return input.selectedCardId ? [input.selectedCardId] : [];
}

function meshScreenQuad(controller: SceneController, mesh: THREE.Mesh<THREE.PlaneGeometry, CardMaterial>) {
  const width = mesh.geometry.parameters.width / 2;
  const height = mesh.geometry.parameters.height / 2;
  mesh.updateMatrixWorld(true);
  const points = [new THREE.Vector3(-width, -height, 0), new THREE.Vector3(width, -height, 0), new THREE.Vector3(width, height, 0), new THREE.Vector3(-width, height, 0)]
    .map((point) => screenPoint(point.applyMatrix4(mesh.matrixWorld), controller));
  const center = screenPoint(new THREE.Vector3(0, 0, 0).applyMatrix4(mesh.matrixWorld), controller);
  const topCenter = screenPoint(new THREE.Vector3(0, height, 0).applyMatrix4(mesh.matrixWorld), controller);
  return { points, center, topCenter };
}

function selectionOverlay(controller: SceneController, input: SceneRenderInput): RuntimeSelectionOverlay | null {
  if (!input.showTransformHandles || input.mode !== "select") return null;
  const ids = selectedIdsFromInput(input);
  if (!ids.length) return null;
  const primaryId = input.selectedCardId && ids.includes(input.selectedCardId) ? input.selectedCardId : ids[ids.length - 1];
  const selected = controller.meshes.get(primaryId);
  const placement = input.composition.cards.find((card) => card.cardId === primaryId);
  if (!selected || !placement) return null;
  const primary = meshScreenQuad(controller, selected);
  const vector = { x: primary.topCenter.x - primary.center.x, y: primary.topCenter.y - primary.center.y };
  const magnitude = Math.max(1, Math.hypot(vector.x, vector.y));
  const extras = ids
    .filter((id) => id !== primaryId)
    .map((id) => controller.meshes.get(id))
    .filter((mesh): mesh is THREE.Mesh<THREE.PlaneGeometry, CardMaterial> => Boolean(mesh))
    .map((mesh) => ({ points: meshScreenQuad(controller, mesh).points }));
  return {
    points: primary.points,
    center: primary.center,
    rotationHandle: { x: primary.topCenter.x + (vector.x / magnitude) * 36, y: primary.topCenter.y + (vector.y / magnitude) * 36 },
    locked: placement.locked,
    extras,
  };
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

export function renderScene(controller: SceneController, input: SceneRenderInput, overviewCamera: CameraPose, options: { target?: THREE.RenderTarget | null; clean?: boolean; production?: boolean; transparentBackground?: boolean } = {}) {
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
  // Overview layout: show every card at its settled composition pose so hit-tests match what you arrange.
  const layoutEdit = input.viewMode === "overview" && !options.production && !options.target;
  const renderCamera = layoutEdit ? overviewCamera : state.camera;
  configureCamera(controller, input.composition, renderCamera, { transparentBackground: options.transparentBackground });
  controller.camera.updateMatrixWorld(true);
  const selectedSet = !options.clean ? new Set(selectedIdsFromInput(input)) : null;
  const placementById = new Map(input.composition.cards.map((card) => [card.cardId, card]));
  for (const card of state.cards) {
    const mesh = controller.meshes.get(card.cardId);
    if (!mesh) continue;
    const placement = layoutEdit ? (placementById.get(card.cardId) ?? card) : card;
    mesh.position.set((placement.x - 0.5) * dimensions.width, (0.5 - placement.y) * dimensions.height, placement.z);
    mesh.rotation.z = -placement.rotation;
    mesh.scale.setScalar(placement.scale);
    mesh.visible = layoutEdit ? true : card.opacity > 0.005;
    const previous = previousCards.get(card.cardId);
    let motionX = 0;
    let motionY = 0;
    let motionAmount = 0;
    if (previous && !layoutEdit) {
      const currentWorld = fieldPointToWorld(input.composition, card);
      const previousWorld = fieldPointToWorld(input.composition, previous);
      const currentScreen = projectWorldPoint(input.composition, state.camera, { ...currentWorld, z: card.z });
      const previousScreen = projectWorldPoint(input.composition, previousState!.camera, { ...previousWorld, z: previous.z });
      const strength = motionBlur.strength;
      motionX = THREE.MathUtils.clamp((currentScreen.x - previousScreen.x) * strength * 3, -0.12, 0.12);
      motionY = THREE.MathUtils.clamp((currentScreen.y - previousScreen.y) * strength * 3, -0.12, 0.12);
      motionAmount = Math.min(1, Math.hypot(currentScreen.x - previousScreen.x, currentScreen.y - previousScreen.y) * strength * 20);
    }
    const effects = !layoutEdit && (card.blur > 0.01 || motionAmount > 0.0001);
    if (mesh.material.cardEffectMode !== effects) {
      const texture = controller.cache.get(card.cardId)?.texture;
      if (texture) { mesh.material.dispose(); mesh.material = createCardMaterial(texture, effects); }
    }
    mesh.material.cardUniforms.opacity.value = layoutEdit ? 1 : card.opacity;
    mesh.material.cardUniforms.blur.value = layoutEdit ? 0 : card.blur;
    const isSelected = Boolean(selectedSet?.has(card.cardId));
    mesh.material.cardUniforms.selected.value = isSelected ? 1 : 0;
    mesh.material.cardUniforms.hero.value = input.take.hero?.cardId === card.cardId ? 1 : 0;
    mesh.material.cardUniforms.motionX.value = motionX;
    mesh.material.cardUniforms.motionY.value = motionY;
    mesh.material.cardUniforms.motionAmount.value = motionAmount;
    // Keep selected cards painted (and hit-tested) above overlaps.
    const selectedBoost = isSelected ? (card.cardId === input.selectedCardId ? 500_000 : 400_000) : 0;
    mesh.renderOrder = card.layerPriority + selectedBoost;
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

/**
 * Pick the card under the pointer.
 * Transparent cards use renderOrder for stacking (depthWrite is off), so a pure depth
 * raycast often returns a different post than the one painted on top. Prefer the
 * currently selected card when it is under the cursor, then break near-depth ties by
 * renderOrder so hits match what the user sees.
 */
function pointInConvexQuad(
  px: number,
  py: number,
  quad: Array<{ x: number; y: number }>,
) {
  // Barycentric-style edge tests for a convex quad in screen space.
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (Math.abs(cross) < 1e-8) continue;
    const next = cross > 0 ? 1 : -1;
    if (sign === 0) sign = next;
    else if (sign !== next) return false;
  }
  return true;
}

function preferredIdSet(preferredCardIds?: string | string[] | null) {
  if (Array.isArray(preferredCardIds)) return new Set(preferredCardIds);
  if (preferredCardIds) return new Set([preferredCardIds]);
  return new Set<string>();
}

function clientToFramePoint(controller: SceneController, clientX: number, clientY: number) {
  const rect = controller.renderer.domElement.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  // Allow a few px of slack outside the canvas edge so card borders stay grabbable.
  const pad = 8;
  if (
    clientX < rect.left - pad || clientX > rect.right + pad
    || clientY < rect.top - pad || clientY > rect.bottom + pad
  ) return null;
  return {
    px: ((clientX - rect.left) / rect.width) * controller.frameWidth,
    py: ((clientY - rect.top) / rect.height) * controller.frameHeight,
    rect,
  };
}

function quadHitsPoint(
  px: number,
  py: number,
  points: Array<{ x: number; y: number }>,
  center: { x: number; y: number },
  padScale = 1.2,
  padPx = 14,
) {
  // Inflate from center (relative) and with a fixed pixel pad (AABB) so small/thin cards stay grabbable.
  const padded = points.map((point) => ({
    x: center.x + (point.x - center.x) * padScale,
    y: center.y + (point.y - center.y) * padScale,
  }));
  if (pointInConvexQuad(px, py, padded)) return true;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of padded) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return px >= minX - padPx && px <= maxX + padPx && py >= minY - padPx && py <= maxY + padPx;
}

/**
 * Screen-space pick: project each card's quad into the canvas and test the pointer.
 * More reliable than raycasting WebGPU node materials for overview/layout interaction.
 */
export function pickCardAtClient(
  controller: SceneController,
  clientX: number,
  clientY: number,
  preferredCardIds?: string | string[] | null,
) {
  const frame = clientToFramePoint(controller, clientX, clientY);
  if (!frame) return undefined;
  const { px, py } = frame;
  controller.camera.updateMatrixWorld(true);

  const preferred = preferredIdSet(preferredCardIds);

  type Hit = { id: string; renderOrder: number; z: number; preferred: boolean };
  const hits: Hit[] = [];
  for (const [cardId, mesh] of controller.meshes) {
    const quad = meshScreenQuad(controller, mesh);
    if (!quadHitsPoint(px, py, quad.points, quad.center, preferred.has(cardId) ? 1.35 : 1.18, preferred.has(cardId) ? 22 : 12)) {
      continue;
    }
    hits.push({
      id: cardId,
      renderOrder: mesh.renderOrder,
      z: mesh.position.z,
      preferred: preferred.has(cardId),
    });
  }
  // No soft center fallback here — blank space must remain clickable for deselect/marquee.
  if (!hits.length) return undefined;
  hits.sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    if (a.renderOrder !== b.renderOrder) return b.renderOrder - a.renderOrder;
    return b.z - a.z;
  });
  return hits[0]?.id;
}

/** Screen-space quads for the given card ids (same space as selection overlay). */
export function cardScreenQuads(
  controller: SceneController,
  cardIds: string[],
) {
  controller.camera.updateMatrixWorld(true);
  const quads: Array<{ id: string; points: Array<{ x: number; y: number }>; center: { x: number; y: number } }> = [];
  for (const id of cardIds) {
    const mesh = controller.meshes.get(id);
    if (!mesh) continue;
    const quad = meshScreenQuad(controller, mesh);
    quads.push({ id, points: quad.points, center: quad.center });
  }
  return quads;
}

/**
 * Restrict pick to the given card ids (multi-select group drag).
 * Hits only padded card bodies — no soft center radius — so blank field
 * clicks can still marquee / deselect.
 */
export function pickPreferredCardAtClient(
  controller: SceneController,
  clientX: number,
  clientY: number,
  preferredCardIds: string | string[],
) {
  const preferred = preferredIdSet(preferredCardIds);
  if (!preferred.size) return undefined;
  const frame = clientToFramePoint(controller, clientX, clientY);
  if (!frame) return undefined;
  const { px, py } = frame;
  controller.camera.updateMatrixWorld(true);

  let bestId: string | undefined;
  let bestDist = Infinity;
  for (const id of preferred) {
    const mesh = controller.meshes.get(id);
    if (!mesh) continue;
    const quad = meshScreenQuad(controller, mesh);
    // Modest pad: easy to grab selected cards, but blank gaps stay empty.
    if (!quadHitsPoint(px, py, quad.points, quad.center, 1.2, 10)) continue;
    const dist = Math.hypot(quad.center.x - px, quad.center.y - py);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = id;
    }
  }
  return bestId;
}

export function hitTestCard(
  controller: SceneController,
  clientX: number,
  clientY: number,
  preferredCardIds?: string | string[] | null,
  options?: { softPick?: boolean; preferredOnly?: boolean },
) {
  if (options?.preferredOnly) {
    const preferred = preferredIdSet(preferredCardIds);
    if (preferred.size) {
      return pickPreferredCardAtClient(controller, clientX, clientY, [...preferred]);
    }
  }

  // Primary path: screen-space quad pick (works with overview layout + node materials).
  const screenHit = pickCardAtClient(controller, clientX, clientY, preferredCardIds);
  if (screenHit) return screenHit;

  if (!options?.softPick) return undefined;

  const frame = clientToFramePoint(controller, clientX, clientY);
  if (!frame) return undefined;
  controller.camera.updateMatrixWorld(true);
  const preferred = preferredIdSet(preferredCardIds);

  let bestId: string | undefined;
  let bestDist = Math.max(controller.frameWidth, controller.frameHeight) * 0.05;
  for (const [cardId, mesh] of controller.meshes) {
    const center = meshScreenQuad(controller, mesh).center;
    const dist = Math.hypot(center.x - frame.px, center.y - frame.py);
    // Prefer currently-selected cards on soft-pick ties.
    const score = preferred.has(cardId) ? dist * 0.65 : dist;
    if (score < bestDist) {
      bestDist = score;
      bestId = cardId;
    }
  }
  return bestId;
}

export function fieldPointAt(controller: SceneController, composition: Composition, clientX: number, clientY: number, z = 0) {
  const point = normalizedCanvasPoint(controller, clientX, clientY);
  controller.camera.updateMatrixWorld(true);
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
  // WebGPU texture copies are top-down like canvas; WebGL readPixels are bottom-up and need a flip.
  const flipY = !controller.renderer.backend?.isWebGPUBackend;
  const packed = packReadbackPixels(pixels, width, height, flipY);
  const canvas = controller.encodeCanvas ?? document.createElement("canvas"); controller.encodeCanvas = canvas; canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false }); if (!context) throw new Error("Preview encoder is unavailable");
  context.putImageData(new ImageData(packed, width, height), 0, 0);
  const encodeStartedAt = performance.now();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    controller.telemetry.record("frameEncode", performance.now() - encodeStartedAt);
    blob ? resolve(blob) : reject(new Error("Preview frame encoding failed"));
  }, "image/webp", quality));
}
