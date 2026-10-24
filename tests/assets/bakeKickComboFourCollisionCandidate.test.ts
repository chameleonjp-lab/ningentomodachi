/** Original GLB bytes are decoded as metadata only. Every evaluator is synthetic. */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type {
  createSourceEvaluator,
  SourceEvaluator,
} from '../../src/assets/evaluateSource';
import { readKickComboFourCollisionCandidate } from '../../tools/assets/kickComboFourCollisionCandidate';
import {
  bakeMeasuredJoint,
  createMeasuredJointReceipt,
} from '../../tools/assets/measuredJointBake';
const api = () =>
  import('../../tools/assets/bakeKickComboFourCollisionCandidate');
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
      bone: 'foot.R',
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
                [51, 52].includes(joints[vertex]?.[dominant] ?? -1)
              );
            }),
          };
        },
      ),
    },
  ];
}
function setup(
  change?: (
    s: SourceEvaluator['surfaceSelections'],
  ) => SourceEvaluator['surfaceSelections'],
) {
  const input = bytes(),
    declaration = readKickComboFourCollisionCandidate(input);
  const shapeId = declaration.shapes[0]?.shapeId ?? '';
  const selections = selection(input.sourceBytes, shapeId);
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
    expect(clip).toBe('KickCombo4');
    expect(shapes).toEqual(declaration.shapes);
    expect(policy).toEqual(declaration.rootPolicy);
    execution?.beforeUpdate({ stage: 'startup', atMs: 0 });
    const evaluator: SourceEvaluator = {
      surfaceSelections: change ? change(selections) : selections,
      sample(atMs) {
        expect(this).toBe(evaluator);
        execution?.beforeUpdate({ stage: 'sample', atMs });
        calls.push(atMs);
        return {
          root: { position: { x: 0, y: 0, z: 0 }, visualYawRad: 0.7 },
          rawRoot: {
            position: { x: 0.25, y: -0.547, z: 0.13 },
            visualYawRad: 0.7,
          },
          shapes: [
            {
              shapeId,
              volume: {
                kind: 'sphere',
                center: { x: atMs / 1000, y: -0.547, z: 0.13 },
                radiusM: 0.1,
              },
            },
          ],
        };
      },
      dispose() {
        expect(this).toBe(evaluator);
        disposed++;
      },
    };
    return evaluator;
  };
  return {
    input: { ...input, receipt: createMeasuredJointReceipt(1337) },
    declaration,
    selections,
    calls,
    factory,
    opened: () => opened,
    disposed: () => disposed,
  };
}

test('actual 859/477/1336 timetable reaches actual bakeMotion with every exact fractional key cached once', async () => {
  const s = setup(),
    { bakeKickComboFourCollisionCandidate } = await api();
  const result = await bakeKickComboFourCollisionCandidate(s.input, s.factory);
  expect(s.declaration.schedule.baseKeysMs).toHaveLength(859);
  expect(s.declaration.schedule.probeKeysMs).toHaveLength(477);
  expect(s.calls).toEqual(s.declaration.schedule.sampleKeysMs);
  expect(new Set(s.calls).size).toBe(1336);
  expect(result.asset.definition.rootCurve.map((k) => k.atMs)).toEqual(
    s.declaration.schedule.baseKeysMs,
  );
  expect(result.poses.size).toBe(1336);
  for (const t of s.declaration.schedule.baseKeysMs)
    expect(result.poses.has(t)).toBe(true);
  result.poses.get(1000 / 240);
  result.poses.get(0);
  result.poses.get(1000 / 240);
  expect(s.calls).toHaveLength(1336);
  expect(s.input.receipt).toMatchObject({
    attemptedSourceUpdates: 1337,
    startupUpdates: 1,
    sampleUpdates: 1336,
    rejectedUpdates: 0,
    cleanupErrors: [],
  });
  expect(s.input.receipt.attemptedTimesMs).toEqual([0, ...s.calls]);
  expect(s.opened()).toBe(1);
  expect(s.disposed()).toBe(1);
});

test('one measured curve preserves four impact identities, provisional shares, native posture and null acceptance', async () => {
  const s = setup(),
    { bakeKickComboFourCollisionCandidate } = await api();
  const r = await bakeKickComboFourCollisionCandidate(s.input, s.factory);
  expect(r.asset.shapes).toHaveLength(1);
  expect(r.asset.definition.impacts).toEqual(s.declaration.impacts);
  expect(r.asset.definition.impacts.map((i) => i.impactIndex)).toEqual([
    0, 1, 2, 3,
  ]);
  expect(
    r.asset.definition.impacts.reduce((sum, i) => sum + i.damageShare, 0),
  ).toBe(1);
  expect(r.declaration.damageShareOrigin).toBe(
    'provisional-developer-balancing-not-source-fact',
  );
  expect(r.declaration.events[1]?.sourceEvent.limb).toBe('right heel/sole');
  expect(r.declaration.events[2]?.sourceEvent.limb).toBe('right instep/shin');
  expect(r.declaration.events[1]?.modelInterpretation).toBe(
    'whole-foot-may-contact-other-foot-surfaces',
  );
  expect(r.declaration.events[2]?.modelInterpretation).toBe(
    'foot-side-interpretation-excludes-shin',
  );
  expect(r.declaration.rootPolicy.mode).toBe('in-place-posture-xyz');
  expect(r.poses.get(0)?.shapes[0]?.volume).toMatchObject({
    center: { y: -0.547, z: 0.13 },
  });
  expect(r.poses.get(0)?.rawRoot.position).toEqual({
    x: 0.25,
    y: -0.547,
    z: 0.13,
  });
  expect(r.declaration.acceptance).toBeNull();
  expect(r.declaration.gameplayAllowance).toBeNull();
  expect(r.surfaceSelections).toEqual(s.selections);
  expect(r.selectionVerification).toMatchObject({
    selectedVertexCount: 2284,
    gate: 'before-first-sample-after-startup',
    acceptance: null,
  });
});

