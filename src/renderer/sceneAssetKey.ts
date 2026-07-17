import type { CardStyle, CommentRecord, Composition } from "@comment-field/engine";

export function createSceneAssetKey(
  composition: Composition,
  comments: CommentRecord[],
  cardStyle: CardStyle,
) {
  const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
  const cardIds = composition.cards.map((card) => card.cardId);

  return JSON.stringify({
    compositionId: composition.id,
    width: composition.width,
    height: composition.height,
    cardIds,
    comments: cardIds.map((cardId) => commentsById.get(cardId) ?? null),
    cardStyle,
  });
}
