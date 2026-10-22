import { Mesh, type Object3D, SkinnedMesh, Vector3 } from 'three';
import type { SkinBoundsPlan } from './skinBounds';

export interface SkinBoundsArtifact {
  readonly algorithm: 'exact-weight-hull-v1';
  readonly meshes: readonly {
    readonly vertexCount: number;
    readonly groups: readonly {
      readonly joints: readonly number[];
      readonly weights: readonly number[];
      readonly indices: readonly number[];
    }[];
  }[];
  readonly stats: SkinBoundsPlan['stats'];
}
/** Offline only: preserve original vertex identities, including duplicate positions.
 * Certification belongs to prepareSkinBounds, never the runtime importer below. */
export function exportSkinBoundsArtifact(
  plan: SkinBoundsPlan,
): SkinBoundsArtifact {
  return {
    algorithm: 'exact-weight-hull-v1',
    meshes: plan.meshes.map((mesh) => {
      const indices = new Map<string, number[]>();
      for (let i = 0; i < mesh.positions.length / 3; i++) {
        const key = JSON.stringify([
          mesh.joints.slice(i * 4, i * 4 + 4),
          mesh.weights.slice(i * 4, i * 4 + 4),
          mesh.positions.slice(i * 3, i * 3 + 3),
        ]);
        const list = indices.get(key) ?? [];
        list.push(i);
        indices.set(key, list);
      }
      return {
        vertexCount: mesh.positions.length / 3,
        groups: mesh.groups.map((group) => ({
          joints: [...group.joints],
          weights: [...group.weights],
          indices: group.points.map((point) => {
            const list = indices.get(
              JSON.stringify([
                group.joints,
                group.weights,
                [point.x, point.y, point.z],
              ]),
            );
            const index = list?.shift();
            if (index === undefined)
              throw new Error('Missing certified original vertex');
            return index;
          }),
        })),
      };
    }),
    stats: { ...plan.stats },
  };
}
export function artifactRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid artifact record');
  return value as Record<string, unknown>;
}
function numericArray(value: unknown, count: number): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== count ||
    !value.every((item) => typeof item === 'number' && Number.isFinite(item))
  )
    throw new Error('Invalid artifact numeric array');
  return [...value];
}
/** Requires an already verified trusted artifact hash. Structural/source-tuple validation
 * is not a second hull proof: a caller-selected digest cannot authorize new geometry. */
