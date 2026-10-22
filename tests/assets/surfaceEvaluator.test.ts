import { readFileSync } from 'node:fs';
import { type BufferGeometry, SkinnedMesh, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { createSourceEvaluator } from '../../src/assets/evaluateSource';
import { inspectGlb } from '../../src/assets/source';
import { createThreeAssetPack } from '../../src/assets/threeAssetPack';
import { clipId, durationMs } from '../../src/contracts';

for (const [category, name, joint] of [
  ['punch', 'Cross', 'hand.R'],
  ['kick', 'FrontKick', 'foot.R'],
] as const) {
  test(`${name} measured surface encloses actual rendered limb, with the runtime root removed exactly once`, async () => {
    const bytes = new Uint8Array(
      readFileSync(
        `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`,
      ),
    );
    const original = bytes.slice();
    const clip = inspectGlb(bytes).clips.find((clip) => clip.name === name);
    if (!clip) throw new Error('Missing source clip');
    const pack = await createThreeAssetPack([bytes]);
    const rig = pack.create('white');
    const evaluator = await createSourceEvaluator(bytes, name, [
      {
        shapeId: 'contact',
        bone: joint,
        surface: 'dominant-skin-subtree',
      },
    ]);
    try {
      const contactBone = rig.node.getObjectByName(joint.replace('.', ''));
      if (!contactBone) throw new Error('Missing contact joint');
      const descendants = new Set<string>();
      contactBone.traverse((node) => descendants.add(node.name));
      const selected: { mesh: SkinnedMesh; indices: number[] }[] = [];
      rig.node.traverse((mesh) => {
        if (!(mesh instanceof SkinnedMesh)) return;
        const geometry: BufferGeometry = mesh.geometry;
        const weights = geometry.getAttribute('skinWeight');
        const joints = geometry.getAttribute('skinIndex');
        const index = geometry.index;
        const referenced = index
          ? Array.from(index.array)
          : Array.from({ length: weights.count }, (_, i) => i);
        const indices = [...new Set(referenced)].filter((vertex) => {
          let dominant = 0;
          for (let channel = 1; channel < 4; channel++) {
            if (
              weights.getComponent(vertex, channel) >
              weights.getComponent(vertex, dominant)
            )
              dominant = channel;
          }
          const bone =
            mesh.skeleton.bones[joints.getComponent(vertex, dominant)];
          return bone !== undefined && descendants.has(bone.name);
        });
        if (indices.length) selected.push({ mesh, indices });
      });
      expect(selected.flatMap((part) => part.indices).length).toBeGreaterThan(
        0,
      );
      const times = [
        ...new Set([
          0,
          ...clip.sampleTimes,
          ...clip.sampleTimes
            .slice(1)
            .map((time, i) => (time + (clip.sampleTimes[i] ?? 0)) / 2),
        ]),
      ].sort((a, b) => a - b);
      const radii: number[] = [];
      for (const seconds of times) {
        const sample = evaluator.sample(durationMs(seconds * 1000));
        const volume = sample.shapes[0]?.volume;
        if (volume?.kind !== 'sphere')
          throw new Error('Expected measured sphere');
        rig.seek(clipId(name), seconds);
        const center = new Vector3(
          volume.center.x,
          volume.center.y,
          volume.center.z,
        );
        let furthest = 0;
        for (const { mesh, indices } of selected) {
          mesh.skeleton.update();
          for (const index of indices) {
            const point = mesh
              .getVertexPosition(index, new Vector3())
              .applyMatrix4(mesh.matrixWorld);
            furthest = Math.max(furthest, point.distanceTo(center));
          }
        }
        expect(furthest, `${name}@${seconds}`).toBeLessThanOrEqual(
          volume.radiusM + 1e-6,
        );
        expect(furthest).toBeCloseTo(volume.radiusM, 6);
        radii.push(volume.radiusM);
      }
      expect(new Set(radii).size).toBeGreaterThan(1);
      expect(Buffer.from(bytes).equals(original)).toBe(true);
    } finally {
      evaluator.dispose();
      rig.dispose();
      pack.dispose();
    }
  }, 30000); // Cold source loading includes exact hull certification.
}
