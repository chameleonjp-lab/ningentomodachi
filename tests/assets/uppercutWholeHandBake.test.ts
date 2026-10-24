/** Real plan + real cache/bake adapter; all evaluators here are synthetic. */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { createSourceEvaluator } from '../../src/assets/evaluateSource';
import { durationMs } from '../../src/contracts';
import {
  bakeMeasuredJoint,
  createMeasuredJointReceipt,
} from '../../tools/assets/measuredJointBake';
import { planUppercutWholeHandCandidate } from '../../tools/assets/uppercutWholeHandCandidate';
const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/android_punch.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/manifest.json',
  ),
});
const api = () => import('../../tools/assets/bakeUppercutWholeHandCandidate');

/** Raw accessor fixture only: no loader, skinning or pose evaluation. */
function rawSelection(bytes: Uint8Array) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    length = data.getUint32(12, true);
  const document = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + length)),
  );
  const binary = 28 + length;
  const accessor = (index: number): number[][] => {
    const a = document.accessors[index],
      view = document.bufferViews[a.bufferView];
    const size =
      a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4;
    const components = a.type === 'SCALAR' ? 1 : 4;
    const start = binary + (view.byteOffset ?? 0) + (a.byteOffset ?? 0),
      stride = view.byteStride ?? size * components;
    return Array.from({ length: a.count }, (_, i) =>
      Array.from({ length: components }, (_, c) => {
        const offset = start + i * stride + c * size;
        if (a.componentType === 5126) return data.getFloat32(offset, true);
        if (size === 1) return data.getUint8(offset);
        if (size === 2) return data.getUint16(offset, true);
        return data.getUint32(offset, true);
      }),
    );
  };
  const descendants = new Set<number>();
  const visit = (node: number) => {
    descendants.add(node);
    for (const child of document.nodes[node].children ?? []) visit(child);
  };
  visit(36);
  const meshes: {
    meshName: string;
    sourceMeshIndex: number;
    sourcePrimitiveIndex: number;
    vertexIndices: number[];
  }[] = document.meshes[0].primitives.flatMap(
    (
      primitive: {
        indices: number;
        attributes: { JOINTS_0: number; WEIGHTS_0: number };
      },
      index: number,
    ) => {
      const referenced = [
        ...new Set(accessor(primitive.indices).map((v) => v[0])),
      ];
      const weights = accessor(primitive.attributes.WEIGHTS_0),
        joints = accessor(primitive.attributes.JOINTS_0);
      const vertexIndices = referenced.filter((vertex) => {
        if (vertex === undefined) throw new Error('Missing raw vertex');
        const w = weights[vertex],
          j = joints[vertex];
        if (!w || !j) throw new Error('Missing raw skin attributes');
        let dominant = 0;
        for (let c = 1; c < 4; c++)
          if ((w[c] ?? 0) > (w[dominant] ?? 0)) dominant = c;
        return (
          (w[dominant] ?? 0) > 0 &&
          descendants.has(document.skins[0].joints[j[dominant] ?? -1])
        );
      });
      return vertexIndices.length
        ? [
            {
              meshName: `synthetic-primitive-${index}`,
              sourceMeshIndex: 0,
              sourcePrimitiveIndex: index,
              vertexIndices: vertexIndices as number[],
            },
          ]
        : [];
    },
  );
  return [{ shapeId: 'Uppercut:whole-hand:0', bone: 'hand.R', meshes }];
}
function setup() {
  const bytes = input(),
    plan = planUppercutWholeHandCandidate(bytes),
    receipt = createMeasuredJointReceipt(373);
  const calls: number[] = [];
  let opened = 0,
    disposed = 0;
  const selections = rawSelection(bytes.sourceBytes);
  const factory: typeof createSourceEvaluator = async (
    _bytes,
    clip,
    shapes,
    policy,
    execution,
  ) => {
    expect(clip).toBe('Uppercut');
    expect(shapes).toEqual([
      {
        shapeId: plan.model.shapeId,
        bone: 'hand.R',
        surface: 'dominant-skin-subtree',
      },
    ]);
    expect(policy).toEqual(plan.metadata.rootPolicy);
    opened++;
    execution?.beforeUpdate({ stage: 'startup', atMs: 0 });
    execution?.observeRootQuaternion?.({
      stage: 'startup',
      atMs: 0,
      quaternion: [0, 0, 0, 1],
    });
    return {
      surfaceSelections: selections,
      sample(atMs) {
        execution?.beforeUpdate({ stage: 'sample', atMs });
        calls.push(atMs);
        const angle = (atMs / plan.metadata.durationMs) * Math.PI * 2;
        execution?.observeRootQuaternion?.({
          stage: 'sample',
          atMs,
          quaternion: [0, 0, 0, 1],
        });
        const root = {
          position: { x: atMs / 10000, y: atMs / 1000, z: atMs / 2000 },
          visualYawRad: Math.PI,
        };
        return {
          root,
          rawRoot: structuredClone(root),
          shapes: [
            {
              shapeId: plan.model.shapeId,
              volume: {
                kind: 'sphere',
                center: { x: 0.1, y: Math.sin(angle), z: Math.cos(angle) },
                radiusM: 0.12,
              },
            },
          ],
        };
      },
      dispose() {
        disposed++;
      },
    };
  };
  const gate = {
    sourceExecutionReleased: true as const,
    sourceSha256: plan.source.sourceSha256,
    sampleTimesSha256: plan.scheduleHashes.sampleTimesMs,
    maxSourceUpdates: 373 as const,
  };
  return {
    bytes,
    plan,
    receipt,
    calls,
    factory,
    selections,
    gate,
    opened: () => opened,
    disposed: () => disposed,
  };
}

