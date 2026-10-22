import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import { expect, test } from 'vitest';
import {
  createSkinBounds,
  prepareSkinBounds,
} from '../../src/assets/skinBounds';

function fixture() {
  const node = new Group(),
    a = new Bone(),
    b = new Bone();
  node.add(a, b);
  const points = [
    [-1, -1, -1],
    [-1, -1, 1],
    [-1, 1, -1],
    [-1, 1, 1],
    [1, -1, -1],
    [1, -1, 1],
    [1, 1, -1],
    [1, 1, 1],
    [0, 0, 0],
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(points.flat(), 3),
  );
  geometry.setAttribute(
    'skinIndex',
    new Uint16BufferAttribute(
      points.flatMap(() => [0, 1, 0, 0]),
      4,
    ),
  );
  geometry.setAttribute(
    'skinWeight',
    new Float32BufferAttribute(
      points.flatMap(() => [0.3, 0.7, 0, 0]),
      4,
    ),
  );
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  node.add(mesh);
  node.updateMatrixWorld(true);
  mesh.bind(new Skeleton([a, b]));
  return { node, mesh, a, b };
}
test('exact tuple hull contains every source point and preserves six extrema under blended affine skinning', () => {
  const { node, mesh, a, b } = fixture(),
    plan = prepareSkinBounds(node),
    evaluator = createSkinBounds(node, plan);
  expect(plan.stats.vertices).toBe(9);
  expect(plan.stats.retainedVertices).toBe(8);
  expect(plan.stats.exactPlaneTests).toBeGreaterThan(0);
  for (let i = 0; i < 80; i++) {
    a.rotation.set(i * 0.13, -i * 0.07, i * 0.11);
    b.rotation.set(i * 0.03, i * 0.17, -i * 0.09);
    a.position.set(i * 0.01, -i * 0.02, i * 0.005);
    b.scale.set(0.8 + i * 0.001, 1.2, 0.9);
    node.updateMatrixWorld(true);
    const inverse = new Matrix4().makeRotationY(0.7).setPosition(2, 3, 4),
      bounds = evaluator.measure(inverse),
      min = new Vector3(Infinity, Infinity, Infinity),
      max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let j = 0; j < 9; j++) {
      const point = mesh
        .getVertexPosition(j, new Vector3())
        .applyMatrix4(mesh.matrixWorld)
        .applyMatrix4(inverse);
      min.min(point);
      max.max(point);
    }
    expect(
      new Vector3(bounds.min.x, bounds.min.y, bounds.min.z).distanceTo(min),
    ).toBeLessThan(1e-12);
    expect(
      new Vector3(bounds.max.x, bounds.max.y, bounds.max.z).distanceTo(max),
    ).toBeLessThan(1e-12);
  }
  mesh.geometry.dispose();
  mesh.material.dispose();
  mesh.skeleton.dispose();
});
test('uncertain/coplanar groups keep all vertices and exact weight tuples never quantize together', () => {
  const { node, mesh } = fixture();
  const p = mesh.geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setZ(i, 0);
  mesh.geometry.getAttribute('skinWeight').setX(0, 0.3000001);
  const plan = prepareSkinBounds(node);
  expect(plan.stats.retainedVertices).toBe(9);
  expect(plan.stats.groups).toBe(2);
  expect(plan.stats.fallbackGroups).toBeGreaterThan(0);
  mesh.geometry.dispose();
  mesh.material.dispose();
  mesh.skeleton.dispose();
});
test('cached plans reject changed rest geometry or weights instead of silently using stale bounds', () => {
  const { node, mesh } = fixture(),
    plan = prepareSkinBounds(node);
  mesh.geometry.getAttribute('position').setY(8, 5);
  expect(() => createSkinBounds(node, plan)).toThrow();
  mesh.geometry.dispose();
  mesh.material.dispose();
  mesh.skeleton.dispose();
});
