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
  type GestureSample,
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
  pickCardAtClient,
  pickPreferredCardAtClient,
  cardScreenQuads,
  normalizedCanvasPoint,
  renderPngBlob,
  renderPreviewBlob,
  renderScene,
  resizeScene,
  selectPerformanceProfile,
  setSceneBackground,
  syncSceneAssets,
  type RuntimeFieldOverlay,
  type RuntimeSelectionOverlay,
  type SceneController,
  type SceneRenderInput,
} from "@comment-field/webgpu-runtime";
import { GesturePathOverlay, TransformOverlay } from "./SceneInteractionOverlays";
import type { CommentSceneHandle, CommentSceneProps, TransformPatch } from "./CommentSceneTypes";
export type { CacheStatus, CommentSceneHandle, InteractionMode, SelectOptions, TransformPatch } from "./CommentSceneTypes";

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
  /** Screen-space AABBs for currently selected cards — authoritative for group-drag hit tests. */
  const selectedHitQuadsRef = useRef<Array<{ id: string; points: Array<{ x: number; y: number }> }>>([]);
  const dragRef = useRef<{
    leadId: string;
    startField: { x: number; y: number };
    origins: Array<{ cardId: string; x: number; y: number }>;
    z: number;
  } | null>(null);
  const overviewPanRef = useRef<{ pointer: { x: number; y: number }; camera: CameraPose } | null>(null);
  const marqueeRef = useRef<{
    startClient: { x: number; y: number };
    currentClient: { x: number; y: number };
    additive: boolean;
  } | null>(null);
  const [marqueeBox, setMarqueeBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [frameHostSize, setFrameHostSize] = useState({ width: 0, height: 0 });
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; midpoint: { x: number; y: number } } | null>(null);
  const gestureRef = useRef<{ start: number; samples: GestureSample[] } | null>(null);
  const gesturePointRef = useRef<number | null>(null);
  const pendingMovesRef = useRef<Array<{ cardId: string; patch: TransformPatch; editReflow: boolean }> | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const manipulationRef = useRef<{
    kind: "scale" | "rotate"; cardId: string; center: { x: number; y: number };
    startDistance: number; startAngle: number; startScale: number; startRotation: number;
  } | null>(null);

  function selectionIds(current = latestRef.current) {
    if (current.selectedCardIds?.length) return current.selectedCardIds;
    return current.selectedCardId ? [current.selectedCardId] : [];
  }

  function renderInput(time = latestRef.current.time): SceneRenderInput {
    const current = latestRef.current;
    return {
      composition: current.composition, take: current.take, entranceMotion: current.entranceMotion,
      comments: current.comments, cardStyle: current.cardStyle, time,
      renderSettings: current.renderSettings,
      selectedCardId: current.selectedCardId,
      selectedCardIds: selectionIds(current),
      mode: current.mode,
      viewMode: current.viewMode ?? "camera", showTransformHandles: current.showTransformHandles ?? false,
    };
  }

  function paint(time = latestRef.current.time, clean = false) {
    const controller = controllerRef.current;
    if (!controller) return;
    const overlays = renderScene(controller, renderInput(time), overviewCameraRef.current, { clean });
    setSelectionOverlay(overlays.selection);
    setFieldOverlay(overlays.field);
    // Keep a live ref of selected screen quads for pointer-down group-drag hits.
    if (!clean) selectedHitQuadsRef.current = cardScreenQuads(controller, selectionIds());
    const rect = controller.renderer.domElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) setFrameHostSize({ width: rect.width, height: rect.height });
  }

  /** Marquee UI box in CSS px relative to the canvas (frame-overlay-host). */
  function marqueeBoxFromClients(controller: SceneController, start: { x: number; y: number }, end: { x: number; y: number }) {
    const rect = controller.renderer.domElement.getBoundingClientRect();
    const x1 = clamp(start.x - rect.left, 0, rect.width);
    const y1 = clamp(start.y - rect.top, 0, rect.height);
    const x2 = clamp(end.x - rect.left, 0, rect.width);
    const y2 = clamp(end.y - rect.top, 0, rect.height);
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  }

  /**
   * Select cards whose on-screen centers fall inside the marquee, using the same
   * canvas-relative client coordinates as the marquee overlay (not the full stage).
   */
  function cardsInMarquee(
    controller: SceneController,
    startClient: { x: number; y: number },
    endClient: { x: number; y: number },
  ) {
    const rect = controller.renderer.domElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return [] as string[];
    const nx1 = (startClient.x - rect.left) / rect.width;
    const ny1 = (startClient.y - rect.top) / rect.height;
    const nx2 = (endClient.x - rect.left) / rect.width;
    const ny2 = (endClient.y - rect.top) / rect.height;
    const left = Math.min(nx1, nx2);
    const right = Math.max(nx1, nx2);
    const top = Math.min(ny1, ny2);
    const bottom = Math.max(ny1, ny2);
    if (right - left < 0.004 && bottom - top < 0.004) return [] as string[];
    controller.camera.updateMatrixWorld(true);
    const ids: string[] = [];
    for (const [cardId, mesh] of controller.meshes) {
      mesh.updateMatrixWorld(true);
      const v = mesh.position.clone().project(controller.camera);
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || v.z < -1 || v.z > 1) continue;
      const sx = v.x * 0.5 + 0.5;
      const sy = -v.y * 0.5 + 0.5;
      // Slight pad so a box around the card body still catches the center.
      const pad = 0.01;
      if (sx >= left - pad && sx <= right + pad && sy >= top - pad && sy <= bottom + pad) ids.push(cardId);
    }
    return ids;
  }

  useEffect(() => {
    const mount = mountRef.current!;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    let controller: SceneController | null = null;
    const profile = selectPerformanceProfile({
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    });
    void createSceneController({ canvasPixelRatio: profile.canvasPixelRatio, cardTexturePixelRatio: profile.cardTexturePixelRatio }).then((created) => {
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
    return setSceneBackground(controller, props.composition.backgroundPlate, {
      width: props.composition.width,
      height: props.composition.height,
      backgroundColor: props.composition.backgroundColor,
    }, paint);
  }, [JSON.stringify(props.composition.backgroundPlate), props.composition.backgroundColor, props.composition.width, props.composition.height, runtimeReady]);

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
    props.time, props.take, props.entranceMotion, props.composition, props.selectedCardId, props.selectedCardIds,
    props.showTransformHandles, props.mode, props.viewMode,
  ]);

  useImperativeHandle(forwardedRef, () => ({
    beginExport(width, height) {
      const controller = controllerRef.current;
      if (!controller) throw new Error("Renderer is not ready");
      beginSceneExport(controller, width, height);
    },
    async renderFrame(time, width, height, options) {
      const controller = controllerRef.current;
      if (!controller) throw new Error("Renderer is not ready");
      const blob = await renderPngBlob(controller, renderInput(time), overviewCameraRef.current, width, height, {
        transparent: options?.transparent,
        omitBackgroundPlate: props.composition.backgroundPlate?.includeInExport === false,
        soloCardIds: options?.soloCardIds,
      });
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
    const isOverview = (current.viewMode ?? "camera") === "overview";
    if (activePointersRef.current.size >= 2 && isOverview) {
      const points = [...activePointersRef.current.values()].slice(0, 2);
      pinchRef.current = {
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
        midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
      };
      dragRef.current = null; overviewPanRef.current = null; marqueeRef.current = null; setMarqueeBox(null); manipulationRef.current = null;
      current.onManipulationStart?.();
      return;
    }
    const point = normalizedCanvasPoint(controller, event.clientX, event.clientY);
    if (current.mode === "record") { gestureRef.current = { start: performance.now(), samples: [{ time: 0, ...point }] }; return; }

    // Overview pan: middle mouse or Alt only — never steal Cmd/Ctrl (multi-select / select-all).
    const wantPan = isOverview && (event.button === 1 || event.altKey);
    if (wantPan) {
      const fieldPoint = fieldPointAt(controller, current.composition, event.clientX, event.clientY);
      if (fieldPoint) overviewPanRef.current = { pointer: fieldPoint, camera: { ...overviewCameraRef.current } };
      return;
    }

    const selected = selectionIds(current);
    // Re-apply layout poses + camera matrices so overview hit-tests match visible cards.
    if (isOverview) {
      renderScene(controller, renderInput(), overviewCameraRef.current);
      selectedHitQuadsRef.current = cardScreenQuads(controller, selected);
    }

    // Always re-sync poses before pick so camera + overview layout match what you see.
    if (!isOverview) {
      renderScene(controller, renderInput(), overviewCameraRef.current);
    }

    // 1) Selected cards first — never start a marquee when grabbing a multi-selection.
    // 2) Screen-space pick (quads + soft center assist for small posts).
    let cardId: string | null = null;
    if (selected.length > 0) {
      cardId = pickPreferredCardAtClient(controller, event.clientX, event.clientY, selected) ?? null;
    }
    if (!cardId) {
      cardId = pickCardAtClient(controller, event.clientX, event.clientY, selected) ?? null;
    }

    // 3) Fall back to cached/live selected screen quads (same geometry as green boxes).
    // Keep pad tight so true blank clicks can deselect.
    if (!cardId && selected.length > 0) {
      const rect = controller.renderer.domElement.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) {
        const px = ((event.clientX - rect.left) / rect.width) * controller.frameWidth;
        const py = ((event.clientY - rect.top) / rect.height) * controller.frameHeight;
        const quads = selectedHitQuadsRef.current.length
          ? selectedHitQuadsRef.current
          : [
              ...(selectionOverlay
                ? [
                    { id: selected[selected.length - 1]!, points: selectionOverlay.points },
                    ...(selectionOverlay.extras ?? []).map((extra, index) => ({
                      id: selected.filter((id) => id !== selected[selected.length - 1])[index] ?? selected[0]!,
                      points: extra.points,
                    })),
                  ]
                : []),
            ];
        let bestId: string | null = null;
        let bestDist = Infinity;
        for (const quad of quads) {
          if (!quad.points.length) continue;
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          let cx = 0;
          let cy = 0;
          for (const point of quad.points) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
            cx += point.x;
            cy += point.y;
          }
          cx /= quad.points.length;
          cy /= quad.points.length;
          const pad = 8;
          if (px < minX - pad || px > maxX + pad || py < minY - pad || py > maxY + pad) continue;
          const dist = Math.hypot(cx - px, cy - py);
          if (dist < bestDist) {
            bestDist = dist;
            bestId = quad.id;
          }
        }
        if (bestId) cardId = bestId;
      }
    }

    const additive = event.shiftKey || event.ctrlKey || event.metaKey;

    if (cardId) {
      const already = selected.includes(cardId);
      if (additive) current.onSelect(cardId, { additive: true });
      else if (!already) current.onSelect(cardId);
      // Multi-select grab: keep full selection; do not collapse to one card.

      current.onManipulationStart?.();
      // Grabbing any already-selected card moves the whole multi-selection.
      const moveIds = !additive && selected.length > 1 && already
        ? [...selected]
        : additive
          ? [...new Set([...selected, cardId])]
          : [cardId];
      const lead = current.mode === "reflow"
        ? current.take.reflowTargets[cardId]
        : current.composition.cards.find((card) => card.cardId === cardId);
      // Always unproject on z=0 so deltas match composition field coordinates used for layout.
      const fieldPoint = fieldPointAt(controller, current.composition, event.clientX, event.clientY, 0)
        ?? (lead ? { x: lead.x, y: lead.y } : null);
      if (!fieldPoint) return;
      const origins = moveIds.flatMap((id) => {
        const base = current.mode === "reflow"
          ? current.take.reflowTargets[id]
          : current.composition.cards.find((card) => card.cardId === id);
        const placement = current.composition.cards.find((card) => card.cardId === id);
        if (!base || placement?.locked) return [];
        return [{ cardId: id, x: base.x, y: base.y }];
      });
      // Even if every card is locked, don't start a marquee over the selection.
      if (!origins.length) return;
      dragRef.current = { leadId: cardId, startField: fieldPoint, origins, z: 0 };
      marqueeRef.current = null;
      setMarqueeBox(null);
      return;
    }

    // Empty space only — never steal clicks meant for selected cards.
    // Do not clear selection on pointerDown; wait for pointerUp so a failed pick
    // can't wipe a multi-select before the user finishes the gesture.
    if (current.mode === "select") {
      const client = { x: event.clientX, y: event.clientY };
      marqueeRef.current = { startClient: client, currentClient: client, additive };
      setMarqueeBox(marqueeBoxFromClients(controller, client, client));
    }
  }

  function flushPendingMoves() {
    const moves = pendingMovesRef.current;
    if (!moves?.length) return;
    pendingMovesRef.current = null;
    const current = latestRef.current;
    if (current.onTransformCards) {
      current.onTransformCards(moves.map(({ cardId, patch }) => ({ cardId, patch })), moves[0].editReflow);
      return;
    }
    for (const move of moves) current.onTransformCard(move.cardId, move.patch, move.editReflow);
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const controller = controllerRef.current;
    if (!controller) return;
    if (gesturePointRef.current !== null) {
      const point = normalizedCanvasPoint(controller, event.clientX, event.clientY);
      latestRef.current.onGestureSampleChange?.(gesturePointRef.current, point);
      return;
    }
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
    if (marqueeRef.current) {
      const client = { x: event.clientX, y: event.clientY };
      marqueeRef.current.currentClient = client;
      setMarqueeBox(marqueeBoxFromClients(controller, marqueeRef.current.startClient, client));
      return;
    }
    if (dragRef.current) {
      // Keep z=0 plane so group deltas stay in composition field space (matches overview layout).
      const fieldPoint = fieldPointAt(controller, latestRef.current.composition, event.clientX, event.clientY, 0);
      if (!fieldPoint) return;
      const bounds = latestRef.current.composition.fieldBounds;
      const minX = 0.5 - bounds.width / 2;
      const maxX = 0.5 + bounds.width / 2;
      const minY = 0.5 - bounds.height / 2;
      const maxY = 0.5 + bounds.height / 2;
      const dx = fieldPoint.x - dragRef.current.startField.x;
      const dy = fieldPoint.y - dragRef.current.startField.y;
      const editReflow = latestRef.current.mode === "reflow";
      pendingMovesRef.current = dragRef.current.origins.map((origin) => ({
        cardId: origin.cardId,
        editReflow,
        patch: {
          x: clamp(origin.x + dx, minX, maxX),
          y: clamp(origin.y + dy, minY, maxY),
        },
      }));
      if (moveFrameRef.current === null) {
        moveFrameRef.current = requestAnimationFrame(() => {
          moveFrameRef.current = null;
          flushPendingMoves();
        });
      }
      return;
    }
    if (overviewPanRef.current) {
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
    moveFrameRef.current = null;
    flushPendingMoves();

    if (marqueeRef.current && controllerRef.current) {
      const box = marqueeRef.current;
      // Re-paint so overview layout poses + camera matrices match what the user sees.
      paint();
      const dragDistance = Math.hypot(
        box.currentClient.x - box.startClient.x,
        box.currentClient.y - box.startClient.y,
      );
      const ids = cardsInMarquee(controllerRef.current, box.startClient, box.currentClient);
      // Blank click (no drag) or empty marquee clears selection when not additive.
      if (ids.length === 0 && !box.additive) {
        latestRef.current.onSelect(null, { ids: [] });
      } else if (ids.length > 0 || box.additive) {
        latestRef.current.onSelect(ids[ids.length - 1] ?? null, { ids, additive: box.additive });
      } else if (dragDistance < 4) {
        // Tiny empty click that somehow still had additive false — deselect.
        latestRef.current.onSelect(null, { ids: [] });
      }
    }

    const hadManipulation = Boolean(dragRef.current || manipulationRef.current || gestureRef.current);
    gestureRef.current = null;
    gesturePointRef.current = null;
    dragRef.current = null;
    overviewPanRef.current = null;
    manipulationRef.current = null;
    marqueeRef.current = null;
    setMarqueeBox(null);
    if (hadManipulation) latestRef.current.onManipulationEnd?.();
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

  function beginGesturePointManipulation(index: number, event: ReactPointerEvent<SVGGElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesturePointRef.current = index;
    latestRef.current.onSelectGestureSample?.(index);
    latestRef.current.onManipulationStart?.();
  }

  return <div ref={mountRef} className={`scene-mount scene-mode-${props.mode}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={wheel}>
    {!runtimeReady && <div className={`runtime-status ${runtimeError ? "is-error" : ""}`} role="status"><strong>{runtimeError ? "WebGPU unavailable" : "Starting WebGPU"}</strong><span>{runtimeError ?? "Requesting a current-generation graphics device..."}</span></div>}
    {fieldOverlay && <svg className="field-map-overlay" aria-hidden="true" width={frameSize.width} height={frameSize.height} viewBox={`0 0 ${frameSize.width} ${frameSize.height}`}>
      <polygon className="field-boundary" points={fieldOverlay.field.map((point) => `${point.x},${point.y}`).join(" ")} />
      {fieldOverlay.protectedRegions.map((region) => <g key={region.id} className="safe-region-vector"><polygon points={region.points.map((point) => `${point.x},${point.y}`).join(" ")} /><text x={region.points[0]?.x ?? 0} y={(region.points[0]?.y ?? 0) + 14}>{region.name}</text></g>)}
      {fieldOverlay.camera.length > 0 && <polygon className="camera-frame-vector" points={fieldOverlay.camera.map((point) => `${point.x},${point.y}`).join(" ")} />}
    </svg>}
    <canvas ref={previewCanvasRef} className="ram-preview-canvas" aria-label="Cached playback preview" style={{ width: frameSize.width, height: frameSize.height }} />
    {props.showGesturePath && props.take.gestureSamples.length > 0 && <GesturePathOverlay samples={props.take.gestureSamples} selectedIndex={props.selectedGestureIndex} time={props.time} width={frameSize.width} height={frameSize.height} onBegin={beginGesturePointManipulation} />}
    {selectionOverlay && <TransformOverlay overlay={selectionOverlay} width={frameSize.width} height={frameSize.height} onBegin={beginHandleManipulation} />}
    <div
      className="frame-overlay-host"
      style={{
        width: frameHostSize.width || frameSize.width,
        height: frameHostSize.height || frameSize.height,
      }}
    >
      {marqueeBox && marqueeBox.width + marqueeBox.height > 2 && (
        <div
          className="selection-marquee"
          style={{ left: marqueeBox.left, top: marqueeBox.top, width: marqueeBox.width, height: marqueeBox.height }}
        />
      )}
    </div>
  </div>;
});
