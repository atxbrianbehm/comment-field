import { useEffect, useRef } from "react";
import type { CardStyle, CommentRecord } from "../models/types";
import { renderCardCanvas } from "../renderer/cardTexture";

export function CardPreview({ comment, style, className = "" }: { comment: CommentRecord; style: CardStyle; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = renderCardCanvas(comment, style);
    canvas.setAttribute("aria-label", `Preview of ${comment.username}'s post`);
    host.replaceChildren(canvas);
  }, [comment, style]);

  return <div ref={hostRef} className={`card-preview ${className}`} />;
}
