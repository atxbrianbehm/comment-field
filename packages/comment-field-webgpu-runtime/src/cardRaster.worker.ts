import type { CardStyle, CommentRecord } from "@comment-field/engine";
import { renderCardSurface } from "./cardTexture";

interface RasterRequest {
  id: number;
  comment: CommentRecord;
  style: CardStyle;
  pixelRatio: number;
}

self.onmessage = (event: MessageEvent<RasterRequest>) => {
  const { id, comment, style, pixelRatio } = event.data;
  try {
    const canvas = new OffscreenCanvas(1, 1);
    renderCardSurface(comment, style, canvas, pixelRatio);
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ id, bitmap, width: canvas.width, height: canvas.height }, { transfer: [bitmap] });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "Card rasterization failed" });
  }
};
