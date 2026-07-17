import type { CardStyle, CommentRecord } from "@comment-field/engine";

export function createCardTextureKey(comment: CommentRecord, style: CardStyle) {
  return JSON.stringify({ comment, style });
}

export function classifyCacheInvalidation(
  previousComments: CommentRecord[],
  nextComments: CommentRecord[],
  previousStyle: CardStyle,
  nextStyle: CardStyle,
) {
  if (JSON.stringify(previousStyle) !== JSON.stringify(nextStyle)) return "card template changed";
  if (JSON.stringify(previousComments) !== JSON.stringify(nextComments)) return "comment content changed";
  return "composition card set changed";
}
