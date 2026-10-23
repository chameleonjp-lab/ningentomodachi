import { describe, expect, test } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { clipId, durationMs, type PoseClipBinding } from '../../src/contracts';
import * as intervals from '../../src/assets/headIntervals';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll } from 'vitest';
import {
  preparePinnedSourceHead,
  type SourceHeadProvider,
} from '../../src/assets/headSurface';
import {
  copyRootPolicy,
  type ClipRootPolicy,
} from '../../src/assets/rootPolicy';
import { appendFileSync } from 'node:fs';
import { ANDROID_RUNTIME_ARTIFACT_V1 } from '../../src/assets/runtimeArtifactManifest';
import { loadVerifiedSource } from '../../src/assets/loadVerifiedSource';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing interval value');
  return value;
}

const binding: PoseClipBinding = Object.freeze({
  clipId: clipId('Idle'),
  durationMs: durationMs(2022.2222805023193),
  sourceBindingId:
    'pose-v1:40a42d3a6dfd776b19f48d7d2bcaf115e52e4e2b59c410f75e5d5ae8fc01f889',
});
function fixture() {
  const channels = [52, 51, 42, 41, 40, 1, 0].flatMap((node) =>
    (['translation', 'rotation', 'scale'] as const).map((property) => {
      const value =
        property === 'rotation'
          ? [0, 0, 0, 1]
          : property === 'scale'
            ? [1, 1, 1]
            : [0, 0, 0];
      return {
        node,
        property,
        mode: 'LINEAR' as const,
        times: new Float32Array([0.55, 0.6, 0.65]),
        values: new Float32Array([...value, ...value, ...value]),
      };
    }),
  );
  let alive = true;
  const plan = {
    binding,
    sourceSha256: 'fixture',
    sourceClipIndex: 0,
    rootMode: 'full-translation' as const,
    rootOrigin: [0, 0, 0],
    channels,
  };
  const context = {
    geometryId: 'fixture',
    radiusM: 0.25,
    layoutSupported: true,
    alive: () => alive,
    resolve: (b: typeof binding) =>
      b.sourceBindingId === binding.sourceBindingId &&
      b.durationMs === binding.durationMs &&
      b.clipId === binding.clipId
        ? plan
        : undefined,
    sampleCanonical: () => ({
      kind: 'transform' as const,
      matrix: Object.freeze(new Matrix4().toArray()),
      numerics: 'cpu-float64-not-certified' as const,
    }),
    sampleValues: (
      _: typeof binding,
      values: readonly {
        node: number;
        property: string;
        value: readonly number[];
      }[],
    ) => {
      const q = required(
        values.find((v) => v.node === 0 && v.property === 'rotation'),
      ).value;
      return {
        kind: 'transform' as const,
        matrix: Object.freeze(
          new Matrix4()
            .compose(
              new Vector3(),
              new Quaternion().fromArray(q),
              new Vector3(1, 1, 1),
            )
            .toArray(),
        ),
        numerics: 'cpu-float64-not-certified' as const,
      };
    },
  };
  return {
    channels,
    context,
    stop: () => {
      alive = false;
    },
  };
}
function create() {
  expect(intervals.createHeadIntervalDiagnostics).toBeTypeOf('function');
  const f = fixture();
  return { ...f, api: intervals.createHeadIntervalDiagnostics(f.context) };
}
test('pure interval diagnostics retain source cuts and explicitly unqualified bounds', () => {
  const { api } = create();
  const r = api.query(binding, durationMs(570), durationMs(630));
  expect(r.kind).toBe('cells');
  if (r.kind !== 'cells') throw Error(r.kind);
  expect(r.cells).toHaveLength(2);
  expect(required(r.cells[0]).toSeconds).toBe(Math.fround(0.6));
  expect(required(r.cells[0]).speedMPerSourceSecond).toBe(0);
  expect(required(r.cells[0]).floatingCertification).toBe('not-certified');
  expect(Object.isFrozen(r.cells[0])).toBe(true);
});
test('pure interval diagnostics reject invalid bounds and unsupported scope without clipping', () => {
  const { api } = create();
  for (const [a, b] of [
    [570, 570],
    [630, 570],
    [NaN, 600],
    [570, Infinity],
  ])
    expect(
      api.query(
        binding,
        a as ReturnType<typeof durationMs>,
        b as ReturnType<typeof durationMs>,
      ),
    ).toMatchObject({ kind: 'unavailable', reason: 'invalid-interval' });
  expect(api.query(binding, durationMs(550), durationMs(630))).toMatchObject({
    kind: 'unavailable',
    reason: 'unsupported-scope',
  });
  expect(
    api.query(
      { ...binding, sourceBindingId: 'wrong' },
      durationMs(570),
      durationMs(630),
    ),
  ).toMatchObject({ kind: 'unavailable', reason: 'invalid-binding' });
});
test('pure interval diagnostics reject SLERP and changing scale', () => {
  const f = fixture();
  const q = required(
    f.channels.find((c) => c.node === 0 && c.property === 'rotation'),
  );
  q.values.set([0, 0, 1, 0], 4);
  const api = intervals.createHeadIntervalDiagnostics(f.context);
  expect(api.query(binding, durationMs(570), durationMs(590))).toMatchObject({
    kind: 'unavailable',
    reason: 'unsupported-branch',
  });
  q.values.set([0, 0, 0, 1], 4);
  required(
    f.channels.find((c) => c.node === 0 && c.property === 'scale'),
  ).values[3] = 2;
  expect(api.query(binding, durationMs(570), durationMs(590))).toMatchObject({
    kind: 'unavailable',
    reason: 'unsupported-layout',
  });
});
test('pure interval diagnostics retain nonunit constant scale and opaque cell ownership', () => {
  const f = fixture();
  const t = required(
    f.channels.find((c) => c.node === 0 && c.property === 'translation'),
  );
  t.values.set([1, 0, 0], 3);
  t.values.set([2, 0, 0], 6);
  required(
    f.channels.find((c) => c.node === 52 && c.property === 'scale'),
  ).values.fill(2);
  const api = intervals.createHeadIntervalDiagnostics(f.context),
    r = api.query(binding, durationMs(570), durationMs(590));
  expect(r.kind).toBe('cells');
  if (r.kind !== 'cells') throw Error(r.kind);
  expect(required(r.cells[0]).speedMPerSourceSecond).toBe(
    2 / (required(t.times[1]) - required(t.times[0])),
  );
  expect(
    api.sampleBoundary({ ...required(r.cells[0]) }, 'from', 'interior-limit'),
  ).toMatchObject({ kind: 'unavailable', reason: 'foreign-cell' });
  f.stop();
  expect(
    api.sampleBoundary(required(r.cells[0]), 'from', 'interior-limit'),
  ).toMatchObject({ kind: 'unavailable', reason: 'disposed' });
});
test('pure branch endpoints distinguish raw constant-copy from normalized-lerp without epsilon sampling', () => {
  const c = {
    node: 0,
    property: 'rotation' as const,
    mode: 'LINEAR' as const,
    times: new Float32Array([0, 1, 2]),
    values: new Float32Array([0, 0, 0.1, 1, 0, 0, 0.1, 1, 0, 0, 0.2, 1]),
  };
  const raw = intervals.channelEndpoint(c, 0, 1),
    normalized = intervals.channelEndpoint(c, 1, 1);
  expect(raw).toEqual(Array.from(c.values.slice(0, 4)));
  expect(normalized).not.toEqual(raw);
  expect(Math.hypot(...normalized)).toBe(1);
});

