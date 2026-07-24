import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronDown, ChevronUp, CircleDot, Minus, Plus, Sparkles, Zap } from "lucide-react";
import {
  EVEN_ARRIVAL_EASING,
  invertBezierCurve,
  moveKeyframe,
  snapTime,
  type CameraKeyframe,
  type CardPopulationSettings,
  type GestureSample,
  type HeroKeyframe,
  type Take,
} from "@comment-field/engine";

interface KeyframeTimelineProps {
  take: Take;
  frameRate: number;
  time: number;
  previewProgress: number;
  expanded: boolean;
  autoKey: boolean;
  selectedGestureIndex: number | null;
  onGestureSelect: (index: number | null) => void;
  onGestureChange: (index: number, patch: Partial<GestureSample>) => void;
  onAutoKeyChange: (enabled: boolean) => void;
  onTimeChange: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onCameraChange: (keyframes: CameraKeyframe[]) => void;
  onHeroChange: (keyframes: HeroKeyframe[]) => void;
  onPopulationChange: (patch: Partial<CardPopulationSettings>) => void;
}

/** Absolute frame index from time (seconds), rounded to the nearest frame. */
export function timeToFrame(time: number, frameRate: number) {
  return Math.max(0, Math.round(time * frameRate));
}

/** Seconds from a frame index. */
export function frameToTime(frame: number, frameRate: number) {
  return snapTime(Math.max(0, frame) / Math.max(1, frameRate), frameRate);
}

/** Primary authoring display: frame number. */
export function formatFrame(time: number, frameRate: number) {
  return `${timeToFrame(time, frameRate)}f`;
}

/** Compact playhead display: current / total frames. */
export function formatFrameRange(time: number, duration: number, frameRate: number) {
  return `${timeToFrame(time, frameRate)} / ${timeToFrame(duration, frameRate)}f`;
}

/** Legacy SMPTE-style string (kept for paste/parse of older values). */
export function formatTimecode(time: number, frameRate: number) {
  const frame = timeToFrame(time, frameRate);
  const frames = frame % frameRate;
  const seconds = Math.floor(frame / frameRate) % 60;
  const minutes = Math.floor(frame / (frameRate * 60)) % 60;
  const hours = Math.floor(frame / (frameRate * 3600));
  return [hours, minutes, seconds, frames].map((value) => String(value).padStart(2, "0")).join(":");
}

export function parseTimecode(value: string, frameRate: number) {
  const trimmed = value.trim().toLowerCase().replace(/f$/, "");
  if (/^\d+$/.test(trimmed)) return frameToTime(Number(trimmed), frameRate);
  const parts = trimmed.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 1) return frameToTime(parts[0], frameRate);
  while (parts.length < 4) parts.unshift(0);
  const [hours, minutes, seconds, frames] = parts.slice(-4);
  return snapTime(hours * 3600 + minutes * 60 + seconds + frames / frameRate, frameRate);
}

function frameTickStep(frameRate: number, pixelsPerFrame: number) {
  const candidates = [1, 2, 5, 10, Math.round(frameRate / 4), Math.round(frameRate / 2), frameRate, frameRate * 2, frameRate * 5];
  const minPx = 48;
  for (const step of candidates) {
    if (step > 0 && step * pixelsPerFrame >= minPx) return step;
  }
  return frameRate;
}

function durationToWidth(duration: number, frameRate: number, pixelsPerFrame: number) {
  return Math.max(pixelsPerFrame, timeToFrame(Math.max(0, duration), frameRate) * pixelsPerFrame);
}

