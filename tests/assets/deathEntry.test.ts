import { readFileSync } from 'node:fs';
import {
  Bone,
  Group,
  type Object3D,
  Quaternion,
  SkinnedMesh,
  Vector3,
} from 'three';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { clipId } from '../../src/contracts';
import { authorDeathClips } from '../../src/assets/deathAnimation';
import {
  createThreeAssetPack,
  type ThreeAssetPack,
} from '../../src/assets/threeAssetPack';
import { fixedSwingTwistPath } from '../../src/assets/entryRotation';

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
  const clips = authorDeathClips(seed.node);
  pack = await createThreeAssetPack(bytes, {}, clips);
  seed.dispose();
  original.dispose();
}, 30000);
afterAll(() => pack?.dispose());

function vertices(node: Object3D): Vector3[] {
  const points: Vector3[] = [];
  node.traverse((part) => {
    if (!(part instanceof SkinnedMesh)) return;
    part.skeleton.update();
    for (let i = 0; i < part.geometry.getAttribute('position').count; i++)
      points.push(
        part.getVertexPosition(i, new Vector3()).applyMatrix4(part.matrixWorld),
      );
  });
  return points;
}

test('fresh actors remain continuous across the independently proven moving-target quaternion seam', () => {
  const seam = 0.025750979417920462;
  for (const death of ['DefeatPunch', 'DefeatKick']) {
    const a = pack.create('white'),
      b = pack.create('white');
    try {
      a.seek(clipId('FrontKick'), 0.55);
      b.seek(clipId('FrontKick'), 0.55);
      a.seek(clipId(death), seam - 1e-8);
      b.seek(clipId(death), seam + 1e-8);
      a.node.traverse((bone) => {
        if (bone instanceof Bone) {
          const other = b.node.getObjectByName(bone.name);
          if (!other) throw new Error('Missing comparison bone');
          expect(
            bone.quaternion
              .clone()
              .normalize()
              .angleTo(other.quaternion.clone().normalize()),
            bone.name,
          ).toBeLessThan(1e-4);
        }
      });
      const first = vertices(a.node),
        second = vertices(b.node);
      for (let i = 0; i < first.length; i++)
        expect(first[i]?.distanceTo(second[i] ?? new Vector3())).toBeLessThan(
          1e-5,
        );
    } finally {
      a.dispose();
      b.dispose();
    }
  }
});

test('reachable inverted and side kicks collapse without an upright reset', () => {
  for (const [name, time] of [
    ['CartwheelKick', 0.9],
    ['ChineseCartwheelKick', 1.04],
    ['ButterflyKick', 0.94],
    ['DivingLunge', 0.6611110925674438],
  ] as const) {
    for (const death of ['DefeatPunch', 'DefeatKick']) {
      const actor = pack.create('white');
      try {
        actor.seek(clipId(name), time);
        for (let frame = 0; frame <= 20; frame++) {
          actor.seek(clipId(death), frame / 40);
          const head = actor.node.getObjectByName('head'),
            pelvis = actor.node.getObjectByName('pelvis');
          if (!head || !pelvis) throw new Error('Missing body axis');
          const up = head
            .getWorldPosition(new Vector3())
            .sub(pelvis.getWorldPosition(new Vector3()))
            .normalize();
          expect(up.y, `${name}/${death}@${frame / 40}`).toBeLessThan(0.5);
          if (frame >= 4) {
            let floor = Infinity;
            for (const point of vertices(actor.node))
              floor = Math.min(floor, point.y);
            expect(
              floor,
              `${name}/${death} local floor@${frame / 40}`,
            ).toBeGreaterThanOrEqual(-0.003);
          }
        }
      } finally {
        actor.dispose();
      }
    }
  }
}, 30000);

