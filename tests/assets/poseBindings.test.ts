import { expect, test } from 'vitest';
import {
  buildPoseBindings,
  capturePoseBindings,
} from '../../src/assets/poseBindings';
import { clipId, durationMs } from '../../src/contracts';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture');
  return value;
}
const inputs = ['Idle', 'Walk', 'Run', 'Jump', 'Partial'].map(
  (name, index) => ({
    clipId: clipId(name),
    durationMs: durationMs(1000),
    sourceSha256: 'a'.repeat(64),
    sourceClipIndex: index,
  }),
);
test('source timing bindings are deterministic, ordered, detached and deeply immutable', async () => {
  const a = await buildPoseBindings(inputs);
  const b = await buildPoseBindings([...inputs].reverse());
  expect(a).toEqual(b);
  expect(a.clips).toHaveLength(5);
  expect(Object.isFrozen(a)).toBe(true);
  expect(Object.isFrozen(a.clips)).toBe(true);
  expect(a.clips.every(Object.isFrozen)).toBe(true);
  expect(Object.isFrozen(a.locomotion)).toBe(true);
  expect(capturePoseBindings(a)).toEqual(a);
});
test('source bytes, source index, duration and explicit extraction provenance all bind identity', async () => {
  const original = await buildPoseBindings(inputs);
  const first = inputs[0];
  if (!first) throw new Error('Fixture');
  for (const changed of [
    { ...first, sourceSha256: 'b'.repeat(64) },
    { ...first, sourceClipIndex: 99 },
    { ...first, durationMs: durationMs(999) },
    {
      ...first,
      rootPolicy: {
        version: 1 as const,
        clipId: first.clipId,
        sourceSha256: first.sourceSha256,
        mode: 'full-translation' as const,
        provenance: {
          manifestSha256: 'c'.repeat(64),
          clipPointer: '/clips/0',
          supportPointer: '/clips/0/support_contacts',
        },
      },
    },
  ]) {
    const result = await buildPoseBindings([changed, ...inputs.slice(1)]);
    expect(result.bindingSetId).not.toBe(original.bindingSetId);
    expect(
      result.clips.find((c) => c.clipId === first.clipId)?.sourceBindingId,
    ).not.toBe(
      original.clips.find((c) => c.clipId === first.clipId)?.sourceBindingId,
    );
  }
});
test('missing locomotion, duplicate clips, wrong provenance and malformed descriptor fail closed', async () => {
  await expect(buildPoseBindings(inputs.slice(1))).rejects.toThrow();
  await expect(
    buildPoseBindings([...inputs, required(inputs[0])]),
  ).rejects.toThrow();
  await expect(
    buildPoseBindings(inputs.map((x) => ({ ...x, sourceSha256: 'bad' }))),
  ).rejects.toThrow();
  const a = await buildPoseBindings(inputs);
  expect(() =>
    capturePoseBindings({ ...a, clips: [...a.clips, required(a.clips[0])] }),
  ).toThrow();
  expect(() =>
    capturePoseBindings({
      ...a,
      locomotion: { ...a.locomotion, jump: clipId('Missing') },
    }),
  ).toThrow();
});

test('catalog exposes detached bindings only after prepare and requires every loaded attack duration', async () => {
  const { createMotionCatalog } = await import(
    '../../src/assets/motionCatalog'
  );
  const { indexedFixture } = await import('./catalogIndexFixture');
  const asset = indexedFixture();
  const binding = await buildPoseBindings([
    ...inputs,
    {
      clipId: asset.definition.clipId,
      durationMs: asset.definition.durationMs,
      sourceSha256: 'b'.repeat(64),
      sourceClipIndex: 0,
    },
  ]);
  const catalog = createMotionCatalog(async () => [asset], {
    poseBindings: () => binding,
  });
  expect(catalog.pose).toBeUndefined();
  await catalog.prepare(new AbortController().signal);
  expect(catalog.pose).toEqual(binding);
  expect(catalog.pose).not.toBe(binding);
  catalog.dispose();
  expect(catalog.pose).toBeUndefined();
  for (const value of [
    undefined,
    await buildPoseBindings(inputs),
    {
      ...binding,
      clips: binding.clips.map((c) =>
        c.clipId === asset.definition.clipId
          ? { ...c, durationMs: durationMs(c.durationMs + 1) }
          : c,
      ),
    },
  ]) {
    const invalid = createMotionCatalog(async () => [asset], {
      poseBindings: () => value,
    });
    await expect(
      invalid.prepare(new AbortController().signal),
    ).rejects.toThrow();
    expect(invalid.pose).toBeUndefined();
    expect(invalid.list()).toEqual([]);
    invalid.dispose();
  }
});

