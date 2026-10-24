/** Original GLB bytes are decoded as metadata only. Every evaluator is synthetic. */
import { readFileSync, existsSync } from 'node:fs';
import { expect, test } from 'vitest';
import type {
  createSourceEvaluator,
  SourceEvaluator,
} from '../../src/assets/evaluateSource';
async function declaration(input: ReturnType<typeof bytes>) {
  expect(
    existsSync('tools/assets/cartwheelKickCollisionCandidate.ts'),
    'declaration must exist',
  ).toBe(true);
  return (
    await import('../../tools/assets/cartwheelKickCollisionCandidate')
  ).readCartwheelKickCollisionCandidate(input);
}
import { createMeasuredJointReceipt } from '../../tools/assets/measuredJointBake';
const api = () =>
  import('../../tools/assets/bakeCartwheelKickCollisionCandidate');
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
    selection(input.sourceBytes, shape.shapeId, 'L'),
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
    expect(clip).toBe('CartwheelKick');
    expect(shapes).toEqual(d.shapes);
    expect(policy).toEqual(d.rootPolicy);
    execution?.beforeUpdate({ stage: 'startup', atMs: 0 });
    const evaluator: SourceEvaluator = {
      surfaceSelections: change ? change(selections) : selections,
      sample(atMs) {
        execution?.beforeUpdate({ stage: 'sample', atMs });
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
    input: { ...input, receipt: createMeasuredJointReceipt(765) },
    declaration: d,
    selections,
    calls,
    factory,
    opened: () => opened,
    disposed: () => disposed,
  };
}
test('one synthetic evaluator caches exact 764 keys retaining root subtraction/addition exactly once', async () => {
  const s = await setup(),
    r = await (await api()).bakeCartwheelKickCollisionCandidate(
      s.input,
      s.factory,
    );
  expect(s.calls).toEqual(s.declaration.schedule.sampleKeysMs);
  expect(new Set(s.calls).size).toBe(764);
  expect(s.opened()).toBe(1);
  expect(s.disposed()).toBe(1);
  expect(s.input.receipt).toMatchObject({
    attemptedSourceUpdates: 765,
    startupUpdates: 1,
    sampleUpdates: 764,
    rejectedUpdates: 0,
    cleanupErrors: [],
  });
  expect(r.asset.shapes).toHaveLength(1);
  expect(r.asset.definition.impacts).toEqual(s.declaration.impacts);
  expect(r.poses.size).toBe(764);
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
      s.map((v, i) => ({ ...v, bone: i === 0 ? 'foot.R' : 'foot.L' })),
  ]) {
    const s = await setup(change);
    await expect(
      (await api()).bakeCartwheelKickCollisionCandidate(s.input, s.factory),
    ).rejects.toThrow(/selection/);
    expect(s.calls).toHaveLength(0);
    expect(s.disposed()).toBe(1);
    expect(s.input.receipt.startupUpdates).toBe(1);
  }
});
test('ceiling rejects before opening and shorter budget preserves cleanup', async () => {
  const s = await setup();
  s.input.receipt = createMeasuredJointReceipt(766);
  await expect(
    (await api()).bakeCartwheelKickCollisionCandidate(s.input, s.factory),
  ).rejects.toThrow(/budget/);
  expect(s.opened()).toBe(0);
  const t = await setup();
  t.input.receipt = createMeasuredJointReceipt(2);
  await expect(
    (await api()).bakeCartwheelKickCollisionCandidate(t.input, t.factory),
  ).rejects.toThrow(/budget/);
  expect(t.disposed()).toBe(1);
});
