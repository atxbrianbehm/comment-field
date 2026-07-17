interface DecodeRequest { id: number; blob: Blob }

interface DecoderImage { close?: () => void }
interface DecoderResult { image: ImageBitmapSource & DecoderImage }
interface DecoderInstance {
  decode(options?: { frameIndex?: number }): Promise<DecoderResult>;
  close(): void;
}
interface DecoderConstructor {
  new(options: { data: ArrayBuffer; type: string; preferAnimation?: boolean }): DecoderInstance;
}

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const { id, blob } = event.data;
  let bitmap: ImageBitmap | null = null;
  let backend = "bitmap-worker";
  try {
    const Decoder = (self as unknown as { ImageDecoder?: DecoderConstructor }).ImageDecoder;
    if (Decoder) {
      const decoder = new Decoder({ data: await blob.arrayBuffer(), type: blob.type || "image/webp", preferAnimation: false });
      const result = await decoder.decode({ frameIndex: 0 });
      bitmap = await createImageBitmap(result.image);
      result.image.close?.();
      decoder.close();
      backend = "webcodecs-worker";
    } else bitmap = await createImageBitmap(blob);
    self.postMessage({ id, bitmap, backend }, { transfer: [bitmap] });
  } catch (error) {
    bitmap?.close();
    self.postMessage({ id, error: error instanceof Error ? error.message : "Preview decode failed" });
  }
};
