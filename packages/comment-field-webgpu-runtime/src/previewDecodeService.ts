interface DecodeResponse { id: number; bitmap?: ImageBitmap; backend?: string; error?: string }
interface PendingDecode { resolve: (bitmap: ImageBitmap) => void; reject: (error: Error) => void }

export class PreviewDecodeService {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingDecode>();
  backend = "main-thread";

  constructor() {
    if (typeof Worker === "undefined" || typeof createImageBitmap !== "function") return;
    this.worker = new Worker(new URL("./previewDecode.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) { response.bitmap?.close(); return; }
      this.pending.delete(response.id);
      if (response.error || !response.bitmap) pending.reject(new Error(response.error ?? "Preview decode failed"));
      else { this.backend = response.backend ?? "bitmap-worker"; pending.resolve(response.bitmap); }
    };
    this.worker.onerror = () => this.rejectPending("Preview decode worker failed");
  }

  async decode(blob: Blob) {
    if (!this.worker) return createImageBitmap(blob);
    const id = this.nextId++;
    try {
      return await new Promise<ImageBitmap>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.worker!.postMessage({ id, blob });
      });
    } catch {
      this.backend = "main-thread";
      return createImageBitmap(blob);
    }
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.rejectPending("Preview decoder disposed");
  }

  private rejectPending(message: string) {
    for (const request of this.pending.values()) request.reject(new Error(message));
    this.pending.clear();
  }
}
