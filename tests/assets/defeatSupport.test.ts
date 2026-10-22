import { readFileSync } from 'node:fs';
import { Group, Matrix4, type Object3D, SkinnedMesh, Vector3 } from 'three';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { authorDeathClips } from '../../src/assets/deathAnimation';
import {
  createThreeAssetPack,
  type ThreeAssetPack,
} from '../../src/assets/threeAssetPack';
import { clipId, presentationTimeMs } from '../../src/contracts';

let pack: ThreeAssetPack;
beforeAll(async () => {
  const bytes = ['movement', 'jump', 'punch', 'kick'].map(
    (category) =>
      new Uint8Array(
        readFileSync(
          `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`,
        ),
      ),
  );
  const original = await createThreeAssetPack(bytes),
    seed = original.create('white');
  seed.seek(clipId('Idle'), 0);
  pack = await createThreeAssetPack(bytes, {}, authorDeathClips(seed.node));
  seed.dispose();
  original.dispose();
}, 30000);
afterAll(() => pack?.dispose());
function reference(node: Object3D) {
  node.updateWorldMatrix(true, true);
  const inverse = node.parent
      ? node.parent.matrixWorld.clone().invert()
      : new Matrix4(),
    min = new Vector3(Infinity, Infinity, Infinity),
    max = new Vector3(-Infinity, -Infinity, -Infinity);
  node.traverse((mesh) => {
    if (!(mesh instanceof SkinnedMesh)) return;
    for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) {
      const p = mesh
        .getVertexPosition(i, new Vector3())
        .applyMatrix4(mesh.matrixWorld)
        .applyMatrix4(inverse);
      min.min(p);
      max.max(p);
    }
  });
  return {
    min: { x: min.x, y: min.y, z: min.z },
    max: { x: max.x, y: max.y, z: max.z },
  };
}
test('support includes every B transform but excludes translated/rotated C parents and preserves skipped entry/replay', () => {
  const rig = pack.create('white'),
    parent = new Group();
  parent.position.set(9, 2.3, -7);
  parent.rotation.y = 0.8;
  parent.add(rig.node);
  rig.node.position.set(0.2, 0.11, -0.3);
  rig.node.rotation.y = -0.4;
  rig.node.scale.set(0.95, 1.05, 1.02);
  rig.seek(clipId('CartwheelKick'), 0.9);
  const entry = reference(rig.node),
    activation = presentationTimeMs(100);
  for (const time of [0.17, 0, 0.499, 0.0257509794, 0.5, 0.1]) {
    rig.seek(clipId('DefeatKick'), time, activation);
    const observed = rig.defeatPoseSupport?.();
    expect(observed).toBeDefined();
    expect(observed?.entryLocalMinY).toBeCloseTo(entry.min.y, 10);
    const exact = reference(rig.node);
    for (const side of ['min', 'max'] as const)
      for (const axis of ['x', 'y', 'z'] as const)
        expect(observed?.currentLocalBounds[side][axis]).toBeCloseTo(
          exact[side][axis],
          10,
        );
    if (time === 0)
      expect(observed?.currentLocalBounds.min.y).toBeCloseTo(entry.min.y, 10);
  }
  rig.seek(clipId('Idle'), 0.2);
  rig.seek(clipId('DefeatKick'), 0.17, activation);
  expect(rig.defeatPoseSupport?.()?.entryLocalMinY).toBeCloseTo(
    entry.min.y,
    10,
  );
  rig.dispose();
});
test('newly mounted dead actor has no invented inherited support', () => {
  const rig = pack.create('white');
  rig.seek(clipId('DefeatPunch'), 0.2, presentationTimeMs(100));
  expect(rig.defeatPoseSupport).toBeTypeOf('function');
  expect(rig.defeatPoseSupport?.()).toBeUndefined();
  rig.dispose();
});
