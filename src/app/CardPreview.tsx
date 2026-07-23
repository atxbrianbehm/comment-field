import { useEffect, useRef } from "react";
import type { CardStyle, CommentRecord, RenderSettings } from "@comment-field/engine";
import { renderCardCanvas } from "@comment-field/webgpu-runtime";

function hexToRgba(value: string, opacity: number) {
  const raw = value.replace("#", "").trim();
  const normalized = raw.length === 3 ? raw.split("").map((character) => character + character).join("") : raw.padEnd(6, "0").slice(0, 6);
  const number = Number.parseInt(normalized, 16);
  if (!Number.isFinite(number)) return `rgba(18, 13, 9, ${opacity})`;
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${opacity})`;
}

export function CardPreview({
  comment,
  style,
  renderSettings,
  className = "",
}: {
  comment: CommentRecord;
  style: CardStyle;
  renderSettings?: RenderSettings;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const lightRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = renderCardCanvas(comment, style);
    canvas.setAttribute("aria-label", `Preview of ${comment.username}'s post`);
    host.replaceChildren(canvas);
    const light = lightRef.current;
    if (light) {
      const surfaceWidth = canvas.width / 2;
      const surfaceHeight = canvas.height / 2;
      light.style.left = `${(24 / surfaceWidth) * 100}%`;
      light.style.right = `${(24 / surfaceWidth) * 100}%`;
      light.style.top = `${(24 / surfaceHeight) * 100}%`;
      light.style.bottom = `${(24 / surfaceHeight) * 100}%`;
    }
  }, [comment, style]);

  const shadow = renderSettings?.sceneShadow;
  const lighting = renderSettings?.cardLighting;
  const shadowAngle = (shadow?.angle ?? 55) * Math.PI / 180;
  const shadowDistance = (shadow?.distance ?? 0) * 520;
  const filter = [
    `brightness(${lighting?.enabled ? lighting.ambient : 1})`,
    shadow?.enabled
      ? `drop-shadow(${Math.cos(shadowAngle) * shadowDistance}px ${Math.sin(shadowAngle) * shadowDistance}px ${8 + shadow.softness * 28}px ${hexToRgba(shadow.color, shadow.opacity)})`
      : "",
  ].filter(Boolean).join(" ");
  const lightStrength = lighting?.enabled ? lighting.intensity : 0;

  return (
    <div className={`card-preview ${className}`} style={{ filter }}>
      <div ref={hostRef} className="card-preview-canvas" />
      <span
        ref={lightRef}
        className="card-preview-light"
        style={{
          background: `linear-gradient(${(lighting?.angle ?? -45) + 90}deg, rgba(255,255,255,${lightStrength}), rgba(255,255,255,0) 48%, rgba(0,0,0,${lightStrength * 0.45}))`,
          boxShadow: `inset 0 0 0 ${Math.max(0, (lighting?.edge ?? 0) * 18)}px rgba(255,255,255,${lighting?.edge ?? 0})`,
          opacity: lighting?.enabled ? 1 : 0,
        }}
      />
    </div>
  );
}