describe('stage A synthetic source partitions', () => {
  function stage(rootMode: ClipRootPolicy['mode'] = 'full-translation') {
    const f = fixture();
    const b = Object.freeze({
      ...binding,
      durationMs: durationMs(2000),
      sourceBindingId: 'synthetic-stage-a',
    });
    const channels = f.channels.map((c) => ({
      ...c,
      mode: c.mode as 'LINEAR' | 'STEP',
      times: new Float32Array([0.5, 1, 2]),
    }));
    const plan = {
      ...required(f.context.resolve(binding)),
      binding: b,
      rootMode,
      channels,
    };
    let sampled: readonly intervals.IntervalValue[] = [];
    const context = {
      ...f.context,
      resolve: (candidate: typeof binding) =>
        candidate.sourceBindingId === b.sourceBindingId &&
        candidate.durationMs === b.durationMs &&
        candidate.clipId === b.clipId
          ? plan
          : undefined,
      sampleValues: (
        candidate: typeof binding,
        values: readonly intervals.IntervalValue[],
      ) => {
        sampled = values;
        return f.context.sampleValues(candidate, values);
      },
    };
    return {
      ...f,
      context,
      channels,
      binding: b,
      plan,
      sampled: () => sampled,
      api: intervals.createHeadIntervalDiagnostics(
        context,
        'pinned42-source-cells-v1',
      ),
    };
  }
  const query = (f: ReturnType<typeof stage>, from = 0, to = 2000) => {
    const r = f.api.query(f.binding, durationMs(from), durationMs(to));
    expect(r.kind).toBe('partition');
    if (r.kind !== 'partition') throw Error(r.kind);
    return r.pieces;
  };
  test('first hold freezes raw TRS at BOTH limits and has exactly zero speed', () => {
    const f = stage();
    for (const c of f.channels) {
      if (c.property === 'rotation')
        c.values.set([0, 0, 0.1, 1, 0, 0, 0.2, 1, 0, 0, 0.3, 1]);
      if (c.property === 'translation')
        c.values.set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      if (c.property === 'scale') c.values.set([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    }
    const hold = required(query(f, 0, 500)[0]);
    expect(hold.kind).toBe('bounded');
    if (hold.kind !== 'bounded') throw Error('hold must be bounded');
    expect(hold.speedMPerSourceSecond).toBe(0);
    expect(hold.branches).toEqual(Array(7).fill('first-hold'));
    for (const endpoint of ['from', 'to'] as const) {
      expect(f.api.sampleBoundary(hold, endpoint, 'interior-limit').kind).toBe(
        'transform',
      );
      expect(f.sampled().map((v) => v.value)).toEqual(
        f.channels.map((c) =>
          Array.from(c.values.slice(0, c.property === 'rotation' ? 4 : 3)),
        ),
      );
    }
  });
  test('mixed branches retain complete unsupported spans and unresolved side limits', () => {
    const f = stage();
    required(
      f.channels.find((c) => c.node === 0 && c.property === 'rotation'),
    ).values.set([0, 0, 1, 0], 8);
    const pieces = query(f);
    expect(pieces.map((p) => [p.fromSeconds, p.toSeconds, p.kind])).toEqual([
      [0, 0.5, 'bounded'],
      [0.5, 1, 'bounded'],
      [1, 2, 'unsupported'],
    ]);
    const unsupported = required(pieces[2]);
    expect(unsupported).toMatchObject({
      reason: 'unsupported-branch',
      resolution: 'unresolved',
    });
    expect('speedMPerSourceSecond' in unsupported).toBe(false);
    expect(
      f.api.sampleBoundary(unsupported, 'to', 'interior-limit'),
    ).toMatchObject({ kind: 'unavailable', resolution: 'unresolved' });
    expect(
      f.api.sampleBoundary(unsupported, 'to', 'canonical-point').kind,
    ).toBe('transform');
  });
  test('terminal STEP scale holds its old value at its left limit without rejecting the open cell', () => {
    const f = stage();
    const c = required(
      f.channels.find((c) => c.node === 0 && c.property === 'scale'),
    );
    c.mode = 'STEP';
    c.values.set([2, 2, 2], 6);
    const pieces = query(f),
      last = required(pieces.at(-1));
    expect(pieces.every((p) => p.kind === 'bounded')).toBe(true);
    f.api.sampleBoundary(last, 'to', 'interior-limit');
    expect(
      f.sampled().find((v) => v.node === 0 && v.property === 'scale')?.value,
    ).toEqual([1, 1, 1]);
    c.mode = 'LINEAR';
    expect(required(query(f).at(-1))).toMatchObject({
      kind: 'unsupported',
      reason: 'unsupported-scale',
    });
  });
  test('antipodal nonunit raw keys use nlerp rather than raw-copy', () => {
    const f = stage();
    const c = required(
      f.channels.find((c) => c.node === 0 && c.property === 'rotation'),
    );
    c.values.set([0, 0, 0.1, 1, 0, 0, -0.1, -1, 0, 0, -0.1, -1]);
    const cell = required(query(f, 500, 1000)[0]);
    expect(cell.kind).toBe('bounded');
    f.api.sampleBoundary(cell, 'from', 'interior-limit');
    expect(
      f.sampled().find((v) => v.node === 0 && v.property === 'rotation')?.value,
    ).not.toEqual(Array.from(c.values.slice(0, 4)));
  });
  test('in-place XYZ retains all root slopes while old modes stay exact', () => {
    for (const [mode, expected] of [
      ['in-place-posture-xyz', 13],
      ['grounded-posture-y', 4],
      ['full-translation', 0],
    ] as const) {
      const f = stage(mode);
      required(
        f.channels.find((c) => c.node === 52 && c.property === 'translation'),
      ).values.set([0, 0, 0, 1.5, 2, 6, 1.5, 2, 6]);
      const cell = required(query(f, 500, 1000)[0]);
      expect(cell.kind).toBe('bounded');
      if (cell.kind !== 'bounded') throw Error('expected bounded');
      expect(cell.speedMPerSourceSecond).toBe(expected);
    }
  });
  test('in-place first hold keeps raw root XYZ and quaternion at both limits', () => {
    const f = stage('in-place-posture-xyz');
    const t = required(
      f.channels.find((c) => c.node === 52 && c.property === 'translation'),
    );
    t.values.set([7, -2, 9, 8, 0, 10, 8, 0, 10]);
    const q = required(
      f.channels.find((c) => c.node === 52 && c.property === 'rotation'),
    );
    q.values.set([0, 0, 0.1, 1, 0, 0, 0.2, 1, 0, 0, 0.2, 1]);
    const cell = required(query(f, 0, 500)[0]);
    if (cell.kind !== 'bounded') throw Error('Expected bounded hold');
    expect(cell.speedMPerSourceSecond).toBe(0);
    for (const endpoint of ['from', 'to'] as const) {
      expect(f.api.sampleBoundary(cell, endpoint, 'interior-limit').kind).toBe(
        'transform',
      );
      expect(
        f.sampled().find((v) => v.node === 52 && v.property === 'translation')
          ?.value,
      ).toEqual([7, -2, 9]);
      expect(
        f.sampled().find((v) => v.node === 52 && v.property === 'rotation')
          ?.value,
      ).toEqual(Array.from(q.values.slice(0, 4)));
    }
  });
  test('in-place mode does not admit unsupported branches or unknown policies', () => {
    const f = stage('in-place-posture-xyz');
    const q = required(
      f.channels.find((c) => c.node === 0 && c.property === 'rotation'),
    );
    q.values.set([0, 0, 1, 0], 4);
    expect(query(f, 500, 1000)[0]).toMatchObject({
      kind: 'unsupported',
      reason: 'unsupported-branch',
    });
    q.values.set([0, 0, 0, 1], 4);
    const scale = required(
      f.channels.find((c) => c.node === 0 && c.property === 'scale'),
    );
    scale.values[3] = 2;
    expect(query(f, 500, 1000)[0]).toMatchObject({
      kind: 'unsupported',
      reason: 'unsupported-scale',
    });
    (f.plan as { rootMode: string }).rootMode = 'future-mode';
    expect(
      f.api.query(f.binding, durationMs(500), durationMs(1000)),
    ).toMatchObject({ kind: 'unavailable', reason: 'unsupported-layout' });
  });
  test('root policy derivatives retain only grounded y and all cells remain provider-owned', () => {
    for (const mode of ['full-translation', 'grounded-posture-y'] as const) {
      const f = stage(mode),
        c = required(
          f.channels.find((c) => c.node === 52 && c.property === 'translation'),
        );
      c.values.set([0, 0, 0, 1, 2, 3, 1, 2, 3]);
      const cell = required(query(f, 500, 1000)[0]);
      if (cell.kind !== 'bounded') throw Error('expected bounded');
      expect(cell.speedMPerSourceSecond).toBe(
        mode === 'full-translation' ? 0 : 4,
      );
      expect(
        f.api.sampleBoundary({ ...cell }, 'to', 'interior-limit'),
      ).toMatchObject({ reason: 'foreign-cell' });
      f.stop();
      expect(f.api.sampleBoundary(cell, 'to', 'interior-limit')).toMatchObject({
        reason: 'disposed',
      });
    }
  });
  test('clipped queries interleave, preserve complete spans, and expose no buffers', () => {
    const f = stage();
    const first = query(f, 250, 1750),
      other = query(f, 600, 900);
    expect(first.map((p) => [p.fromMs, p.toMs])).toEqual([
      [250, 500],
      [500, 1000],
      [1000, 1750],
    ]);
    expect(other.map((p) => [p.fromMs, p.toMs])).toEqual([[600, 900]]);
    expect(query(f, 250, 1750)).toEqual(first);
    for (const p of first) {
      expect(Object.isFrozen(p)).toBe(true);
      expect(Object.values(p).some((v) => ArrayBuffer.isView(v))).toBe(false);
    }
    expect(
      f.api.query(
        { ...f.binding, sourceBindingId: 'foreign' },
        durationMs(0),
        durationMs(2000),
      ),
    ).toMatchObject({ reason: 'invalid-binding' });
    expect(
      f.api.query(f.binding, durationMs(500), durationMs(500)),
    ).toMatchObject({ reason: 'invalid-interval' });
  });
  test('cancellation between channel chunks and after cells discards the whole result', () => {
    const f = stage();
    for (const abortAfter of [5, 24]) {
      let reads = 0;
      const signal = {
        get aborted() {
          return ++reads >= abortAfter;
        },
      } as AbortSignal;
      expect(
        f.api.query(f.binding, durationMs(0), durationMs(2000), { signal }),
      ).toMatchObject({
        kind: 'unavailable',
        reason: 'cancelled',
        resolution: 'unresolved',
      });
    }
    expect(query(f)).toHaveLength(3);
  });
  test('zero scale, missing channels, changed static layout and excessive union keys fail closed', () => {
    const zero = stage();
    required(zero.channels.find((c) => c.property === 'scale')).values[0] = 0;
    expect(
      zero.api.query(zero.binding, durationMs(0), durationMs(2000)),
    ).toMatchObject({ reason: 'unsupported-layout' });
    const missing = stage();
    missing.channels.pop();
    expect(
      missing.api.query(missing.binding, durationMs(0), durationMs(2000)),
    ).toMatchObject({ reason: 'unsupported-layout' });
    const layout = stage();
    layout.context.layoutSupported = false;
    expect(
      layout.api.query(layout.binding, durationMs(0), durationMs(2000)),
    ).toMatchObject({ reason: 'unsupported-layout' });
    const excessive = stage();
    for (let channel = 0; channel < 2; channel++) {
      const c = required(excessive.channels[channel]);
      c.times = new Float32Array([
        ...Array.from({ length: 300 }, (_, i) => (i * 2 + channel + 1) / 1000),
        2,
      ]);
      const n = c.property === 'rotation' ? 4 : 3;
      c.values = new Float32Array(c.times.length * n);
      if (c.property === 'rotation')
        for (let i = 0; i < c.times.length; i++) c.values[i * 4 + 3] = 1;
    }
    expect(
      excessive.api.query(excessive.binding, durationMs(0), durationMs(2000)),
    ).toMatchObject({ reason: 'resource-limit' });
  });
  test('caps, domain and cancellation fail without clipped success', () => {
    const f = stage();
    expect(
      f.api.query(f.binding, durationMs(0), durationMs(2001)),
    ).toMatchObject({ kind: 'unavailable', reason: 'invalid-interval' });
    const signal = new AbortController();
    signal.abort();
    expect(
      f.api.query(f.binding, durationMs(0), durationMs(2000), {
        signal: signal.signal,
      }),
    ).toMatchObject({ kind: 'unavailable', reason: 'cancelled' });
    required(f.channels[0]).times = new Float32Array(513);
    expect(
      f.api.query(f.binding, durationMs(0), durationMs(2000)),
    ).toMatchObject({ kind: 'unavailable', reason: 'resource-limit' });
  });
});

describe('pinned source proofs', () => {
  const policy = copyRootPolicy({
    version: 1,
    clipId: 'Uppercut',
    mode: 'grounded-posture-y',
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    provenance: {
      manifestSha256:
        'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
      clipPointer: '/clips/3',
      supportPointer: '/clips/3/support_contacts',
    },
  });
  const bytes = () =>
    new Uint8Array(
      readFileSync('public/game-assets/android/derived-pack-v1.glb'),
    );
  let provider: SourceHeadProvider;
  beforeAll(async () => {
    provider = await preparePinnedSourceHead({
      derivedBytes: bytes(),
      rootPolicies: [policy],
      signal: new AbortController().signal,
      intervalDiagnostics: 'idle-uppercut-f21-f24-v1',
    });
  });
  afterAll(() => provider?.dispose());
  function pinnedCells(name: 'Idle' | 'Uppercut') {
    const b = required(
      provider.poseBindings.clips.find((b) => b.clipId === name),
    );
    expect(provider.intervalDiagnostics).toBeDefined();
    const r = required(provider.intervalDiagnostics).query(
      b,
      durationMs(name === 'Idle' ? 567.6666686534882 : 466.66666865348816),
      durationMs(name === 'Idle' ? 634.3333611488342 : 533.3333611488342),
    );
    expect(r.kind).toBe('cells');
    if (r.kind !== 'cells') throw Error(r.kind);
    return r.cells;
  }
  test('pinned opt-in intervals expose exactly four Idle and three Uppercut source cells', () => {
    expect(pinnedCells('Idle')).toHaveLength(4);
    expect(pinnedCells('Uppercut')).toHaveLength(3);
    for (const c of [...pinnedCells('Idle'), ...pinnedCells('Uppercut')]) {
      expect(c.speedMPerSourceSecond).toBeGreaterThan(0);
      expect(c.floatingCertification).toBe('not-certified');
      expect(Object.isFrozen(c.binding)).toBe(true);
      expect(Object.values(c).some((v) => ArrayBuffer.isView(v))).toBe(false);
    }
  });
  test('pinned boundary operations interleave without changing canonical point samples', () => {
    const api = required(provider.intervalDiagnostics);
    for (const c of [
      ...[...pinnedCells('Uppercut')].reverse(),
      ...pinnedCells('Idle'),
    ]) {
      const old = provider.evaluate(c.binding, c.fromMs);
      const limit = api.sampleBoundary(c, 'to', 'interior-limit');
      expect(limit.kind).toBe('transform');
      const canonical = api.sampleBoundary(c, 'from', 'canonical-point');
      expect(canonical).toMatchObject(old);
      expect(provider.evaluate(c.binding, c.fromMs)).toEqual(old);
      if (limit.kind === 'transform')
        expect(Object.isFrozen(limit.matrix)).toBe(true);
      expect(
        api.sampleBoundary({ ...c }, 'from', 'interior-limit'),
      ).toMatchObject({ kind: 'unavailable', reason: 'foreign-cell' });
    }
  });
  test('pinned scope ends at F24 and does not authorize full original active window', () => {
    const b = required(
      provider.poseBindings.clips.find((b) => b.clipId === 'Uppercut'),
    );
    expect(
      required(provider.intervalDiagnostics).query(
        b,
        durationMs(466.66666865348816),
        durationMs(555.5555820465088),
      ),
    ).toMatchObject({ kind: 'unavailable', reason: 'unsupported-scope' });
  });
  test('default provider has no interval capability', async () => {
    const p = await preparePinnedSourceHead({
      derivedBytes: bytes(),
      signal: new AbortController().signal,
    });
    try {
      expect(p.intervalDiagnostics).toBeUndefined();
    } finally {
      p.dispose();
    }
  });
  test('enabled preparation cancellation rejects before interval publication', async () => {
    const controller = new AbortController();
    await expect(
      preparePinnedSourceHead({
        derivedBytes: bytes(),
        signal: controller.signal,
        intervalDiagnostics: 'idle-uppercut-f21-f24-v1',
        checkpoint: async (stage) => {
          if (stage === 'interval-diagnostics') controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  test('legitimate alternate root binding is unsupported rather than promoted into studied scope', async () => {
    const p = await preparePinnedSourceHead({
      derivedBytes: bytes(),
      signal: new AbortController().signal,
      intervalDiagnostics: 'idle-uppercut-f21-f24-v1',
    });
    try {
      const b = required(
        p.poseBindings.clips.find((b) => b.clipId === 'Uppercut'),
      );
      expect(p.evaluate(b, durationMs(500)).kind).toBe('transform');
      expect(
        required(p.intervalDiagnostics).query(
          b,
          durationMs(480),
          durationMs(520),
        ),
      ).toMatchObject({ kind: 'unavailable', reason: 'unsupported-scope' });
      const idle = required(
          p.poseBindings.clips.find((b) => b.clipId === 'Idle'),
        ),
        r = required(p.intervalDiagnostics).query(
          idle,
          durationMs(580),
          durationMs(590),
        );
      if (r.kind !== 'cells') throw Error(r.kind);
      const api = required(p.intervalDiagnostics),
        cell = required(r.cells[0]);
      p.dispose();
      expect(api.query(idle, durationMs(580), durationMs(590))).toMatchObject({
        kind: 'unavailable',
        reason: 'disposed',
      });
      expect(api.sampleBoundary(cell, 'to', 'canonical-point')).toMatchObject({
        kind: 'unavailable',
        reason: 'disposed',
      });
    } finally {
      p.dispose();
    }
  });

  interface OracleDocument {
    nodes: {
      children?: number[];
      translation?: number[];
      rotation?: number[];
      scale?: number[];
    }[];
    accessors: {
      bufferView: number;
      byteOffset?: number;
      count: number;
      type: string;
      componentType: number;
    }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
    animations: {
      name: string;
      channels: { sampler: number; target: { node: number; path: string } }[];
      samplers: { input: number; output: number; interpolation?: string }[];
    }[];
    skins: { inverseBindMatrices: number }[];
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  }
  /** Independent test-only original GLB hierarchy and skin algebra, not the provider's helper. */
  function originalOracle(input: Uint8Array, name: 'Idle' | 'Uppercut') {
    const data = new DataView(input.buffer, input.byteOffset, input.byteLength),
      jsonLength = data.getUint32(12, true);
    const doc = JSON.parse(
      new TextDecoder().decode(input.subarray(20, 20 + jsonLength)),
    ) as OracleDocument;
    const binary = 28 + jsonLength;
    function accessor(index: number) {
      const a = required(doc.accessors[index]),
        v = required(doc.bufferViews[a.bufferView]);
      expect(a.componentType).toBe(5126);
      expect(v.byteStride).toBeUndefined();
      const stride = required(
        ({ SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[
          a.type
        ],
      );
      return Array.from({ length: a.count * stride }, (_, i) =>
        data.getFloat32(
          binary + (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * 4,
          true,
        ),
      );
    }
    const clip = required(doc.animations.find((c) => c.name === name));
    const channels = clip.channels.map((c) => {
      const sampler = required(clip.samplers[c.sampler]);
      return {
        ...c.target,
        mode: sampler.interpolation ?? 'LINEAR',
        times: accessor(sampler.input),
        values: accessor(sampler.output),
      };
    });
    const parents = new Map<number, number>();
    doc.nodes.forEach((n, i) => {
      n.children?.forEach((k) => {
        parents.set(k, i);
      });
    });
    function pose(time: number, cellInterior?: number) {
      const frames = doc.nodes.map((n) => ({
        p: new Vector3().fromArray(n.translation ?? [0, 0, 0]),
        q: new Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]),
        s: new Vector3().fromArray(n.scale ?? [1, 1, 1]),
      }));
      for (const channel of channels) {
        const stride = channel.path === 'rotation' ? 4 : 3;
        let upper = 0;
        const selection = cellInterior ?? time;
        while (
          upper < channel.times.length &&
          required(channel.times[upper]) <= selection
        )
          upper++;
        let value: number[];
        if (upper === 0 || upper === channel.times.length) {
          const k = upper === 0 ? 0 : upper - 1;
          value = channel.values.slice(k * stride, (k + 1) * stride);
        } else {
          const a = channel.values.slice((upper - 1) * stride, upper * stride),
            b = channel.values.slice(upper * stride, (upper + 1) * stride);
          const u =
            (time - required(channel.times[upper - 1])) /
            (required(channel.times[upper]) -
              required(channel.times[upper - 1]));
          if (channel.mode === 'STEP') value = a;
          else if (channel.path === 'rotation') {
            value = [0, 0, 0, 0];
            Quaternion.slerpFlat(value, 0, a, 0, b, 0, u);
          } else value = a.map((x, k) => (1 - u) * x + u * required(b[k]));
        }
        const node = required(frames[channel.node]);
        if (channel.path === 'rotation') node.q.fromArray(value);
        else if (channel.path === 'translation') node.p.fromArray(value);
        else if (channel.path === 'scale') node.s.fromArray(value);
      }
      return frames;
    }
    function world(frames: ReturnType<typeof pose>, index: number): Matrix4 {
      const f = required(frames[index]),
        local = new Matrix4().compose(f.p, f.q, f.s),
        parent = parents.get(index);
      return parent === undefined
        ? local
        : world(frames, parent).multiply(local);
    }
    const zero = pose(0),
      originWorld = new Vector3().setFromMatrixPosition(world(zero, 52));
    const inverse = new Matrix4().fromArray(
      accessor(required(doc.skins[0]).inverseBindMatrices),
      6 * 16,
    );
    const positions = required(doc.meshes[0]).primitives.map((p) =>
      accessor(p.attributes.POSITION),
    );
    return {
      positions,
      skin(time: number, cellInterior?: number) {
        const frames = pose(time, cellInterior),
          root = required(frames[52]);
        if (name === 'Idle') root.p.copy(required(zero[52]).p);
        else {
          const current = new Vector3().setFromMatrixPosition(
            world(frames, 52),
          );
          current.x = originWorld.x;
          current.z = originWorld.z;
          root.p.copy(
            current.applyMatrix4(
              world(frames, required(parents.get(52))).invert(),
            ),
          );
        }
        return world(frames, 0).multiply(inverse);
      },
    };
  }
  test('bounded original and derived seven-cell full-head interval proof', async () => {
    const original = await preparePinnedSourceHead({
      sources: ANDROID_RUNTIME_ARTIFACT_V1.sources.map(
        (s) => new Uint8Array(readFileSync(s.path)),
      ),
      rootPolicies: [policy],
      signal: new AbortController().signal,
      intervalDiagnostics: 'idle-uppercut-f21-f24-v1',
    });
    const receipt = {
      passed: false,
      scope:
        'Seven studied source cells through F24 only; no full attack/42-clip interval coverage, no Float64 separation or timing certificate',
      criterionM: 1e-10,
      witnesses: 0,
      maxErrorM: 0,
      derivativeWitnesses: 0,
      maxObservedToBound: 0,
      cells: [] as {
        clip: string;
        fromMs: number;
        toMs: number;
        boundMPerSourceSecond: number;
        observedMPerSourceSecond: number;
      }[],
    };
    try {
      for (const name of ['Uppercut', 'Idle'] as const) {
        const source = required(
          provider.clipSources.find((s) => s.binding.clipId === name),
        );
        const pin = required(
          ANDROID_RUNTIME_ARTIFACT_V1.sources.find(
            (s) => s.sha256 === source.sourceSha256,
          ),
        );
        const verified = await loadVerifiedSource(
          async () => new Uint8Array(readFileSync(pin.path)),
          pin,
          new AbortController().signal,
        );
        const oracle = originalOracle(verified.bytes, name),
          cells = [...pinnedCells(name)].reverse(),
          api = required(provider.intervalDiagnostics),
          otherApi = required(original.intervalDiagnostics);
        const all = otherApi.query(
          source.binding,
          required(cells.at(-1)).fromMs,
          required(cells[0]).toMs,
        );
        if (all.kind !== 'cells') throw Error(all.kind);
        expect([...all.cells].reverse()).toEqual(cells);
        for (const cell of cells) {
          const mid = (cell.fromSeconds + cell.toSeconds) / 2;
          const counterpart = required(
            all.cells.find((c) => c.fromMs === cell.fromMs),
          );
          for (const endpoint of ['to', 'from'] as const)
            for (const semantics of [
              'interior-limit',
              'canonical-point',
            ] as const) {
              const sampled = api.sampleBoundary(cell, endpoint, semantics),
                other = otherApi.sampleBoundary(
                  counterpart,
                  endpoint,
                  semantics,
                );
              expect(other).toEqual(sampled);
              if (sampled.kind !== 'transform') throw Error(sampled.reason);
              const skin = oracle.skin(
                  sampled.sourceSeconds,
                  semantics === 'interior-limit' ? mid : undefined,
                ),
                matrix = new Matrix4().fromArray(sampled.matrix);
              for (const vertex of provider.descriptor.vertices) {
                const expected = new Vector3()
                  .fromArray(
                    required(oracle.positions[vertex.primitive]),
                    vertex.vertexIndex * 3,
                  )
                  .applyMatrix4(skin);
                const actual = new Vector3(
                  vertex.position.x,
                  vertex.position.y,
                  vertex.position.z,
                ).applyMatrix4(matrix);
                const error = expected.distanceTo(actual);
                receipt.witnesses++;
                receipt.maxErrorM = Math.max(receipt.maxErrorM, error);
                if (!Number.isFinite(error) || error > 1e-10)
                  throw Error(
                    `${name} ${endpoint} ${semantics} ${vertex.primitive}:${vertex.vertexIndex} ${error}`,
                  );
              }
            }
          let observed = 0;
          const h = (cell.toSeconds - cell.fromSeconds) / 65536;
          for (let k = 1; k <= 9; k++) {
            const t =
              cell.fromSeconds + ((cell.toSeconds - cell.fromSeconds) * k) / 10;
            const a = provider.evaluate(
                cell.binding,
                durationMs((t - h) * 1000),
              ),
              b = provider.evaluate(cell.binding, durationMs((t + h) * 1000));
            if (a.kind !== 'transform' || b.kind !== 'transform')
              throw Error('Missing derivative point');
            const ma = new Matrix4().fromArray(a.matrix),
              mb = new Matrix4().fromArray(b.matrix);
            for (const vertex of provider.descriptor.vertices) {
              const p = new Vector3(
                vertex.position.x,
                vertex.position.y,
                vertex.position.z,
              );
              observed = Math.max(
                observed,
                p.clone().applyMatrix4(ma).distanceTo(p.applyMatrix4(mb)) /
                  (2 * h),
              );
              receipt.derivativeWitnesses++;
            }
          }
          expect(observed).toBeLessThanOrEqual(cell.speedMPerSourceSecond);
          receipt.maxObservedToBound = Math.max(
            receipt.maxObservedToBound,
            observed / cell.speedMPerSourceSecond,
          );
          receipt.cells.push({
            clip: name,
            fromMs: cell.fromMs,
            toMs: cell.toMs,
            boundMPerSourceSecond: cell.speedMPerSourceSecond,
            observedMPerSourceSecond: observed,
          });
        }
      }
      expect(receipt.cells).toHaveLength(7);
      expect(receipt.witnesses).toBe(7 * 4 * 4472);
      receipt.passed = true;
    } finally {
      original.dispose();
      if (process.env.HEAD_INTERVAL_PROOF)
        appendFileSync(
          process.env.HEAD_INTERVAL_PROOF,
          `${JSON.stringify(receipt)}\n`,
        );
    }
  }, 30000);

  // Values copied from the independently reviewed phase-pinned14-cell receipt.
  const priorAnalyticCells: readonly (readonly [
    'Idle' | 'Uppercut',
    number,
    number,
    number,
  ])[] = [
    ['Uppercut', 466.66666865348816, 476.77780294418335, 0.795402719063766],
    ['Idle', 567.6666686534882, 577.7778029441833, 0.0037746929112924318],
    ['Uppercut', 476.77780294418335, 477.77777910232544, 0.795402719063766],
    ['Idle', 577.7778029441833, 578.7777791023254, 0.0037748224200509113],
    ['Uppercut', 477.77777910232544, 488.8888895511627, 0.795402719063766],
    ['Idle', 578.7777791023254, 589.8888895511627, 0.0037748224200509113],
    ['Uppercut', 488.8888895511627, 491.66666343808174, 0.7953938968413314],
    ['Idle', 589.8888895511627, 592.6666634380817, 0.0037748224200509113],
    ['Uppercut', 491.66666343808174, 494.44443732500076, 0.7953938968413314],
    ['Idle', 592.6666634380817, 595.4444373250008, 0.0037748224200509113],
    ['Uppercut', 494.44443732500076, 497.2222112119198, 0.7953938968413314],
    ['Idle', 595.4444373250008, 598.2222112119198, 0.0037748224200509113],
    ['Uppercut', 497.2222112119198, 498.99996423721313, 0.7953938968413314],
    ['Idle', 598.2222112119198, 599.9999642372131, 0.0037748224200509113],
    ['Uppercut', 498.99996423721313, 499.9999850988388, 0.7953938968413314],
    ['Idle', 599.9999642372131, 600.9999850988388, 0.006721382918428753],
    ['Uppercut', 499.9999850988388, 511.1110806465149, 0.7953938968413314],
    ['Idle', 600.9999850988388, 612.1110806465149, 0.006721382918428753],
    ['Uppercut', 511.1110806465149, 516.6666507720947, 0.7081959242665913],
    ['Idle', 612.1110806465149, 617.6666507720947, 0.006721382918428753],
    ['Uppercut', 516.6666507720947, 521.2222447395325, 0.7081959242665913],
    ['Idle', 617.6666507720947, 622.2222447395325, 0.006721382918428753],
    ['Uppercut', 521.2222447395325, 522.2222208976746, 0.7081959242665913],
    ['Idle', 622.2222447395325, 623.2222208976746, 0.006721346152615849],
    ['Uppercut', 522.2222208976746, 527.7777910232544, 0.7081959242665913],
    ['Idle', 623.2222208976746, 628.7777910232544, 0.006721346152615849],
    ['Uppercut', 527.7777910232544, 533.3333611488342, 0.7081959242665913],
    ['Idle', 628.7777910232544, 634.3333611488342, 0.006721346152615849],
  ];
  test('prior14-cell analytic comparison remains explicitly numerical diagnostic evidence', () => {
    const rows = priorAnalyticCells.map(([clip, from, to, prior]) => {
      const binding = required(
        provider.poseBindings.clips.find((b) => b.clipId === clip),
      );
      const result = required(provider.intervalDiagnostics).query(
        binding,
        durationMs(from),
        durationMs(to),
      );
      if (result.kind !== 'cells') throw Error(result.kind);
      const actual = Math.max(
        ...result.cells.map((c) => c.speedMPerSourceSecond),
      );
      expect(Number.isFinite(actual)).toBe(true);
      expect(actual).toBe(prior);
      return {
        clip,
        fromMs: from,
        toMs: to,
        priorAnalyticSpeed: prior,
        prototypeSpeed: actual,
        difference: actual - prior,
      };
    });
    if (process.env.HEAD_INTERVAL_PROOF)
      appendFileSync(
        process.env.HEAD_INTERVAL_PROOF,
        `${JSON.stringify({ scope: '28 source subcell comparisons only, no floating certification', rows, maxAbsoluteDifference: Math.max(...rows.map((r) => Math.abs(r.difference))) })}\n`,
      );
  });
});

describe('stage A pinned inventory', () => {
  test('all42 cells preserve complete stage A coverage and explicit unsupported pieces', async () => {
    const metadataCheckpoints: string[] = [];
    const provider = await preparePinnedSourceHead({
      derivedBytes: bytesForStageA(),
      signal: new AbortController().signal,
      intervalDiagnostics: 'pinned42-source-cells-v1',
      checkpoint: async (stage) => {
        if (stage.startsWith('interval-channels:'))
          metadataCheckpoints.push(stage);
      },
    });
    try {
      expect(metadataCheckpoints).toHaveLength(126);
      expect(new Set(metadataCheckpoints).size).toBe(126);
      const api = required(provider.intervalDiagnostics);
      expect(api.scope).toBe('pinned42-source-cells-v1');
      const expected = [
        ['Jump', 69, 0],
        ['FrontKick', 49, 0],
        ['SideKick', 53, 0],
        ['RoundhouseKick', 67, 8],
        ['LowSweep', 55, 3],
        ['KickCombo4', 136, 18],
        ['SpinningAttack', 88, 33],
        ['AerialKnee', 66, 0],
        ['CartwheelKick', 91, 44],
        ['FrontThrustKick', 65, 0],
        ['SideThrustKick', 71, 0],
        ['OutsideCrescentKick', 74, 0],
        ['KungFuSweep', 78, 18],
        ['KungFuKickChain4', 191, 3],
        ['TornadoKick', 100, 50],
        ['FlyingKick', 78, 0],
        ['ButterflyKick', 88, 48],
        ['ChineseCartwheelKick', 101, 45],
        ['ChineseAerialKnee', 84, 83],
        ['KungFuAcrobaticCombo', 208, 84],
        ['Idle', 91, 0],
        ['Walk', 37, 0],
        ['Run', 25, 0],
        ['DashStart', 46, 0],
        ['DashStop', 69, 0],
        ['StrafeLeft', 49, 0],
        ['StrafeRight', 49, 0],
        ['QuickTurn', 49, 19],
        ['CrouchMove', 61, 0],
        ['Jab', 37, 0],
        ['Cross', 45, 3],
        ['Hook', 49, 2],
        ['Uppercut', 47, 2],
        ['PunchCombo4', 81, 8],
        ['FlippingSlash', 91, 34],
        ['DivingLunge', 85, 11],
        ['AcrobaticCombo', 311, 101],
        ['KungFuStraight', 61, 0],
        ['PalmStrike', 61, 0],
        ['WhippingStrike', 61, 4],
        ['ElbowStrike', 49, 0],
        ['KungFuHandCombo5', 145, 0],
      ] as const;
      let bounded = 0,
        unsupported = 0;
      const rows = expected.map(([name, count, unsupportedCount]) => {
        const binding = required(
          provider.poseBindings.clips.find((b) => b.clipId === name),
        );
        const result = api.query(binding, durationMs(0), binding.durationMs);
        if (result.kind !== 'partition') throw Error(`${name}: ${result.kind}`);
        expect(result.pieces).toHaveLength(count);
        expect(
          result.pieces.filter((p) => p.kind === 'unsupported'),
        ).toHaveLength(unsupportedCount);
        let previous = 0;
        for (const p of result.pieces) {
          expect(p.fromMs).toBe(previous);
          expect(p.toMs).toBeGreaterThan(p.fromMs);
          previous = p.toMs;
          expect(p.binding).toBe(binding);
          expect(Object.isFrozen(p)).toBe(true);
          if (p.kind === 'bounded') {
            bounded++;
            expect(Number.isFinite(p.speedMPerSourceSecond)).toBe(true);
            expect(p.speedMPerSourceSecond).toBeGreaterThanOrEqual(0);
          } else {
            unsupported++;
            expect(
              api.sampleBoundary(p, 'from', 'interior-limit'),
            ).toMatchObject({ kind: 'unavailable', resolution: 'unresolved' });
          }
        }
        expect(previous).toBe(binding.durationMs);
        const hold = required(result.pieces[0]);
        if (hold.kind !== 'bounded') throw Error('first hold unsupported');
        expect(hold.speedMPerSourceSecond).toBe(0);
        expect(
          api.sampleBoundary(hold, 'from', 'interior-limit'),
        ).toMatchObject(provider.evaluate(binding, durationMs(0)));
        expect(api.sampleBoundary(hold, 'to', 'interior-limit')).toMatchObject(
          provider.evaluate(binding, durationMs(0)),
        );
        return {
          clip: name,
          cells: count,
          unsupported: unsupportedCount,
          sourceBindingId: binding.sourceBindingId,
        };
      });
      expect({ bounded, unsupported }).toEqual({
        bounded: 2790,
        unsupported: 621,
      });
      if (process.env.HEAD_STAGE_A_RECEIPT)
        appendFileSync(
          process.env.HEAD_STAGE_A_RECEIPT,
          `${JSON.stringify({
            scope:
              'Stage A source partition inventory only; not Float64 certification',
            bounded,
            unsupported,
            rows,
          })}\n`,
        );
    } finally {
      provider.dispose();
    }
  });
});
function bytesForStageA() {
  return new Uint8Array(
    readFileSync('public/game-assets/android/derived-pack-v1.glb'),
  );
}

test('three pinned in-place policies retain193 finite source cells and explicit unsupported sides', async () => {
  const recipes = [
    {
      name: 'RoundhouseKick',
      index: 2,
      support: 'support',
      cells: 67,
      bounded: 59,
    },
    {
      name: 'SideThrustKick',
      index: 9,
      support: 'support_contacts',
      cells: 71,
      bounded: 71,
    },
    {
      name: 'LowSweep',
      index: 3,
      support: 'support_contacts',
      cells: 55,
      bounded: 52,
    },
  ] as const;
  const policies = recipes.map(({ name, index, support }) =>
    copyRootPolicy({
      version: 1,
      clipId: clipId(name),
      sourceSha256:
        '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
      mode: 'in-place-posture-xyz',
      provenance: {
        manifestSha256:
          'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
        clipPointer: `/clips/${index}`,
        supportPointer: `/clips/${index}/support_contacts/${support}`,
      },
    }),
  );
  const provider = await preparePinnedSourceHead({
    derivedBytes: bytesForStageA(),
    rootPolicies: policies,
    signal: new AbortController().signal,
    intervalDiagnostics: 'pinned42-source-cells-v1',
  });
  const receipt = {
    passed: false,
    mode: 'in-place-posture-xyz',
    cells: 0,
    bounded: 0,
    unsupported: 0,
    unavailableSides: 0,
    scope:
      'Three-clip metadata and side availability only; not a full-head bound proof',
  };
  try {
    const api = required(provider.intervalDiagnostics);
    for (const recipe of recipes) {
      const b = required(
        provider.poseBindings.clips.find((x) => x.clipId === recipe.name),
      );
      const r = api.query(b, durationMs(0), b.durationMs);
      if (r.kind !== 'partition') throw Error('Missing native partition');
      expect(r.pieces).toHaveLength(recipe.cells);
      expect(r.pieces.filter((x) => x.kind === 'bounded')).toHaveLength(
        recipe.bounded,
      );
      expect(
        api.query(
          { ...b, sourceBindingId: 'mixed-root-policy' },
          durationMs(0),
          b.durationMs,
        ),
      ).toMatchObject({ kind: 'unavailable', reason: 'invalid-binding' });
      for (const cell of [...r.pieces].reverse()) {
        receipt.cells++;
        if (cell.kind === 'bounded') {
          receipt.bounded++;
          expect(Number.isFinite(cell.speedMPerSourceSecond)).toBe(true);
          expect(cell.floatingCertification).toBe('not-certified');
        } else receipt.unsupported++;
        for (const endpoint of ['from', 'to'] as const) {
          expect(
            api.sampleBoundary(cell, endpoint, 'canonical-point').kind,
          ).toBe('transform');
          const side = api.sampleBoundary(cell, endpoint, 'interior-limit');
          if (cell.kind === 'unsupported') {
            expect(side).toMatchObject({
              kind: 'unavailable',
              resolution: 'unresolved',
            });
            receipt.unavailableSides++;
          } else expect(side.kind).toBe('transform');
        }
      }
    }
    expect([
      receipt.cells,
      receipt.bounded,
      receipt.unsupported,
      receipt.unavailableSides,
    ]).toEqual([193, 182, 11, 22]);
    receipt.passed = true;
  } finally {
    provider.dispose();
    if (process.env.IN_PLACE_INTERVAL_RECEIPT)
      appendFileSync(
        process.env.IN_PLACE_INTERVAL_RECEIPT,
        `${JSON.stringify(receipt)}\n`,
      );
  }
}, 30000);