test('same-count different vertex identity fails before first sample and disposes original receiver', async () => {
  const s = setup((original) => {
    const changed = structuredClone(original);
    const indices = changed[0]?.meshes[0]?.vertexIndices as number[];
    indices[0] = (indices[0] ?? 0) + 1;
    return changed;
  });
  const { bakeKickComboFourCollisionCandidate } = await api();
  await expect(
    bakeKickComboFourCollisionCandidate(s.input, s.factory),
  ).rejects.toThrow('selection');
  expect(s.calls).toEqual([]);
  expect(s.disposed()).toBe(1);
  expect(s.input.receipt).toMatchObject({
    startupUpdates: 1,
    sampleUpdates: 0,
    attemptedSourceUpdates: 1,
  });
});

test('wrong mesh provenance fails closed before measurement', async () => {
  const s = setup((original) =>
    original.map((part) => ({
      ...part,
      meshes: part.meshes.map((mesh) => ({ ...mesh, sourceMeshIndex: 1 })),
    })),
  );
  const { bakeKickComboFourCollisionCandidate } = await api();
  await expect(
    bakeKickComboFourCollisionCandidate(s.input, s.factory),
  ).rejects.toThrow('selection');
  expect(s.calls).toEqual([]);
  expect(s.disposed()).toBe(1);
});

test('missing selection fails closed without factory retry or sample', async () => {
  const s = setup(() => []),
    { bakeKickComboFourCollisionCandidate } = await api();
  await expect(
    bakeKickComboFourCollisionCandidate(s.input, s.factory),
  ).rejects.toThrow('selection');
  expect(s.opened()).toBe(1);
  expect(s.calls).toEqual([]);
  expect(s.disposed()).toBe(1);
});

test('exact fractional key deletion is rejected by real shared cache without fallback or reseek', async () => {
  const s = setup(),
    d = s.declaration;
  const times = d.schedule.sampleKeysMs.filter((t) => t !== 1000 / 240);
  await expect(
    bakeMeasuredJoint(
      {
        sourceBytes: s.input.sourceBytes,
        clipName: d.clipId,
        shapes: d.shapes,
        rootPolicy: d.rootPolicy,
        receipt: s.input.receipt,
        sampleTimesMs: times,
        bakeInput: {
          clipId: d.clipId,
          category: d.category,
          durationMs: d.durationMs,
          sampleRateHz: 240,
          sourceTimesMs: d.sourceTimesSeconds.map((t) => t * 1000),
          impacts: d.impacts,
          ownership: d.ownership,
        },
      },
      s.factory,
    ),
  ).rejects.toThrow('Missing exact cache key');
  expect(s.calls).toEqual(times);
  expect(s.calls).toHaveLength(1335);
  expect(s.input.receipt.attemptedSourceUpdates).toBe(1336);
  expect(s.disposed()).toBe(1);
});

test('fixed budget ceiling rejects oversized receipt and one-update-short receipt preserves shared cleanup', async () => {
  const s = setup(),
    { bakeKickComboFourCollisionCandidate } = await api();
  await expect(
    bakeKickComboFourCollisionCandidate(
      { ...s.input, receipt: createMeasuredJointReceipt(1338) },
      s.factory,
    ),
  ).rejects.toThrow('budget');
  expect(s.opened()).toBe(0);
  await expect(
    bakeKickComboFourCollisionCandidate(
      { ...s.input, receipt: createMeasuredJointReceipt(1336) },
      s.factory,
    ),
  ).rejects.toThrow('budget');
  expect(s.calls).toHaveLength(1335);
  expect(s.opened()).toBe(1);
  expect(s.disposed()).toBe(1);
});

test('source hash mismatch rejects before synthetic factory construction', async () => {
  const s = setup(),
    { bakeKickComboFourCollisionCandidate } = await api();
  await expect(
    bakeKickComboFourCollisionCandidate(
      { ...s.input, sourceBytes: new Uint8Array() },
      s.factory,
    ),
  ).rejects.toThrow('hash');
  expect(s.opened()).toBe(0);
  expect(s.calls).toEqual([]);
  expect(s.disposed()).toBe(0);
});

test('selection mutation during synthetic sampling fails closed before returning a candidate', async () => {
  const s = setup(),
    { bakeKickComboFourCollisionCandidate } = await api();
  const factory: typeof createSourceEvaluator = async (...args) => {
    const original = await s.factory(...args);
    return {
      surfaceSelections: original.surfaceSelections,
      sample(atMs) {
        const pose = original.sample.call(original, atMs);
        if (atMs === s.declaration.durationMs) {
          const ids = original.surfaceSelections[0]?.meshes[0]
            ?.vertexIndices as number[];
          ids[0] = (ids[0] ?? 0) + 1;
        }
        return pose;
      },
      dispose() {
        original.dispose.call(original);
      },
    };
  };
  await expect(
    bakeKickComboFourCollisionCandidate(s.input, factory),
  ).rejects.toThrow('selection');
  expect(s.calls).toHaveLength(1336);
  expect(s.disposed()).toBe(1);
});
