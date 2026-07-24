import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, Copy, Pause, Play, Plus, RotateCcw, SkipBack, SkipForward, Trash2 } from "lucide-react";
import {
  cameraFrameInField,
  compositionWorldDimensions,
  DEFAULT_CAMERA_EASING,
  evaluateCamera,
  evaluateEntranceComponents,
  fieldPointToWorld,
  findKeyframeAt,
  heroStartTime,
  projectWorldPoint,
  snapTime,
  sortedHeroKeyframes,
  sortKeyframes,
  upsertCameraKeyframe,
  upsertKeyframe,
  type CameraKeyframe,
  type CameraPose,
  type CardStyle,
  type CommentRecord,
  type Composition,
  type EntranceMotionTemplate,
  type HeroKeyframe,
  type HeroPerformance,
  type Point2D,
  type RenderSettings,
  type Take,
} from "@comment-field/engine";
import { CommentScene, type CacheStatus, type CommentSceneHandle, type TransformPatch } from "../renderer/CommentScene";
import { CardPreview } from "./CardPreview";
import { BezierOverlay, CurveEditor } from "./MotionEditors";
import { DEFAULT_ENTRANCE_VIEWPORT, editorPointToMotion, frameEntrancePath, motionPointToEditor } from "./motionViewport";
import { Field, PanelSection, SelectField, Slider } from "./Controls";

function styleToggle(label: string, checked: boolean, onChange: (value: boolean) => void) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

