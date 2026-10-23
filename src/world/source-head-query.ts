/** Standalone finite-pose surface query. NOT a trusted source provider, solid
 * occupancy test, continuous solver, or authority to emit gameplay contacts. */
import { Box3, Matrix4, Triangle, Vector3 } from 'three';

type Point = Readonly<{ x: number; y: number; z: number }>;
export interface HeadSurfaceTriangle {
  readonly primitive: number;
  readonly triangleIndex: number;
  readonly vertices: readonly [Point, Point, Point];
}
export interface HeadSurfaceSphere {
  readonly center: Point;
  readonly radiusM: number;
}
export type HeadSurfaceResult =
  | Readonly<{
      kind: 'surface-distance';
      numerics: 'float64-not-certified';
      triangle: Readonly<{ primitive: number; triangleIndex: number }>;
      closestPoint: Point;
      barycentric: Point;
      distanceM: number;
      /** Distance to the triangle surface minus unchanged sphere radius.
       * Not signed distance to a solid, nor a penetration depth. */
      sphereGapM: number;
      overlap: boolean;
      visitedTriangles: number;
      visitedBounds: number;
      inverseStretchBound: number;
    }>
  | Readonly<{
      kind: 'invalid';
      reason: 'invalid-sphere' | 'invalid-affine-transform';
    }>
  | Readonly<{
      kind: 'unresolved';
      reason: 'unrepresentable-arithmetic';
    }>;
export interface PreparedHeadSurface {
  readonly triangleCount: number;
  /** Column-major affine source-reference-to-world matrix. Arbitrary query
   * order is supported. Caller owns time, root policy and source provenance. */
  query(
    sourceToWorld: readonly number[],
    sphere: HeadSurfaceSphere,
  ): HeadSurfaceResult;
}
interface Face {
  readonly primitive: number;
  readonly triangleIndex: number;
  readonly vertices: readonly [Vector3, Vector3, Vector3];
}
type Node =
  | { readonly box: Box3; readonly faces: readonly number[] }
  | { readonly box: Box3; readonly left: Node; readonly right: Node };
const point = (v: Vector3): Point => Object.freeze({ x: v.x, y: v.y, z: v.z });
const finitePoint = (p: unknown): p is Point =>
  typeof p === 'object' &&
  p !== null &&
  'x' in p &&
  typeof p.x === 'number' &&
  Number.isFinite(p.x) &&
  'y' in p &&
  typeof p.y === 'number' &&
  Number.isFinite(p.y) &&
  'z' in p &&
  typeof p.z === 'number' &&
  Number.isFinite(p.z);
const vector = (p: Point) => new Vector3(p.x, p.y, p.z);
class ArithmeticFailure extends Error {}
function finite(value: number): number {
  if (!Number.isFinite(value)) throw new ArithmeticFailure();
  return value;
}

/** Copies and validates GENERIC geometry. This does not check a GLB source pin,
 * extract anatomical regions, or imply that this input is trusted anatomy.
 * Empty, duplicate-ID, zero-area and numerically unrepresentable triangles are
 * rejected. No epsilon-area cutoff is used; no triangles are silently dropped.
 * Private copied geometry/acceleration are shared read-only between queries. */
