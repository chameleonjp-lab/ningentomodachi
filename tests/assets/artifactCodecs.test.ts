import {
  AnimationClip,
  Bone,
  BoxGeometry,
  BufferAttribute,
  Group,
  Matrix4,
  MeshStandardMaterial,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { expect, test } from 'vitest';
import {
  exportDeathClipArtifact,
  importDeathClipArtifact,
  verifyDeathClipTargets,
} from '../../src/assets/deathClipArtifact';
import {
  createSkinBounds,
  prepareSkinBounds,
} from '../../src/assets/skinBounds';
import {
  exportSkinBoundsArtifact,
  importSkinBoundsArtifact,
} from '../../src/assets/skinBoundsArtifact';

const checkpoint = async () => {};

test('offline hull indices restore exact tuple bounds and reject malformed source references', async () => {
  const root = new Group(),
    bone = new Bone(),
    geometry = new BoxGeometry();
  const count = geometry.getAttribute('position').count,
    weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute(
    'skinIndex',
    new BufferAttribute(new Uint16Array(count * 4), 4),
  );
  geometry.setAttribute('skinWeight', new BufferAttribute(weights, 4));
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  root.add(bone, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton([bone]));
  const proof = prepareSkinBounds(root),
    artifact = exportSkinBoundsArtifact(proof);
  const restored = await importSkinBoundsArtifact(root, artifact, checkpoint),
    bound = createSkinBounds(root, restored);
  expect(restored.stats).toEqual(proof.stats);
  for (let pose = 0; pose < 20; pose++) {
    bone.rotation.set(pose * 0.17, pose * -0.12, pose * 0.08);
    bone.scale.set(0.8 + pose * 0.01, 1.3, 0.6);
    root.updateMatrixWorld(true);
    const actual = bound.measure(new Matrix4()),
      min = new Vector3(Infinity, Infinity, Infinity),
      max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < count; i++) {
      const p = mesh
        .getVertexPosition(i, new Vector3())
        .applyMatrix4(mesh.matrixWorld);
      min.min(p);
      max.max(p);
    }
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(actual.min[axis]).toBeCloseTo(min[axis], 12);
      expect(actual.max[axis]).toBeCloseTo(max[axis], 12);
    }
  }
  const first = artifact.meshes[0],
    group = first?.groups[0];
  if (!first || !group) throw new Error('Fixture');
  for (const invalidGroup of [
    { ...group, indices: [count] },
    { ...group, indices: [0, 0] },
    { ...group, joints: [999, 0, 0, 0] },
    { ...group, weights: [NaN, 0, 0, 0] },
  ])
    await expect(
      importSkinBoundsArtifact(
        root,
        { ...artifact, meshes: [{ ...first, groups: [invalidGroup] }] },
        checkpoint,
      ),
    ).rejects.toThrow();
  await expect(
    importSkinBoundsArtifact(
      root,
      { ...artifact, meshes: [{ ...first, groups: [] }] },
      checkpoint,
    ),
  ).rejects.toThrow('coverage');
  geometry.dispose();
  mesh.material.dispose();
  mesh.skeleton.dispose();
});

test('canonical track codec preserves every FLOAT bit including negative zero, with strict bone coverage', async () => {
  const root = new Group(),
    bones = [
      'root',
      'pelvis',
      ...Array.from({ length: 51 }, (_, i) => `bone${i}`),
    ];
  for (const name of bones) {
    const bone = new Bone();
    bone.name = name;
    root.add(bone);
  }
  const times = Array.from({ length: 121 }, (_, i) => i / 240);
  const tracks = bones.flatMap((name) => [
    new QuaternionKeyframeTrack(
      `${name}.quaternion`,
      times,
      times.flatMap(() => [0, -0, 0, 1]),
    ),
    new VectorKeyframeTrack(`${name}.scale`, [0, 0.5], [1, 1, 1, 1, 1, 1]),
    ...(name === 'root'
      ? []
      : [
          new VectorKeyframeTrack(
            `${name}.position`,
            name === 'pelvis' ? times : [0, 0.5],
            (name === 'pelvis' ? times : [0, 0.5]).flatMap(() => [-0, 0, 0]),
          ),
        ]),
  ]);
  const original = ['DefeatPunch', 'DefeatKick'].map(
    (name) => new AnimationClip(name, 0.5, tracks),
  );
  const encoded = exportDeathClipArtifact(original),
    json: unknown = JSON.parse(JSON.stringify(encoded));
  const decoded = await importDeathClipArtifact(json, checkpoint);
  verifyDeathClipTargets(root, decoded);
  for (let clip = 0; clip < original.length; clip++)
    for (let track = 0; track < tracks.length; track++) {
      const before = original[clip]?.tracks[track],
        after = decoded[clip]?.tracks[track];
      if (!before || !after) throw new Error('Fixture');
      expect(after.times).toEqual(before.times);
      expect(after.values).toEqual(before.values);
      expect(new Uint8Array(after.values.buffer)).toEqual(
        new Uint8Array(before.values.buffer),
      );
    }
  await expect(
    importDeathClipArtifact(
      {
        ...encoded,
        clips: encoded.clips.map((clip) => ({ ...clip, duration: 0.6 })),
      },
      checkpoint,
    ),
  ).rejects.toThrow('identity');
  const first = decoded[0]?.tracks[0];
  if (!first) throw new Error('Fixture');
  first.name = 'foreign.quaternion';
  expect(() => verifyDeathClipTargets(root, decoded)).toThrow('bone track');
});
