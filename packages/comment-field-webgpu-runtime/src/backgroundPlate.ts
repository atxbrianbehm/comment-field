import * as THREE from "three";
import type { BackgroundPlate, Composition } from "@comment-field/engine";

export interface BackgroundPlateRuntime {
  plate: BackgroundPlate;
  composition: Pick<Composition, "width" | "height" | "backgroundColor">;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  image: HTMLImageElement | null;
  video: HTMLVideoElement | null;
  requestedTime: number;
  dispose: () => void;
}

interface BackgroundPlateController {
  scene: THREE.Scene;
  backgroundPlate: BackgroundPlateRuntime | null;
}

export function resolveBackgroundPlateDrawRect(
  frameWidth: number,
  frameHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  fit: BackgroundPlate["fit"],
) {
  if (fit === "stretch") return { x: 0, y: 0, width: frameWidth, height: frameHeight };
  const scale = fit === "contain"
    ? Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight)
    : Math.max(frameWidth / sourceWidth, frameHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height };
}

function drawBackgroundPlate(runtime: BackgroundPlateRuntime) {
  const { canvas, context, composition, plate } = runtime;
  context.globalAlpha = 1;
  context.fillStyle = composition.backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const source = runtime.video ?? runtime.image;
  const sourceWidth = runtime.video?.videoWidth ?? runtime.image?.naturalWidth ?? 0;
  const sourceHeight = runtime.video?.videoHeight ?? runtime.image?.naturalHeight ?? 0;
  if (!source || sourceWidth < 1 || sourceHeight < 1) {
    runtime.texture.needsUpdate = true;
    return;
  }
  const rect = resolveBackgroundPlateDrawRect(canvas.width, canvas.height, sourceWidth, sourceHeight, plate.fit);
  context.globalAlpha = Math.min(1, Math.max(0, plate.opacity));
  context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
  context.globalAlpha = 1;
  runtime.texture.needsUpdate = true;
}

function normalizedVideoTime(video: HTMLVideoElement, time: number) {
  const safeTime = Math.max(0, Number.isFinite(time) ? time : 0);
  return Number.isFinite(video.duration) && video.duration > 0 ? safeTime % video.duration : safeTime;
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: "loadedmetadata" | "seeked") {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      video.removeEventListener(eventName, finish);
      video.removeEventListener("error", finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, 4000);
    video.addEventListener(eventName, finish, { once: true });
    video.addEventListener("error", finish, { once: true });
  });
}

export function syncSceneBackgroundTime(controller: BackgroundPlateController, time: number) {
  const runtime = controller.backgroundPlate;
  const video = runtime?.video;
  if (!runtime || !video) return;
  runtime.requestedTime = time;
  if (video.readyState < HTMLMediaElement.HAVE_METADATA || video.seeking) return;
  const target = normalizedVideoTime(video, time);
  if (Math.abs(video.currentTime - target) > 1 / 120) video.currentTime = target;
  else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) drawBackgroundPlate(runtime);
}

export async function seekSceneBackground(controller: BackgroundPlateController, time: number) {
  const runtime = controller.backgroundPlate;
  const video = runtime?.video;
  if (!runtime || !video) return;
  runtime.requestedTime = time;
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) await waitForVideoEvent(video, "loadedmetadata");
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
  if (video.seeking) await waitForVideoEvent(video, "seeked");
  const target = normalizedVideoTime(video, time);
  if (Math.abs(video.currentTime - target) > 0.001) {
    const sought = waitForVideoEvent(video, "seeked");
    video.currentTime = target;
    await sought;
  }
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) drawBackgroundPlate(runtime);
}

export function setSceneBackground(
  controller: BackgroundPlateController,
  plate: BackgroundPlate | undefined,
  composition: Pick<Composition, "width" | "height" | "backgroundColor">,
  onReady: () => void,
) {
  controller.backgroundPlate?.dispose();
  controller.backgroundPlate = null;
  controller.scene.background = null;
  if (!plate?.visible || !plate.source) {
    onReady();
    return () => undefined;
  }

  const renderScale = Math.min(1, 1920 / Math.max(composition.width, composition.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(composition.width * renderScale));
  canvas.height = Math.max(1, Math.round(composition.height * renderScale));
  const context = canvas.getContext("2d");
  if (!context) {
    onReady();
    return () => undefined;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  let disposed = false;
  let image: HTMLImageElement | null = null;
  let video: HTMLVideoElement | null = null;
  const cleanups: Array<() => void> = [];
  const runtime: BackgroundPlateRuntime = {
    plate,
    composition,
    canvas,
    context,
    texture,
    image,
    video,
    requestedTime: 0,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      if (controller.scene.background === texture) controller.scene.background = null;
      texture.dispose();
      if (controller.backgroundPlate === runtime) controller.backgroundPlate = null;
    },
  };
  controller.backgroundPlate = runtime;
  controller.scene.background = texture;
  drawBackgroundPlate(runtime);

  if (plate.mediaType === "video") {
    video = document.createElement("video");
    runtime.video = video;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.disablePictureInPicture = true;
    const redraw = () => {
      if (disposed) return;
      drawBackgroundPlate(runtime);
      onReady();
    };
    video.addEventListener("loadeddata", redraw);
    video.addEventListener("seeked", redraw);
    video.addEventListener("error", redraw);
    cleanups.push(() => {
      video?.removeEventListener("loadeddata", redraw);
      video?.removeEventListener("seeked", redraw);
      video?.removeEventListener("error", redraw);
    });
    video.src = plate.source;
    video.load();
  } else {
    image = new Image();
    runtime.image = image;
    const loaded = () => {
      if (disposed) return;
      drawBackgroundPlate(runtime);
      onReady();
    };
    image.addEventListener("load", loaded);
    image.addEventListener("error", loaded);
    cleanups.push(() => {
      image?.removeEventListener("load", loaded);
      image?.removeEventListener("error", loaded);
    });
    image.src = plate.source;
  }

  return runtime.dispose;
}