export function prepareHeadSurface(
  triangles: readonly HeadSurfaceTriangle[],
): PreparedHeadSurface {
  if (!Array.isArray(triangles) || triangles.length === 0)
    throw new Error('Head surface is empty or malformed');
  const faces: Face[] = Array.from(triangles, (t) => {
    if (
      !t ||
      !Number.isSafeInteger(t.primitive) ||
      t.primitive < 0 ||
      !Number.isSafeInteger(t.triangleIndex) ||
      t.triangleIndex < 0
    )
      throw new Error('Invalid original triangle identity');
    if (
      !Array.isArray(t.vertices) ||
      t.vertices.length !== 3 ||
      Array.from(t.vertices).some((p) => !finitePoint(p))
    )
      throw new Error('Head triangle requires three finite vertices');
    const vertices = t.vertices.map(vector) as [Vector3, Vector3, Vector3];
    const area = vertices[1]
      .clone()
      .sub(vertices[0])
      .cross(vertices[2].clone().sub(vertices[0]))
      .lengthSq();
    if (!(area > 0) || !Number.isFinite(area))
      throw new Error('Unsupported degenerate or unrepresentable triangle');
    return { primitive: t.primitive, triangleIndex: t.triangleIndex, vertices };
  });
  faces.sort(
    (a, b) => a.primitive - b.primitive || a.triangleIndex - b.triangleIndex,
  );
  for (let i = 1; i < faces.length; i++)
    if (
      faces[i]!.primitive === faces[i - 1]!.primitive &&
      faces[i]!.triangleIndex === faces[i - 1]!.triangleIndex
    )
      throw new Error('Head surface has duplicate original triangle identity');

  function build(ids: number[]): Node {
    const box = new Box3();
    for (const i of ids)
      for (const p of faces[i]!.vertices) box.expandByPoint(p);
    if (ids.length <= 8) return { box, faces: ids };
    const size = box.getSize(new Vector3());
    if (!finitePoint(size)) throw new Error('Unrepresentable head bounds');
    const axis =
      size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
    // Midpoint of each triangle's bounds avoids overflowing a centroid sum.
    const center = (i: number) => {
      const values = faces[i]!.vertices.map((p) => p[axis]);
      return Math.min(...values) / 2 + Math.max(...values) / 2;
    };
    ids.sort((a, b) => center(a) - center(b) || a - b);
    const middle = ids.length >> 1;
    return {
      box,
      left: build(ids.slice(0, middle)),
      right: build(ids.slice(middle)),
    };
  }
  const tree = build(faces.map((_, i) => i));

  function query(
    sourceToWorld: readonly number[],
    sphere: HeadSurfaceSphere,
  ): HeadSurfaceResult {
    if (
      !sphere ||
      !finitePoint(sphere.center) ||
      !Number.isFinite(sphere.radiusM) ||
      sphere.radiusM < 0
    )
      return Object.freeze({ kind: 'invalid', reason: 'invalid-sphere' });
    if (
      !Array.isArray(sourceToWorld) ||
      sourceToWorld.length !== 16 ||
      sourceToWorld.some((v) => !Number.isFinite(v)) ||
      sourceToWorld[3] !== 0 ||
      sourceToWorld[7] !== 0 ||
      sourceToWorld[11] !== 0 ||
      sourceToWorld[15] !== 1
    )
      return Object.freeze({
        kind: 'invalid',
        reason: 'invalid-affine-transform',
      });
    const transform = new Matrix4().fromArray(sourceToWorld);
    const determinant = transform.determinant();
    if (!Number.isFinite(determinant) || determinant === 0)
      return Object.freeze({
        kind: 'invalid',
        reason: 'invalid-affine-transform',
      });
    const inverse = transform.clone().invert();
    if (inverse.elements.some((v) => !Number.isFinite(v)))
      return Object.freeze({
        kind: 'invalid',
        reason: 'invalid-affine-transform',
      });
    try {
      const e = inverse.elements;
      // ||A||2 <= sqrt(||A||1 * ||A||infinity). Separate square roots
      // avoid squaring tiny inverse scales or multiplying extreme norms.
      // This is a real-arithmetic bound, not a rounded certificate.
      const columnNorm = Math.max(
        Math.abs(e[0]) + Math.abs(e[1]) + Math.abs(e[2]),
        Math.abs(e[4]) + Math.abs(e[5]) + Math.abs(e[6]),
        Math.abs(e[8]) + Math.abs(e[9]) + Math.abs(e[10]),
      );
      const rowNorm = Math.max(
        Math.abs(e[0]) + Math.abs(e[4]) + Math.abs(e[8]),
        Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9]),
        Math.abs(e[2]) + Math.abs(e[6]) + Math.abs(e[10]),
      );
      const inverseStretchBound = finite(
        Math.sqrt(columnNorm) * Math.sqrt(rowNorm),
      );
      if (inverseStretchBound === 0) throw new ArithmeticFailure();
      const center = vector(sphere.center);
      const local = center.clone().applyMatrix4(inverse);
      if (!finitePoint(local)) throw new ArithmeticFailure();
      const triangle = new Triangle();
      const closest = new Vector3();
      const bestPoint = new Vector3();
      const bestBarycentric = new Vector3();
      let bestDistance = Infinity;
      let bestId = Infinity;
      let visitedTriangles = 0;
      let visitedBounds = 0;
      function evaluate(id: number) {
        visitedTriangles++;
        const v = faces[id]!.vertices;
        triangle.a.copy(v[0]).applyMatrix4(transform);
        triangle.b.copy(v[1]).applyMatrix4(transform);
        triangle.c.copy(v[2]).applyMatrix4(transform);
        if (![triangle.a, triangle.b, triangle.c].every(finitePoint))
          throw new ArithmeticFailure();
        triangle.closestPointToPoint(center, closest);
        const distance = finite(
          Math.hypot(
            closest.x - center.x,
            closest.y - center.y,
            closest.z - center.z,
          ),
        );
        if (
          distance < bestDistance ||
          (distance === bestDistance && id < bestId)
        ) {
          bestDistance = distance;
          bestId = id;
          bestPoint.copy(closest);
          if (
            triangle.getBarycoord(closest, bestBarycentric) === null ||
            !finitePoint(bestBarycentric)
          )
            throw new ArithmeticFailure();
        }
      }
      function lower(node: Node) {
        visitedBounds++;
        return finite(
          Math.hypot(
            Math.max(node.box.min.x - local.x, 0, local.x - node.box.max.x),
            Math.max(node.box.min.y - local.y, 0, local.y - node.box.max.y),
            Math.max(node.box.min.z - local.z, 0, local.z - node.box.max.z),
          ) / inverseStretchBound,
        );
      }
      function visit(node: Node, lowerDistance: number) {
        // Exact-distance ties remain eligible for stable original-ID selection.
        if (lowerDistance > bestDistance) return;
        if ('faces' in node) {
          for (const id of node.faces) evaluate(id);
        } else {
          const left = lower(node.left);
          const right = lower(node.right);
          if (left <= right) {
            visit(node.left, left);
            visit(node.right, right);
          } else {
            visit(node.right, right);
            visit(node.left, left);
          }
        }
      }
      visit(tree, lower(tree));
      const distanceM = finite(bestDistance);
      const selected = faces[bestId]!;
      return Object.freeze({
        kind: 'surface-distance',
        numerics: 'float64-not-certified',
        triangle: Object.freeze({
          primitive: selected.primitive,
          triangleIndex: selected.triangleIndex,
        }),
        closestPoint: point(bestPoint),
        barycentric: point(bestBarycentric),
        distanceM,
        sphereGapM: finite(distanceM - sphere.radiusM),
        overlap: distanceM <= sphere.radiusM,
        visitedTriangles,
        visitedBounds,
        inverseStretchBound,
      });
    } catch (error) {
      if (!(error instanceof ArithmeticFailure)) throw error;
      return Object.freeze({
        kind: 'unresolved',
        reason: 'unrepresentable-arithmetic',
      });
    }
  }
  return Object.freeze({ triangleCount: faces.length, query });
}