test('synthetic actual297/75/372 timetable feeds real bake adapter with exact373 updates', async () => {
  const { bakeUppercutWholeHandCandidate } = await api();
  const s = setup();
  const result = await bakeUppercutWholeHandCandidate(
    s.bytes,
    s.receipt,
    s.gate,
    s.factory,
  );
  expect(s.opened()).toBe(1);
  expect(s.disposed()).toBe(1);
  expect(s.calls).toEqual(s.plan.schedule.sampleTimesMs);
  expect(s.receipt).toMatchObject({
    attemptedSourceUpdates: 373,
    startupUpdates: 1,
    sampleUpdates: 372,
    rejectedUpdates: 0,
  });
  expect(s.receipt.attemptedTimesMs).toEqual([
    0,
    ...s.plan.schedule.sampleTimesMs,
  ]);
  expect(result.asset.definition.rootCurve.map((k) => k.atMs)).toEqual(
    s.plan.schedule.candidateTimesMs,
  );
  expect(result.sampledPoses).toHaveLength(372);
  expect(result.sampledPoses.map((sample) => sample.atMs)).toEqual(
    s.plan.schedule.sampleTimesMs,
  );
  expect(result.probes).toHaveLength(75);
  expect(result.evaluationKind).toBe('synthetic-control');
  expect(result.acceptance).toBeNull();
  expect(result.gameplayAllowance).toBeNull();
  expect(result.sourceAuthoredAnatomy).toBeNull();
});

test('synthetic exact-key removal fails without cache fallback or reseek', async () => {
  const s = setup();
  const missing = s.plan.schedule.candidateTimesMs[1];
  const times = s.plan.schedule.sampleTimesMs.filter((t) => t !== missing);
  await expect(
    bakeMeasuredJoint(
      {
        sourceBytes: s.bytes.sourceBytes,
        clipName: 'Uppercut',
        shapes: [
          {
            shapeId: s.plan.model.shapeId,
            bone: 'hand.R',
            surface: 'dominant-skin-subtree',
          },
        ],
        rootPolicy: s.plan.metadata.rootPolicy,
        bakeInput: {
          clipId: s.plan.metadata.clipId,
          category: 'punch',
          durationMs: s.plan.metadata.durationMs,
          sampleRateHz: 240,
          sourceTimesMs: s.plan.schedule.candidateTimesMs,
          impacts: [
            {
              ...s.plan.impact,
              startMs: durationMs(s.plan.impact.startMs),
              endMs: durationMs(s.plan.impact.endMs),
            },
          ],
          ownership: [
            {
              atMs: durationMs(0),
              horizontalOwner: 'authored-root',
              verticalOwner: 'authored-root',
            },
          ],
        },
        sampleTimesMs: times,
        receipt: s.receipt,
      },
      s.factory,
    ),
  ).rejects.toThrow(/Missing exact cache key/);
  expect(s.calls).toEqual(times);
  expect(s.calls).not.toContain(missing);
  expect(s.disposed()).toBe(1);
});

