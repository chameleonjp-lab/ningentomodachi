/** Original GLB bytes are decoded as metadata only. Every evaluator is synthetic. */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type {
  createSourceEvaluator,
  SourceEvaluator,
} from '../../src/assets/evaluateSource';
import { readButterflyKickCollisionCandidate } from '../../tools/assets/butterflyKickCollisionCandidate';
import { createMeasuredJointReceipt } from '../../tools/assets/measuredJointBake';
const api = () =>
  import('../../tools/assets/bakeButterflyKickCollisionCandidate');
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
function setup(
  change?: (
    s: SourceEvaluator['surfaceSelections'],
  ) => SourceEvaluator['surfaceSelections'],
) {
  const input = bytes(),
    declaration = readButterflyKickCollisionCandidate(input);
  const selections = declaration.shapes.flatMap((shape, i) =>
    selection(input.sourceBytes, shape.shapeId, i === 0 ? 'L' : 'R'),
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
    expect(clip).toBe('ButterflyKick');
    expect(shapes).toEqual(declaration.shapes);
    expect(policy).toEqual(declaration.rootPolicy);
    execution?.beforeUpdate({ stage: 'startup', atMs: 0 });
    const quaternion: [number, number, number, number] = [
      1 / Math.sqrt(30),
      2 / Math.sqrt(30),
      3 / Math.sqrt(30),
      4 / Math.sqrt(30),
    ];
    execution?.observeRootQuaternion?.({
      stage: 'startup',
      atMs: 0,
      quaternion,
    });
    const evaluator: SourceEvaluator = {
      surfaceSelections: change ? change(selections) : selections,
      sample(atMs) {
        execution?.beforeUpdate({ stage: 'sample', atMs });
        calls.push(atMs);
        const D = {
          x: (0.2 * atMs) / 1000,
          y: (0.4 * atMs) / 1000,
          z: (0.3 * atMs) / 1000,
        };
        execution?.observeRootQuaternion?.({
          stage: 'sample',
          atMs,
          quaternion,
        });
        return {
          root: { position: D, visualYawRad: 0.7 },
          rawRoot: { position: D, visualYawRad: 0.7 },
          shapes: shapes.map((shape, i) => ({
            shapeId: shape.shapeId,
            volume: {
              kind: 'sphere' as const,
              center: {
                x: atMs / 1000 - D.x,
                y: (i === 0 ? 0.5 : -0.5) - D.y,
                z: 0.1 - D.z,
              },
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
    input: { ...input, receipt: createMeasuredJointReceipt(786) },
    declaration,
    selections,
    calls,
    factory,
    opened: () => opened,
    disposed: () => disposed,
  };
}
test('one synthetic evaluator caches exact 785 keys for two separate sphere curves', async () => {
  const s = setup(),
    r = await (await api()).bakeButterflyKickCollisionCandidate(
      s.input,
      s.factory,
    );
  expect(s.calls).toEqual(s.declaration.schedule.sampleKeysMs);
  expect(new Set(s.calls).size).toBe(785);
  expect(s.opened()).toBe(1);
  expect(s.disposed()).toBe(1);
  expect(s.input.receipt).toMatchObject({
    attemptedSourceUpdates: 786,
    startupUpdates: 1,
    sampleUpdates: 785,
    rejectedUpdates: 0,
    cleanupErrors: [],
  });
  expect(r.asset.shapes).toHaveLength(2);
  expect(r.asset.definition.impacts).toEqual(s.declaration.impacts);
  expect(r.poses.size).toBe(785);
  expect(r.asset.definition.rootCurve.map((k) => k.atMs)).toEqual(
    s.declaration.schedule.baseKeysMs,
  );
  expect(r.declaration.acceptance).toBeNull();
  expect(r.selectionVerification.selectedVertexCount).toBe(4568);
  expect(r.declaration.rootPolicy.mode).toBe('full-translation');
  expect(s.input.receipt.rootQuaternionObservations).toHaveLength(786);
  for (const [atMs, pose] of r.poses) {
    expect(pose.root.position).toEqual(pose.rawRoot?.position);
    pose.shapes.forEach((shape, i) => {
      if (shape.volume.kind !== 'sphere') throw new Error('Expected sphere');
      expect(shape.volume.center.x + pose.root.position.x).toBeCloseTo(
        atMs / 1000,
        12,
      );
      expect(shape.volume.center.y + pose.root.position.y).toBeCloseTo(
        i === 0 ? 0.5 : -0.5,
        12,
      );
      expect(shape.volume.center.z + pose.root.position.z).toBeCloseTo(0.1, 12);
    });
  }
  expect(r.asset.definition.rootCurve.at(-1)?.position).toEqual({
    x: (0.2 * s.declaration.durationMs) / 1000,
    y: (0.4 * s.declaration.durationMs) / 1000,
    z: (0.3 * s.declaration.durationMs) / 1000,
  });
});
test('swapped left/right membership or single union is rejected before first sample with disposal', async () => {
  for (const change of [
    (s: SourceEvaluator['surfaceSelections']) =>
      s.map((v, i) => ({ ...v, meshes: s[1 - i]?.meshes ?? [] })),
    (s: SourceEvaluator['surfaceSelections']) => s.slice(0, 1),
    (s: SourceEvaluator['surfaceSelections']) =>
      s.map((v, i) => ({ ...v, bone: i === 0 ? 'foot.R' : 'foot.L' })),
  ]) {
    const s = setup(change);
    await expect(
      (await api()).bakeButterflyKickCollisionCandidate(s.input, s.factory),
    ).rejects.toThrow(/selection/);
    expect(s.calls).toHaveLength(0);
    expect(s.disposed()).toBe(1);
    expect(s.input.receipt.startupUpdates).toBe(1);
  }
});
test('ceiling rejects before opening and shorter budget preserves cleanup', async () => {
  const s = setup();
  s.input.receipt = createMeasuredJointReceipt(787);
  await expect(
    (await api()).bakeButterflyKickCollisionCandidate(s.input, s.factory),
  ).rejects.toThrow(/budget/);
  expect(s.opened()).toBe(0);
  const t = setup();
  t.input.receipt = createMeasuredJointReceipt(2);
  await expect(
    (await api()).bakeButterflyKickCollisionCandidate(t.input, t.factory),
  ).rejects.toThrow(/budget/);
  expect(t.disposed()).toBe(1);
});
