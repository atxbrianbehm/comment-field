import * as THREE from "three";
import type { CardStyle, CommentRecord } from "@comment-field/engine";

function hexWithOpacity(hex: string, opacity: number) {
  const raw = (hex || "#FFFFFF").replace("#", "").trim();
  const normalized = raw.length === 3 ? raw.split("").map((character) => character + character).join("") : raw.padEnd(6, "0").slice(0, 6);
  const number = Number.parseInt(normalized, 16);
  if (!Number.isFinite(number)) return `rgba(255, 255, 255, ${opacity})`;
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${opacity})`;
}

type CardCanvas = HTMLCanvasElement | OffscreenCanvas;
type CardContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function roundedRect(context: CardContext, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function wrapLines(context: CardContext, text: string, maxWidth: number) {
  const words = String(text || " ").split(/\s+/).filter(Boolean);
  if (!words.length) return [" "];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [" "];
}

export interface CardTextureResult {
  texture: THREE.Texture;
  aspect: number;
}

export function avatarInitialForComment(comment: CommentRecord) {
  const source = comment.username || comment.handle || comment.message;
  return source.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? "•";
}

export function renderCardCanvas(comment: CommentRecord, style: CardStyle, pixelRatio = 2): HTMLCanvasElement {
  return renderCardSurface(comment, style, document.createElement("canvas"), pixelRatio) as HTMLCanvasElement;
}

export function renderCardSurface(comment: CommentRecord, style: CardStyle, canvas: CardCanvas, pixelRatio = 2): CardCanvas {
  const shadowMargin = 24;
  const width = style.width;
  const contentWidth = width - style.padding * 2;
  const postType = style.postType ?? "x";
  const context = canvas.getContext("2d") as CardContext;
  context.font = `${style.bodySize}px Inter, ui-sans-serif, system-ui, sans-serif`;
  const lines = wrapLines(context, comment.message || " ", contentWidth).slice(0, 40);
  const headerVisible = style.showAvatar || style.showDisplayName || style.showHandle || style.showTimestamp;
  const headerHeight = headerVisible
    ? Math.max(style.showAvatar ? style.avatarSize : 0, postType === "instagram" ? 38 : 46) + (postType === "instagram" ? 14 : 12)
    : 0;
  const engagementHeight = style.showEngagement ? (postType === "facebook" ? 50 : 42) : 8;
  const bodyHeight = Math.max(style.bodySize * 1.35, lines.length * style.bodySize * 1.35);
  const height = Math.min(2048, style.padding * 2 + headerHeight + bodyHeight + engagementHeight);
  canvas.width = (width + shadowMargin * 2) * pixelRatio;
  canvas.height = (height + shadowMargin * 2) * pixelRatio;
  context.scale(pixelRatio, pixelRatio);

  context.shadowColor = `rgba(20, 13, 9, ${style.shadow})`;
  context.shadowBlur = 18;
  context.shadowOffsetY = 9;
  roundedRect(context, shadowMargin, shadowMargin, width, height, style.cornerRadius);
  context.fillStyle = hexWithOpacity(style.background, style.backgroundOpacity);
  context.fill();
  context.shadowColor = "transparent";
  if (style.strokeWidth > 0) {
    context.lineWidth = style.strokeWidth;
    context.strokeStyle = style.strokeColor;
    context.stroke();
  }

  const left = shadowMargin + style.padding;
  const top = shadowMargin + style.padding;
  if (style.showAvatar) {
    context.beginPath();
    context.arc(left + style.avatarSize / 2, top + style.avatarSize / 2, style.avatarSize / 2, 0, Math.PI * 2);
    context.fillStyle = comment.avatarColor;
    context.fill();
    if (postType === "instagram") {
      context.lineWidth = 3;
      context.strokeStyle = "#D946EF";
      context.stroke();
    }
    context.fillStyle = "rgba(255,255,255,.9)";
    context.font = `700 ${Math.round(style.avatarSize * 0.38)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(avatarInitialForComment(comment), left + style.avatarSize / 2, top + style.avatarSize / 2 + 1);
  }

  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  const textLeft = left + (style.showAvatar ? style.avatarSize + 13 : 0);
  if (style.showDisplayName) {
    context.fillStyle = postType === "facebook" ? "#18243A" : "#171713";
    context.font = `${style.displayNameWeight} ${Math.max(14, style.bodySize - 2)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    context.fillText(comment.username, textLeft, top + 20);
  }
  const metadataParts = postType === "facebook"
    ? [style.showTimestamp ? comment.timestamp : "", style.showHandle ? comment.handle : ""]
    : [style.showHandle ? comment.handle : "", style.showTimestamp ? comment.timestamp : ""];
  const metadata = metadataParts.filter(Boolean).join(" · ");
  if (metadata) {
    context.fillStyle = "#77746C";
    context.font = `500 ${Math.max(12, style.bodySize - 5)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    context.fillText(metadata, textLeft, top + (style.showDisplayName ? 42 : 24));
  }

  context.fillStyle = postType === "facebook" ? "#1C1E21" : "#22221E";
  context.font = `${postType === "instagram" ? 450 : 500} ${style.bodySize}px Inter, ui-sans-serif, system-ui, sans-serif`;
  lines.forEach((line, index) => context.fillText(line, left, top + headerHeight + 18 + index * style.bodySize * 1.35));

  if (style.showEngagement) {
    const engagementY = height + shadowMargin - style.padding + 2;
    context.fillStyle = postType === "facebook" ? "#58606B" : "#77746C";
    context.font = `500 ${Math.max(12, style.bodySize - 5)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    if (postType === "instagram") {
      context.fillStyle = "#1A1A18";
      context.fillText(`♡  ${comment.likes}`, left, engagementY);
      context.fillText(`○  ${comment.replies}`, left + contentWidth * 0.35, engagementY);
      context.fillText("⌁", left + contentWidth * 0.72, engagementY);
    } else if (postType === "facebook") {
      context.strokeStyle = "rgba(88, 96, 107, .22)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(left, engagementY - 27);
      context.lineTo(left + contentWidth, engagementY - 27);
      context.stroke();
      context.fillText(`Like  ${comment.likes}`, left, engagementY);
      context.fillText(`Comment  ${comment.replies}`, left + contentWidth * 0.38, engagementY);
      context.fillText(`Share  ${comment.reposts}`, left + contentWidth * 0.76, engagementY);
    } else {
      context.fillText(`○  ${comment.replies}`, left, engagementY);
      context.fillText(`↻  ${comment.reposts}`, left + contentWidth * 0.34, engagementY);
      context.fillText(`♡  ${comment.likes}`, left + contentWidth * 0.68, engagementY);
    }
  }

  return canvas;
}

export function createCardTexture(comment: CommentRecord, style: CardStyle): CardTextureResult {
  const canvas = renderCardCanvas(comment, style);
  return createCardTextureFromSource(canvas, canvas.width, canvas.height);
}

export function createCardTextureFromSource(source: CanvasImageSource, width: number, height: number): CardTextureResult {
  const texture = new THREE.Texture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return { texture, aspect: width / height };
}
