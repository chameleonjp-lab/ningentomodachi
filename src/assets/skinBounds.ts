import { Matrix4, Mesh, type Object3D, SkinnedMesh, Vector3 } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import type { DefeatPoseSupportObservation } from '../contracts';

type Bounds = DefeatPoseSupportObservation['currentLocalBounds'];
type ExactPoint = readonly [bigint, bigint, bigint];
interface GroupPlan {
  readonly joints: readonly number[];
  readonly weights: readonly number[];
  readonly points: readonly Vector3[];
}
interface MeshPlan {
  readonly positions: readonly number[];
  readonly joints: readonly number[];
  readonly weights: readonly number[];
  readonly groups: readonly GroupPlan[];
}
export interface SkinBoundsPlan {
  readonly meshes: readonly MeshPlan[];
  readonly stats: {
    readonly vertices: number;
    readonly retainedVertices: number;
    readonly groups: number;
    readonly exactPlaneTests: number;
    readonly fallbackGroups: number;
  };
}
const bits = new DataView(new ArrayBuffer(4));
function integer(value: number): bigint {
  bits.setFloat32(0, value);
  if (bits.getFloat32(0) !== value || !Number.isFinite(value))
    throw new Error('Non-FLOAT hull point');
  const b = bits.getUint32(0),
    exponent = (b >>> 23) & 255,
    mantissa = (b & 0x7fffff) | (exponent ? 0x800000 : 0);
  // Every finite FLOAT accessor value is an exact integer times 2^-149.
  return (
    (BigInt(mantissa) * (b >>> 31 ? -1n : 1n)) <<
    BigInt(exponent ? exponent - 1 : 0)
  );
}
const subtract = (a: ExactPoint, b: ExactPoint): ExactPoint => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const cross = (a: ExactPoint, b: ExactPoint): ExactPoint => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: ExactPoint, b: ExactPoint) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** QuickHull only proposes vertices. Exact dyadic supporting planes plus closed,
 * connected oriented topology certify containment; any uncertainty retains ALL points. */
