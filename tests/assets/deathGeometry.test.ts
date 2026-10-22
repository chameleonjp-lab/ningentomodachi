import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Group, SkinnedMesh, Vector3 } from 'three';
import { clipId } from '../../src/contracts';
import { createThreeAssetPack } from '../../src/assets/threeAssetPack';
import { authorDeathClips } from '../../src/assets/deathAnimation';
const source = new Uint8Array(
  readFileSync(
    'assets/android/motions/completed42-speed15/movement/android_movement.glb',
  ),
);
test('articulated death candidates preserve the source, settle the complete mesh and remain continuous across dense samples', async () => {
  const original = await createThreeAssetPack([source]),
    seed = original.create('white');
  seed.seek(clipId('Idle'), 0);
  const before = seed.node.toJSON();
  const clips = authorDeathClips(seed.node);
  expect(seed.node.toJSON()).toEqual(before);
  const pack = await createThreeAssetPack([source], {}, clips);
  for (const clip of clips) {
    expect(clip.duration).toBe(0.5);
    expect(
      clip.tracks.filter((t) => t.name.endsWith('.quaternion')).length,
    ).toBeGreaterThan(14);
    expect(clip.tracks.some((t) => t.name === 'pelvis.position')).toBe(true);
    expect(clip.tracks.some((t) => t.name === 'root.position')).toBe(false);
    const actor = pack.create('white');
    let previous: Vector3[] | undefined;
    for (let frame = 0; frame <= 240; frame++) {
      actor.seek(clipId(clip.name), frame / 480);
      let min = Infinity;
      const points: Vector3[] = [];
      actor.node.traverse((node) => {
        if (node instanceof SkinnedMesh) {
          node.skeleton.update();
          const v = new Vector3();
          for (
            let i = 0;
            i < node.geometry.getAttribute('position').count;
            i++
          ) {
            const p = node
              .getVertexPosition(i, v)
              .applyMatrix4(node.matrixWorld);
            min = Math.min(min, p.y);
            if (i % 47 === 0) points.push(p.clone());
          }
        }
      });
      expect(min, `${clip.name} floor at${frame}/480`).toBeGreaterThanOrEqual(
        -0.003,
      );
      expect(min).toBeLessThan(0.009);
      if (previous)
        for (let i = 0; i < points.length; i++)
          expect(
            points[i]?.distanceTo(previous[i] ?? new Vector3()),
          ).toBeLessThan(0.12);
      previous = points;
    }
    expect(
      actor.node.getObjectByName('head')?.getWorldPosition(new Vector3()).y,
    ).toBeLessThan(0.65);
    expect(
      actor.node.getObjectByName('pelvis')?.getWorldPosition(new Vector3()).y,
    ).toBeLessThan(0.55);
    actor.dispose();
  }
  seed.dispose();
  original.dispose();
  pack.dispose();
}, 60000); // 22,259,242 full-vertex samples plus cold preparation; preserve every assertion under CPU contention.