test('metadata-only raw selected4223 provenance validates exact primitive hashes', async () => {
  const { validateUppercutWholeHandSelection } = await api();
  const s = setup();
  expect(() =>
    validateUppercutWholeHandSelection(s.bytes, s.selections),
  ).not.toThrow();
  expect(s.selections[0]?.meshes.map((m) => m.vertexIndices.length)).toEqual([
    1513, 122, 1676, 912,
  ]);
});

test('metadata-only wrong shape bone mesh primitive duplicate or vertex order rejects', async () => {
  const { validateUppercutWholeHandSelection } = await api();
  const s = setup();
  for (const mutate of [
    (v: typeof s.selections) => {
      if (v[0]) v[0].bone = 'forearm.R';
    },
    (v: typeof s.selections) => {
      if (v[0]) v[0].shapeId = 'other';
    },
    (v: typeof s.selections) => {
      if (v[0]?.meshes[0]) v[0].meshes[0].sourceMeshIndex = 1;
    },
    (v: typeof s.selections) => {
      if (v[0]?.meshes[0]) v[0].meshes[0].sourcePrimitiveIndex = 4;
    },
    (v: typeof s.selections) => {
      if (v[0]?.meshes[0]) v[0].meshes.push(v[0].meshes[0]);
    },
    (v: typeof s.selections) => {
      v[0]?.meshes[0]?.vertexIndices.reverse();
    },
  ]) {
    const copy = structuredClone(s.selections);
    mutate(copy);
    expect(() => validateUppercutWholeHandSelection(s.bytes, copy)).toThrow(
      /selection/i,
    );
  }
});

test('synthetic invalid selection cannot return a candidate after delegated cleanup', async () => {
  const { bakeUppercutWholeHandCandidate } = await api();
  const s = setup();
  s.selections.length = 0;
  await expect(
    bakeUppercutWholeHandCandidate(s.bytes, s.receipt, s.gate, s.factory),
  ).rejects.toThrow(/selection/i);
  expect(s.disposed()).toBe(1);
  expect(s.calls).toEqual([]);
  expect(s.receipt.startupUpdates).toBe(1);
});

test('synthetic wrong execution gate or receipt rejects before evaluator construction', async () => {
  const { bakeUppercutWholeHandCandidate } = await api();
  for (const kind of ['gate', 'budget', 'used-receipt'] as const) {
    const s = setup();
    const gate =
      kind === 'gate' ? { ...s.gate, sourceSha256: 'wrong' } : s.gate;
    const receipt =
      kind === 'budget' ? createMeasuredJointReceipt(374) : s.receipt;
    if (kind === 'used-receipt') receipt.attemptedSourceUpdates = 1;
    await expect(
      bakeUppercutWholeHandCandidate(s.bytes, receipt, gate, s.factory),
    ).rejects.toThrow(/gate|budget/i);
    expect(s.opened()).toBe(0);
  }
});

