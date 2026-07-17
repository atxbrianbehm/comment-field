import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  compositionWorldDimensions,
  type CameraPose,
  type CardStyle,
  type CommentRecord,
  type Composition,
  type EntranceMotionTemplate,
  type GestureSample,
  type RenderSettings,
  type Take,
  type Transform,
} from "@comment-field/engine";
import {
  beginSceneExport,
  createSceneController,
  disposeSceneController,
  endSceneExport,
  fieldPointAt,
  fitFrameWithinBounds,
  fittedOverviewCamera,
  getSceneTelemetry,
  hitTestCard,
  normalizedCanvasPoint,
  renderPngBlob,
  renderPreviewBlob,
  renderScene,
  resizeScene,
  setSceneBackground,
  syncSceneAssets,
  type RuntimeCacheStatus,
  type RuntimeFieldOverlay,
  type RuntimeSelectionOverlay,
  type SceneController,
  type SceneRenderInput,
  type PerformanceTelemetrySnapshot,
} from "@comment-field/webgpu-runtime";

export type InteractionMode = "select" | "record" | "reflow";
export type TransformPatch = Partial<Pick<Transform, "x" | "y" | "scale" | "rotation">>;
export type CacheStatus = RuntimeCacheStatus;

export interface CommentSceneHandle {
  beginExport: (width: number, height: number) => void;
  renderFrame: (time: number, width: number, height: number) => Promise<Blob>;
  renderLiveFrame: (time: number) => void;
  renderPreviewFrame: (time: number, width: number, height: number, quality: number) => Promise<Blob>;
  showPreviewBitmap: (bitmap: ImageBitmap) => void;
  hidePreview: () => void;
  endExport: () => void;
  fitField: () => void;
  getPerformanceTelemetry: () => PerformanceTelemetrySnapshot | null;
}

