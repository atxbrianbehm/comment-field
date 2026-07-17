import { Cpu, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

type WebGpuNavigator = Navigator & {
  gpu?: { requestAdapter(options?: { powerPreference?: "low-power" | "high-performance" }): Promise<unknown | null> };
};

export function WebGpuGate({ children }: { children: React.ReactNode }) {
  const surfaceProof = import.meta.env.DEV && new URLSearchParams(window.location.search).has("surface-proof");
  const [state, setState] = useState<"checking" | "ready" | "unsupported">(surfaceProof ? "ready" : "checking");

  useEffect(() => {
    if (surfaceProof) return;
    let cancelled = false;
    const check = async () => {
      const gpu = (navigator as WebGpuNavigator).gpu;
      if (!gpu) { if (!cancelled) setState("unsupported"); return; }
      try {
        const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!cancelled) setState(adapter ? "ready" : "unsupported");
      } catch {
        if (!cancelled) setState("unsupported");
      }
    };
    void check();
    return () => { cancelled = true; };
  }, [surfaceProof]);

  if (state === "ready") return children;
  return <main className="webgpu-gate">
    <section className="webgpu-gate-card" aria-live="polite">
      <div className="webgpu-gate-icon"><Cpu size={28} /></div>
      <span>Comment Field runtime</span>
      <h1>{state === "checking" ? "Starting WebGPU" : "WebGPU is required"}</h1>
      <p>{state === "checking"
        ? "Checking for a current-generation graphics adapter…"
        : "Open this project in an up-to-date Chrome or Edge browser with hardware acceleration enabled. Comment Field does not silently fall back to WebGL."}</p>
      {state === "unsupported" && <button type="button" onClick={() => window.location.reload()}><RefreshCw size={16} />Check again</button>}
    </section>
  </main>;
}