export function KeyframeTimeline(props: KeyframeTimelineProps) {
  const { take, frameRate, time, previewProgress, expanded, autoKey } = props;
  const [pixelsPerFrame, setPixelsPerFrame] = useState(4);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [durationFramesText, setDurationFramesText] = useState(() => String(timeToFrame(take.duration, frameRate)));
  useEffect(() => setDurationFramesText(String(timeToFrame(take.duration, frameRate))), [take.id, take.duration, frameRate]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const heroKeys = take.hero?.keyframes ?? [];
  const burstEnabled = take.population.enabled && take.population.postHeroBurst > 0;
  const rawBurstStart = Number.isFinite(take.population.postHeroBurstStartTime)
    ? take.population.postHeroBurstStartTime
    : Math.max(0, take.duration - 2);
  // Keep the burst cue drawable inside the shot even if an old value was past Out.
  const burstStart = Math.max(0, Math.min(take.duration, rawBurstStart));
  const burstDuration = Math.max(1 / frameRate, take.population.postHeroBurstDuration || 0);
  const burstEnd = Math.min(take.duration, burstStart + burstDuration);
  const burstEasing = take.population.postHeroBurstEasing ?? EVEN_ARRIVAL_EASING;
  const burstDensity = useMemo(() => {
    const amount = Math.max(0, Math.min(1, take.population.postHeroBurst || 0));
    const count = Math.max(1, Math.round(28 * Math.max(0.15, amount)));
    return Array.from({ length: count }, (_, index) => (
      invertBezierCurve(burstEasing, (index + 0.5) / Math.max(1, count))
    ));
  }, [take.population.postHeroBurst, burstEasing]);
  // Timeline length IS the shot. One extra frame keeps the Out handle grabbable.
  // Never expand from keys/triggers — that created multi-hundred-frame empty scrub ranges.
  const durationFrames = Math.max(1, timeToFrame(take.duration, frameRate));
  const totalFrames = durationFrames + 1;
  const contentWidth = Math.max(320, totalFrames * pixelsPerFrame);
  const maxScrubTime = take.duration;
  const tickStep = frameTickStep(frameRate, pixelsPerFrame);
  const ticks = useMemo(
    () => Array.from({ length: Math.floor(totalFrames / tickStep) + 1 }, (_, index) => index * tickStep),
    [totalFrames, tickStep],
  );

  function timeAtPointer(clientX: number) {
    const content = scrollRef.current?.querySelector<HTMLElement>(".dopesheet-content");
    if (!content) return 0;
    const frame = Math.max(0, (clientX - content.getBoundingClientRect().left) / pixelsPerFrame);
    return frameToTime(Math.round(frame), frameRate);
  }

  function dragTime(event: React.PointerEvent, update: (time: number) => void, options?: { clampToShot?: boolean; maxTime?: number }) {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const clampToShot = options?.clampToShot !== false;
    const ceiling = options?.maxTime ?? maxScrubTime;
    const move = (clientX: number) => {
      const raw = timeAtPointer(clientX);
      update(clampToShot ? Math.max(0, Math.min(ceiling, raw)) : Math.max(0, raw));
    };
    move(event.clientX);
    const onMove = (moveEvent: PointerEvent) => move(moveEvent.clientX);
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  function clampShotTime(nextTime: number) {
    return Math.max(0, Math.min(maxScrubTime, nextTime));
  }

  function dragKey(event: React.PointerEvent, kind: "camera" | "hero", id: string) {
    event.stopPropagation();
    setSelectedId(id);
    dragTime(event, (nextTime) => {
      const time = clampShotTime(nextTime);
      if (kind === "camera") props.onCameraChange(moveKeyframe(take.cameraKeyframes, id, time, frameRate));
      else props.onHeroChange(moveKeyframe(heroKeys, id, time, frameRate));
      props.onTimeChange(time);
    });
  }

  function dragGesturePoint(event: React.PointerEvent, index: number) {
    event.stopPropagation();
    props.onGestureSelect(index);
    dragTime(event, (nextTime) => {
      const time = clampShotTime(nextTime);
      props.onGestureChange(index, { time });
      props.onTimeChange(time);
    });
  }

  function dragBurstStart(event: React.PointerEvent) {
    event.stopPropagation();
    setSelectedId("burst-start");
    dragTime(event, (nextTime) => {
      const time = clampShotTime(nextTime);
      props.onPopulationChange({ postHeroBurstStartTime: time });
      props.onTimeChange(time);
    });
  }

  function dragBurstEnd(event: React.PointerEvent) {
    event.stopPropagation();
    setSelectedId("burst-end");
    dragTime(event, (nextTime) => {
      // Window end can sit on Out; keep start fixed and size the arrival span inside the shot.
      const end = clampShotTime(Math.max(burstStart + 1 / frameRate, nextTime));
      const duration = Math.max(1 / frameRate, end - burstStart);
      props.onPopulationChange({ postHeroBurstDuration: snapTime(duration, frameRate) });
      props.onTimeChange(end);
    });
  }

  function commitDurationFrames(value: string) {
    const parsed = parseTimecode(value, frameRate);
    if (parsed !== null) props.onDurationChange(Math.max(1 / frameRate, parsed));
    setDurationFramesText(String(timeToFrame(parsed ?? take.duration, frameRate)));
  }

  function leftForTime(value: number) {
    return timeToFrame(value, frameRate) * pixelsPerFrame;
  }

  const burstWindowStyle = {
    left: leftForTime(burstStart),
    width: durationToWidth(burstDuration, frameRate, pixelsPerFrame),
  };
  const burstStartLeft = leftForTime(burstStart);
  const burstEndLeft = leftForTime(burstEnd);
  const burstOverflow = burstStart > take.duration;

  return (
    <section className={`dopesheet ${expanded ? "is-expanded" : "is-compact"}`}>
      <header className="dopesheet-toolbar">
        <button className={`auto-key ${autoKey ? "is-active" : ""}`} onClick={() => props.onAutoKeyChange(!autoKey)} aria-pressed={autoKey}><i />Auto-key</button>
        <label className="duration-timecode">
          <span>Out</span>
          <input
            value={durationFramesText}
            onFocus={() => setDurationFramesText(String(durationFrames))}
            onChange={(event) => setDurationFramesText(event.target.value)}
            onBlur={(event) => commitDurationFrames(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            aria-label="Take length in frames"
          />
        </label>
        <label className="duration-seconds">
          <span>Frames</span>
          <input
            type="number"
            min={1}
            step={1}
            value={durationFrames}
            onChange={(event) => props.onDurationChange(frameToTime(Math.max(1, Math.round(Number(event.target.value))), frameRate))}
          />
        </label>
        <div className="timeline-zoom">
          <button onClick={() => setPixelsPerFrame((value) => Math.max(1, value - 1))} aria-label="Zoom timeline out"><Minus size={14} /></button>
          <span>{pixelsPerFrame}px/f</span>
          <button onClick={() => setPixelsPerFrame((value) => Math.min(24, value + 1))} aria-label="Zoom timeline in"><Plus size={14} /></button>
        </div>
        <span className="timeline-expand-label">{expanded ? <><ChevronDown size={14} />Animation tracks</> : <><ChevronUp size={14} />Open Animate for tracks</>}</span>
      </header>
      <div className="dopesheet-body">
        {expanded ? (
          <div className="dopesheet-labels">
            <div className="ruler-label">Tracks</div>
            <div><Camera size={14} />Camera</div>
            <div><Sparkles size={14} />Hero</div>
            <div><CircleDot size={14} />Build path</div>
            <div className={burstEnabled ? "" : "is-muted"}><Zap size={14} />Final burst</div>
          </div>
        ) : (
          <div className="dopesheet-labels dopesheet-labels-compact">
            <div className="ruler-label">Time</div>
            <div className={burstEnabled ? "" : "is-muted"}><Zap size={14} />Burst</div>
          </div>
        )}
        <div className="dopesheet-scroll" ref={scrollRef}>
          <div className="dopesheet-content" style={{ width: contentWidth }} onPointerDown={(event) => dragTime(event, props.onTimeChange)}>
            <div className="dopesheet-ruler">
              {ticks.map((frame) => (
                <span key={frame} style={{ left: frame * pixelsPerFrame }}><i />{frame}f</span>
              ))}
            </div>
            <div className="preview-cache-fill" style={{ width: `${durationFrames * pixelsPerFrame * previewProgress}px` }} />
            <div className="shot-overflow" style={{ left: durationFrames * pixelsPerFrame, width: Math.max(0, contentWidth - durationFrames * pixelsPerFrame) }} />
            {expanded && <>
              <div className="dopesheet-row camera-row">{take.cameraKeyframes.map((keyframe) => <button key={keyframe.id} className={`key-diamond ${selectedId === keyframe.id ? "is-selected" : ""} ${keyframe.time > take.duration ? "is-overflow" : ""}`} style={{ left: leftForTime(keyframe.time) }} onPointerDown={(event) => dragKey(event, "camera", keyframe.id)} onClick={() => props.onTimeChange(keyframe.time)} aria-label={`Camera key at frame ${timeToFrame(keyframe.time, frameRate)}`} />)}</div>
              <div className="dopesheet-row hero-row">{heroKeys.map((keyframe) => <button key={keyframe.id} className={`key-diamond ${keyframe.value.kind === "source" ? "is-source" : ""} ${selectedId === keyframe.id ? "is-selected" : ""} ${keyframe.time > take.duration ? "is-overflow" : ""}`} style={{ left: leftForTime(keyframe.time) }} onPointerDown={(event) => dragKey(event, "hero", keyframe.id)} onClick={() => props.onTimeChange(keyframe.time)} aria-label={`Hero key at frame ${timeToFrame(keyframe.time, frameRate)}`} />)}</div>
              <div className="dopesheet-row gesture-row">{take.gestureSamples.map((sample, index) => <button key={`${index}-${sample.time}`} className={`key-diamond gesture-key ${props.selectedGestureIndex === index ? "is-selected" : ""} ${sample.time > take.duration ? "is-overflow" : ""}`} style={{ left: leftForTime(sample.time) }} onPointerDown={(event) => dragGesturePoint(event, index)} onClick={() => { props.onGestureSelect(index); props.onTimeChange(sample.time); }} aria-label={`Build path point ${index + 1} at frame ${timeToFrame(sample.time, frameRate)}`} />)}</div>
            </>}
            {/* Burst track is always visible (compact or expanded) so the start key is never buried. */}
            <div className={`dopesheet-row burst-row ${expanded ? "burst-row-expanded" : "burst-row-compact"} ${burstEnabled ? "" : "is-disabled"}`}>
              <div className="burst-window" style={burstWindowStyle}>
                {burstDensity.map((position, index) => <i key={index} style={{ left: `${position * 100}%` }} />)}
              </div>
              <button
                type="button"
                className={`key-diamond burst-key ${selectedId === "burst-start" ? "is-selected" : ""} ${burstOverflow ? "is-overflow" : ""}`}
                style={{ left: burstStartLeft }}
                onPointerDown={dragBurstStart}
                onClick={() => props.onTimeChange(burstStart)}
                aria-label={`Final burst start at frame ${timeToFrame(burstStart, frameRate)}`}
                title={`Burst start · ${timeToFrame(burstStart, frameRate)}f`}
              />
              <button
                type="button"
                className={`burst-end-handle ${selectedId === "burst-end" ? "is-selected" : ""}`}
                style={{ left: burstEndLeft }}
                onPointerDown={dragBurstEnd}
                onClick={() => props.onTimeChange(burstEnd)}
                aria-label={`Burst arrival window ends at frame ${timeToFrame(burstEnd, frameRate)}`}
                title={`Arrival window end · ${timeToFrame(burstEnd, frameRate)}f`}
              ><i /></button>
            </div>
            {!expanded && take.gestureSamples.map((sample, index) => (
              <button
                key={`${index}-${sample.time}`}
                type="button"
                className={`gesture-key-marker ${props.selectedGestureIndex === index ? "is-selected" : ""}`}
                style={{ left: leftForTime(sample.time) }}
                onPointerDown={(event) => dragGesturePoint(event, index)}
                onClick={() => { props.onGestureSelect(index); props.onTimeChange(sample.time); }}
                aria-label={`Build path point ${index + 1} at frame ${timeToFrame(sample.time, frameRate)}`}
              />
            ))}
            <div className="timeline-playhead" style={{ left: leftForTime(Math.min(time, take.duration)) }}><i /></div>
            <button
              type="button"
              className="shot-outpoint"
              style={{ left: leftForTime(take.duration) }}
              onPointerDown={(event) => dragTime(event, (next) => props.onDurationChange(Math.max(1 / frameRate, next)), {
                // Out may extend the shot; allow dragging past the current end of the ruler.
                clampToShot: false,
                maxTime: Math.max(take.duration * 2, 30),
              })}
              aria-label="Drag shot out point"
            ><i /></button>
          </div>
        </div>
      </div>
    </section>
  );
}