export async function importSkinBoundsArtifact(
  root: Object3D,
  data: unknown,
  checkpoint: () => Promise<void>,
): Promise<SkinBoundsPlan> {
  const payload = artifactRecord(data);
  if (
    payload.algorithm !== 'exact-weight-hull-v1' ||
    !Array.isArray(payload.meshes)
  )
    throw new Error('Unsupported support artifact');
  const skins: SkinnedMesh[] = [];
  root.traverse((node) => {
    if (node instanceof SkinnedMesh) skins.push(node);
    else if (node instanceof Mesh)
      throw new Error('Unsupported non-skinned support surface');
  });
  if (!skins.length || skins.length !== payload.meshes.length)
    throw new Error('Artifact mesh mismatch');
  const meshes: SkinBoundsPlan['meshes'][number][] = [];
  let vertices = 0,
    retainedVertices = 0,
    groupCount = 0;
  for (let index = 0; index < skins.length; index++) {
    const skin = skins[index];
    if (!skin) throw new Error('Missing artifact mesh');
    const encoded = artifactRecord(payload.meshes[index]);
    const p = skin.geometry.getAttribute('position'),
      j = skin.geometry.getAttribute('skinIndex'),
      w = skin.geometry.getAttribute('skinWeight');
    if (
      !p ||
      !j ||
      !w ||
      p.itemSize !== 3 ||
      j.itemSize !== 4 ||
      w.itemSize !== 4 ||
      p.count !== j.count ||
      p.count !== w.count ||
      skin.geometry.morphAttributes.position?.length ||
      encoded.vertexCount !== p.count ||
      !Array.isArray(encoded.groups)
    )
      throw new Error('Artifact geometry mismatch');
    const positions: number[] = [],
      joints: number[] = [],
      weights: number[] = [];
    const tuples = new Map<string, Set<number>>();
    for (let i = 0; i < p.count; i++) {
      const point = [p.getX(i), p.getY(i), p.getZ(i)];
      const joint = Array.from({ length: 4 }, (_, component) =>
        j.getComponent(i, component),
      );
      const weight = Array.from({ length: 4 }, (_, component) =>
        w.getComponent(i, component),
      );
      if (
        !point.every(Number.isFinite) ||
        joint.some(
          (v) =>
            !Number.isInteger(v) || v < 0 || v >= skin.skeleton.bones.length,
        ) ||
        weight.some((v) => !Number.isFinite(v) || v < 0)
      )
        throw new Error('Invalid artifact source tuple');
      positions.push(...point);
      joints.push(...joint);
      weights.push(...weight);
      const key = JSON.stringify([joint, weight]);
      const members = tuples.get(key) ?? new Set<number>();
      members.add(i);
      tuples.set(key, members);
      if ((i + 1) % 1024 === 0) await checkpoint();
    }
    if (encoded.groups.length !== tuples.size)
      throw new Error('Artifact tuple coverage mismatch');
    const groups: SkinBoundsPlan['meshes'][number]['groups'][number][] = [];
    for (const raw of encoded.groups) {
      const group = artifactRecord(raw),
        joint = numericArray(group.joints, 4),
        weight = numericArray(group.weights, 4);
      const key = JSON.stringify([joint, weight]),
        members = tuples.get(key);
      if (
        !members ||
        !Array.isArray(group.indices) ||
        !group.indices.length ||
        group.indices.length > members.size
      )
        throw new Error('Artifact group mismatch');
      const selected = new Set<number>(),
        points: Vector3[] = [];
      for (const id of group.indices) {
        if (
          typeof id !== 'number' ||
          !Number.isInteger(id) ||
          !members.has(id) ||
          selected.has(id)
        )
          throw new Error('Invalid retained vertex index');
        selected.add(id);
        const x = positions[id * 3],
          y = positions[id * 3 + 1],
          z = positions[id * 3 + 2];
        if (x === undefined || y === undefined || z === undefined)
          throw new Error('Missing retained source point');
        points.push(Object.freeze(new Vector3(x, y, z)));
      }
      tuples.delete(key);
      groups.push(
        Object.freeze({
          joints: Object.freeze(joint),
          weights: Object.freeze(weight),
          points: Object.freeze(points),
        }),
      );
      retainedVertices += points.length;
    }
    if (tuples.size) throw new Error('Incomplete artifact tuple coverage');
    vertices += p.count;
    groupCount += groups.length;
    meshes.push(
      Object.freeze({
        positions: Object.freeze(positions),
        joints: Object.freeze(joints),
        weights: Object.freeze(weights),
        groups: Object.freeze(groups),
      }),
    );
    await checkpoint();
  }
  const stats = artifactRecord(payload.stats);
  if (
    stats.vertices !== vertices ||
    stats.retainedVertices !== retainedVertices ||
    stats.groups !== groupCount ||
    typeof stats.exactPlaneTests !== 'number' ||
    !Number.isSafeInteger(stats.exactPlaneTests) ||
    stats.exactPlaneTests < 0 ||
    typeof stats.fallbackGroups !== 'number' ||
    !Number.isSafeInteger(stats.fallbackGroups) ||
    stats.fallbackGroups < 0 ||
    stats.fallbackGroups > groupCount
  )
    throw new Error('Artifact proof receipt mismatch');
  return Object.freeze({
    meshes: Object.freeze(meshes),
    stats: Object.freeze({
      vertices,
      retainedVertices,
      groups: groupCount,
      exactPlaneTests: stats.exactPlaneTests,
      fallbackGroups: stats.fallbackGroups,
    }),
  });
}
