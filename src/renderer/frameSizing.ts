export interface FrameSize {
  width: number;
  height: number;
}

export function fitFrameWithinBounds(
  containerWidth: number,
  containerHeight: number,
  frameWidth: number,
  frameHeight: number,
): FrameSize {
  if (containerWidth <= 0 || containerHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return { width: 0, height: 0 };
  }

  const aspect = frameWidth / frameHeight;
  let width = containerWidth;
  let height = width / aspect;

  if (height > containerHeight) {
    height = containerHeight;
    width = height * aspect;
  }

  return { width, height };
}
