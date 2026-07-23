import {
  fieldPointToWorld,
  projectWorldPoint,
  type CameraPose,
  type Composition,
  type Transform,
} from "@comment-field/engine";

export interface CardMotionBlurVectors {
  center: { x: number; y: number };
  uAxis: { x: number; y: number };
  vAxis: { x: number; y: number };
  amount: number;
  maxOffset: number;
}

interface ProjectedCardBasis {
  center: { x: number; y: number };
  uAxis: { x: number; y: number };
  vAxis: { x: number; y: number };
}

const ZERO_MOTION: CardMotionBlurVectors = {
  center: { x: 0, y: 0 },
  uAxis: { x: 0, y: 0 },
  vAxis: { x: 0, y: 0 },
  amount: 0,
  maxOffset: 0,
};

function projectedCardBasis(
  composition: Pick<Composition, "width" | "height">,
  camera: CameraPose,
  transform: Transform,
  planeWidth: number,
  planeHeight: number,
): ProjectedCardBasis {
  const center = fieldPointToWorld(composition, transform);
  const rotation = -transform.rotation;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const projectLocal = (x: number, y: number) => projectWorldPoint(composition, camera, {
    x: center.x + (x * cosine - y * sine) * transform.scale,
    y: center.y + (x * sine + y * cosine) * transform.scale,
    z: transform.z,
  });
  const projectedCenter = projectLocal(0, 0);
  const projectedU = projectLocal(planeWidth, 0);
  const projectedV = projectLocal(0, planeHeight);
  return {
    center: projectedCenter,
    uAxis: { x: projectedU.x - projectedCenter.x, y: projectedU.y - projectedCenter.y },
    vAxis: { x: projectedV.x - projectedCenter.x, y: projectedV.y - projectedCenter.y },
  };
}

function inverseTransform(
  basis: ProjectedCardBasis,
  vector: { x: number; y: number },
) {
  const determinant = basis.uAxis.x * basis.vAxis.y - basis.uAxis.y * basis.vAxis.x;
  if (Math.abs(determinant) < 1e-9) return { x: 0, y: 0 };
  return {
    x: (basis.vAxis.y * vector.x - basis.vAxis.x * vector.y) / determinant,
    y: (-basis.uAxis.y * vector.x + basis.uAxis.x * vector.y) / determinant,
  };
}

function vectorAt(
  center: { x: number; y: number },
  uAxis: { x: number; y: number },
  vAxis: { x: number; y: number },
  u: number,
  v: number,
) {
  return {
    x: center.x + uAxis.x * u + vAxis.x * v,
    y: center.y + uAxis.y * u + vAxis.y * v,
  };
}

/**
 * Returns the previous-frame texture lookup as an affine UV offset.
 *
 * Unlike a center-only velocity, this captures translation plus apparent motion
 * caused by card scale, rotation, Z depth, FOV, and camera movement. The shader
 * evaluates the affine offset per fragment so zooms produce radial blur and
 * rotations produce tangential blur.
 */
export function computeCardMotionBlur(
  composition: Pick<Composition, "width" | "height">,
  currentCamera: CameraPose,
  previousCamera: CameraPose,
  current: Transform,
  previous: Transform,
  planeWidth: number,
  planeHeight: number,
  strength: number,
): CardMotionBlurVectors {
  if (strength <= 0 || planeWidth <= 0 || planeHeight <= 0) return ZERO_MOTION;
  const currentBasis = projectedCardBasis(composition, currentCamera, current, planeWidth, planeHeight);
  const previousBasis = projectedCardBasis(composition, previousCamera, previous, planeWidth, planeHeight);
  const centerDelta = {
    x: currentBasis.center.x - previousBasis.center.x,
    y: currentBasis.center.y - previousBasis.center.y,
  };
  const center = inverseTransform(previousBasis, centerDelta);
  const currentUInPrevious = inverseTransform(previousBasis, currentBasis.uAxis);
  const currentVInPrevious = inverseTransform(previousBasis, currentBasis.vAxis);
  const uAxis = { x: currentUInPrevious.x - 1, y: currentUInPrevious.y };
  const vAxis = { x: currentVInPrevious.x, y: currentVInPrevious.y - 1 };

  const gain = Math.max(0, strength);
  center.x *= gain;
  center.y *= gain;
  uAxis.x *= gain;
  uAxis.y *= gain;
  vAxis.x *= gain;
  vAxis.y *= gain;

  const samplePoints = [
    vectorAt(center, uAxis, vAxis, -0.5, -0.5),
    vectorAt(center, uAxis, vAxis, 0.5, -0.5),
    vectorAt(center, uAxis, vAxis, 0.5, 0.5),
    vectorAt(center, uAxis, vAxis, -0.5, 0.5),
    center,
  ];
  let maxOffset = Math.max(...samplePoints.map((point) => Math.hypot(point.x, point.y)));
  // Keep extreme entrance scales from turning the whole card into a clamped texture streak.
  if (maxOffset > 0.35) {
    const scale = 0.35 / maxOffset;
    center.x *= scale;
    center.y *= scale;
    uAxis.x *= scale;
    uAxis.y *= scale;
    vAxis.x *= scale;
    vAxis.y *= scale;
    maxOffset = 0.35;
  }
  return {
    center,
    uAxis,
    vAxis,
    maxOffset,
    amount: Math.min(1, maxOffset * 8),
  };
}