export function DesignWorkspace({
  comment,
  style,
  renderSettings,
  onStyleChange,
  onSceneShadowChange,
  onCardLightingChange,
  onCardWobbleChange,
  onBack,
}: {
  comment: CommentRecord;
  style: CardStyle;
  renderSettings: RenderSettings;
  onStyleChange: <K extends keyof CardStyle>(key: K, value: CardStyle[K]) => void;
  onSceneShadowChange: <K extends keyof RenderSettings["sceneShadow"]>(key: K, value: RenderSettings["sceneShadow"][K]) => void;
  onCardLightingChange: <K extends keyof RenderSettings["cardLighting"]>(key: K, value: RenderSettings["cardLighting"][K]) => void;
  onCardWobbleChange: <K extends keyof RenderSettings["cardWobble"]>(key: K, value: RenderSettings["cardWobble"][K]) => void;
  onBack: () => void;
}) {
  return (
    <section className="authoring-workspace design-workspace">
      <div className="authoring-canvas">
        <div className="authoring-heading">
          <button className="back-button" onClick={onBack}><ArrowLeft size={16} />Back to Field</button>
          <div><span>Shared card template</span><strong>Design one post. Update every post.</strong></div>
        </div>
        <div className="design-preview-surface">
          <CardPreview comment={comment} style={style} renderSettings={renderSettings} className="design-card-preview" />
          <p>Representative content · {comment.handle || "message-only post"}</p>
        </div>
      </div>
      <aside className="authoring-inspector panel-scroll">
        <PanelSection title="Card surface" meta="Shared globally">
          <SelectField label="Post setup" value={style.postType} onChange={(event) => onStyleChange("postType", event.target.value as CardStyle["postType"])}>
            <option value="x">X / Twitter</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
          </SelectField>
          <Field label="Card color" type="color" value={style.background} onChange={(event) => onStyleChange("background", event.target.value)} />
          <Slider label="Width" min={300} max={620} step={10} value={style.width} display={`${style.width}px`} onChange={(event) => onStyleChange("width", Number(event.target.value))} />
          <Slider label="Opacity" min={0.2} max={1} step={0.01} value={style.backgroundOpacity} onChange={(event) => onStyleChange("backgroundOpacity", Number(event.target.value))} />
          <Slider label="Stroke width" min={0} max={12} step={0.5} value={style.strokeWidth} display={`${style.strokeWidth}px`} onChange={(event) => onStyleChange("strokeWidth", Number(event.target.value))} />
          <Field label="Stroke color" type="color" value={style.strokeColor} onChange={(event) => onStyleChange("strokeColor", event.target.value)} />
          <Slider label="Corner radius" min={0} max={48} step={1} value={style.cornerRadius} display={`${style.cornerRadius}px`} onChange={(event) => onStyleChange("cornerRadius", Number(event.target.value))} />
          <Slider label="Texture shadow" min={0} max={0.6} step={0.01} value={style.shadow} onChange={(event) => onStyleChange("shadow", Number(event.target.value))} />
          <Slider label="Padding" min={12} max={40} step={1} value={style.padding} display={`${style.padding}px`} onChange={(event) => onStyleChange("padding", Number(event.target.value))} />
        </PanelSection>
        <PanelSection title="Scene depth" meta="Live WebGPU">
          {styleToggle("Soft shadow", renderSettings.sceneShadow.enabled, (value) => onSceneShadowChange("enabled", value))}
          {renderSettings.sceneShadow.enabled && <>
            <Field label="Shadow color" type="color" value={renderSettings.sceneShadow.color} onChange={(event) => onSceneShadowChange("color", event.target.value)} />
            <Slider label="Opacity" min={0} max={0.8} step={0.01} value={renderSettings.sceneShadow.opacity} display={`${Math.round(renderSettings.sceneShadow.opacity * 100)}%`} onChange={(event) => onSceneShadowChange("opacity", Number(event.target.value))} />
            <Slider label="Softness" min={0} max={1} step={0.01} value={renderSettings.sceneShadow.softness} display={`${Math.round(renderSettings.sceneShadow.softness * 100)}%`} onChange={(event) => onSceneShadowChange("softness", Number(event.target.value))} />
            <Slider label="Distance" min={0} max={0.06} step={0.001} value={renderSettings.sceneShadow.distance} display={`${(renderSettings.sceneShadow.distance * 100).toFixed(1)}%`} onChange={(event) => onSceneShadowChange("distance", Number(event.target.value))} />
            <Slider label="Shadow angle" min={-180} max={180} step={1} value={renderSettings.sceneShadow.angle} display={`${renderSettings.sceneShadow.angle.toFixed(0)}°`} onChange={(event) => onSceneShadowChange("angle", Number(event.target.value))} />
          </>}
          {styleToggle("Card lighting", renderSettings.cardLighting.enabled, (value) => onCardLightingChange("enabled", value))}
          {renderSettings.cardLighting.enabled && <>
            <Slider label="Ambient" min={0.7} max={1.2} step={0.01} value={renderSettings.cardLighting.ambient} display={`${renderSettings.cardLighting.ambient.toFixed(2)}×`} onChange={(event) => onCardLightingChange("ambient", Number(event.target.value))} />
            <Slider label="Key intensity" min={0} max={0.5} step={0.01} value={renderSettings.cardLighting.intensity} display={`${Math.round(renderSettings.cardLighting.intensity * 100)}%`} onChange={(event) => onCardLightingChange("intensity", Number(event.target.value))} />
            <Slider label="Light angle" min={-180} max={180} step={1} value={renderSettings.cardLighting.angle} display={`${renderSettings.cardLighting.angle.toFixed(0)}°`} onChange={(event) => onCardLightingChange("angle", Number(event.target.value))} />
            <Slider label="Edge light" min={0} max={0.3} step={0.01} value={renderSettings.cardLighting.edge} display={`${Math.round(renderSettings.cardLighting.edge * 100)}%`} onChange={(event) => onCardLightingChange("edge", Number(event.target.value))} />
          </>}
          {styleToggle("Card wobble", renderSettings.cardWobble.enabled, (value) => onCardWobbleChange("enabled", value))}
          {renderSettings.cardWobble.enabled && <>
            <Slider label="Wobble amount" min={0} max={0.35} step={0.005} value={renderSettings.cardWobble.amount} display={`${(renderSettings.cardWobble.amount * 57.2958).toFixed(1)}°`} onChange={(event) => onCardWobbleChange("amount", Number(event.target.value))} />
            <Slider label="Wobble speed" min={0.05} max={2} step={0.01} value={renderSettings.cardWobble.speed} display={`${renderSettings.cardWobble.speed.toFixed(2)} Hz`} onChange={(event) => onCardWobbleChange("speed", Number(event.target.value))} />
            <Slider label="Card variation" min={0} max={1} step={0.01} value={renderSettings.cardWobble.variation} display={`${Math.round(renderSettings.cardWobble.variation * 100)}%`} onChange={(event) => onCardWobbleChange("variation", Number(event.target.value))} />
          </>}
        </PanelSection>
        <PanelSection title="Content visibility">
          {styleToggle("Avatar", style.showAvatar, (value) => onStyleChange("showAvatar", value))}
          {styleToggle("Display name", style.showDisplayName, (value) => onStyleChange("showDisplayName", value))}
          {styleToggle("Handle", style.showHandle, (value) => onStyleChange("showHandle", value))}
          {styleToggle("Timestamp", style.showTimestamp, (value) => onStyleChange("showTimestamp", value))}
          {styleToggle("Engagement row", style.showEngagement, (value) => onStyleChange("showEngagement", value))}
        </PanelSection>
        <PanelSection title="Typography">
          <Slider label="Avatar" min={24} max={72} step={1} value={style.avatarSize} display={`${style.avatarSize}px`} onChange={(event) => onStyleChange("avatarSize", Number(event.target.value))} />
          <Slider label="Body size" min={14} max={30} step={1} value={style.bodySize} display={`${style.bodySize}px`} onChange={(event) => onStyleChange("bodySize", Number(event.target.value))} />
          <Slider label="Name weight" min={400} max={800} step={100} value={style.displayNameWeight} display={String(style.displayNameWeight)} onChange={(event) => onStyleChange("displayNameWeight", Number(event.target.value))} />
        </PanelSection>
      </aside>
    </section>
  );
}


