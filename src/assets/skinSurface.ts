import {
  Box3,
  type BufferGeometry,
  type Object3D,
  SkinnedMesh,
  Vector3,
} from 'three';

export interface SkinSurfacePart {
  readonly mesh: SkinnedMesh;
  readonly vertexIndices: readonly number[];
}

/** Select rendered vertices only. Weight ties use the first accessor component.
 * This identifies a conservative skin cluster, not a visually accepted contact patch. */
export function selectSkinSurface(
  scene: Object3D,
  joint: Object3D,
): readonly SkinSurfacePart[] {
  const descendants = new Set<Object3D>();
  joint.traverse((node) => descendants.add(node));
  const selected: SkinSurfacePart[] = [];
  scene.traverse((mesh) => {
    if (!(mesh instanceof SkinnedMesh)) return;
    const geometry: BufferGeometry = mesh.geometry;
    const weights = geometry.getAttribute('skinWeight');
    const joints = geometry.getAttribute('skinIndex');
    const index = geometry.index;
    const count = index?.count ?? weights.count;
    const start = mesh.geometry.drawRange.start;
    const end = Math.min(count, start + mesh.geometry.drawRange.count);
    const referenced = new Set<number>();
    for (let offset = start; offset < end; offset++)
      referenced.add(index?.getX(offset) ?? offset);
    const vertexIndices = [...referenced].filter((vertex) => {
      let dominant = 0;
      for (let component = 1; component < 4; component++) {
        if (
          weights.getComponent(vertex, component) >
          weights.getComponent(vertex, dominant)
        )
          dominant = component;
      }
      const bone = mesh.skeleton.bones[joints.getComponent(vertex, dominant)];
      return (
        bone !== undefined &&
        weights.getComponent(vertex, dominant) > 0 &&
        descendants.has(bone)
      );
    });
    if (vertexIndices.length) selected.push({ mesh, vertexIndices });
  });
  if (!selected.length)
    throw new Error('Contact skin surface has no rendered vertices');
  return selected;
}

/** Axis-aligned-box center plus farthest vertex: deterministic enclosing sphere
 * of the actual posed cluster. A minimal sphere or exact contact manifold is not claimed. */
export function measureSkinSurface(parts: readonly SkinSurfacePart[]): {
  center: Vector3;
  radiusM: number;
} {
  const bounds = new Box3();
  const points: Vector3[] = [];
  for (const { mesh, vertexIndices } of parts) {
    mesh.skeleton.update();
    for (const index of vertexIndices) {
      const point = mesh
        .getVertexPosition(index, new Vector3())
        .applyMatrix4(mesh.matrixWorld);
      bounds.expandByPoint(point);
      points.push(point);
    }
  }
  const center = bounds.getCenter(new Vector3());
  let radiusM = 0;
  for (const point of points)
    radiusM = Math.max(radiusM, point.distanceTo(center));
  if (!Number.isFinite(radiusM) || radiusM <= 0)
    throw new Error('Invalid measured contact surface');
  return { center, radiusM };
}
