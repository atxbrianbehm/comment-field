import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronDown, ChevronUp, CircleDot, Minus, Plus, Sparkles } from "lucide-react";
import { moveKeyframe, snapTime, type CameraKeyframe, type GestureSample, type HeroKeyframe, type Take } from "@comment-field/engine";

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

export function KeyframeTimeline(props: KeyframeTimelineProps) {
  const { take, frameRate, time, previewProgress, expanded, autoKey } = props;
  const [pixelsPerFrame, setPixelsPerFrame] = useState(4);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [durationFramesText, setDurationFramesText] = useState(() => String(timeToFrame(take.duration, frameRate)));
  useEffect(() => setDurationFramesText(String(timeToFrame(take.duration, frameRate))), [take.id, take.duration, frameRate]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const heroKeys = take.hero?.keyframes ?? [];
  const latestEvent = Math.max(
    take.duration,
    ...take.cameraKeyframes.map((keyframe) => keyframe.time),
    ...heroKeys.map((keyframe) => keyframe.time),
    ...take.gestureSamples.map((sample) => sample.time),
    ...take.cardTriggers.map((trigger) => trigger.triggerTime),
  );
  const totalFrames = Math.max(1, timeToFrame(Math.max(take.duration + 1 / frameRate, latestEvent + 1 / frameRate), frameRate));
  const durationFrames = timeToFrame(take.duration, frameRate);
  const contentWidth = Math.max(520, totalFrames * pixelsPerFrame);
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

  function dragTime(event: React.PointerEvent, update: (time: number) => void) {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const move = (clientX: number) => update(timeAtPointer(clientX));
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

  function dragKey(event: React.PointerEvent, kind: "camera" | "hero", id: string) {
    event.stopPropagation();
    setSelectedId(id);
    dragTime(event, (nextTime) => {
      if (kind === "camera") props.onCameraChange(moveKeyframe(take.cameraKeyframes, id, nextTime, frameRate));
      else props.onHeroChange(moveKeyframe(heroKeys, id, nextTime, frameRate));
      props.onTimeChange(nextTime);
    });
  }

  function dragGesturePoint(event: React.PointerEvent, index: number) {
    event.stopPropagation();
    props.onGestureSelect(index);
    dragTime(event, (nextTime) => {
      props.onGestureChange(index, { time: nextTime });
      props.onTimeChange(nextTime);
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
        <span className="timeline-expand-label">{expanded ? <><ChevronDown size={14} />Camera + Hero</> : <><ChevronUp size={14} />Open Animate for tracks</>}</span>
      </header>
      <div className="dopesheet-body">
        {expanded && <div className="dopesheet-labels"><div className="ruler-label">Tracks</div><div><Camera size={14} />Camera</div><div><Sparkles size={14} />Hero</div><div><CircleDot size={14} />Build path</div></div>}
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
            {!expanded && take.gestureSamples.map((sample, index) => <button key={`${index}-${sample.time}`} className={`gesture-key-marker ${props.selectedGestureIndex === index ? "is-selected" : ""}`} style={{ left: leftForTime(sample.time) }} onPointerDown={(event) => dragGesturePoint(event, index)} onClick={() => { props.onGestureSelect(index); props.onTimeChange(sample.time); }} aria-label={`Build path point ${index + 1} at frame ${timeToFrame(sample.time, frameRate)}`} />)}
            <div className="timeline-playhead" style={{ left: leftForTime(Math.min(time, take.duration + 1)) }}><i /></div>
            <button className="shot-outpoint" style={{ left: leftForTime(take.duration) }} onPointerDown={(event) => dragTime(event, (next) => props.onDurationChange(Math.max(1 / frameRate, next)))} aria-label="Drag shot out point"><i /></button>
          </div>
        </div>
      </div>
    </section>
  );
}