test('synthetic fullXYZ and identity-root geometry remain separate from Euler yaw metadata', async () => {
  const { bakeUppercutWholeHandCandidate } = await api();
  const s = setup();
  const result = await bakeUppercutWholeHandCandidate(
    s.bytes,
    s.receipt,
    s.gate,
    s.factory,
  );
  const root = result.asset.definition.rootCurve.find((k) => k.atMs === 1000),
    shape = result.asset.shapes[0]?.keys.find((k) => k.atMs === 1000);
  expect(root?.position).toEqual({ x: 0.1, y: 1, z: 0.5 });
  expect(root?.visualYawRad).toBe(Math.PI);
  expect(shape?.volume).toMatchObject({
    center: {
      x: 0.1,
      y: Math.sin((1000 / s.plan.metadata.durationMs) * Math.PI * 2),
      z: Math.cos((1000 / s.plan.metadata.durationMs) * Math.PI * 2),
    },
  });
  expect(s.receipt.rootQuaternionObservations).toHaveLength(373);
  expect(
    s.receipt.rootQuaternionObservations.every(
      (q) => q.quaternion[0] === 0 && q.quaternion[3] === 1,
    ),
  ).toBe(true);
  expect(result.scalarYawInterpretation).toBe(
    'Euler-YXZ observation; not arbitrary-axis heading',
  );
});

test('synthetic outputs are immutable snapshots and probes do not claim empty-space acceptance', async () => {
  const { bakeUppercutWholeHandCandidate } = await api();
  const s = setup();
  const result = await bakeUppercutWholeHandCandidate(
    s.bytes,
    s.receipt,
    s.gate,
    s.factory,
  );
  const frozen = (v: unknown): void => {
    if (v && typeof v === 'object') {
      expect(Object.isFrozen(v)).toBe(true);
      for (const child of Object.values(v)) frozen(child);
    }
  };
  frozen(result);
  expect(
    result.probes.every(
      (p) =>
        Number.isFinite(p.envelopeResidualM) &&
        Number.isFinite(p.rootInterpolationErrorM),
    ),
  ).toBe(true);
  expect(result.emptySpaceExcess).toBeNull();
  expect(result.probeCoverage).toBe(
    'finite-active-quarter-mid-threequarter-only',
  );
  const before = result.surfaceSelections[0]?.meshes[0]?.vertexIndices[0];
  s.selections[0]?.meshes[0]?.vertexIndices.reverse();
  expect(result.surfaceSelections[0]?.meshes[0]?.vertexIndices[0]).toBe(before);
});

test('synthetic all-negative signed probes retain negatives and zero positive exceedance', async () => {
  const { bakeUppercutWholeHandCandidate } = await api();
  const s = setup();
  const probeTimes = new Set(s.plan.schedule.probeTimesMs);
  const factory: typeof createSourceEvaluator = async (...args) => {
    const evaluator = await s.factory(...args);
    return {
      surfaceSelections: evaluator.surfaceSelections,
      sample(atMs) {
        const pose = evaluator.sample(atMs);
        const volume = pose.shapes[0]?.volume;
        if (probeTimes.has(atMs) && volume?.kind === 'sphere')
          return {
            ...pose,
            shapes: [
              {
                shapeId: s.plan.model.shapeId,
                volume: { ...volume, radiusM: 0.01 },
              },
            ],
          };
        return pose;
      },
      dispose() {
        evaluator.dispose();
      },
    };
  };
  const result = await bakeUppercutWholeHandCandidate(
    s.bytes,
    s.receipt,
    s.gate,
    factory,
  );
  expect(result.probes).toHaveLength(75);
  expect(result.probes.every((probe) => probe.envelopeResidualM < 0)).toBe(
    true,
  );
  expect(result.maximumPositiveEnvelopeExceedanceM).toBe(0);
  expect(s.receipt.attemptedSourceUpdates).toBe(373);
});