function certifiedHull(points: readonly Vector3[]): {
  points: readonly Vector3[];
  tests: number;
  fallback: boolean;
} {
  if (points.length < 4) return { points, tests: 0, fallback: true };
  try {
    const hull = new ConvexHull().setFromPoints([...points]),
      ids = new Map(points.map((p, i) => [p, i])),
      selected = new Set<number>(),
      edges = new Map<string, number>();
    const exact = points.map(
      (p): ExactPoint => [integer(p.x), integer(p.y), integer(p.z)],
    );
    let tests = 0;
    for (let faceIndex = 0; faceIndex < hull.faces.length; faceIndex++) {
      const face = hull.faces[faceIndex];
      if (!face) throw new Error('Missing face');
      const edge = face.edge;
      if (edge.next.next.next !== edge)
        throw new Error('Non-triangular certificate face');
      const triangle = [
        edge.vertex.point,
        edge.next.vertex.point,
        edge.next.next.vertex.point,
      ].map((p) => ids.get(p));
      if (triangle.some((i) => i === undefined) || new Set(triangle).size !== 3)
        throw new Error('Invalid face');
      const a = exact[triangle[0] ?? -1],
        b = exact[triangle[1] ?? -1],
        c = exact[triangle[2] ?? -1];
      if (!a || !b || !c) throw new Error('Missing exact vertex');
      for (let i = 0; i < 3; i++) {
        const from = triangle[i],
          to = triangle[(i + 1) % 3];
        if (from === undefined || to === undefined)
          throw new Error('Missing edge');
        selected.add(from);
        const key = `${from},${to}`;
        if (edges.has(key)) throw new Error('Duplicate oriented edge');
        edges.set(key, faceIndex);
      }
      const normal = cross(subtract(b, a), subtract(c, a));
      if (normal.every((v) => v === 0n)) throw new Error('Degenerate face');
      let interior = false;
      for (const point of exact) {
        const sign = dot(normal, subtract(point, a));
        tests++;
        if (sign > 0n) throw new Error('Point outside exact hull');
        if (sign < 0n) interior = true;
      }
      if (!interior) throw new Error('Coplanar group');
    }
    if (
      !hull.faces.length ||
      selected.size - edges.size / 2 + hull.faces.length !== 2
    )
      throw new Error('Nonclosed hull');
    const neighbors = new Map<number, Set<number>>();
    for (const [key, face] of edges) {
      const [a, b] = key.split(','),
        other = edges.get(`${b},${a}`);
      if (other === undefined) throw new Error('Open hull');
      let adjacent = neighbors.get(face);
      if (!adjacent) {
        adjacent = new Set();
        neighbors.set(face, adjacent);
      }
      adjacent.add(other);
    }
    const visited = new Set<number>(),
      pending = [0];
    while (pending.length) {
      const face = pending.pop();
      if (face === undefined || visited.has(face)) continue;
      visited.add(face);
      for (const adjacent of neighbors.get(face) ?? []) pending.push(adjacent);
    }
    if (visited.size !== hull.faces.length)
      throw new Error('Disconnected hull');
    return {
      points: [...selected].map((i) => {
        const point = points[i];
        if (!point) throw new Error('Missing retained point');
        return point;
      }),
      tests,
      fallback: false,
    };
  } catch {
    return { points, tests: 0, fallback: true };
  }
}
function meshesOf(root: Object3D): SkinnedMesh[] {
  const meshes: SkinnedMesh[] = [];
  root.traverse((node) => {
    if (node instanceof SkinnedMesh) meshes.push(node);
    else if (node instanceof Mesh)
      throw new Error('Unsupported non-skinned support surface');
  });
  if (!meshes.length) throw new Error('No skinned support surface');
  return meshes;
}
function attributes(mesh: SkinnedMesh) {
  const geometry = mesh.geometry,
    position = geometry.getAttribute('position'),
    joints = geometry.getAttribute('skinIndex'),
    weights = geometry.getAttribute('skinWeight');
  if (
    !position ||
    !joints ||
    !weights ||
    position.itemSize !== 3 ||
    joints.itemSize !== 4 ||
    weights.itemSize !== 4 ||
    position.count !== joints.count ||
    position.count !== weights.count ||
    geometry.morphAttributes.position?.length
  )
    throw new Error('Unsupported support geometry');
  return { position, joints, weights };
}
export function prepareSkinBounds(root: Object3D): SkinBoundsPlan {
  const stats = {
    vertices: 0,
    retainedVertices: 0,
    groups: 0,
    exactPlaneTests: 0,
    fallbackGroups: 0,
  };
  const meshes = meshesOf(root).map((mesh) => {
    const a = attributes(mesh),
      positions: number[] = [],
      joints: number[] = [],
      weights: number[] = [],
      groups = new Map<
        string,
        { joints: number[]; weights: number[]; points: Vector3[] }
      >();
    for (let i = 0; i < a.position.count; i++) {
      const p = new Vector3().fromBufferAttribute(a.position, i),
        j = Array.from({ length: 4 }, (_, k) => a.joints.getComponent(i, k)),
        w = Array.from({ length: 4 }, (_, k) => a.weights.getComponent(i, k));
      if (
        ![p.x, p.y, p.z, ...w].every(Number.isFinite) ||
        w.some((value) => value < 0) ||
        j.some(
          (value) =>
            !Number.isInteger(value) ||
            value < 0 ||
            value >= mesh.skeleton.bones.length,
        )
      )
        throw new Error('Invalid support tuple');
      positions.push(p.x, p.y, p.z);
      joints.push(...j);
      weights.push(...w);
      const key = JSON.stringify([j, w]);
      let group = groups.get(key);
      if (!group) {
        group = { joints: j, weights: w, points: [] };
        groups.set(key, group);
      }
      group.points.push(p);
    }
    stats.vertices += a.position.count;
    stats.groups += groups.size;
    const plans = [...groups.values()].map((group) => {
      const proof = certifiedHull(group.points);
      stats.retainedVertices += proof.points.length;
      stats.exactPlaneTests += proof.tests;
      if (proof.fallback) stats.fallbackGroups++;
      return {
        joints: Object.freeze(group.joints),
        weights: Object.freeze(group.weights),
        points: Object.freeze(
          proof.points.map((point) => Object.freeze(point)),
        ),
      };
    });
    return Object.freeze({
      positions: Object.freeze(positions),
      joints: Object.freeze(joints),
      weights: Object.freeze(weights),
      groups: Object.freeze(plans.map((plan) => Object.freeze(plan))),
    });
  });
  return Object.freeze({
    meshes: Object.freeze(meshes),
    stats: Object.freeze(stats),
  });
}
export function createSkinBounds(
  root: Object3D,
  plan: SkinBoundsPlan,
): { measure(spaceInverse: Matrix4): Bounds } {
  const meshes = meshesOf(root);
  if (meshes.length !== plan.meshes.length)
    throw new Error('Support plan mesh mismatch');
  const attached = meshes.map((mesh, index) => {
    const source = plan.meshes[index],
      a = attributes(mesh);
    if (!source || source.positions.length !== a.position.count * 3)
      throw new Error('Support plan geometry mismatch');
    for (let i = 0; i < a.position.count; i++) {
      for (let k = 0; k < 3; k++)
        if (a.position.getComponent(i, k) !== source.positions[i * 3 + k])
          throw new Error('Support plan position mismatch');
      for (let k = 0; k < 4; k++)
        if (
          a.joints.getComponent(i, k) !== source.joints[i * 4 + k] ||
          a.weights.getComponent(i, k) !== source.weights[i * 4 + k]
        )
          throw new Error('Support plan weight mismatch');
    }
    return { mesh, groups: source.groups };
  });
  const combined = new Matrix4(),
    boneMatrix = new Matrix4();
  return {
    measure(spaceInverse) {
      return measureBoundSkin(attached, spaceInverse, combined, boneMatrix);
    },
  };
}
type BoundSkin = Readonly<{
  groups: readonly GroupPlan[];
  mesh: Readonly<{
    matrixWorld: Matrix4;
    bindMatrix: Matrix4;
    bindMatrixInverse: Matrix4;
    skeleton: Readonly<{
      bones: readonly Readonly<{ matrixWorld: Matrix4 }>[];
      boneInverses: readonly Matrix4[];
    }>;
  }>;
}>;
function measureBoundSkin(
  attached: readonly BoundSkin[],
  spaceInverse: Matrix4,
  combined: Matrix4,
  boneMatrix: Matrix4,
): Bounds {
  const min = new Vector3(Infinity, Infinity, Infinity),
    max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const { mesh, groups } of attached)
    for (const group of groups) {
      const e = combined.elements;
      e.fill(0);
      e[15] = 1;
      for (let i = 0; i < 4; i++) {
        const weight = group.weights[i],
          index = group.joints[i];
        if (weight === undefined || index === undefined)
          throw new Error('Missing support tuple');
        if (weight === 0) continue;
        const bone = mesh.skeleton.bones[index],
          inverse = mesh.skeleton.boneInverses[index];
        if (!bone || !inverse) throw new Error('Missing support bone');
        boneMatrix.multiplyMatrices(bone.matrixWorld, inverse);
        for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14])
          e[k] = (e[k] ?? 0) + (boneMatrix.elements[k] ?? 0) * weight;
      }
      // Do not normalize weights or divide by their sum. Three's Vector3 skinning
      // adds weighted XYZ and then applies bindMatrixInverse with homogeneous w=1.
      combined
        .multiply(mesh.bindMatrix)
        .premultiply(mesh.bindMatrixInverse)
        .premultiply(mesh.matrixWorld)
        .premultiply(spaceInverse);
      for (const p of group.points) {
        const x =
            (e[0] ?? 0) * p.x +
            (e[4] ?? 0) * p.y +
            (e[8] ?? 0) * p.z +
            (e[12] ?? 0),
          y =
            (e[1] ?? 0) * p.x +
            (e[5] ?? 0) * p.y +
            (e[9] ?? 0) * p.z +
            (e[13] ?? 0),
          z =
            (e[2] ?? 0) * p.x +
            (e[6] ?? 0) * p.y +
            (e[10] ?? 0) * p.z +
            (e[14] ?? 0);
        min.x = Math.min(min.x, x);
        min.y = Math.min(min.y, y);
        min.z = Math.min(min.z, z);
        max.x = Math.max(max.x, x);
        max.y = Math.max(max.y, y);
        max.z = Math.max(max.z, z);
      }
    }
  if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite))
    throw new Error('Unavailable finite support');
  return {
    min: { x: min.x, y: min.y, z: min.z },
    max: { x: max.x, y: max.y, z: max.z },
  };
}
/** CPU transform bindings only. No Mesh, Skeleton, materials or geometry ownership. */
export interface SkinMatrixBinding {
  readonly matrixWorld: Matrix4;
  readonly bindMatrix: Matrix4;
  readonly bindMatrixInverse: Matrix4;
  readonly bones: readonly Readonly<{ world: Matrix4; inverse: Matrix4 }>[];
}
export function createMatrixSkinBounds(
  plan: SkinBoundsPlan,
  bindings: () => readonly SkinMatrixBinding[],
): { measure(spaceInverse: Matrix4): Bounds } {
  const combined = new Matrix4(),
    boneMatrix = new Matrix4();
  return {
    measure(spaceInverse) {
      // Capture every binding before arithmetic so a late malformed binding never
      // produces a partially measured result. Clones detach mutable callers.
      const finiteMatrix = (m: Matrix4): Matrix4 => {
        if (
          m?.elements.length !== 16 ||
          !Array.from(
            { length: 16 },
            (_, i) =>
              Object.hasOwn(m.elements, i) && Number.isFinite(m.elements[i]),
          ).every(Boolean)
        )
          throw Error('Invalid support matrix binding');
        return m.clone();
      };
      const space = finiteMatrix(spaceInverse),
        source = bindings();
      if (source.length !== plan.meshes.length)
        throw Error('Support matrix layout mismatch');
      const captured = Array.from(source, (mesh, index) => {
        const meshPlan = plan.meshes[index];
        if (!mesh || !meshPlan) throw Error('Missing support matrix binding');
        const bones = Array.from(mesh.bones, (bone) => {
          if (!bone) throw Error('Missing support bone matrix');
          return {
            world: finiteMatrix(bone.world),
            inverse: finiteMatrix(bone.inverse),
          };
        });
        const groups = meshPlan.groups;
        for (const group of groups)
          for (let i = 0; i < 4; i++)
            if (group.weights[i] !== 0 && !bones[group.joints[i] ?? -1])
              throw Error('Missing support bone');
        return {
          matrixWorld: finiteMatrix(mesh.matrixWorld),
          bindMatrix: finiteMatrix(mesh.bindMatrix),
          bindMatrixInverse: finiteMatrix(mesh.bindMatrixInverse),
          bones,
          groups,
        };
      });
      const attached = captured.map((mesh) => ({
        groups: mesh.groups,
        mesh: {
          matrixWorld: mesh.matrixWorld,
          bindMatrix: mesh.bindMatrix,
          bindMatrixInverse: mesh.bindMatrixInverse,
          skeleton: {
            bones: mesh.bones.map((bone) => ({ matrixWorld: bone.world })),
            boneInverses: mesh.bones.map((bone) => bone.inverse),
          },
        },
      }));
      return measureBoundSkin(attached, space, combined, boneMatrix);
    },
  };
}
