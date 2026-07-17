import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { evaluateScene } from "../animation/evaluateScene";
import { compositionWorldDimensions, evaluateCamera, fieldPointToWorld, unprojectScreenPoint, worldPointToField } from "../animation/camera";
import type { CameraPose, CardStyle, CommentRecord, Composition, EntranceMotionTemplate, GestureSample, Take, Transform } from "../models/types";
import { createCardTextureKey } from "./cardCache";
import { createCardMaterial, type CardMaterial } from "./cardMaterial";
import { createCardTexture } from "./cardTexture";
import { fitFrameWithinBounds } from "./frameSizing";

export type InteractionMode = "select" | "record" | "reflow";
export type TransformPatch = Partial<Pick<Transform, "x" | "y" | "scale" | "rotation">>;

export interface CacheStatus {
  state: "ready" | "rebuilding";
  ready: number;
  total: number;
  hits: number;
  misses: number;
  reason: string;
}

export interface CommentSceneHandle {
  beginExport: (width: number, height: number) => void;
  renderFrame: (time: number, width: number, height: number) => Promise<Blob>;
  renderLiveFrame: (time: number) => void;
  renderPreviewFrame: (time: number, width: number, height: number, quality: number) => Promise<Blob>;
  showPreviewBitmap: (bitmap: ImageBitmap) => void;
  hidePreview: () => void;
  endExport: () => void;
  fitField: () => void;
}

interface CommentSceneProps {
  composition: Composition;
  take: Take;
  entranceMotion: EntranceMotionTemplate;
  comments: CommentRecord[];
  cardStyle: CardStyle;
  time: number;
  selectedCardId: string | null;
  mode: InteractionMode;
  showTransformHandles?: boolean;
  onSelect: (cardId: string | null) => void;
  onTransformCard: (cardId: string, patch: TransformPatch, editReflow: boolean) => void;
  onGestureComplete: (samples: GestureSample[]) => void;
  onCacheStatus?: (status: CacheStatus) => void;
  onManipulationStart?: () => void;
  viewMode?: "camera" | "overview";
}

interface CachedTexture {
  key: string;
  texture: THREE.Texture;
  aspect: number;
}

interface SceneController {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cards: THREE.Group;
  meshes: Map<string, THREE.Mesh<THREE.PlaneGeometry, CardMaterial>>;
  cache: Map<string, CachedTexture>;
  frameWidth: number;
  frameHeight: number;
  exporting: boolean;
}

interface SelectionOverlay {
  points: Array<{ x: number; y: number }>;
  center: { x: number; y: number };
  rotationHandle: { x: number; y: number };
  locked: boolean;
}

interface FieldOverlay {
  field: Array<{ x: number; y: number }>;
  camera: Array<{ x: number; y: number }>;
  protectedRegions: Array<{ id: string; name: string; points: Array<{ x: number; y: number }> }>;
}

function configureCamera(controller: SceneController, composition: Composition, pose: CameraPose) {
  controller.camera.aspect = composition.width / composition.height;
  controller.camera.fov = pose.fov;
  controller.camera.position.set(pose.x, pose.y, pose.z);
  controller.camera.updateProjectionMatrix();
  controller.renderer.setClearColor(composition.backgroundColor, 1);
}

function worldDimensions(composition: Composition) {
  return compositionWorldDimensions(composition);
}

function fittedOverviewCamera(composition: Composition): CameraPose {
  const scale = Math.max(composition.fieldBounds.width, composition.fieldBounds.height);
  return { ...composition.camera, x: 0, y: 0, z: Math.max(2, composition.camera.z * scale * 1.08) };
}

function screenPoint(point: THREE.Vector3, controller: SceneController) {
  const projected = point.project(controller.camera);
  return {
    x: (projected.x * 0.5 + 0.5) * controller.frameWidth,
    y: (-projected.y * 0.5 + 0.5) * controller.frameHeight,
  };
}