test('synthetic sample failure retains attempted witnesses and disposes once', async () => {
  const { bakeUppercutWholeHandCandidate } = await api();
  const s = setup();
  const failure = new Error('synthetic sample failure');
  const factory: typeof createSourceEvaluator = async (...args) => {
    const e = await s.factory(...args);
    return {
      surfaceSelections: e.surfaceSelections,
      sample(atMs) {
        e.sample(atMs);
        throw failure;
      },
      dispose() {
        e.dispose();
      },
    };
  };
  await expect(
    bakeUppercutWholeHandCandidate(s.bytes, s.receipt, s.gate, factory),
  ).rejects.toBe(failure);
  expect(s.receipt.attemptedSourceUpdates).toBe(2);
  expect(s.receipt.rootQuaternionObservations).toHaveLength(2);
  expect(s.disposed()).toBe(1);
  // Two additional failure scenarios, each owns a fresh synthetic instance/receipt.
  for (const scenario of ['nonfinite', 'wrong-sampled-shape'] as const) {
    const x = setup();
    const invalidFactory: typeof createSourceEvaluator = async (...args) => {
      const e = await x.factory(...args);
      return {
        surfaceSelections: e.surfaceSelections,
        sample(atMs) {
          const pose = e.sample(atMs);
          return scenario === 'nonfinite'
            ? {
                ...pose,
                root: {
                  ...pose.root,
                  position: { ...pose.root.position, x: NaN },
                },
              }
            : {
                ...pose,
                shapes: pose.shapes.map((shape) => ({
                  ...shape,
                  shapeId: 'not-Uppercut',
                })),
              };
        },
        dispose() {
          e.dispose();
        },
      };
    };
    await expect(
      bakeUppercutWholeHandCandidate(
        x.bytes,
        x.receipt,
        x.gate,
        invalidFactory,
      ),
    ).rejects.toThrow();
    expect(x.receipt.attemptedSourceUpdates).toBeGreaterThanOrEqual(2);
    expect(x.receipt.rootQuaternionObservations.length).toBe(
      x.receipt.attemptedSourceUpdates,
    );
    expect(x.disposed()).toBe(1);
  }
});
test('synthetic cleanup failure remains in caller receipt and never returns candidate', async () => {
  const { bakeUppercutWholeHandCandidate } = await api();
  const s = setup();
  const failure = new Error('synthetic cleanup failure');
  const factory: typeof createSourceEvaluator = async (...args) => {
    const e = await s.factory(...args);
    return {
      surfaceSelections: e.surfaceSelections,
      sample(atMs) {
        return e.sample(atMs);
      },
      dispose() {
        e.dispose();
        throw failure;
      },
    };
  };
  await expect(
    bakeUppercutWholeHandCandidate(s.bytes, s.receipt, s.gate, factory),
  ).rejects.toThrow(/Measured joint cleanup failed/);
  expect(s.receipt.cleanupErrors).toContain(failure);
  expect(s.disposed()).toBe(1);
});
test('synthetic probes independently agree with retained exact cache geometry', async () => {
  const { bakeUppercutWholeHandCandidate } = await api();
  const s = setup();
  const result = await bakeUppercutWholeHandCandidate(
    s.bytes,
    s.receipt,
    s.gate,
    s.factory,
  );
  for (const probe of result.probes) {
    const exact = result.sampledPoses.find((p) => p.atMs === probe.atMs)?.pose;
    const upper = result.asset.definition.rootCurve.findIndex(
      (k) => k.atMs > probe.atMs,
    );
    const a = result.asset.definition.rootCurve[upper - 1],
      b = result.asset.definition.rootCurve[upper];
    const sa = result.asset.shapes[0]?.keys[upper - 1]?.volume,
      sb = result.asset.shapes[0]?.keys[upper]?.volume,
      actual = exact?.shapes[0]?.volume;
    if (
      !a ||
      !b ||
      !exact ||
      sa?.kind !== 'sphere' ||
      sb?.kind !== 'sphere' ||
      actual?.kind !== 'sphere'
    )
      throw new Error('Missing synthetic oracle samples');
    const f = (probe.atMs - a.atMs) / (b.atMs - a.atMs);
    const squared = (['x', 'y', 'z'] as const).map((axis) => {
      const expected =
        (1 - f) * (a.position[axis] + sa.center[axis]) +
        f * (b.position[axis] + sb.center[axis]);
      return (exact.root.position[axis] + actual.center[axis] - expected) ** 2;
    });
    const residual =
      Math.sqrt(squared.reduce((x, y) => x + y, 0)) +
      actual.radiusM -
      ((1 - f) * sa.radiusM + f * sb.radiusM);
    expect(probe.envelopeResidualM).toBeCloseTo(residual, 12);
  }
  expect(s.calls).toHaveLength(372);
  expect(s.disposed()).toBe(1);
});