test('entry rotations are continuous throughout the blend, not only at its first sample', () => {
  for (const [name, time] of [
    ['FrontKick', 0.55],
    ['CartwheelKick', 0.9],
    ['ChineseCartwheelKick', 1.04],
    ['ButterflyKick', 0.94],
    ['Jump', 0.4],
  ] as const) {
    for (const death of ['DefeatPunch', 'DefeatKick']) {
      const actor = pack.create('white');
      try {
        actor.seek(clipId(name), time);
        let previous = new Map<string, Quaternion>();
        let previousSurface: Vector3[] | undefined;
        for (let frame = 0; frame <= 96; frame++) {
          actor.seek(clipId(death), frame / 960);
          const rotations = new Map<string, Quaternion>();
          actor.node.traverse((bone) => {
            if (!(bone instanceof Bone)) return;
            const rotation = bone.quaternion.clone().normalize();
            const before = previous.get(bone.name);
            if (before)
              expect(
                rotation.angleTo(before),
                `${name}/${death}/${bone.name}@${frame}/960`,
              ).toBeLessThan(0.15);
            rotations.set(bone.name, rotation);
          });
          previous = rotations;
          if (name === 'FrontKick') {
            const points = vertices(actor.node);
            if (previousSurface) {
              let maximum = 0;
              for (let index = 0; index < points.length; index++)
                maximum = Math.max(
                  maximum,
                  points[index]?.distanceTo(
                    previousSurface[index] ?? new Vector3(),
                  ) ?? Infinity,
                );
              expect(maximum).toBeLessThan(0.035);
            }
            previousSurface = points;
          }
        }
      } finally {
        actor.dispose();
      }
    }
  }
}, 60000);

test('entry transport preserves canonical Idle orientation and C-parent invariance for inverted poses', () => {
  for (const death of ['DefeatPunch', 'DefeatKick']) {
    const canonical = pack.create('white'),
      idle = pack.create('white');
    idle.seek(clipId('Idle'), 0);
    for (let frame = 0; frame <= 20; frame++) {
      canonical.seek(clipId(death), frame / 40);
      idle.seek(clipId(death), frame / 40);
      canonical.node.traverse((bone) => {
        if (!(bone instanceof Bone)) return;
        const counterpart = idle.node.getObjectByName(bone.name);
        if (!counterpart) throw new Error('Missing comparison bone');
        expect(
          bone.quaternion
            .clone()
            .normalize()
            .angleTo(counterpart.quaternion.clone().normalize()),
        ).toBeLessThan(1e-6);
      });
    }
    canonical.dispose();
    idle.dispose();
    const local = pack.create('white'),
      mounted = pack.create('white'),
      parent = new Group();
    parent.position.set(-3, 7, 4);
    parent.rotation.y = 0.7;
    parent.add(mounted.node);
    parent.updateMatrixWorld(true);
    const unchanged = parent.matrixWorld.clone();
    local.seek(clipId('CartwheelKick'), 0.9);
    mounted.seek(clipId('CartwheelKick'), 0.9);
    for (const time of [0, 0.025, 0.1, 0.25, 0.49, 0.5, 0.25, 0.5]) {
      local.seek(clipId(death), time);
      mounted.seek(clipId(death), time);
      local.node.traverse((bone) => {
        if (!(bone instanceof Bone)) return;
        const counterpart = mounted.node.getObjectByName(bone.name);
        if (!counterpart) throw new Error('Missing mounted comparison bone');
        expect(
          bone
            .getWorldPosition(new Vector3())
            .distanceTo(
              parent.worldToLocal(counterpart.getWorldPosition(new Vector3())),
            ),
        ).toBeLessThan(1e-6);
      });
      expect(parent.matrixWorld).toEqual(unchanged);
    }
    local.dispose();
    mounted.dispose();
  }
}, 30000);

test('fixed swing/twist endpoints and adjacent upright/side inputs have no classification boundary', () => {
  const axis = new Vector3(0, 1, 0),
    x = new Vector3(1, 0, 0),
    end = new Quaternion().setFromAxisAngle(x, -1.48);
  for (const angle of [0, Math.PI / 3, Math.PI / 2, Math.PI]) {
    const before = new Quaternion().setFromAxisAngle(x, angle - 1e-7),
      after = new Quaternion().setFromAxisAngle(x, angle + 1e-7);
    const first = fixedSwingTwistPath(before, end, axis),
      second = fixedSwingTwistPath(after, end, axis);
    expect(first(0).angleTo(before)).toBeLessThan(1e-6);
    expect(first(1).angleTo(end)).toBeLessThan(1e-6);
    for (let frame = 0; frame <= 100; frame++)
      expect(first(frame / 100).angleTo(second(frame / 100))).toBeLessThan(
        1e-5,
      );
  }
});