test('defeat entry preserves the last visible articulated attack pose, then reaches the same terminal pose without changing another actor', async () => {
  const sources = ['movement', 'jump', 'punch', 'kick'].map(
    (category) =>
      new Uint8Array(
        readFileSync(
          `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`,
        ),
      ),
  );
  const original = await createThreeAssetPack(sources),
    seed = original.create('white');
  seed.seek(clipId('Idle'), 0);
  const clips = authorDeathClips(seed.node),
    pack = await createThreeAssetPack(sources, {}, clips);
  const survivor = pack.create('white');
  survivor.seek(clipId('Idle'), 0);
  const unchanged = survivor.node.getObjectByName('head')?.matrixWorld.clone();
  for (const [name, time] of [
    ['Jab', 0.24444444],
    ['FrontKick', 0.55],
    ['Jump', 0.4],
    ['SpinningAttack', 0.9],
    ['AcrobaticCombo', 1.8],
  ] as const)
    for (const death of clips) {
      const actor = pack.create('white');
      actor.seek(clipId(name), time);
      let inheritedFloor = Infinity;
      const point = new Vector3();
      actor.node.traverse((part) => {
        if (part instanceof SkinnedMesh) {
          part.skeleton.update();
          for (
            let vertex = 0;
            vertex < part.geometry.getAttribute('position').count;
            vertex++
          )
            inheritedFloor = Math.min(
              inheritedFloor,
              part
                .getVertexPosition(vertex, point)
                .applyMatrix4(part.matrixWorld).y,
            );
        }
      });
      const before = new Map<string, Vector3>();
      actor.node.traverse((node) => {
        before.set(node.name, node.getWorldPosition(new Vector3()));
      });
      actor.seek(clipId(death.name), 0);
      actor.node.traverse((node) => {
        expect(
          node
            .getWorldPosition(new Vector3())
            .distanceTo(before.get(node.name) ?? new Vector3()),
        ).toBeLessThan(1e-6);
      });
      actor.seek(clipId(death.name), 1e-8);
      for (const [name, position] of before)
        expect(
          actor.node
            .getObjectByName(name)
            ?.getWorldPosition(new Vector3())
            .distanceTo(position),
        ).toBeLessThan(1e-5);
      actor.seek(clipId(death.name), 0.001);
      actor.node.traverse((node) => {
        expect(
          node
            .getWorldPosition(new Vector3())
            .distanceTo(before.get(node.name) ?? new Vector3()),
        ).toBeLessThan(0.02);
      });
      for (const time of [0.005, 0.01, 0.02, 0.04, 0.06, 0.08, 0.1]) {
        actor.seek(clipId(death.name), time);
        let floor = Infinity;
        const v = new Vector3();
        actor.node.traverse((node) => {
          if (node instanceof SkinnedMesh) {
            node.skeleton.update();
            for (
              let i = 0;
              i < node.geometry.getAttribute('position').count;
              i++
            )
              floor = Math.min(
                floor,
                node.getVertexPosition(i, v).applyMatrix4(node.matrixWorld).y,
              );
          }
        });
        expect(
          floor,
          `${name} to ${death.name}@${time}`,
        ).toBeGreaterThanOrEqual(
          Math.min(0, inheritedFloor) *
            (1 - (time / 0.1) ** 2 * (3 - (2 * time) / 0.1)) -
            0.003,
        );
      }
      actor.seek(clipId(death.name), 0.5);
      const canonical = pack.create('white');
      canonical.seek(clipId(death.name), 0.5);
      actor.node.traverse((node) => {
        const expected = canonical.node.getObjectByName(node.name);
        if (expected)
          expect(
            node
              .getWorldPosition(new Vector3())
              .distanceTo(expected.getWorldPosition(new Vector3())),
          ).toBeLessThan(1e-6);
      });
      canonical.dispose();
      const end = actor.node.getObjectByName('head')?.matrixWorld.clone();
      actor.seek(clipId(death.name), 0.25);
      actor.seek(clipId(death.name), 0.5);
      expect(actor.node.getObjectByName('head')?.matrixWorld).toEqual(end);
      actor.dispose();
    }
  expect(survivor.node.getObjectByName('head')?.matrixWorld).toEqual(unchanged);
  survivor.dispose();
  pack.dispose();
  seed.dispose();
  original.dispose();
}, 30000);

test('settled head is supported near the ground rather than held above a rigid torso', async () => {
  const original = await createThreeAssetPack([source]),
    seed = original.create('white');
  seed.seek(clipId('Idle'), 0);
  const clips = authorDeathClips(seed.node),
    pack = await createThreeAssetPack([source], {}, clips);
  for (const clip of clips) {
    const actor = pack.create('white');
    actor.seek(clipId(clip.name), 0.5);
    for (const name of ['footL', 'footR'])
      expect(
        actor.node.getObjectByName(name)?.getWorldPosition(new Vector3()).y,
      ).toBeLessThan(0.23);
    expect(
      actor.node.getObjectByName('head')?.getWorldPosition(new Vector3()).y,
    ).toBeLessThan(0.3);
    actor.dispose();
  }
  pack.dispose();
  seed.dispose();
  original.dispose();
}, 30000);

test('entry support is actor-local under a translated C-owned parent and never changes physical placement', async () => {
  const original = await createThreeAssetPack([source]),
    seed = original.create('white');
  seed.seek(clipId('Idle'), 0);
  const clips = authorDeathClips(seed.node);
  const punch = new Uint8Array(
    readFileSync(
      'assets/android/motions/completed42-speed15/punch/android_punch.glb',
    ),
  );
  const pack = await createThreeAssetPack([source, punch], {}, clips),
    local = pack.create('white'),
    mounted = pack.create('white');
  const parent = new Group();
  parent.position.set(-3, 7, 4);
  parent.rotation.y = 0.7;
  parent.add(mounted.node);
  parent.updateWorldMatrix(true, true);
  const physical = parent.matrixWorld.clone();
  for (const actor of [local, mounted]) {
    actor.seek(clipId('Jab'), 11 / 45);
    actor.seek(clipId('DefeatPunch'), 0.04);
  }
  for (const name of ['pelvis', 'head', 'footL', 'footR']) {
    const localPosition = local.node
      .getObjectByName(name)
      ?.getWorldPosition(new Vector3());
    const mountedPosition = mounted.node
      .getObjectByName(name)
      ?.getWorldPosition(new Vector3());
    if (!localPosition || !mountedPosition) throw new Error(name);
    mounted.node.worldToLocal(mountedPosition);
    expect(mountedPosition.distanceTo(localPosition)).toBeLessThan(1e-6);
  }
  expect(parent.matrixWorld.equals(physical)).toBe(true);
  expect(mounted.node.position.toArray()).toEqual([0, 0, 0]);
  local.dispose();
  mounted.dispose();
  pack.dispose();
  seed.dispose();
  original.dispose();
}, 30000);
