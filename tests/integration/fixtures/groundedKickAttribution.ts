/** Test-only finite DISPLAY-pose attribution. Never emits a gameplay contact.
 * The capsule is C's existing combat proxy, not a SpatialSnapshot field or a
 * visible source surface. No continuous or solid-occupancy claim is made. */
import { type Object3D, SkinnedMesh, Triangle, Vector3 } from 'three';
import type { Vector3 as Point } from '../../../src/contracts';
import { combatHurt } from '../../../src/world/combat-hurt';
import type { loadGroundedKickDiagnostics } from '../../../tools/assets/groundedKickDiagnostic';

type Entry = ReturnType<typeof loadGroundedKickDiagnostics>[number];
export interface PatchFace {
  readonly primitive: number;
  readonly triangleIndex: number;
  readonly region: 'heel' | 'sole';
  readonly triangle: Triangle;
}
export function displayedKickPatch(node: Object3D, entry: Entry): PatchFace[] {
  node.updateWorldMatrix(true, true);
  const meshes: SkinnedMesh[] = [];
  node.traverse((part) => {
    if (part instanceof SkinnedMesh) {
      part.skeleton.update();
      meshes.push(part);
    }
  });
  if (meshes.length !== 5)
    throw new Error('Pinned primitive order unavailable');
  return entry.polygons.flatMap((polygon) => {
    const region = polygon.region;
    if (region !== 'heel' && region !== 'sole')
      throw new Error('Unknown source region');
    const mesh = meshes[polygon.primitive];
    if (!mesh) throw new Error('Missing source primitive');
    const indices = mesh.geometry.index;
    if (
      !indices ||
      polygon.vertexIndices.some(
        (id, i) => indices.getX(polygon.triangleIndex * 3 + i) !== id,
      )
    )
      throw new Error('Source triangle topology differs');
    const posed = polygon.vertexIndices.map((id) =>
      mesh.getVertexPosition(id, new Vector3()).applyMatrix4(mesh.matrixWorld),
    );
    const cuts = polygon.barycentric.map((weights) => {
      const p = new Vector3();
      weights.forEach((weight, i) => {
        const vertex = posed[i];
        if (!vertex) throw new Error('Missing posed source vertex');
        p.addScaledVector(vertex, weight);
      });
      return p;
    });
    return cuts.slice(2).map((last, i): PatchFace => {
      const first = cuts[0],
        next = cuts[i + 1];
      if (!first || !next) throw new Error('Missing clipped source vertex');
      const triangle = new Triangle(first, next, last);
      if (!(triangle.getArea() > 0))
        throw new Error('Degenerate posed source patch');
      return {
        primitive: polygon.primitive,
        triangleIndex: polygon.triangleIndex,
        region,
        triangle,
      };
    });
  });
}

/** Distance to a convex triangle along the capsule axis is convex. This finite
 * ternary search retains its final axis-parameter bracket; Float64 arithmetic
 * is not a certified interval solver. The unchanged capsule radius is subtracted
 * only for a diagnostic gap, never promoted to a source-contact allowance. */
export function patchAttribution(
  faces: readonly PatchFace[],
  target: Point,
  candidatePoint?: Point,
) {
  const capsule = combatHurt(target);
  const start = new Vector3(capsule.start.x, capsule.start.y, capsule.start.z);
  const end = new Vector3(capsule.end.x, capsule.end.y, capsule.end.z);
  const point = new Vector3(),
    closest = new Vector3();
  let gapM = Infinity,
    pointGapM = Infinity;
  let witness: {
    primitive: number;
    triangleIndex: number;
    region: string;
  } | null = null;
  for (const face of faces) {
    const distance = (t: number) => {
      point.lerpVectors(start, end, t);
      face.triangle.closestPointToPoint(point, closest);
      return point.distanceTo(closest);
    };
    let low = 0,
      high = 1;
    for (let i = 0; i < 64; i++) {
      const a = low + (high - low) / 3,
        b = high - (high - low) / 3;
      if (distance(a) <= distance(b)) high = b;
      else low = a;
    }
    const gap =
      Math.min(distance(0), distance(1), distance((low + high) / 2)) -
      capsule.radiusM;
    if (gap < gapM) {
      gapM = gap;
      witness = {
        primitive: face.primitive,
        triangleIndex: face.triangleIndex,
        region: face.region,
      };
    }
    if (candidatePoint) {
      point.set(candidatePoint.x, candidatePoint.y, candidatePoint.z);
      face.triangle.closestPointToPoint(point, closest);
      pointGapM = Math.min(pointGapM, point.distanceTo(closest));
    }
  }
  if (
    !Number.isFinite(gapM) ||
    !witness ||
    (candidatePoint && !Number.isFinite(pointGapM))
  )
    throw new Error('Finite source patch attribution unavailable');
  return {
    capsule,
    regionGapM: gapM,
    witness,
    candidatePointToPatchM: candidatePoint ? pointGapM : null,
    finalAxisBracketUpperBoundM: start.distanceTo(end) * (2 / 3) ** 64,
    numerics: 'finite-float64-not-certified',
    scope:
      'display-pose source patch versus existing C proxy; not event-time or visible target surface',
  };
}
