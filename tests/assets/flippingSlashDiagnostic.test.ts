/** Metadata source0 only: no loader, mixer, posing, mesh evaluation or fitting. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/android_punch.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/manifest.json',
  ),
});
const api = () => import('../../tools/assets/flippingSlashDiagnostic');

test('source0 pins generic hand.R strike without inventing a fist or contact region', async () => {
  const { readFlippingSlashSource, FLIPPING_SLASH_SOURCE_PINS } = await api();
  const bytes = input();
  expect(createHash('sha256').update(bytes.sourceBytes).digest('hex')).toBe(
    FLIPPING_SLASH_SOURCE_PINS.sourceSha256,
  );
  expect(createHash('sha256').update(bytes.manifestBytes).digest('hex')).toBe(
    FLIPPING_SLASH_SOURCE_PINS.manifestSha256,
  );
  const d = readFlippingSlashSource(bytes);
  expect(d.clipId).toBe('FlippingSlash');
  expect(d.sourceClipPointer).toBe('/clips/5');
  expect(d.events).toHaveLength(1);
  expect(d.events[0]).toMatchObject({
    impactIndex: 0,
    boneName: 'hand.R',
    sourceFrames: [41, 46],
    peakFrame: 44,
    sourceEventPointer: '/clips/5/attack_and_timeline_events/strikes/0',
    intendedRegion: null,
    acceptance: null,
    sourceEvent: {
      limb: 'hand.R',
      type: 'single downward-forward unarmed arm strike',
      active_frames: [41, 46],
      impact_frame: 44,
      target_added: false,
    },
  });
  expect(d.regionChoice).toBeNull();
  expect(d.acceptance).toBeNull();
  expect(d.gameplayAllowance).toBeNull();
});

test('source0 preserves native clock and labels inclusive frame interpretation provisional', async () => {
  const { readFlippingSlashSource, FLIPPING_SLASH_NATIVE_TIMES_SHA256 } =
    await api();
  const d = readFlippingSlashSource(input());
  expect(d.sourceTimesSeconds).toHaveLength(91);
  expect(d.durationMs).toBe(2022.2222805023193);
  expect(d.sourceTimesSeconds[0]).toBe(0.02222222276031971);
  expect(d.events[0]?.window).toMatchObject({
    policy: 'inclusive-accessor-frame-cells-v1',
    acceptance: 'provisional-policy',
    startMs: 911.1111164093018,
    peakMs: 977.7777791023254,
    endMs: 1044.4444417953491,
    initialHoldEndMs: 22.22222276031971,
  });
  expect(d.timeProvenance).toEqual({
    animationPointer: '/animations/5',
    fullTimeAccessorPointer: '/accessors/514',
    endpointAccessorPointer: '/accessors/517',
    nativeTimesSha256: FLIPPING_SLASH_NATIVE_TIMES_SHA256,
  });
});

test('source0 preserves full XYZ and parent-root X flip without promoting ownership', async () => {
  const { readFlippingSlashSource } = await api();
  const d = readFlippingSlashSource(input());
  expect(d.rootPolicy.mode).toBe('full-translation');
  expect(d.rootPolicy.provenance.supportPointer).toBe(
    '/clips/5/support_contacts/contacts',
  );
  expect(d.rootTransformRequirement).toMatchObject({
    rootNode: 52,
    pelvisNode: 51,
    translationAccessor: 1963,
    quaternionAccessor: 1964,
    translationAxes: ['x', 'y', 'z'],
    preserveAllAnimationChannels: true,
    flipCarrier: 'root-parent-quaternion',
    pelvisLocalRotation: 'identity',
    endReset: false,
    acceptance: null,
  });
  expect(d.sourceRoot.root_motion.rotation).toContain('+360');
  expect(d.sourceRoot.root_motion.end_reset).toBe(false);
  expect(d.rootPolicyAcceptance).toBeNull();
  expect(d.ownershipAcceptance).toBeNull();
});

test('source0 rejects changed or truncated bytes before interpreting metadata', async () => {
  const { readFlippingSlashSource } = await api();
  for (const field of ['sourceBytes', 'manifestBytes'] as const) {
    const changed = input();
    changed[field][100] = (changed[field][100] ?? 0) ^ 1;
    expect(() => readFlippingSlashSource(changed)).toThrow(/hash/);
    const truncated = input();
    truncated[field] = truncated[field].subarray(1);
    expect(() => readFlippingSlashSource(truncated)).toThrow(/hash/);
  }
});

test('source0 rejects trimmed, reordered, retimed and nonfinite native clocks', async () => {
  const { readFlippingSlashSource, validateFlippingSlashAccessorTimes } =
    await api();
  const times = [...readFlippingSlashSource(input()).sourceTimesSeconds];
  for (const changed of [
    times.slice(1),
    [...times].reverse(),
    times.map((t) => Math.fround(t / 1.5)),
    [NaN, ...times.slice(1)],
    [0, ...times.slice(1)],
  ])
    expect(() => validateFlippingSlashAccessorTimes(changed)).toThrow();
});

test('source0 deeply freezes unresolved anatomy and cannot promote a region', async () => {
  const { readFlippingSlashSource } = await api();
  const d = readFlippingSlashSource(input());
  const assertFrozen = (value: unknown): void => {
    if (value && typeof value === 'object') {
      expect(Object.isFrozen(value)).toBe(true);
      for (const child of Object.values(value)) assertFrozen(child);
    }
  };
  assertFrozen(d);
  expect(Reflect.set(d, 'regionChoice', 'fist')).toBe(false);
  const event = d.events[0];
  if (!event) throw new Error('Missing pinned event');
  expect(Reflect.set(event, 'intendedRegion', 'dorsal-hand-hypothesis')).toBe(
    false,
  );
  expect(d.regionChoice).toBeNull();
});

test('source0 module exports metadata only, with no execution dependencies', async () => {
  const module = await api();
  expect(Object.keys(module).sort()).toEqual(
    [
      'FLIPPING_SLASH_NATIVE_TIMES_SHA256',
      'FLIPPING_SLASH_SOURCE_PINS',
      'readFlippingSlashSource',
      'validateFlippingSlashAccessorTimes',
    ].sort(),
  );
  const text = readFileSync('tools/assets/flippingSlashDiagnostic.ts', 'utf8');
  expect(text).not.toMatch(
    /from\s+['"]three|GLTFLoader|AnimationMixer|\.\/bake|fitSourceSphere|planFlipping|bakeFlipping/,
  );
});