const PREVIEW_PIXEL_RATIO = 1;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const CommentScene = forwardRef<CommentSceneHandle, CommentSceneProps>(function CommentScene(props, forwardedRef) {
  const mountRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [selectionOverlay, setSelectionOverlay] = useState<SelectionOverlay | null>(null);
  const [fieldOverlay, setFieldOverlay] = useState<FieldOverlay | null>(null);
  const latestRef = useRef(props);
  latestRef.current = props;
  const resizeRef = useRef<(() => void) | null>(null);
  const dragRef = useRef<{ cardId: string; offsetX: number; offsetY: number; z: number } | null>(null);
  const overviewCameraRef = useRef<CameraPose>(fittedOverviewCamera(props.composition));
  const overviewPanRef = useRef<{ pointer: { x: number; y: number }; camera: CameraPose } | null>(null);
  const pendingMoveRef = useRef<{ cardId: string; patch: TransformPatch; editReflow: boolean } | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const cacheFrameRef = useRef<number | null>(null);
  const gestureRef = useRef<{ start: number; samples: GestureSample[] } | null>(null);
  const manipulationRef = useRef<{
    kind: "scale" | "rotate";
    cardId: string;
    center: { x: number; y: number };
    startDistance: number;
    startAngle: number;
    startScale: number;
    startRotation: number;
  } | null>(null);
  const previousAssetsRef = useRef<{ style: string; comments: string; cards: string } | null>(null);
  const previewTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const encodeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const render = (time: number, options: { target?: THREE.WebGLRenderTarget | null; clean?: boolean; updateOverlay?: boolean; production?: boolean } = {}) => {
    const controller = controllerRef.current;
    if (!controller) return;
    const current = latestRef.current;
    const dimensions = worldDimensions(current.composition);
    const entrance = current.take.entranceOverride ?? current.entranceMotion;
    const state = evaluateScene(current.composition, current.take, entrance, time);
    const renderCamera = current.viewMode === "overview" && !options.production && !options.target ? overviewCameraRef.current : state.camera;
    configureCamera(controller, current.composition, renderCamera);
    for (const card of state.cards) {
      const mesh = controller.meshes.get(card.cardId);
      if (!mesh) continue;
      mesh.position.set((card.x - 0.5) * dimensions.width, (0.5 - card.y) * dimensions.height, card.z);
      mesh.rotation.z = -card.rotation;
      mesh.scale.setScalar(card.scale);
      mesh.visible = card.opacity > 0.005;
      mesh.material.uniforms.uOpacity.value = card.opacity;
      mesh.material.uniforms.uBlur.value = card.blur;
      mesh.material.uniforms.uSelected.value = !options.clean && current.selectedCardId === card.cardId ? 1 : 0;
      mesh.material.uniforms.uHero.value = current.take.hero?.cardId === card.cardId ? 1 : 0;
      mesh.renderOrder = card.layerPriority;
    }
    controller.renderer.setRenderTarget(options.target ?? null);
    controller.renderer.render(controller.scene, controller.camera);
    controller.renderer.setRenderTarget(null);
    if (options.updateOverlay !== false && !options.target) {
      updateSelectionOverlay();
      updateFieldOverlay(state.camera);
    }
  };

  function projectFieldPoint(point: { x: number; y: number }) {
    const controller = controllerRef.current;
    if (!controller) return { x: 0, y: 0 };
    const world = fieldPointToWorld(latestRef.current.composition, point);
    return screenPoint(new THREE.Vector3(world.x, world.y, 0), controller);
  }

  function updateFieldOverlay(outputCamera: CameraPose) {
    const controller = controllerRef.current;
    const current = latestRef.current;
    if (!controller) return;
    const bounds = current.composition.fieldBounds;
    const minX = 0.5 - bounds.width / 2;
    const maxX = 0.5 + bounds.width / 2;
    const minY = 0.5 - bounds.height / 2;
    const maxY = 0.5 + bounds.height / 2;
    const field = [
      { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY },
    ].map(projectFieldPoint);
    const camera = current.viewMode === "overview"
      ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((point) => {
          const world = unprojectScreenPoint(current.composition, outputCamera, point, 0);
          return screenPoint(new THREE.Vector3(world.x, world.y, 0), controller);
        })
      : [];
    const protectedRegions = current.composition.protectedRegions.map((region) => ({
      id: region.id,
      name: region.name,
      points: [
        { x: region.x, y: region.y },
        { x: region.x + region.width, y: region.y },
        { x: region.x + region.width, y: region.y + region.height },
        { x: region.x, y: region.y + region.height },
      ].map(projectFieldPoint),
    }));
    setFieldOverlay({ field, camera, protectedRegions });
  }

  function updateSelectionOverlay() {
    const controller = controllerRef.current;
    const current = latestRef.current;
    const selected = current.selectedCardId ? controller?.meshes.get(current.selectedCardId) : null;
    const placement = current.composition.cards.find((card) => card.cardId === current.selectedCardId);
    if (!controller || !selected || !placement || !current.showTransformHandles || current.mode !== "select") {
      setSelectionOverlay((value) => value ? null : value);
      return;
    }
    const width = selected.geometry.parameters.width / 2;
    const height = selected.geometry.parameters.height / 2;
    selected.updateMatrixWorld(true);
    const points = [
      new THREE.Vector3(-width, -height, 0),
      new THREE.Vector3(width, -height, 0),
      new THREE.Vector3(width, height, 0),
      new THREE.Vector3(-width, height, 0),
    ].map((point) => screenPoint(point.applyMatrix4(selected.matrixWorld), controller));
    const center = screenPoint(new THREE.Vector3(0, 0, 0).applyMatrix4(selected.matrixWorld), controller);
    const topCenter = screenPoint(new THREE.Vector3(0, height, 0).applyMatrix4(selected.matrixWorld), controller);
    const vector = { x: topCenter.x - center.x, y: topCenter.y - center.y };
    const magnitude = Math.max(1, Math.hypot(vector.x, vector.y));
    const rotationHandle = { x: topCenter.x + (vector.x / magnitude) * 36, y: topCenter.y + (vector.y / magnitude) * 36 };
    setSelectionOverlay({ points, center, rotationHandle, locked: placement.locked });
  }

  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(PREVIEW_PIXEL_RATIO);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 100);
    const cards = new THREE.Group();
    scene.add(cards);
    const controller: SceneController = { renderer, scene, camera, cards, meshes: new Map(), cache: new Map(), frameWidth: 0, frameHeight: 0, exporting: false };
    controllerRef.current = controller;
    mount.appendChild(renderer.domElement);
    const resize = () => {
      const rect = mount.getBoundingClientRect();
      const composition = latestRef.current.composition;
      const { width, height } = fitFrameWithinBounds(rect.width, rect.height, composition.width, composition.height);
      controller.frameWidth = width;
      controller.frameHeight = height;
      setFrameSize({ width, height });
      renderer.domElement.style.width = `${width}px`;
      renderer.domElement.style.height = `${height}px`;
      renderer.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), false);
      render(latestRef.current.time);
    };
    resizeRef.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    return () => {
      observer.disconnect();
      if (cacheFrameRef.current !== null) cancelAnimationFrame(cacheFrameRef.current);
      if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current);
      previewTargetRef.current?.dispose();
      controller.cache.forEach(({ texture }) => texture.dispose());
      controller.meshes.forEach((mesh) => { mesh.geometry.dispose(); mesh.material.dispose(); });
      renderer.dispose();
      renderer.domElement.remove();
      resizeRef.current = null;
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => { resizeRef.current?.(); }, [props.composition.width, props.composition.height]);

  useEffect(() => {
    overviewCameraRef.current = fittedOverviewCamera(props.composition);
    if (props.viewMode === "overview") render(props.time);
  }, [props.composition.id, props.composition.fieldBounds.width, props.composition.fieldBounds.height]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    let texture: THREE.Texture | null = null;
    let cancelled = false;
    if (!props.composition.backgroundImage) {
      controller.scene.background = null;
      render(props.time);
      return;
    }
    new THREE.TextureLoader().load(props.composition.backgroundImage, (loaded) => {
      if (cancelled) { loaded.dispose(); return; }
      texture = loaded;
      loaded.colorSpace = THREE.SRGBColorSpace;
      controller.scene.background = loaded;
      render(latestRef.current.time);
    });
    return () => {
      cancelled = true;
      if (controller.scene.background === texture) controller.scene.background = null;
      texture?.dispose();
    };
  }, [props.composition.backgroundImage]);

  const styleSignature = JSON.stringify(props.cardStyle);
  const commentsSignature = JSON.stringify(props.comments);
  const cardsSignature = JSON.stringify({
    id: props.composition.id,
    width: props.composition.width,
    height: props.composition.height,
    ids: props.composition.cards.map((card) => card.cardId),
  });

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const activeController = controller;
    if (cacheFrameRef.current !== null) cancelAnimationFrame(cacheFrameRef.current);
    const commentsById = new Map(props.comments.map((comment) => [comment.id, comment]));
    const desiredIds = new Set(props.composition.cards.map((card) => card.cardId));
    const dimensions = worldDimensions(props.composition);
    for (const [cardId, mesh] of controller.meshes) {
      if (desiredIds.has(cardId)) continue;
      controller.cards.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      controller.meshes.delete(cardId);
      controller.cache.get(cardId)?.texture.dispose();
      controller.cache.delete(cardId);
    }
    const dirty = props.composition.cards.filter((placement) => {
      const comment = commentsById.get(placement.cardId);
      if (!comment) return false;
      return controller.cache.get(placement.cardId)?.key !== createCardTextureKey(comment, props.cardStyle)
        || !controller.meshes.has(placement.cardId);
    });
    for (const placement of props.composition.cards) {
      const cached = activeController.cache.get(placement.cardId);
      const mesh = activeController.meshes.get(placement.cardId);
      const comment = commentsById.get(placement.cardId);
      if (!cached || !mesh || !comment || cached.key !== createCardTextureKey(comment, props.cardStyle)) continue;
      const planeWidth = Math.min(dimensions.width * 0.24, 1.2);
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(planeWidth, planeWidth / cached.aspect);
    }
    const previous = previousAssetsRef.current;
    const reason = !previous ? "initial texture build"
      : previous.style !== styleSignature ? "card template changed"
        : previous.comments !== commentsSignature ? "comment content changed"
          : "composition card set changed";
    previousAssetsRef.current = { style: styleSignature, comments: commentsSignature, cards: cardsSignature };
    const total = props.composition.cards.length;
    const hits = total - dirty.length;
    let completed = 0;
    latestRef.current.onCacheStatus?.({
      state: dirty.length ? "rebuilding" : "ready",
      ready: hits,
      total,
      hits,
      misses: dirty.length,
      reason: dirty.length ? reason : "cache hit",
    });
    let cancelled = false;

    function processBatch() {
      if (cancelled || !controllerRef.current) return;
      for (let index = 0; index < 4 && completed < dirty.length; index += 1, completed += 1) {
        const placement = dirty[completed];
        const comment = commentsById.get(placement.cardId);
        if (!comment) continue;
        const key = createCardTextureKey(comment, props.cardStyle);
        const rendered = createCardTexture(comment, props.cardStyle);
        const planeWidth = Math.min(dimensions.width * 0.24, 1.2);
        const geometry = new THREE.PlaneGeometry(planeWidth, planeWidth / rendered.aspect);
        const existing = activeController.meshes.get(placement.cardId);
        if (existing) {
          existing.geometry.dispose();
          existing.geometry = geometry;
          existing.material.uniforms.uMap.value = rendered.texture;
        } else {
          const material = createCardMaterial(rendered.texture);
          const mesh = new THREE.Mesh(geometry, material);
          mesh.userData.cardId = placement.cardId;
          activeController.cards.add(mesh);
          activeController.meshes.set(placement.cardId, mesh);
        }
        activeController.cache.get(placement.cardId)?.texture.dispose();
        activeController.cache.set(placement.cardId, { key, texture: rendered.texture, aspect: rendered.aspect });
      }
      const ready = hits + completed;
      latestRef.current.onCacheStatus?.({
        state: completed < dirty.length ? "rebuilding" : "ready",
        ready,
        total,
        hits,
        misses: dirty.length,
        reason,
      });
      render(latestRef.current.time);
      if (completed < dirty.length) cacheFrameRef.current = requestAnimationFrame(processBatch);
      else cacheFrameRef.current = null;
    }

    processBatch();
    return () => {
      cancelled = true;
      if (cacheFrameRef.current !== null) {
        cancelAnimationFrame(cacheFrameRef.current);
        cacheFrameRef.current = null;
      }
    };
  }, [styleSignature, commentsSignature, cardsSignature]);

  useEffect(() => { render(props.time); }, [props.time, props.take, props.entranceMotion, props.composition, props.selectedCardId, props.showTransformHandles, props.mode]);

  useImperativeHandle(forwardedRef, () => ({
    beginExport(width, height) {
      const controller = controllerRef.current;
      if (!controller) throw new Error("Renderer is not ready");
      controller.exporting = true;
      controller.renderer.setPixelRatio(1);
      controller.renderer.setSize(width, height, false);
    },
    async renderFrame(time, width, height) {
      const controller = controllerRef.current;
      if (!controller) throw new Error("Renderer is not ready");
      const canvas = controller.renderer.domElement;
      const temporaryExport = !controller.exporting;
      if (temporaryExport) {
        controller.renderer.setPixelRatio(1);
        controller.renderer.setSize(width, height, false);
      }
      render(time, { production: true, clean: true, updateOverlay: false });
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Frame capture failed")), "image/png"));
      if (temporaryExport) {
        controller.renderer.setPixelRatio(PREVIEW_PIXEL_RATIO);
        controller.renderer.setSize(Math.max(1, Math.round(controller.frameWidth)), Math.max(1, Math.round(controller.frameHeight)), false);
        render(latestRef.current.time);
      }
      return blob;
    },
    renderLiveFrame(time) {
      const previewCanvas = previewCanvasRef.current;
      if (previewCanvas) previewCanvas.classList.remove("is-visible");
      render(time);
    },
    async renderPreviewFrame(time, width, height, quality) {
      const controller = controllerRef.current;
      if (!controller) throw new Error("Renderer is not ready");
      let target = previewTargetRef.current;
      if (!target || target.width !== width || target.height !== height) {
        target?.dispose();
        target = new THREE.WebGLRenderTarget(width, height, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          depthBuffer: true,
        });
        target.texture.colorSpace = THREE.SRGBColorSpace;
        previewTargetRef.current = target;
      }
      render(time, { target, clean: true, updateOverlay: false, production: true });
      const pixels = new Uint8Array(width * height * 4);
      controller.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      const flipped = new Uint8ClampedArray(pixels.length);
      const rowBytes = width * 4;
      for (let row = 0; row < height; row += 1) {
        flipped.set(pixels.subarray(row * rowBytes, (row + 1) * rowBytes), (height - row - 1) * rowBytes);
      }
      const canvas = encodeCanvasRef.current ?? document.createElement("canvas");
      encodeCanvasRef.current = canvas;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Preview encoder is unavailable");
      context.putImageData(new ImageData(flipped, width, height), 0, 0);
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Preview frame encoding failed")), "image/webp", quality);
      });
    },
    showPreviewBitmap(bitmap) {
      const canvas = previewCanvasRef.current;
      if (!canvas) return;
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      canvas.classList.add("is-visible");
      setSelectionOverlay((value) => value ? null : value);
    },
    hidePreview() {
      const canvas = previewCanvasRef.current;
      if (canvas) canvas.classList.remove("is-visible");
    },
    endExport() {
      const controller = controllerRef.current;
      if (!controller) return;
      controller.exporting = false;
      controller.renderer.setPixelRatio(PREVIEW_PIXEL_RATIO);
      controller.renderer.setSize(Math.max(1, Math.round(controller.frameWidth)), Math.max(1, Math.round(controller.frameHeight)), false);
      render(latestRef.current.time);
    },
    fitField() {
      overviewCameraRef.current = fittedOverviewCamera(latestRef.current.composition);
      render(latestRef.current.time);
    },
  }));

  function normalizedPointer(event: React.PointerEvent<HTMLDivElement>) {
    const canvas = controllerRef.current?.renderer.domElement;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function cardAtPointer(event: React.PointerEvent<HTMLDivElement>) {
    const controller = controllerRef.current;
    if (!controller) return null;
    const point = normalizedPointer(event);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(point.x * 2 - 1, -(point.y * 2 - 1)), controller.camera);
    const hit = raycaster.intersectObjects([...controller.meshes.values()], false)[0];
    return hit?.object.userData.cardId as string | undefined;
  }

  function fieldPointAtPointer(event: React.PointerEvent<HTMLDivElement>, z = 0) {
    const controller = controllerRef.current;
    if (!controller) return null;
    const point = normalizedPointer(event);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(point.x * 2 - 1, -(point.y * 2 - 1)), controller.camera);
    const world = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), world)) return null;
    return worldPointToField(latestRef.current.composition, world);
  }

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (manipulationRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = latestRef.current;
    const point = normalizedPointer(event);
    if (current.mode === "record") {
      gestureRef.current = { start: performance.now(), samples: [{ time: 0, ...point }] };
      return;
    }
    const cardId = cardAtPointer(event) ?? null;
    current.onSelect(cardId);
    if (cardId) {
      current.onManipulationStart?.();
      const base = current.mode === "reflow"
        ? current.take.reflowTargets[cardId]
        : current.composition.cards.find((card) => card.cardId === cardId);
      const fieldPoint = fieldPointAtPointer(event, base?.z ?? 0);
      dragRef.current = {
        cardId,
        offsetX: (base?.x ?? fieldPoint?.x ?? point.x) - (fieldPoint?.x ?? point.x),
        offsetY: (base?.y ?? fieldPoint?.y ?? point.y) - (fieldPoint?.y ?? point.y),
        z: base?.z ?? 0,
      };
    } else if (current.viewMode === "overview") {
      const fieldPoint = fieldPointAtPointer(event);
      if (fieldPoint) overviewPanRef.current = { pointer: fieldPoint, camera: { ...overviewCameraRef.current } };
    }
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (manipulationRef.current) {
      const manipulation = manipulationRef.current;
      const canvas = controllerRef.current?.renderer.domElement;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const distance = Math.hypot(point.x - manipulation.center.x, point.y - manipulation.center.y);
      const angle = Math.atan2(point.y - manipulation.center.y, point.x - manipulation.center.x);
      const patch = manipulation.kind === "scale"
        ? { scale: clamp(manipulation.startScale * (distance / Math.max(1, manipulation.startDistance)), 0.2, 4) }
        : { rotation: manipulation.startRotation + angle - manipulation.startAngle };
      latestRef.current.onTransformCard(manipulation.cardId, patch, false);
      return;
    }
    const point = normalizedPointer(event);
    if (gestureRef.current) {
      const time = (performance.now() - gestureRef.current.start) / 1000;
      const previous = gestureRef.current.samples.at(-1);
      if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 0.006) gestureRef.current.samples.push({ time, ...point });
      return;
    }
    if (dragRef.current) {
      const fieldPoint = fieldPointAtPointer(event, dragRef.current.z);
      if (!fieldPoint) return;
      const bounds = latestRef.current.composition.fieldBounds;
      pendingMoveRef.current = {
        cardId: dragRef.current.cardId,
        patch: {
          x: clamp(fieldPoint.x + dragRef.current.offsetX, 0.5 - bounds.width / 2, 0.5 + bounds.width / 2),
          y: clamp(fieldPoint.y + dragRef.current.offsetY, 0.5 - bounds.height / 2, 0.5 + bounds.height / 2),
        },
        editReflow: latestRef.current.mode === "reflow",
      };
      if (moveFrameRef.current === null) {
        moveFrameRef.current = requestAnimationFrame(() => {
          moveFrameRef.current = null;
          flushPendingMove();
        });
      }
    } else if (overviewPanRef.current) {
      const fieldPoint = fieldPointAtPointer(event);
      if (!fieldPoint) return;
      const dimensions = compositionWorldDimensions(latestRef.current.composition);
      overviewCameraRef.current = {
        ...overviewPanRef.current.camera,
        x: overviewPanRef.current.camera.x + (overviewPanRef.current.pointer.x - fieldPoint.x) * dimensions.width,
        y: overviewPanRef.current.camera.y - (overviewPanRef.current.pointer.y - fieldPoint.y) * dimensions.height,
      };
      render(latestRef.current.time);
    }
  }

  function flushPendingMove() {
    const move = pendingMoveRef.current;
    if (!move) return;
    pendingMoveRef.current = null;
    latestRef.current.onTransformCard(move.cardId, move.patch, move.editReflow);
  }

  function pointerUp() {
    if (gestureRef.current) latestRef.current.onGestureComplete(gestureRef.current.samples);
    if (moveFrameRef.current !== null) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    }
    flushPendingMove();
    gestureRef.current = null;
    dragRef.current = null;
    overviewPanRef.current = null;
    manipulationRef.current = null;
  }


  function wheel(event: React.WheelEvent<HTMLDivElement>) {
    if (latestRef.current.viewMode !== "overview") return;
    event.preventDefault();
    const next = overviewCameraRef.current.z * Math.exp(event.deltaY * 0.001);
    overviewCameraRef.current = { ...overviewCameraRef.current, z: clamp(next, 2, 60) };
    render(latestRef.current.time);
  }

  function beginHandleManipulation(kind: "scale" | "rotate", event: React.PointerEvent<SVGElement>) {
    const selected = latestRef.current.composition.cards.find((card) => card.cardId === latestRef.current.selectedCardId);
    if (!selected || selected.locked || !selectionOverlay) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const canvas = controllerRef.current?.renderer.domElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    latestRef.current.onManipulationStart?.();
    manipulationRef.current = {
      kind,
      cardId: selected.cardId,
      center: selectionOverlay.center,
      startDistance: Math.hypot(point.x - selectionOverlay.center.x, point.y - selectionOverlay.center.y),
      startAngle: Math.atan2(point.y - selectionOverlay.center.y, point.x - selectionOverlay.center.x),
      startScale: selected.scale,
      startRotation: selected.rotation,
    };
  }

  return (
    <div
      ref={mountRef}
      className={`scene-mount scene-mode-${props.mode}`}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onWheel={wheel}
    >
      {fieldOverlay && <svg className="field-map-overlay" aria-hidden="true" width={frameSize.width} height={frameSize.height} viewBox={`0 0 ${frameSize.width} ${frameSize.height}`}>
        <polygon className="field-boundary" points={fieldOverlay.field.map((point) => `${point.x},${point.y}`).join(" ")} />
        {fieldOverlay.protectedRegions.map((region) => <g key={region.id} className="safe-region-vector">
          <polygon points={region.points.map((point) => `${point.x},${point.y}`).join(" ")} />
          <text x={region.points[0]?.x ?? 0} y={(region.points[0]?.y ?? 0) + 14}>{region.name}</text>
        </g>)}
        {fieldOverlay.camera.length > 0 && <polygon className="camera-frame-vector" points={fieldOverlay.camera.map((point) => `${point.x},${point.y}`).join(" ")} />}
      </svg>}
      <canvas
        ref={previewCanvasRef}
        className="ram-preview-canvas"
        aria-label="Cached playback preview"
        style={{ width: frameSize.width, height: frameSize.height }}
      />
      {selectionOverlay && (
        <svg className={`transform-overlay ${selectionOverlay.locked ? "is-locked" : ""}`} width={frameSize.width} height={frameSize.height} viewBox={`0 0 ${frameSize.width} ${frameSize.height}`}>
          <polygon points={selectionOverlay.points.map((point) => `${point.x},${point.y}`).join(" ")} />
          <line x1={selectionOverlay.center.x} y1={selectionOverlay.center.y} x2={selectionOverlay.rotationHandle.x} y2={selectionOverlay.rotationHandle.y} />
          {selectionOverlay.points.map((point, index) => (
            <g key={index} className="transform-handle scale-handle" transform={`translate(${point.x} ${point.y})`} onPointerDown={(event) => beginHandleManipulation("scale", event)}>
              <circle className="transform-hit" r="20" />
              <rect x="-6" y="-6" width="12" height="12" rx="3" />
            </g>
          ))}
          <g className="transform-handle rotate-handle" transform={`translate(${selectionOverlay.rotationHandle.x} ${selectionOverlay.rotationHandle.y})`} onPointerDown={(event) => beginHandleManipulation("rotate", event)}>
            <circle className="transform-hit" r="20" />
            <circle r="7" />
          </g>
          {selectionOverlay.locked && <text x={selectionOverlay.center.x} y={selectionOverlay.center.y}>Locked</text>}
        </svg>
      )}
    </div>
  );
});
