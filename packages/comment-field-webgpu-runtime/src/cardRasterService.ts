import type { CardStyle, CommentRecord } from "@comment-field/engine";
import { renderCardCanvas } from "./cardTexture";

export interface RasterizedCard {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose(): void;
}

interface RasterResponse {
  id: number;
  bitmap?: ImageBitmap;
  width?: number;
  height?: number;
  error?: string;
}

interface PendingRaster {
  resolve: (value: RasterizedCard) => void;
  reject: (error: Error) => void;
}

export class CardRasterService {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRaster>();

  constructor() {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return;
    this.worker = new Worker(new URL("./cardRaster.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<RasterResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) { response.bitmap?.close(); return; }
      this.pending.delete(response.id);
      if (response.error || !response.bitmap) pending.reject(new Error(response.error ?? "Card rasterization failed"));
      else pending.resolve({
        source: response.bitmap,
        width: response.width ?? response.bitmap.width,
        height: response.height ?? response.bitmap.height,
        dispose: () => response.bitmap?.close(),
      });
    };
    this.worker.onerror = () => this.rejectPending("Card raster worker failed");
  }

  async rasterize(comment: CommentRecord, style: CardStyle, pixelRatio: number): Promise<RasterizedCard> {
    if (!this.worker) {
      const canvas = renderCardCanvas(comment, style, pixelRatio);
      return { source: canvas, width: canvas.width, height: canvas.height, dispose: () => undefined };
    }
    const id = this.nextId++;
    return new Promise<RasterizedCard>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, comment, style, pixelRatio });
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.rejectPending("Card raster service disposed");
  }

  private rejectPending(message: string) {
    for (const request of this.pending.values()) request.reject(new Error(message));
    this.pending.clear();
  }
}
