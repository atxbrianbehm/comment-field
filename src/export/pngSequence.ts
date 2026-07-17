import { zipSync } from "fflate";

export interface ExportProgress {
  frame: number;
  total: number;
}

export async function exportPngSequence(
  renderFrame: (time: number, width: number, height: number) => Promise<Blob>,
  settings: { width: number; height: number; frameRate: number; duration: number; prefix: string },
  onProgress: (progress: ExportProgress) => void,
) {
  const total = Math.max(1, Math.round(settings.duration * settings.frameRate));
  const files: Record<string, Uint8Array> = {};
  for (let frame = 0; frame < total; frame += 1) {
    const blob = await renderFrame(frame / settings.frameRate, settings.width, settings.height);
    const name = `${settings.prefix}_${String(frame + 1).padStart(6, "0")}.png`;
    files[name] = new Uint8Array(await blob.arrayBuffer());
    onProgress({ frame: frame + 1, total });
    if (frame % 4 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: "application/zip" });
}