interface CommentSceneProps {
  composition: Composition;
  take: Take;
  entranceMotion: EntranceMotionTemplate;
  comments: CommentRecord[];
  cardStyle: CardStyle;
  renderSettings: RenderSettings;
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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const CommentScene = forwardRef<CommentSceneHandle, CommentSceneProps>(function CommentScene(props, forwardedRef) {
  const mountRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const latestRef = useRef(props);
  latestRef.current = props;
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [selectionOverlay, setSelectionOverlay] = useState<RuntimeSelectionOverlay | null>(null);
  const [fieldOverlay, setFieldOverlay] = useState<RuntimeFieldOverlay | null>(null);
  const overviewCameraRef = useRef<CameraPose>(fittedOverviewCamera(props.composition));
  const previousAssetsRef = useRef<{ style: string; comments: string; cards: string } | null>(null);
  const assetJobRef = useRef<{ cancel: () => void } | null>(null);
  const dragRef = useRef<{ cardId: string; offsetX: number; offsetY: number; z: number } | null>(null);
  const overviewPanRef = useRef<{ pointer: { x: number; y: number }; camera: CameraPose } | null>(null);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; midpoint: { x: number; y: number } } | null>(null);
  const gestureRef = useRef<{ start: number; samples: GestureSample[] } | null>(null);
  const pendingMoveRef = useRef<{ cardId: string; patch: TransformPatch; editReflow: boolean } | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const manipulationRef = useRef<{
    kind: "scale" | "rotate"; cardId: string; center: { x: number; y: number };
    startDistance: number; startAngle: number; startScale: number; startRotation: number;
  } | null>(null);

  function renderInput(time = latestRef.current.time): SceneRenderInput {
    const current = latestRef.current;
    return {
      composition: current.composition, take: current.take, entranceMotion: current.entranceMotion,
      comments: current.comments, cardStyle: current.cardStyle, time,
      renderSettings: current.renderSettings,
      selectedCardId: current.selectedCardId, mode: current.mode,
      viewMode: current.viewMode ?? "camera", showTransformHandles: current.showTransformHandles ?? false,
    };
  }

  function paint(time = latestRef.current.time, clean = false) {
    const controller = controllerRef.current;
    if (!controller) return;
    const overlays = renderScene(controller, renderInput(time), overviewCameraRef.current, { clean });
    setSelectionOverlay(overlays.selection);
    setFieldOverlay(overlays.field);
  }

  useEffect(() => {
    const mount = mountRef.current!;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    let controller: SceneController | null = null;
    void createSceneController().then((created) => {
      if (disposed) { disposeSceneController(created); return; }
      controller = created;
      controllerRef.current = created;
      mount.appendChild(created.renderer.domElement);
      const resize = () => {
        const bounds = mount.getBoundingClientRect();
        const composition = latestRef.current.composition;
        const size = fitFrameWithinBounds(bounds.width, bounds.height, composition.width, composition.height);
        setFrameSize(size);
        resizeScene(created, size.width, size.height);
        paint();
      };
      observer = new ResizeObserver(resize);
      observer.observe(mount);
      setRuntimeReady(true);
      resize();
    }).catch((error: unknown) => {
      if (!disposed) setRuntimeError(error instanceof Error ? error.message : "WebGPU initialization failed");
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      assetJobRef.current?.cancel();
      if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current);
      if (controller) disposeSceneController(controller);
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const bounds = mountRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const size = fitFrameWithinBounds(bounds.width, bounds.height, props.composition.width, props.composition.height);
    setFrameSize(size);
    resizeScene(controller, size.width, size.height);
    paint();
  }, [props.composition.width, props.composition.height]);

  useEffect(() => {
    overviewCameraRef.current = fittedOverviewCamera(props.composition);
    paint();
  }, [props.composition.id, props.composition.fieldBounds.width, props.composition.fieldBounds.height]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    return setSceneBackground(controller, props.composition.backgroundImage, paint);
  }, [props.composition.backgroundImage, runtimeReady]);

  const styleSignature = JSON.stringify(props.cardStyle);
  const commentsSignature = JSON.stringify(props.comments);
  const cardsSignature = JSON.stringify({
    id: props.composition.id, width: props.composition.width, height: props.composition.height,
    ids: props.composition.cards.map((card) => card.cardId),
  });

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    assetJobRef.current?.cancel();
    const job = syncSceneAssets(
      controller,
      renderInput(),
      previousAssetsRef.current,
      (status) => latestRef.current.onCacheStatus?.(status),
      paint,
    );
    previousAssetsRef.current = job.signatures;
    assetJobRef.current = job;
    return job.cancel;
  }, [styleSignature, commentsSignature, cardsSignature, runtimeReady]);

  useEffect(() => { paint(props.time); }, [
    props.time, props.take, props.entranceMotion, props.composition, props.selectedCardId,
    props.showTransformHandles, props.mode, props.viewMode,
  ]);

  useImperativeHandle(forwardedRef, () => ({
    beginExport(width, height) {
      const controller = controllerRef.current;
      if (!controller) throw new Error("Renderer is not ready");
      beginSceneExport(controller, width, height);
    },
    async renderFrame(time, width, height) {
      const controller = controllerRef.current;
      if (!controller) throw new Error("Renderer is not ready");
      const blob = await renderPngBlob(controller, renderInput(time), overviewCameraRef.current, width, height);
      if (!controller.exporting) paint();
      return blob;
    },
    renderLiveFrame(time) { previewCanvasRef.current?.classList.remove("is-visible"); paint(time); },
    async renderPreviewFrame(time, width, height, quality) {
      const controller = controllerRef.current;
      if (!controller) throw new Error("Renderer is not ready");
      return renderPreviewBlob(controller, renderInput(time), overviewCameraRef.current, width, height, quality);
    },
    showPreviewBitmap(bitmap) {
      const canvas = previewCanvasRef.current;
      if (!canvas) return;
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext("2d", { alpha: false })?.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
      canvas.classList.add("is-visible");
      setSelectionOverlay(null);
    },
    hidePreview() { previewCanvasRef.current?.classList.remove("is-visible"); },
    endExport() {
      const controller = controllerRef.current;
      if (!controller) return;
      endSceneExport(controller); paint();
    },
    fitField() { overviewCameraRef.current = fittedOverviewCamera(latestRef.current.composition); paint(); },
    getPerformanceTelemetry() { return controllerRef.current ? getSceneTelemetry(controllerRef.current) : null; },
  }));

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (manipulationRef.current) return;
    const controller = controllerRef.current;
    if (!controller) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = latestRef.current;
    if (activePointersRef.current.size >= 2 && (current.viewMode ?? "camera") === "overview") {
      const points = [...activePointersRef.current.values()].slice(0, 2);
      pinchRef.current = {
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
        midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
      };
      dragRef.current = null; overviewPanRef.current = null; manipulationRef.current = null;
      current.onManipulationStart?.();
      return;
    }
    const point = normalizedCanvasPoint(controller, event.clientX, event.clientY);
    if (current.mode === "record") { gestureRef.current = { start: performance.now(), samples: [{ time: 0, ...point }] }; return; }
    const cardId = hitTestCard(controller, event.clientX, event.clientY) ?? null;
    current.onSelect(cardId);
    if (cardId) {
      current.onManipulationStart?.();
      const base = current.mode === "reflow" ? current.take.reflowTargets[cardId] : current.composition.cards.find((card) => card.cardId === cardId);
      const fieldPoint = fieldPointAt(controller, current.composition, event.clientX, event.clientY, base?.z ?? 0);
      dragRef.current = { cardId, offsetX: (base?.x ?? point.x) - (fieldPoint?.x ?? point.x), offsetY: (base?.y ?? point.y) - (fieldPoint?.y ?? point.y), z: base?.z ?? 0 };
    } else if ((current.viewMode ?? "camera") === "overview") {
      const fieldPoint = fieldPointAt(controller, current.composition, event.clientX, event.clientY);
      if (fieldPoint) overviewPanRef.current = { pointer: fieldPoint, camera: { ...overviewCameraRef.current } };
    }
  }

  function flushPendingMove() {
    const move = pendingMoveRef.current;
    if (!move) return;
    pendingMoveRef.current = null;
    latestRef.current.onTransformCard(move.cardId, move.patch, move.editReflow);
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const controller = controllerRef.current;
    if (!controller) return;
    if (activePointersRef.current.has(event.pointerId)) activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchRef.current && activePointersRef.current.size >= 2) {
      const points = [...activePointersRef.current.values()].slice(0, 2);
      const distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
      const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const dimensions = compositionWorldDimensions(latestRef.current.composition);
      const zoom = overviewCameraRef.current.z / fittedOverviewCamera(latestRef.current.composition).z;
      overviewCameraRef.current = {
        ...overviewCameraRef.current,
        x: overviewCameraRef.current.x - (midpoint.x - pinchRef.current.midpoint.x) / Math.max(1, frameSize.width) * dimensions.width * zoom,
        y: overviewCameraRef.current.y + (midpoint.y - pinchRef.current.midpoint.y) / Math.max(1, frameSize.height) * dimensions.height * zoom,
        z: clamp(overviewCameraRef.current.z * pinchRef.current.distance / distance, 2, 60),
      };
      pinchRef.current = { distance, midpoint };
      paint(); return;
    }
    const manipulation = manipulationRef.current;
    if (manipulation) {
      const rect = controller.renderer.domElement.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const distance = Math.hypot(point.x - manipulation.center.x, point.y - manipulation.center.y);
      const angle = Math.atan2(point.y - manipulation.center.y, point.x - manipulation.center.x);
      const patch = manipulation.kind === "scale"
        ? { scale: clamp(manipulation.startScale * distance / Math.max(1, manipulation.startDistance), 0.2, 4) }
        : { rotation: manipulation.startRotation + angle - manipulation.startAngle };
      latestRef.current.onTransformCard(manipulation.cardId, patch, false); return;
    }
    const point = normalizedCanvasPoint(controller, event.clientX, event.clientY);
    if (gestureRef.current) {
      const time = (performance.now() - gestureRef.current.start) / 1000;
      const previous = gestureRef.current.samples.at(-1);
      if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 0.006) gestureRef.current.samples.push({ time, ...point });
      return;
    }
    if (dragRef.current) {
      const fieldPoint = fieldPointAt(controller, latestRef.current.composition, event.clientX, event.clientY, dragRef.current.z);
      if (!fieldPoint) return;
      const bounds = latestRef.current.composition.fieldBounds;
      pendingMoveRef.current = { cardId: dragRef.current.cardId, editReflow: latestRef.current.mode === "reflow", patch: {
        x: clamp(fieldPoint.x + dragRef.current.offsetX, 0.5 - bounds.width / 2, 0.5 + bounds.width / 2),
        y: clamp(fieldPoint.y + dragRef.current.offsetY, 0.5 - bounds.height / 2, 0.5 + bounds.height / 2),
      } };
      if (moveFrameRef.current === null) moveFrameRef.current = requestAnimationFrame(() => { moveFrameRef.current = null; flushPendingMove(); });
    } else if (overviewPanRef.current) {
      const fieldPoint = fieldPointAt(controller, latestRef.current.composition, event.clientX, event.clientY);
      if (!fieldPoint) return;
      const dimensions = compositionWorldDimensions(latestRef.current.composition);
      overviewCameraRef.current = { ...overviewPanRef.current.camera,
        x: overviewPanRef.current.camera.x + (overviewPanRef.current.pointer.x - fieldPoint.x) * dimensions.width,
        y: overviewPanRef.current.camera.y - (overviewPanRef.current.pointer.y - fieldPoint.y) * dimensions.height };
      paint();
    }
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size < 2) pinchRef.current = null;
    if (gestureRef.current) latestRef.current.onGestureComplete(gestureRef.current.samples);
    if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current);
    moveFrameRef.current = null; flushPendingMove(); gestureRef.current = null; dragRef.current = null;
    overviewPanRef.current = null; manipulationRef.current = null;
  }

  function wheel(event: ReactWheelEvent<HTMLDivElement>) {
    if ((latestRef.current.viewMode ?? "camera") !== "overview") return;
    event.preventDefault();
    overviewCameraRef.current = { ...overviewCameraRef.current, z: clamp(overviewCameraRef.current.z * Math.exp(event.deltaY * 0.001), 2, 60) };
    paint();
  }

  function beginHandleManipulation(kind: "scale" | "rotate", event: ReactPointerEvent<SVGElement>) {
    const selected = latestRef.current.composition.cards.find((card) => card.cardId === latestRef.current.selectedCardId);
    if (!selected || selected.locked || !selectionOverlay) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    const rect = controllerRef.current?.renderer.domElement.getBoundingClientRect();
    if (!rect) return;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    latestRef.current.onManipulationStart?.();
    manipulationRef.current = { kind, cardId: selected.cardId, center: selectionOverlay.center,
      startDistance: Math.hypot(point.x - selectionOverlay.center.x, point.y - selectionOverlay.center.y),
      startAngle: Math.atan2(point.y - selectionOverlay.center.y, point.x - selectionOverlay.center.x),
      startScale: selected.scale, startRotation: selected.rotation };
  }

  return <div ref={mountRef} className={`scene-mount scene-mode-${props.mode}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={wheel}>
    {!runtimeReady && <div className={`runtime-status ${runtimeError ? "is-error" : ""}`} role="status"><strong>{runtimeError ? "WebGPU unavailable" : "Starting WebGPU"}</strong><span>{runtimeError ?? "Requesting a current-generation graphics device..."}</span></div>}
    {fieldOverlay && <svg className="field-map-overlay" aria-hidden="true" width={frameSize.width} height={frameSize.height} viewBox={`0 0 ${frameSize.width} ${frameSize.height}`}>
      <polygon className="field-boundary" points={fieldOverlay.field.map((point) => `${point.x},${point.y}`).join(" ")} />
      {fieldOverlay.protectedRegions.map((region) => <g key={region.id} className="safe-region-vector"><polygon points={region.points.map((point) => `${point.x},${point.y}`).join(" ")} /><text x={region.points[0]?.x ?? 0} y={(region.points[0]?.y ?? 0) + 14}>{region.name}</text></g>)}
      {fieldOverlay.camera.length > 0 && <polygon className="camera-frame-vector" points={fieldOverlay.camera.map((point) => `${point.x},${point.y}`).join(" ")} />}
    </svg>}
    <canvas ref={previewCanvasRef} className="ram-preview-canvas" aria-label="Cached playback preview" style={{ width: frameSize.width, height: frameSize.height }} />
    {selectionOverlay && <svg className={`transform-overlay ${selectionOverlay.locked ? "is-locked" : ""}`} width={frameSize.width} height={frameSize.height} viewBox={`0 0 ${frameSize.width} ${frameSize.height}`}>
      <polygon points={selectionOverlay.points.map((point) => `${point.x},${point.y}`).join(" ")} /><line x1={selectionOverlay.center.x} y1={selectionOverlay.center.y} x2={selectionOverlay.rotationHandle.x} y2={selectionOverlay.rotationHandle.y} />
      {selectionOverlay.points.map((point, index) => <g key={index} className="transform-handle scale-handle" transform={`translate(${point.x} ${point.y})`} onPointerDown={(event) => beginHandleManipulation("scale", event)}><circle className="transform-hit" r="24" /><rect x="-6" y="-6" width="12" height="12" rx="3" /></g>)}
      <g className="transform-handle rotate-handle" transform={`translate(${selectionOverlay.rotationHandle.x} ${selectionOverlay.rotationHandle.y})`} onPointerDown={(event) => beginHandleManipulation("rotate", event)}><circle className="transform-hit" r="24" /><circle r="7" /></g>
      {selectionOverlay.locked && <text x={selectionOverlay.center.x} y={selectionOverlay.center.y}>Locked</text>}
    </svg>}
  </div>;
});
