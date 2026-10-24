import { createHash } from 'node:crypto';
/** Planning only. No loader, pose, bake, or catalog execution. */
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
vi.mock('../../src/assets/evaluateSource', () => ({
  createSourceEvaluator: () => {
    throw new Error('Source execution forbidden');
  },
}));
const input = () => ({
  sourceBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/android_punch.glb',
  ),
  manifestBytes: readFileSync(
    'assets/android/motions/completed42-speed15/punch/manifest.json',
  ),
});
const api = () => import('../../tools/assets/uppercutWholeHandCandidate');
test('declares a bounded whole-hand developer abstraction with no acceptance or execution', async () => {
  const { planUppercutWholeHandCandidate } = await api();
  const p = planUppercutWholeHandCandidate(input());
  expect(p.model).toMatchObject({
    origin: 'developer-selected-collision-model',
    shapeId: 'Uppercut:whole-hand:0',
    bone: 'hand.R',
    sourceAuthoredAnatomy: null,
    includesForearm: false,
    addedPaddingM: 0,
  });
  expect(p.model.jointIndices).toEqual(
    Array.from({ length: 16 }, (_, i) => 29 + i),
  );
  expect(p.impact).toMatchObject({
    impactIndex: 0,
    damageShare: 1,
    startMs: 466.66666865348816,
    endMs: 555.555522441864,
  });
  expect(p.executionReleased).toBe(false);
  expect(p.executionReceipt).toBeNull();
  expect(p.acceptance).toBeNull();
  expect(p.gameplayAllowance).toBeNull();
  expect(Object.isFrozen(p.model)).toBe(true);
});
test('pins JS exact timetable and a single proposed lifecycle budget', async () => {
  const { planUppercutWholeHandCandidate } = await api();
  const p = planUppercutWholeHandCandidate(input());
  expect(p.schedule.candidateTimesMs).toHaveLength(297);
  expect(p.schedule.probeTimesMs).toHaveLength(75);
  expect(p.schedule.sampleTimesMs).toHaveLength(372);
  expect(p.scheduleHashes).toEqual({
    candidateTimesMs:
      'f59e2fa09e8c640d2da0876619110c9039a2b6e8697d11a8afe1be411302a417',
    probeTimesMs:
      '873386020b370385db225eb5580dc82c95cc2b48d7c8b35a681a64a95c351d27',
    sampleTimesMs:
      '4e978caacabe7315029b242d678a01ec2c70eb20eb58be9c73849fd331d0a957',
  });
  expect(p.proposedBudget).toMatchObject({
    evaluatorInstances: 1,
    startupSourceUpdates: 1,
    sampleCalls: 372,
    totalSourceUpdates: 373,
    selectedVerticesPerSample: 4223,
    measuredVertexEvaluations: 1570956,
    adaptiveRounds: 0,
    rasterCalls: 0,
  });
  expect(p.expectedSelection.primitives.map((x) => x.count)).toEqual([
    1513, 122, 1676, 912, 0,
  ]);
});
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

test('independent raw skin accessor provenance matches all whole-hand primitive pins', async () => {
  const { planUppercutWholeHandCandidate } = await api();
  const bytes = input();
  const p = planUppercutWholeHandCandidate(bytes);
  const actual = rawSelection(bytes.sourceBytes)[0];
  expect(actual?.bone).toBe('hand.R');
  expect(actual?.shapeId).toBe(p.model.shapeId);
  for (const pin of p.expectedSelection.primitives) {
    const mesh = actual?.meshes.find(
      (m) => m.sourcePrimitiveIndex === pin.index,
    );
    const indices = mesh?.vertexIndices ?? [];
    expect(indices.length).toBe(pin.count);
    const b = new Uint8Array(indices.length * 4);
    const v = new DataView(b.buffer);
    indices.forEach((x, i) => {
      v.setUint32(i * 4, x, true);
    });
    expect(createHash('sha256').update(b).digest('hex')).toBe(pin.sha256);
  }
});
