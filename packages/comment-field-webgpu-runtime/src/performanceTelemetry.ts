export type PerformanceMetric = "sceneRender" | "gpuReadback" | "frameEncode" | "textureRaster";

export interface PerformanceMetricSnapshot {
  samples: number;
  averageMs: number;
  maximumMs: number;
  latestMs: number;
}

export type PerformanceTelemetrySnapshot = Record<PerformanceMetric, PerformanceMetricSnapshot>;

interface MutableMetric {
  samples: number;
  totalMs: number;
  maximumMs: number;
  latestMs: number;
}

export interface PerformanceTelemetryRecorder {
  record(metric: PerformanceMetric, durationMs: number): void;
  snapshot(): PerformanceTelemetrySnapshot;
  reset(): void;
}

const metricNames: PerformanceMetric[] = ["sceneRender", "gpuReadback", "frameEncode", "textureRaster"];
const emptyMetric = (): MutableMetric => ({ samples: 0, totalMs: 0, maximumMs: 0, latestMs: 0 });

export function createPerformanceTelemetry(): PerformanceTelemetryRecorder {
  const metrics = Object.fromEntries(metricNames.map((name) => [name, emptyMetric()])) as Record<PerformanceMetric, MutableMetric>;
  return {
    record(metric, durationMs) {
      const target = metrics[metric];
      target.samples += 1;
      target.totalMs += durationMs;
      target.latestMs = durationMs;
      target.maximumMs = Math.max(target.maximumMs, durationMs);
    },
    snapshot() {
      return Object.fromEntries(metricNames.map((name) => {
        const metric = metrics[name];
        return [name, {
          samples: metric.samples,
          averageMs: metric.samples ? metric.totalMs / metric.samples : 0,
          maximumMs: metric.maximumMs,
          latestMs: metric.latestMs,
        }];
      })) as PerformanceTelemetrySnapshot;
    },
    reset() { for (const name of metricNames) metrics[name] = emptyMetric(); },
  };
}