test('binding construction captures inputs before yielding; catalog callback is deferred and cannot publish after disposal', async () => {
  const mutable = inputs.map((value) => ({ ...value }));
  const expected = await buildPoseBindings(mutable);
  let steps = 0;
  const actual = await buildPoseBindings(mutable, async () => {
    steps++;
    for (const value of mutable) value.sourceSha256 = 'b'.repeat(64);
  });
  expect(actual).toEqual(expected);
  expect(steps).toBe(inputs.length);
  const { createMotionCatalog } = await import(
    '../../src/assets/motionCatalog'
  );
  const { indexedFixture } = await import('./catalogIndexFixture');
  let calls = 0;
  const asset = indexedFixture();
  let release: ((assets: readonly (typeof asset)[]) => void) | undefined;
  const loaded = new Promise<readonly (typeof asset)[]>((resolve) => {
    release = resolve;
  });
  const catalog = createMotionCatalog(() => loaded, {
    poseBindings: () => {
      calls++;
      return expected;
    },
  });
  expect(calls).toBe(0);
  const pending = catalog.prepare(new AbortController().signal);
  const rejected = expect(pending).rejects.toThrow();
  catalog.dispose();
  required(release)([asset]);
  await rejected;
  expect(calls).toBe(0);
  expect(catalog.pose).toBeUndefined();
  expect(catalog.list()).toEqual([]);
});

test('optional crouch bindings preserve old four-mode fixtures and reject missing declared clip', async () => {
  const legacy = await buildPoseBindings(inputs);
  expect(legacy.locomotion).toEqual({
    idle: 'Idle',
    walk: 'Walk',
    run: 'Run',
    jump: 'Jump',
  });
  expect(Object.hasOwn(legacy.locomotion, 'crouch')).toBe(false);
  const crouch = {
    clipId: clipId('CrouchMove'),
    durationMs: durationMs(1234),
    sourceSha256: 'c'.repeat(64),
    sourceClipIndex: 7,
  };
  const complete = await buildPoseBindings([...inputs, crouch]);
  expect(complete.locomotion.crouch).toBe('CrouchMove');
  expect(complete.bindingSetId).not.toBe(legacy.bindingSetId);
  // Independently SHA-256-derived from this literal synthetic provenance and the
  // five-mode map, so omitting crouch from the set digest cannot pass.
  expect(complete.bindingSetId).toBe(
    'pose-set-v1:704b2f78e8d331e8271d4d918d7469ff37f1c0d269888db81990e0891a356749',
  );
  expect(complete.clips[0]?.sourceBindingId).toBe(
    'pose-v1:d4175200f23993723d99fc87ee9e009fb3bf0c26ba09b76fcd833725572d063a',
  );
  expect(await buildPoseBindings([crouch, ...[...inputs].reverse()])).toEqual(
    complete,
  );
  expect(complete.clips.map((c) => c.clipId)).toEqual([
    'CrouchMove',
    'Idle',
    'Jump',
    'Partial',
    'Run',
    'Walk',
  ]);
  for (const clip of legacy.clips)
    expect(complete.clips.find((c) => c.clipId === clip.clipId)).toEqual(clip);
  expect(capturePoseBindings(complete)).toEqual(complete);
  expect(Object.isFrozen(complete.locomotion)).toBe(true);
  for (const changed of [
    { ...crouch, durationMs: durationMs(1235) },
    { ...crouch, sourceSha256: 'd'.repeat(64) },
    { ...crouch, sourceClipIndex: 8 },
  ]) {
    const different = await buildPoseBindings([...inputs, changed]);
    expect(different.bindingSetId).not.toBe(complete.bindingSetId);
    expect(
      different.clips.find((c) => c.clipId === 'CrouchMove')?.sourceBindingId,
    ).not.toBe(complete.clips[0]?.sourceBindingId);
  }
  for (const bad of [undefined, null, '', 1, 'Missing'])
    expect(() =>
      capturePoseBindings({
        ...legacy,
        locomotion: { ...legacy.locomotion, crouch: bad },
      }),
    ).toThrow(/locomotion/);
});
