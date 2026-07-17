import * as THREE from "three";
import type { CardStyle, CommentRecord } from "../models/types";

function hexWithOpacity(hex: string, opacity: number) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3 ? normalized.split("").map((character) => character + character).join("") : normalized;
  const number = Number.parseInt(value, 16);
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${opacity})`;
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/);
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
  return lines;
}

export interface CardTextureResult {
  texture: THREE.CanvasTexture;
  aspect: number;
}

export function avatarInitialForComment(comment: CommentRecord) {
  const source = comment.username || comment.handle || comment.message;
  return source.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? "•";
}

export function renderCardCanvas(comment: CommentRecord, style: CardStyle, pixelRatio = 2): HTMLCanvasElement {
  const shadowMargin = 24;
  const width = style.width;
  const contentWidth = width - style.padding * 2;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  context.font = `${style.bodySize}px Inter, ui-sans-serif, system-ui, sans-serif`;
  const lines = wrapLines(context, comment.message, contentWidth);
  const headerVisible = style.showAvatar || style.showDisplayName || style.showHandle || style.showTimestamp;
  const headerHeight = headerVisible ? Math.max(style.showAvatar ? style.avatarSize : 0, 46) + 12 : 0;
  const engagementHeight = style.showEngagement ? 42 : 8;
  const bodyHeight = Math.max(style.bodySize * 1.35, lines.length * style.bodySize * 1.35);
  const height = style.padding * 2 + headerHeight + bodyHeight + engagementHeight;
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
    context.fillStyle = "#171713";
    context.font = `${style.displayNameWeight} ${Math.max(14, style.bodySize - 2)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    context.fillText(comment.username, textLeft, top + 20);
  }
  const metadata = [style.showHandle ? comment.handle : "", style.showTimestamp ? comment.timestamp : ""].filter(Boolean).join(" · ");
  if (metadata) {
    context.fillStyle = "#77746C";
    context.font = `500 ${Math.max(12, style.bodySize - 5)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    context.fillText(metadata, textLeft, top + (style.showDisplayName ? 42 : 24));
  }

  context.fillStyle = "#22221E";
  context.font = `500 ${style.bodySize}px Inter, ui-sans-serif, system-ui, sans-serif`;
  lines.forEach((line, index) => context.fillText(line, left, top + headerHeight + 18 + index * style.bodySize * 1.35));

  if (style.showEngagement) {
    const engagementY = height + shadowMargin - style.padding + 2;
    context.fillStyle = "#77746C";
    context.font = `500 ${Math.max(12, style.bodySize - 5)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    context.fillText(`○  ${comment.replies}`, left, engagementY);
    context.fillText(`↻  ${comment.reposts}`, left + contentWidth * 0.34, engagementY);
    context.fillText(`♡  ${comment.likes}`, left + contentWidth * 0.68, engagementY);
  }

  return canvas;
}

export function createCardTexture(comment: CommentRecord, style: CardStyle): CardTextureResult {
  const canvas = renderCardCanvas(comment, style);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return { texture, aspect: canvas.width / canvas.height };
}
