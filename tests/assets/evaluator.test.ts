import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { bakeMotion } from '../../src/assets/bakeMotion';
import { createSourceEvaluator } from '../../src/assets/evaluateSource';
import { inspectGlb } from '../../src/assets/source';
import { clipId, durationMs } from '../../src/contracts';

test('actual Jab accessor samples produce deterministic measured hand/root curves without modifying source bytes', async () => {
  const bytes = new Uint8Array(
    readFileSync(
      'assets/android/motions/completed42-speed15/punch/android_punch.glb',
    ),
  );
  const source = inspectGlb(bytes).clips.find((c) => c.name === 'Jab');
  if (!source) throw new Error('Missing source');
  const input = {
    clipId: clipId('Jab'),
    category: 'punch' as const,
    durationMs: durationMs(source.durationSeconds * 1000),
    sampleRateHz: 120,
    sourceTimesMs: source.sampleTimes.map((t) => t * 1000),
    impacts: [
      {
        impactIndex: 0,
        startMs: durationMs((11 / 45) * 1000),
        endMs: durationMs((12 / 45) * 1000),
        damageShare: 1,
        shapeId: 'left-fist',
      },
    ],
    ownership: [
      {
        atMs: durationMs(0),
        horizontalOwner: 'authored-root' as const,
        verticalOwner: 'spatial-jump' as const,
      },
    ],
  };
  const derive = async () => {
    const evaluator = await createSourceEvaluator(bytes, 'Jab', [
      { shapeId: 'left-fist', bone: 'hand.L', radiusM: 0.08 },
    ]);
    try {
      return bakeMotion(input, evaluator.sample);
    } finally {
      evaluator.dispose();
    }
  };
  const first = await derive(),
    second = await derive();
  expect(first).toEqual(second);
  expect(first.definition.effectiveRangeM).toBeGreaterThan(0.3);
  expect(first.definition.effectiveRangeM).toBeLessThan(2);
  expect(first.shapes[0]?.keys.length).toBeGreaterThan(
    source.sampleTimes.length,
  );
});

test('actual source bake and runtime retain the same clip-zero root origin before and after one C root/world transform', async () => {
  const { createThreeAssetPack } = await import(
    '../../src/assets/threeAssetPack'
  );
  const { Vector3, Quaternion } = await import('three');
  for (const [category, names] of [
    ['punch', ['Jab', 'KungFuStraight', 'DivingLunge']],
    ['movement', ['CrouchMove']],
  ] as const) {
    const bytes = new Uint8Array(
      readFileSync(
        `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`,
      ),
    );
    const inspection = inspectGlb(bytes),
      pack = await createThreeAssetPack([bytes]),
      rig = pack.create('white');
    const bones = ['hand.L', 'hand.R', 'foot.L', 'foot.R'];
    for (const name of names) {
      const clip = inspection.clips.find((clip) => clip.name === name);
      if (!clip) throw new Error('Missing source');
      const times = [
        ...new Set([
          0,
          ...clip.sampleTimes,
          ...clip.sampleTimes
            .slice(1)
            .map((time, index) => (time + (clip.sampleTimes[index] ?? 0)) / 2),
        ]),
      ].sort((a, b) => a - b);
      const evaluator = await createSourceEvaluator(
        bytes,
        name,
        bones.map((bone) => ({ shapeId: bone, bone, radiusM: 0.08 })),
      );
      const facing = new Quaternion().setFromAxisAngle(
          new Vector3(0, 1, 0),
          0.71,
        ),
        anchor = new Vector3(3, 0.4, -2);
      for (const seconds of times) {
        const pose = evaluator.sample(durationMs(seconds * 1000));
        rig.seek(clipId(name), seconds);
        for (const shape of pose.shapes) {
          if (shape.volume.kind !== 'sphere') throw new Error('Fixture sphere');
          const bone = rig.node.getObjectByName(
            shape.shapeId.replaceAll('.', ''),
          );
          if (!bone) throw new Error('Missing runtime bone');
          const visible = bone.getWorldPosition(new Vector3()),
            sampled = new Vector3(
              shape.volume.center.x,
              shape.volume.center.y,
              shape.volume.center.z,
            );
          expect(
            visible.distanceTo(sampled),
            `${name}/${shape.shapeId}@${seconds}`,
          ).toBeLessThan(1e-6);
          const root = new Vector3(
            pose.root.position.x,
            pose.root.position.y,
            pose.root.position.z,
          );
          const renderedWorld = visible
            .clone()
            .add(root)
            .applyQuaternion(facing)
            .add(anchor);
          const sampledWorld = sampled
            .clone()
            .add(root)
            .applyQuaternion(facing)
            .add(anchor);
          expect(renderedWorld.distanceTo(sampledWorld)).toBeLessThan(1e-6);
        }
      }
      evaluator.dispose();
    }
    rig.dispose();
    pack.dispose();
  }
}, 30000); // Includes offline exact hull certification, not frame-time work.
