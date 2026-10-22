import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createPinnedDerivedThreeAssetPack } from '../../src/assets';
import { PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES } from '../../src/assets/representativePolicies';
const input = () => ({
  derivedBytes: new Uint8Array(
    readFileSync('public/game-assets/android/derived-pack-v1.glb'),
  ),
  artifactBytes: new Uint8Array(
    readFileSync('public/game-assets/android/runtime-artifact-v1.json'),
  ),
  rootPolicies: PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES,
  signal: new AbortController().signal,
});
test('required preparation actually yields inside validation and between all42 original animation constructions', async () => {
  const stages: string[] = [];
  let ticks = 0,
    previous = 0;
  const timer = setInterval(() => ticks++, 1);
  try {
    const pack = await createPinnedDerivedThreeAssetPack({
      ...input(),
      async checkpoint(stage) {
        expect(ticks).toBeGreaterThan(previous);
        previous = ticks;
        stages.push(stage);
      },
    });
    try {
      expect(
        stages.filter((stage) => stage.startsWith('inspect:0:chunk:')).length,
      ).toBeGreaterThan(10);
      expect(
        stages.filter((stage) => /^parse:0:animation:\d+:before$/.test(stage)),
      ).toHaveLength(42);
      expect(
        stages.filter((stage) => /^parse:0:animation:\d+:after$/.test(stage)),
      ).toHaveLength(42);
      expect(stages.indexOf('parse:0:static:after')).toBeLessThan(
        stages.indexOf('parse:0:animation:0:before'),
      );
      expect(pack.clipNames()).toHaveLength(44);
    } finally {
      pack.dispose();
    }
  } finally {
    clearInterval(timer);
  }
});

// Hashes captured from the frozen, pre-slicing synchronous implementation3917.
// This is independent of parity between the two drivers sharing the new generator.
import { createHash } from 'node:crypto';
import { inspectGlb, inspectGlbYielding } from '../../src/assets/source';
const originalInspectionReceipts = [
  {
    path: 'assets/android/motions/completed42/movement/android_movement.glb',
    sha256: '8ffbf8d8cd50a535fda38590cf9863c09b09b36428887042f031c24692de22fd',
  },
  {
    path: 'assets/android/motions/completed42/jump/android_jump.glb',
    sha256: 'e460f4307583e20f8e57a41ada16aa0d69c1458104fb40cb0e982c5a3d3401bd',
  },
  {
    path: 'assets/android/motions/completed42/punch/android_punch.glb',
    sha256: '69bcd6340e9614cf8ea263f7387408ee1c3e4d7d0e16ea0c42c83f3e5c2f94d6',
  },
  {
    path: 'assets/android/motions/completed42/kick/android_kick.glb',
    sha256: '094de0df458382531febf3d699bd21aabddcf988c25b1a39be00506fb622546a',
  },
  {
    path: 'assets/android/motions/completed42-speed15/movement/android_movement.glb',
    sha256: '69429126a157b3b577b03b225f813e7367399cae9f7ec0542b80ad2e1c0ce8af',
  },
  {
    path: 'assets/android/motions/completed42-speed15/jump/android_jump.glb',
    sha256: '030f3c71e2098a15129c63a5d740e6d1678831c1146f87fe69a201309346097d',
  },
  {
    path: 'assets/android/motions/completed42-speed15/punch/android_punch.glb',
    sha256: 'ea36ed731ec5bb705ab911aa793641e4a6ffd09adaad8cc1f9462ee62abd2678',
  },
  {
    path: 'assets/android/motions/completed42-speed15/kick/android_kick.glb',
    sha256: '98bf064ea4367ed34034bc95d3b02f8dbe7ebdf3aff5602c3bdc890394f858d8',
  },
  {
    path: 'public/game-assets/android/derived-pack-v1.glb',
    sha256: 'e08e250864f1a3567f22b532e9db466b6ad197bd67f533bff2ec07370fde06c0',
  },
] as const;
test('all nine original/retimed/derived inspection receipts equal the frozen pre-slicing implementation', async () => {
  for (const { path, sha256 } of originalInspectionReceipts) {
    const bytes = new Uint8Array(readFileSync(path));
    expect(
      createHash('sha256')
        .update(JSON.stringify(inspectGlb(bytes)))
        .digest('hex'),
    ).toBe(sha256);
    const result = await inspectGlbYielding(bytes, async () => {});
    expect(
      createHash('sha256').update(JSON.stringify(result)).digest('hex'),
    ).toBe(sha256);
  }
});
test('cooperative inspection captures bytes and rejects a chunk callback immediately', async () => {
  const bytes = input().derivedBytes;
  const expected = inspectGlb(bytes);
  let calls = 0;
  expect(
    await inspectGlbYielding(bytes, async () => {
      if (calls++ === 0) bytes.fill(0);
    }),
  ).toEqual(expected);
  for (const stop of [0, Math.floor(calls / 2), calls - 1]) {
    let count = 0;
    const reason = new Error(`stop${stop}`);
    await expect(
      inspectGlbYielding(input().derivedBytes, async () => {
        if (count++ === stop) throw reason;
      }),
    ).rejects.toBe(reason);
    expect(count).toBe(stop + 1);
  }
});
import { BufferGeometry, Material, Skeleton } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { vi } from 'vitest';
test('real pinned factory aborts validation/static/animation/root checkpoints without leaked or double-owned resources', async () => {
  for (const stop of [
    'inspect:0:chunk:0',
    'parse:0:static:before',
    'parse:0:static:after',
    'parse:0:animation:0:before',
    'parse:0:animation:21:after',
    'parse:0:animation:41:after',
    'parse:0:root:ready',
  ]) {
    const controller = new AbortController(),
      stages: string[] = [];
    const geometry = vi.spyOn(BufferGeometry.prototype, 'dispose'),
      material = vi.spyOn(Material.prototype, 'dispose'),
      skeleton = vi.spyOn(Skeleton.prototype, 'dispose');
    const parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
    try {
      await expect(
        createPinnedDerivedThreeAssetPack({
          ...input(),
          signal: controller.signal,
          checkpoint: async (stage) => {
            stages.push(stage);
            if (stage === stop) controller.abort();
          },
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(stages.at(-1)).toBe(stop);
      const created =
        stop !== 'inspect:0:chunk:0' && stop !== 'parse:0:static:before';
      expect(parse).toHaveBeenCalledTimes(stop === 'inspect:0:chunk:0' ? 0 : 1);
      for (const [spy, count] of [
        [geometry, 5],
        [material, 5],
        [skeleton, 1],
      ] as const) {
        expect(spy).toHaveBeenCalledTimes(created ? count : 0);
        expect(new Set(spy.mock.contexts).size).toBe(spy.mock.calls.length);
      }
    } finally {
      geometry.mockRestore();
      material.mockRestore();
      skeleton.mockRestore();
      parse.mockRestore();
    }
  }
}, 15000);
test('abort arriving during a task yield does not invoke the next checkpoint or parse', async () => {
  const controller = new AbortController(),
    stages: string[] = [];
  const parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
  try {
    await expect(
      createPinnedDerivedThreeAssetPack({
        ...input(),
        signal: controller.signal,
        checkpoint: async (stage) => {
          stages.push(stage);
          if (stage === 'inspect:0:chunk:0')
            setTimeout(() => controller.abort(), 0);
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(stages.at(-1)).toBe('inspect:0:chunk:0');
    expect(parse).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
  }
});
