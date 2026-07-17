import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronDown, ChevronUp, Minus, Plus, Sparkles } from "lucide-react";
import { moveKeyframe, snapTime } from "../animation/keyframes";
import type { CameraKeyframe, HeroKeyframe, Take } from "../models/types";

interface KeyframeTimelineProps {
  take: Take;
  frameRate: number;
  time: number;
  previewProgress: number;
  expanded: boolean;
  autoKey: boolean;
  onAutoKeyChange: (enabled: boolean) => void;
  onTimeChange: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onCameraChange: (keyframes: CameraKeyframe[]) => void;
  onHeroChange: (keyframes: HeroKeyframe[]) => void;
}

export function formatTimecode(time: number, frameRate: number) {
  const frame = Math.max(0, Math.round(time * frameRate));
  const frames = frame % frameRate;
  const seconds = Math.floor(frame / frameRate) % 60;
  const minutes = Math.floor(frame / (frameRate * 60)) % 60;
  const hours = Math.floor(frame / (frameRate * 3600));
  return [hours, minutes, seconds, frames].map((value) => String(value).padStart(2, "0")).join(":");
}

export function parseTimecode(value: string, frameRate: number) {
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 1) return snapTime(parts[0], frameRate);
  while (parts.length < 4) parts.unshift(0);
  const [hours, minutes, seconds, frames] = parts.slice(-4);
  return snapTime(hours * 3600 + minutes * 60 + seconds + frames / frameRate, frameRate);
}

export function KeyframeTimeline(props: KeyframeTimelineProps) {
  const { take, frameRate, time, previewProgress, expanded, autoKey } = props;
  const [pixelsPerSecond, setPixelsPerSecond] = useState(90);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [durationText, setDurationText] = useState(() => formatTimecode(take.duration, frameRate));
  useEffect(() => setDurationText(formatTimecode(take.duration, frameRate)), [take.id, take.duration, frameRate]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const heroKeys = take.hero?.keyframes ?? [];
  const latestEvent = Math.max(
    take.duration,
    ...take.cameraKeyframes.map((keyframe) => keyframe.time),
    ...heroKeys.map((keyframe) => keyframe.time),
    ...take.cardTriggers.map((trigger) => trigger.triggerTime),
  );
  const visibleDuration = Math.max(take.duration + 1, latestEvent + 1);
  const contentWidth = Math.max(520, visibleDuration * pixelsPerSecond);
  const ticks = useMemo(() => Array.from({ length: Math.ceil(visibleDuration) + 1 }, (_, index) => index), [visibleDuration]);

  function timeAtPointer(clientX: number) {
    const content = scrollRef.current?.querySelector<HTMLElement>(".dopesheet-content");
    if (!content) return 0;
    return snapTime((clientX - content.getBoundingClientRect().left) / pixelsPerSecond, frameRate);
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

  function commitDuration(value: string) {
    const parsed = parseTimecode(value, frameRate);
    if (parsed !== null) props.onDurationChange(Math.max(1 / frameRate, parsed));
    setDurationText(formatTimecode(parsed ?? take.duration, frameRate));
  }

  return (
    <section className={`dopesheet ${expanded ? "is-expanded" : "is-compact"}`}>
      <header className="dopesheet-toolbar">
        <button className={`auto-key ${autoKey ? "is-active" : ""}`} onClick={() => props.onAutoKeyChange(!autoKey)} aria-pressed={autoKey}><i />Auto-key</button>
        <label className="duration-timecode"><span>Out</span><input value={durationText} onFocus={() => setDurationText(formatTimecode(take.duration, frameRate))} onChange={(event) => setDurationText(event.target.value)} onBlur={(event) => commitDuration(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
        <label className="duration-seconds"><span>Seconds</span><input type="number" min={1 / frameRate} step={1 / frameRate} value={take.duration} onChange={(event) => props.onDurationChange(Number(event.target.value))} /></label>
        <div className="timeline-zoom"><button onClick={() => setPixelsPerSecond((value) => Math.max(40, value - 20))} aria-label="Zoom timeline out"><Minus size={14} /></button><span>{pixelsPerSecond}px/s</span><button onClick={() => setPixelsPerSecond((value) => Math.min(220, value + 20))} aria-label="Zoom timeline in"><Plus size={14} /></button></div>
        <span className="timeline-expand-label">{expanded ? <><ChevronDown size={14} />Camera + Hero</> : <><ChevronUp size={14} />Open Animate for tracks</>}</span>
      </header>
      <div className="dopesheet-body">
        {expanded && <div className="dopesheet-labels"><div className="ruler-label">Tracks</div><div><Camera size={14} />Camera</div><div><Sparkles size={14} />Hero</div></div>}
        <div className="dopesheet-scroll" ref={scrollRef}>
          <div className="dopesheet-content" style={{ width: contentWidth }} onPointerDown={(event) => dragTime(event, props.onTimeChange)}>
            <div className="dopesheet-ruler">{ticks.map((tick) => <span key={tick} style={{ left: tick * pixelsPerSecond }}><i />{tick}s</span>)}</div>
            <div className="preview-cache-fill" style={{ width: `${take.duration * pixelsPerSecond * previewProgress}px` }} />
            <div className="shot-overflow" style={{ left: take.duration * pixelsPerSecond, width: Math.max(0, contentWidth - take.duration * pixelsPerSecond) }} />
            {expanded && <>
              <div className="dopesheet-row camera-row">{take.cameraKeyframes.map((keyframe) => <button key={keyframe.id} className={`key-diamond ${selectedId === keyframe.id ? "is-selected" : ""} ${keyframe.time > take.duration ? "is-overflow" : ""}`} style={{ left: keyframe.time * pixelsPerSecond }} onPointerDown={(event) => dragKey(event, "camera", keyframe.id)} onClick={() => props.onTimeChange(keyframe.time)} aria-label={`Camera key at ${formatTimecode(keyframe.time, frameRate)}`} />)}</div>
              <div className="dopesheet-row hero-row">{heroKeys.map((keyframe) => <button key={keyframe.id} className={`key-diamond ${keyframe.value.kind === "source" ? "is-source" : ""} ${selectedId === keyframe.id ? "is-selected" : ""} ${keyframe.time > take.duration ? "is-overflow" : ""}`} style={{ left: keyframe.time * pixelsPerSecond }} onPointerDown={(event) => dragKey(event, "hero", keyframe.id)} onClick={() => props.onTimeChange(keyframe.time)} aria-label={`Hero key at ${formatTimecode(keyframe.time, frameRate)}`} />)}</div>
            </>}
            <div className="timeline-playhead" style={{ left: Math.min(time, visibleDuration) * pixelsPerSecond }}><i /></div>
            <button className="shot-outpoint" style={{ left: take.duration * pixelsPerSecond }} onPointerDown={(event) => dragTime(event, (next) => props.onDurationChange(Math.max(1 / frameRate, next)))} aria-label="Drag shot out point"><i /></button>
          </div>
        </div>
      </div>
    </section>
  );
}
