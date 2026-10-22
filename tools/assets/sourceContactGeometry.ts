/** Offline source-only geometry primitives. No source trust, anatomy or gameplay policy. */
import { type Matrix4, Vector3 as ThreeVector3 } from 'three';
import type { HitVolume, Vector3 } from '../../src/contracts';
export type SourceBarycentric = readonly [number, number, number];
const plain = (v: ThreeVector3): Vector3 => ({ x: v.x, y: v.y, z: v.z });
const three = (v: Vector3) => new ThreeVector3(v.x, v.y, v.z);

/** Mesh-bind +Z axis in the foot's bind-reference frame, fixed before target tests.
 * Radial center is the source XY bounds midpoint; radius encloses all source points.
 * At that fixed radius, shorten the axis interval only as point containment permits.
 * The 1e-7m arithmetic guard is separate from any interpolation/gameplay allowance. */
export function fitSourceAxisCapsule(
  points: readonly Vector3[],
): Extract<HitVolume, { readonly kind: 'capsule' }> {
  if (
    !points.length ||
    points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
  )
    throw new Error('Finite nonempty source surface required');
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const x = (minX + maxX) / 2,
    y = (minY + maxY) / 2;
  let radialSquared = 0;
  for (const p of points)
    radialSquared = Math.max(radialSquared, (p.x - x) ** 2 + (p.y - y) ** 2);
  if (!(radialSquared > 0) || !Number.isFinite(radialSquared))
    throw new Error('Nondegenerate finite source surface required');
  const radiusM = Math.sqrt(radialSquared) + 1e-7;
  let startZ = Infinity,
    endZ = -Infinity;
  for (const p of points) {
    const remaining = Math.sqrt(
      Math.max(0, radialSquared - (p.x - x) ** 2 - (p.y - y) ** 2),
    );
    startZ = Math.min(startZ, p.z + remaining);
    endZ = Math.max(endZ, p.z - remaining);
  }
  if (startZ > endZ) startZ = endZ = (startZ + endZ) / 2;
  if (![x, y, startZ, endZ, radiusM].every(Number.isFinite))
    throw new Error('Nonfinite capsule fit');
  return {
    kind: 'capsule',
    start: { x, y, z: startZ },
    end: { x, y, z: endZ },
    radiusM,
  };
}

/** Intersect an original face with scalar half-spaces using its exact barycentrics. */
export function clipBarycentricTriangle(
  fields: readonly SourceBarycentric[],
): readonly SourceBarycentric[] {
  if (
    fields.some(
      (field) =>
        field.length !== 3 || field.some((value) => !Number.isFinite(value)),
    )
  )
    throw new Error('Finite triangle half-space fields required');
  let polygon: SourceBarycentric[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (const field of fields) {
    const next: SourceBarycentric[] = [];
    const value = (b: SourceBarycentric) =>
      b[0] * field[0] + b[1] * field[1] + b[2] * field[2];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      if (!a || !b) throw new Error('Invalid clipping edge');
      const av = value(a),
        bv = value(b);
      if (av >= 0) next.push(a);
      if (av >= 0 !== bv >= 0) {
        const t = av / (av - bv);
        next.push([
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
        ]);
      }
    }
    polygon = next.filter((point, index) => {
      const previous = next[(index + next.length - 1) % next.length];
      return (
        !previous ||
        point.some((value, component) => value !== previous[component])
      );
    });
    if (polygon.length < 3) return [];
  }
  return polygon;
}

/** Conservative spectral norm bound sqrt(max absolute row sum of A^T A).
 * Unlike assuming orthonormality, this retains source Float32/TRS affine effects. */
export function stretchBound(matrix: Matrix4): number {
  const columns = [0, 1, 2].map((i) =>
    new ThreeVector3().setFromMatrixColumn(matrix, i),
  );
  return Math.sqrt(
    Math.max(
      ...columns.map((a) =>
        columns.reduce((sum, b) => sum + Math.abs(a.dot(b)), 0),
      ),
    ),
  );
}
export function positiveArea(points: readonly Vector3[]): boolean {
  const origin = points[0];
  if (!origin) return false;
  let area = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i],
      b = points[i + 1];
    if (a && b)
      area += three(a)
        .sub(three(origin))
        .cross(three(b).sub(three(origin)))
        .length();
  }
  return area > 0;
}
export function interpolateFace(
  points: readonly Vector3[],
  b: SourceBarycentric,
): Vector3 {
  const result = new ThreeVector3();
  for (let i = 0; i < 3; i++) {
    const p = points[i],
      w = b[i];
    if (!p || w === undefined) throw new Error('Missing original face point');
    result.addScaledVector(three(p), w);
  }
  return plain(result);
}

/** One deterministic source-reference AABB midpoint sphere, never target-driven.
 * The existing 1e-7m arithmetic guard is not an interpolation or gameplay allowance. */
export function fitSourceSphere(
  points: readonly Vector3[],
): Extract<HitVolume, { readonly kind: 'sphere' }> {
  if (
    !points.length ||
    points.some((point) => ![point.x, point.y, point.z].every(Number.isFinite))
  )
    throw new Error('Finite nonempty source surface required');
  const min = new ThreeVector3(Infinity, Infinity, Infinity);
  const max = new ThreeVector3(-Infinity, -Infinity, -Infinity);
  for (const point of points) {
    min.min(three(point));
    max.max(three(point));
  }
  const center = min.add(max).multiplyScalar(0.5);
  let radius = 0;
  for (const point of points)
    radius = Math.max(radius, center.distanceTo(three(point)));
  if (
    !(radius > 0) ||
    ![center.x, center.y, center.z, radius].every(Number.isFinite)
  )
    throw new Error('Nondegenerate finite source surface required');
  return { kind: 'sphere', center: plain(center), radiusM: radius + 1e-7 };
}
