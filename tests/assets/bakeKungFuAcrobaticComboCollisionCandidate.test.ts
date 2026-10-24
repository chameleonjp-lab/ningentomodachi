/** Original GLB bytes are decoded as metadata only. Every evaluator is synthetic. */
import { readFileSync, existsSync } from 'node:fs';
import { expect, test } from 'vitest';
import type {
  createSourceEvaluator,
  SourceEvaluator,
} from '../../src/assets/evaluateSource';
async function declaration(input: ReturnType<typeof bytes>) {
  expect(
    existsSync('tools/assets/kungFuAcrobaticComboCollisionCandidate.ts'),
    'declaration must exist',
  ).toBe(true);
  return (
    await import('../../tools/assets/kungFuAcrobaticComboCollisionCandidate')
  ).readKungFuAcrobaticComboCollisionCandidate(input);
}
import { createMeasuredJointReceipt } from '../../tools/assets/measuredJointBake';
const api = () =>
  import('../../tools/assets/bakeKungFuAcrobaticComboCollisionCandidate');
const bytes = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/kick/manifest.json',
  ),
});
// Independent static accessor decoder, not a Three loader, skinning or pose evaluator.
function selection(
  source: Buffer,
  shapeId: string,
  side: 'L' | 'R',
): SourceEvaluator['surfaceSelections'] {
  const length = source.readUInt32LE(12);
  const gltf = JSON.parse(source.subarray(20, 20 + length).toString());
  const binary = 28 + length;
  const values = (index: number): number[][] => {
    const a = gltf.accessors[index],
      v = gltf.bufferViews[a.bufferView];
    const size = a.type === 'VEC4' ? 4 : 1;
    const width =
      a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4;
    expect([5121, 5123, 5125, 5126]).toContain(a.componentType);
    return Array.from({ length: a.count }, (_, i) =>
      Array.from({ length: size }, (_, c) => {
        const offset =
          binary +
          (v.byteOffset ?? 0) +
          (a.byteOffset ?? 0) +
          i * (v.byteStride ?? size * width) +
          c * width;
        return a.componentType === 5121
          ? source.readUInt8(offset)
          : a.componentType === 5126
            ? source.readFloatLE(offset)
            : a.componentType === 5123
              ? source.readUInt16LE(offset)
              : source.readUInt32LE(offset);
      }),
    );
  };
  expect(gltf.skins[0].joints.slice(51, 53)).toEqual([48, 47]);
  return [
    {
      shapeId,
      bone: `foot.${side}`,
      meshes: gltf.meshes[0].primitives.map(
        (
          p: { attributes: Record<string, number>; indices: number },
          primitive: number,
        ) => {
          const joints = values(p.attributes.JOINTS_0 ?? -1),
            weights = values(p.attributes.WEIGHTS_0 ?? -1);
          const referenced = [
            ...new Set(values(p.indices).map((r) => r[0] ?? -1)),
          ];
          return {
            meshName: `synthetic-Sphere-${primitive}`,
            sourceMeshIndex: 0,
            sourcePrimitiveIndex: primitive,
            vertexIndices: referenced.filter((vertex) => {
              const row = weights[vertex] ?? [];
              let dominant = 0;
              for (let c = 1; c < 4; c++)
                if ((row[c] ?? 0) > (row[dominant] ?? 0)) dominant = c;
              return (
                (row[dominant] ?? 0) > 0 &&
                (side === 'L' ? [47, 48] : [51, 52]).includes(
                  joints[vertex]?.[dominant] ?? -1,
                )
              );
            }),
          };
        },
      ),
    },
  ];
}
async function setup(
  change?: (
    s: SourceEvaluator['surfaceSelections'],
  ) => SourceEvaluator['surfaceSelections'],
) {
  const input = bytes(),
    d = await declaration(input);
  const selections = d.shapes.flatMap((shape) =>
    selection(input.sourceBytes, shape.shapeId, 'R'),
  );
  const calls: number[] = [];
  let opened = 0,
    disposed = 0;
  const factory: typeof createSourceEvaluator = async (
    _bytes,
    clip,
    shapes,
    policy,
    execution,
  ) => {
    opened++;
    expect(clip).toBe('KungFuAcrobaticCombo');
    expect(shapes).toEqual(d.shapes);
    expect(policy).toEqual(d.rootPolicy);
    execution?.beforeUpdate({ stage: 'startup', atMs: 0 });
    execution?.observeRootQuaternion?.({
      stage: 'startup',
      atMs: 0,
      quaternion: [0.2, 0.3, 0.4, 0.8426149773176358],
    });
    const evaluator: SourceEvaluator = {
      surfaceSelections: change ? change(selections) : selections,
      sample(atMs) {
        execution?.beforeUpdate({ stage: 'sample', atMs });
        execution?.observeRootQuaternion?.({
          stage: 'sample',
          atMs,
          quaternion: [0.2, 0.3, 0.4, 0.8426149773176358],
        });
        calls.push(atMs);
        return {
          root: {
            position: { x: atMs / 1000, y: 0.4, z: 0.3 },
            visualYawRad: 0.7,
          },
          rawRoot: {
            position: { x: atMs / 1000, y: 0.4, z: 0.3 },
            visualYawRad: 0.7,
          },
          shapes: shapes.map((shape) => ({
            shapeId: shape.shapeId,
            volume: {
              kind: 'sphere' as const,
              center: { x: 3 - atMs / 1000, y: 1.6, z: 0.7 },
              radiusM: 0.1,
            },
          })),
        };
      },
      dispose() {
        disposed++;
      },
    };
    return evaluator;
  };
  return {
    input: {
      ...input,
      receipt: createMeasuredJointReceipt(2713),
      gate: {
        sourceExecutionReleased: true as const,
        sourceSha256: String(d.sourcePins.sourceSha256),
        sampleTimesSha256: d.schedule.sampleKeysSha256,
        modelSha256: d.modelSha256,
        maxSourceUpdates: 2713 as const,
      },
    },
    declaration: d,
    selections,
    calls,
    factory,
    opened: () => opened,
    disposed: () => disposed,
  };
}
test('one synthetic evaluator caches exact 2712 keys retaining root subtraction/addition exactly once', async () => {
  const s = await setup(),
    r = await (await api()).bakeKungFuAcrobaticComboCollisionCandidate(
      s.input,
      s.factory,
    );
  expect(s.calls).toEqual(s.declaration.schedule.sampleKeysMs);
  expect(new Set(s.calls).size).toBe(2712);
  expect(s.opened()).toBe(1);
  expect(s.disposed()).toBe(1);
  expect(s.input.receipt).toMatchObject({
    attemptedSourceUpdates: 2713,
    startupUpdates: 1,
    sampleUpdates: 2712,
    rejectedUpdates: 0,
    cleanupErrors: [],
  });
  expect(s.input.receipt.rootQuaternionObservations).toHaveLength(2713);
  expect(s.input.receipt.rootQuaternionObservations[140]?.quaternion).toEqual([
    0.2, 0.3, 0.4, 0.8426149773176358,
  ]);
  expect(r.asset.shapes).toHaveLength(1);
  expect(r.asset.definition.impacts).toEqual(s.declaration.impacts);
  expect(r.poses.size).toBe(2712);
  expect(r.asset.definition.rootCurve.map((k) => k.atMs)).toEqual(
    s.declaration.schedule.baseKeysMs,
  );
  expect(r.declaration.acceptance).toBeNull();
  expect(r.selectionVerification.selectedVertexCount).toBe(2284);
  expect(r.asset.ownership).toEqual([
    {
      atMs: 0,
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ]);
  for (const [i, k] of r.asset.definition.rootCurve.entries()) {
    const volume = r.asset.shapes[0]?.keys[i]?.volume;
    if (!volume || volume.kind !== 'sphere') throw new Error('Missing sphere');
    expect(k.position.x).toBe(k.atMs / 1000);
    expect(k.position.y).toBe(0.4);
    expect(k.position.z).toBe(0.3);
    expect(k.position.x + volume.center.x).toBeCloseTo(3, 12);
    expect(k.position.y + volume.center.y).toBeCloseTo(2, 12);
    expect(k.position.z + volume.center.z).toBeCloseTo(1, 12);
  }
});
test('wrong left membership or absent selection is rejected before first sample with disposal', async () => {
  for (const change of [
    (s: SourceEvaluator['surfaceSelections']) =>
      s.map((v, i) => ({ ...v, meshes: s[1 - i]?.meshes ?? [] })),
    (s: SourceEvaluator['surfaceSelections']) => s.slice(0, 0),
    (s: SourceEvaluator['surfaceSelections']) =>
      s.map((v, i) => ({ ...v, bone: i === 0 ? 'foot.L' : 'foot.R' })),
  ]) {
    const s = await setup(change);
    await expect(
      (await api()).bakeKungFuAcrobaticComboCollisionCandidate(
        s.input,
        s.factory,
      ),
    ).rejects.toThrow(/selection/);
    expect(s.calls).toHaveLength(0);
    expect(s.disposed()).toBe(1);
    expect(s.input.receipt.startupUpdates).toBe(1);
  }
});
test('nonexact budgets reject before opening', async () => {
  const s = await setup();
  s.input.receipt = createMeasuredJointReceipt(2714);
  await expect(
    (await api()).bakeKungFuAcrobaticComboCollisionCandidate(
      s.input,
      s.factory,
    ),
  ).rejects.toThrow(/budget/);
  expect(s.opened()).toBe(0);
  const t = await setup();
  t.input.receipt = createMeasuredJointReceipt(2);
  await expect(
    (await api()).bakeKungFuAcrobaticComboCollisionCandidate(
      t.input,
      t.factory,
    ),
  ).rejects.toThrow(/budget/);
  expect(t.opened()).toBe(0);
});

test('exact source/model/schedule gates and fresh receipts reject before opening', async () => {
  for (const field of [
    'sourceSha256',
    'sampleTimesSha256',
    'modelSha256',
  ] as const) {
    const s = await setup();
    s.input.gate[field] = '0'.repeat(64);
    await expect(
      (await api()).bakeKungFuAcrobaticComboCollisionCandidate(
        s.input,
        s.factory,
      ),
    ).rejects.toThrow(/gate/);
    expect(s.opened()).toBe(0);
  }
  const s = await setup();
  s.input.receipt.attemptedSourceUpdates = 1;
  await expect(
    (await api()).bakeKungFuAcrobaticComboCollisionCandidate(
      s.input,
      s.factory,
    ),
  ).rejects.toThrow(/fresh|budget/i);
  expect(s.opened()).toBe(0);
});
test('same-count reordered or duplicate membership is rejected before sampling', async () => {
  for (const change of [
    (x: number[]) => x.reverse(),
    (x: number[]) => {
      x[1] = x[0]!;
      return x;
    },
  ]) {
    const s = await setup((rows) =>
      rows.map((r) => ({
        ...r,
        meshes: r.meshes.map((m, i) => ({
          ...m,
          vertexIndices:
            i === 0 ? change([...m.vertexIndices]) : m.vertexIndices,
        })),
      })),
    );
    await expect(
      (await api()).bakeKungFuAcrobaticComboCollisionCandidate(
        s.input,
        s.factory,
      ),
    ).rejects.toThrow(/selection/);
    expect(s.calls).toHaveLength(0);
    expect(s.disposed()).toBe(1);
  }
});

test('synthetic primary sample failure wins over cleanup failure including undefined', async () => {
  for (const primary of [new Error('sample failed'), undefined]) {
    const s = await setup();
    let disposed = 0;
    const factory: typeof createSourceEvaluator = async (...args) => {
      const e = await s.factory(...args);
      return {
        surfaceSelections: e.surfaceSelections,
        sample() {
          throw primary;
        },
        dispose() {
          disposed++;
          throw new Error('cleanup failed');
        },
      };
    };
    let caught = false,
      value: unknown;
    try {
      await (await api()).bakeKungFuAcrobaticComboCollisionCandidate(
        s.input,
        factory,
      );
    } catch (e) {
      caught = true;
      value = e;
    }
    expect(caught).toBe(true);
    expect(value).toBe(primary);
    expect(disposed).toBe(1);
    expect(s.input.receipt.cleanupErrors).toHaveLength(1);
  }
});
test('synthetic factory failure is preserved without later sampling', async () => {
  const s = await setup(),
    error = new Error('factory failed');
  const factory: typeof createSourceEvaluator = async () => {
    throw error;
  };
  await expect(
    (await api()).bakeKungFuAcrobaticComboCollisionCandidate(s.input, factory),
  ).rejects.toBe(error);
  expect(s.calls).toHaveLength(0);
});
test('actual left vertex IDs disguised as the right bone fail exact membership gate', async () => {
  const s = await setup((rows) =>
    rows.map((row) => ({
      ...row,
      meshes: selection(bytes().sourceBytes, row.shapeId, 'L')[0]!.meshes,
    })),
  );
  expect(s.selections[0]?.bone).toBe('foot.R');
  await expect(
    (await api()).bakeKungFuAcrobaticComboCollisionCandidate(
      s.input,
      s.factory,
    ),
  ).rejects.toThrow(/selection/);
  expect(s.calls).toHaveLength(0);
  expect(s.disposed()).toBe(1);
});
