import { appendFileSync, readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { durationMs, type DurationMs } from '../../src/contracts';
import { preparePinnedSourceHead } from '../../src/assets/headSurface';

const derived = () =>
  new Uint8Array(
    readFileSync('public/game-assets/android/derived-pack-v1.glb'),
  );
const signal = () => new AbortController().signal;

test('head provider rejects changed source bytes rather than accepting caller provenance', async () => {
  const bytes = derived();
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
  await expect(
    preparePinnedSourceHead({ derivedBytes: bytes, signal: signal() }),
  ).rejects.toThrow(/hash mismatch/);
});

test('pinned head descriptor retains every original vertex and face identity', async () => {
  const provider = await preparePinnedSourceHead({
    derivedBytes: derived(),
    signal: signal(),
  });
  try {
    expect(provider.descriptor.vertices).toHaveLength(4472);
    expect(provider.descriptor.triangles).toHaveLength(4326);
    expect(provider.descriptor.meshIndex).toBe(0);
    expect(provider.descriptor.primitives.map((p) => p.indexAccessor)).toEqual([
      5, 11, 17, 23, 29,
    ]);
    expect(
      new Set(
        provider.descriptor.triangles.map(
          (t) => `${t.primitive}:${t.triangleIndex}`,
        ),
      ).size,
    ).toBe(4326);
    expect(Object.isFrozen(provider.descriptor.vertices[0]?.position)).toBe(
      true,
    );
    expect(Object.isFrozen(provider.descriptor.triangles)).toBe(true);
    expect(provider.poseBindings.clips).toHaveLength(42);
  } finally {
    provider.dispose();
  }
}, 30000);

test('head samples are detached, arbitrary order, binding checked and revoked on disposal', async () => {
  const provider = await preparePinnedSourceHead({
    derivedBytes: derived(),
    signal: signal(),
  });
  const binding = provider.poseBindings.clips.find(
    (b) => b.clipId === 'Uppercut',
  );
  if (!binding) throw new Error('Missing source Uppercut');
  const t = durationMs(binding.durationMs * 0.731);
  const first = provider.evaluate(binding, t);
  expect(first.kind).toBe('transform');
  provider.evaluate(binding, durationMs(0));
  provider.evaluate(binding, binding.durationMs);
  const repeat = provider.evaluate(binding, t);
  expect(repeat).toEqual(first);
  if (first.kind === 'transform' && repeat.kind === 'transform') {
    expect(first.matrix).not.toBe(repeat.matrix);
    expect(Object.isFrozen(first.matrix)).toBe(true);
    expect(first.matrix.filter((_, i) => [3, 7, 11, 15].includes(i))).toEqual([
      0, 0, 0, 1,
    ]);
  }
  expect(provider.evaluate({ ...binding, sourceBindingId: 'fake' }, t)).toEqual(
    { kind: 'unavailable', reason: 'invalid-binding' },
  );
  expect(provider.evaluate(binding, -1 as DurationMs)).toEqual({
    kind: 'unavailable',
    reason: 'invalid-time',
  });
  provider.dispose();
  provider.dispose();
  expect(provider.evaluate(binding, t)).toEqual({
    kind: 'unavailable',
    reason: 'disposed',
  });
}, 30000);

test('preparation captures bytes before yielding and cancellation prevents publication', async () => {
  const bytes = derived();
  let changed = false;
  const provider = await preparePinnedSourceHead({
    derivedBytes: bytes,
    signal: signal(),
    checkpoint: async () => {
      if (!changed) {
        bytes.fill(0);
        changed = true;
      }
    },
  });
  expect(provider.descriptor.vertices.length).toBe(4472);
  provider.dispose();
  const abort = new AbortController();
  await expect(
    preparePinnedSourceHead({
      derivedBytes: derived(),
      signal: abort.signal,
      checkpoint: async () => abort.abort(),
    }),
  ).rejects.toThrow(/abort/i);
}, 30000);

import { Matrix4, Object3D, SkinnedMesh, Vector3 } from 'three';
import { ANDROID_DERIVED_PACK_V1 } from '../../src/assets/derivedPackManifest';
import { ANDROID_RUNTIME_ARTIFACT_V1 } from '../../src/assets/runtimeArtifactManifest';
import { createPinnedDerivedThreeAssetPack } from '../../src/assets/derivedAssetPack';
import type { ClipRootPolicy } from '../../src/assets/rootPolicy';
import { clipId } from '../../src/contracts';

const originals = () =>
  ANDROID_RUNTIME_ARTIFACT_V1.sources.map(
    (s) => new Uint8Array(readFileSync(s.path)),
  );
function policies(mode: ClipRootPolicy['mode']): ClipRootPolicy[] {
  return ANDROID_DERIVED_PACK_V1.clips.map((c, i) => ({
    version: 1,
    clipId: clipId(c.name),
    sourceSha256: c.sourceSha256,
    mode,
    provenance: {
      manifestSha256: 'a'.repeat(64),
      clipPointer: `/clips/${i}`,
      supportPointer: `/clips/${i}/support_contacts`,
    },
  }));
}

test('original and derived providers preserve identical immutable geometry and canonical binding identity', async () => {
  const a = await preparePinnedSourceHead({
      sources: originals(),
      signal: signal(),
    }),
    b = await preparePinnedSourceHead({
      derivedBytes: derived(),
      signal: signal(),
    });
  try {
    expect(a.poseBindings).toEqual(b.poseBindings);
    expect(a.descriptor).toEqual(b.descriptor);
    for (const binding of a.poseBindings.clips) {
      for (const phase of [0.713, 0, 1, 0.027]) {
        expect(
          a.evaluate(binding, durationMs(binding.durationMs * phase)),
        ).toEqual(b.evaluate(binding, durationMs(binding.durationMs * phase)));
      }
    }
  } finally {
    a.dispose();
    b.dispose();
  }
}, 30000);

for (const mode of ['full-translation', 'grounded-posture-y'] as const) {
  test(`canonical all42 full-head CPU witnesses preserve ${mode} and arbitrary query order`, async () => {
    const rootPolicies = policies(mode);
    const a = await preparePinnedSourceHead({
        sources: originals(),
        rootPolicies,
        signal: signal(),
      }),
      b = await preparePinnedSourceHead({
        derivedBytes: derived(),
        rootPolicies,
        signal: signal(),
      });
    const pack = await createPinnedDerivedThreeAssetPack({
      derivedBytes: derived(),
      artifactBytes: new Uint8Array(
        readFileSync('public/game-assets/android/runtime-artifact-v1.json'),
      ),
      rootPolicies,
      signal: signal(),
    });
    const rig = pack.create('white');
    try {
      expect(a.poseBindings).toEqual(pack.poseBindings);
      expect(b.poseBindings).toEqual(pack.poseBindings);
      const seek = rig.seekPose?.bind(rig);
      if (!seek) throw new Error('Missing canonical seek');
      const meshes: SkinnedMesh[] = [];
      rig.node.traverse((part) => {
        if (part instanceof SkinnedMesh) meshes.push(part);
      });
      expect(meshes).toHaveLength(5);
      let maxError = 0,
        witnessCount = 0;
      const saved = [];
      for (const binding of [...a.poseBindings.clips].reverse()) {
        for (const phase of [0.731, 0, 1, 0.137, 0.731]) {
          const time = durationMs(binding.durationMs * phase),
            sample = a.evaluate(binding, time),
            other = b.evaluate(binding, time);
          expect(sample).toEqual(other);
          if (sample.kind !== 'transform')
            throw new Error(`Unavailable ${binding.clipId} ${phase}`);
          saved.push(sample.matrix);
          seek(binding, time);
          const matrix = new Matrix4().fromArray(sample.matrix);
          for (const vertex of a.descriptor.vertices) {
            const mesh = meshes[vertex.primitive];
            if (!mesh) throw new Error('Missing primitive');
            const expected = mesh
              .getVertexPosition(vertex.vertexIndex, new Vector3())
              .applyMatrix4(mesh.matrixWorld);
            const actual = new Vector3(
              vertex.position.x,
              vertex.position.y,
              vertex.position.z,
            ).applyMatrix4(matrix);
            const error = expected.distanceTo(actual);
            if (!Number.isFinite(error) || error > 1e-10)
              throw new Error(
                `${mode} ${binding.clipId} phase=${phase} primitive=${vertex.primitive} vertex=${vertex.vertexIndex} CPU error=${error}`,
              );
            maxError = Math.max(maxError, error);
            witnessCount++;
          }
        }
      }
      expect(witnessCount).toBe(42 * 5 * 4472);
      expect(saved.every(Object.isFrozen)).toBe(true);
      const receipt = JSON.stringify({
        proof: 'source-head-canonical',
        mode,
        clips: 42,
        poses: 210,
        witnessCount,
        maxError,
        criterionM: 1e-10,
        sourceHashes: ANDROID_RUNTIME_ARTIFACT_V1.sources.map((s) => s.sha256),
        derivedSha256: ANDROID_DERIVED_PACK_V1.sha256,
      });
      if (process.env.SOURCE_HEAD_PROOF_RECEIPT)
        appendFileSync(process.env.SOURCE_HEAD_PROOF_RECEIPT, `${receipt}\n`);
      console.log(receipt);
    } finally {
      rig.dispose();
      pack.dispose();
      a.dispose();
      b.dispose();
    }
  }, 120000);
}

test('geometry preparation yields a real task so cancellation stops the next chunk', async () => {
  const controller = new AbortController();
  let geometryCallbacks = 0;
  await expect(
    preparePinnedSourceHead({
      derivedBytes: derived(),
      signal: controller.signal,
      checkpoint: async (stage) => {
        if (stage.startsWith('geometry:')) {
          geometryCallbacks++;
          if (geometryCallbacks === 1) setTimeout(() => controller.abort(), 0);
        }
      },
    }),
  ).rejects.toThrow(/abort/i);
  expect(geometryCallbacks).toBe(1);
}, 30000);

test('each available binding exposes detached original source and sampling provenance', async () => {
  const provider = await preparePinnedSourceHead({
    derivedBytes: derived(),
    signal: signal(),
  });
  try {
    expect(provider.clipSources).toHaveLength(42);
    for (const origin of provider.clipSources) {
      const expected = ANDROID_DERIVED_PACK_V1.clips.find(
        (c) => c.name === origin.binding.clipId,
      );
      expect(origin.sourceSha256).toBe(expected?.sourceSha256);
      expect(origin.sourceClipIndex).toBe(expected?.sourceClipIndex);
      expect(origin.binding).toEqual(
        provider.poseBindings.clips.find(
          (b) => b.clipId === origin.binding.clipId,
        ),
      );
      expect(origin.sampling).toBe(
        'three-0.186.1-absolute-source-trs-first-key-hold-v1',
      );
      expect(origin.rootPolicy).toBeNull();
      expect(Object.isFrozen(origin)).toBe(true);
    }
  } finally {
    provider.dispose();
  }
}, 30000);

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

test('prepare and repeated finite samples never parse a model, clone an actor or scan skinned vertices', async () => {
  const parse = vi.spyOn(GLTFLoader.prototype, 'parse'),
    clone = vi.spyOn(Object3D.prototype, 'clone'),
    traverse = vi.spyOn(Object3D.prototype, 'traverse'),
    vertex = vi.spyOn(SkinnedMesh.prototype, 'getVertexPosition');
  try {
    const provider = await preparePinnedSourceHead({
      derivedBytes: derived(),
      signal: signal(),
    });
    try {
      const binding = provider.poseBindings.clips[0];
      if (!binding) throw new Error('No source binding');
      for (let i = 0; i < 1000; i++) {
        const sample = provider.evaluate(
          binding,
          durationMs((binding.durationMs * ((i * 73) % 1000)) / 1000),
        );
        expect(sample.kind).toBe('transform');
        if (sample.kind === 'transform') expect(sample.matrix).toHaveLength(16);
      }
      expect(parse).not.toHaveBeenCalled();
      expect(clone).not.toHaveBeenCalled();
      expect(traverse).not.toHaveBeenCalled();
      expect(vertex).not.toHaveBeenCalled();
    } finally {
      provider.dispose();
    }
  } finally {
    vi.restoreAllMocks();
  }
}, 30000);

test('hash, geometry, clip, binding and publication stages cancel without publishing a provider', async () => {
  for (const target of [
    'verify:0:before',
    'verify:0:after',
    'geometry:0:vertices',
    'geometry:0:triangles',
    'clip:Idle',
    'bindings',
    'publish',
  ]) {
    const controller = new AbortController();
    let reached = false;
    await expect(
      preparePinnedSourceHead({
        derivedBytes: derived(),
        signal: controller.signal,
        checkpoint: async (stage) => {
          if (stage === target) {
            reached = true;
            controller.abort();
          }
        },
      }),
    ).rejects.toThrow(/abort/i);
    expect(reached, target).toBe(true);
  }
  const originalAbort = new AbortController();
  let equivalenceReached = false;
  await expect(
    preparePinnedSourceHead({
      sources: originals(),
      signal: originalAbort.signal,
      checkpoint: async (stage) => {
        if (stage === 'geometry:equivalence') {
          equivalenceReached = true;
          originalAbort.abort();
        }
      },
    }),
  ).rejects.toThrow(/abort/i);
  expect(equivalenceReached).toBe(true);
  const controller = new AbortController();
  controller.abort();
  await expect(
    preparePinnedSourceHead({
      derivedBytes: derived(),
      signal: controller.signal,
    }),
  ).rejects.toThrow(/abort/i);
}, 30000);

test('policy inputs are captured before yielding; changed binding, clock and unsupported bytes fail closed', async () => {
  const rootPolicies = policies('grounded-posture-y');
  let mutated = false;
  const provider = await preparePinnedSourceHead({
    derivedBytes: derived(),
    rootPolicies,
    signal: signal(),
    checkpoint: async () => {
      if (!mutated) {
        rootPolicies.splice(0, rootPolicies.length);
        mutated = true;
      }
    },
  });
  try {
    expect(
      provider.clipSources.every(
        (c) => c.rootPolicy?.mode === 'grounded-posture-y',
      ),
    ).toBe(true);
    expect(
      provider.clipSources.every((c) =>
        Object.isFrozen(c.rootPolicy?.provenance),
      ),
    ).toBe(true);
    const binding = provider.poseBindings.clips[0];
    if (!binding) throw new Error('No source binding');
    for (const invalid of [
      NaN,
      Infinity,
      -Infinity,
      -1,
      binding.durationMs + 1,
    ])
      expect(provider.evaluate(binding, invalid as DurationMs)).toEqual({
        kind: 'unavailable',
        reason: 'invalid-time',
      });
    expect(
      provider.evaluate(
        { ...binding, durationMs: durationMs(binding.durationMs + 1) },
        durationMs(0),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'invalid-binding' });
  } finally {
    provider.dispose();
  }
  await expect(
    preparePinnedSourceHead({ sources: [], signal: signal() }),
  ).rejects.toThrow(/source count/);
  await expect(
    preparePinnedSourceHead({
      derivedBytes: new Uint8Array(16),
      signal: signal(),
    }),
  ).rejects.toThrow(/size mismatch/);
  const duplicate = policies('full-translation')[0];
  if (!duplicate) throw new Error('No policy');
  await expect(
    preparePinnedSourceHead({
      derivedBytes: derived(),
      rootPolicies: [duplicate, duplicate],
      signal: signal(),
    }),
  ).rejects.toThrow(/duplicate root policy/);
}, 30000);

import { createHash } from 'node:crypto';
const inPlaceKickHash =
  '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd';
const inPlaceManifestHash =
  'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed';
const inPlaceRecipes = [
  { name: 'RoundhouseKick', index: 2, support: 'support', peak: 31 },
  { name: 'SideThrustKick', index: 9, support: 'support_contacts', peak: 36 },
  { name: 'LowSweep', index: 3, support: 'support_contacts', peak: 29 },
] as const;
function inPlacePolicies(mode: ClipRootPolicy['mode']): ClipRootPolicy[] {
  return inPlaceRecipes.map(({ name, index, support }) => ({
    version: 1,
    clipId: clipId(name),
    sourceSha256: inPlaceKickHash,
    mode,
    provenance: {
      manifestSha256: inPlaceManifestHash,
      clipPointer: `/clips/${index}`,
      supportPointer: `/clips/${index}/support_contacts/${support}`,
    },
  }));
}
function originalRootKeys(index: number) {
  const bytes = new Uint8Array(
    readFileSync(
      'assets/android/motions/completed42-speed15/kick/android_kick.glb',
    ),
  );
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    inPlaceKickHash,
  );
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    length = data.getUint32(12, true),
    bin = 28 + length;
  const doc = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + length)),
  ) as {
    animations: {
      channels: { sampler: number; target: { node: number; path: string } }[];
      samplers: { input: number; output: number }[];
    }[];
    accessors: {
      bufferView: number;
      byteOffset?: number;
      componentType: number;
      count: number;
      type: string;
    }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
  };
  const animation = doc.animations[index];
  if (!animation) throw Error('Missing source clip');
  const channel = animation.channels.find(
    (c) => c.target.node === 52 && c.target.path === 'translation',
  );
  if (!channel) throw Error('Missing root channel');
  const sampler = animation.samplers[channel.sampler];
  if (!sampler) throw Error('Missing sampler');
  const read = (accessorIndex: number, size: number) => {
    const a = doc.accessors[accessorIndex];
    if (!a) throw Error('Missing accessor');
    expect(a.componentType).toBe(5126);
    const v = doc.bufferViews[a.bufferView];
    if (!v) throw Error('Missing view');
    return Array.from({ length: a.count }, (_, i) =>
      Array.from({ length: size }, (_, k) =>
        data.getFloat32(
          bin +
            (v.byteOffset ?? 0) +
            (a.byteOffset ?? 0) +
            i * (v.byteStride ?? size * 4) +
            k * 4,
          true,
        ),
      ),
    );
  };
  return {
    times: read(sampler.input, 1).map((x) => x[0] as number),
    values: read(sampler.output, 3),
  };
}
test('native XYZ point transform does not fall through to full root extraction', async () => {
  const native = await preparePinnedSourceHead({
    derivedBytes: derived(),
    rootPolicies: inPlacePolicies('in-place-posture-xyz'),
    signal: signal(),
  });
  const full = await preparePinnedSourceHead({
    derivedBytes: derived(),
    rootPolicies: inPlacePolicies('full-translation'),
    signal: signal(),
  });
  try {
    const rows = [];
    for (const recipe of inPlaceRecipes) {
      const a = native.poseBindings.clips.find((b) => b.clipId === recipe.name),
        b = full.poseBindings.clips.find((b) => b.clipId === recipe.name);
      if (!a || !b) throw Error('Missing binding');
      const keys = originalRootKeys(recipe.index),
        i = recipe.peak - 1,
        time = keys.times[i],
        value = keys.values[i],
        origin = keys.values[0];
      if (time === undefined || !value || !origin)
        throw Error('Missing source key');
      const x = native.evaluate(a, durationMs(time * 1000)),
        y = full.evaluate(b, durationMs(time * 1000));
      if (x.kind !== 'transform' || y.kind !== 'transform')
        throw Error('Missing transform');
      expect(native.evaluate(b, durationMs(time * 1000))).toMatchObject({
        kind: 'unavailable',
        reason: 'invalid-binding',
      });
      expect(full.evaluate(a, durationMs(time * 1000))).toMatchObject({
        kind: 'unavailable',
        reason: 'invalid-binding',
      });
      expect(native.evaluate(a, durationMs(time * 1000))).toEqual(x);
      const expected = value.map((v, k) => v - (origin[k] as number)),
        actual = [12, 13, 14].map(
          (k) => (x.matrix[k] as number) - (y.matrix[k] as number),
        );
      rows.push({ clip: recipe.name, time, expected, actual });
      if (process.env.IN_PLACE_HEAD_RED_RECEIPT)
        appendFileSync(
          process.env.IN_PLACE_HEAD_RED_RECEIPT,
          `${JSON.stringify(rows[rows.length - 1])}\n`,
        );
      for (let k = 0; k < 3; k++)
        expect(
          Math.abs((actual[k] as number) - (expected[k] as number)),
        ).toBeLessThanOrEqual(1e-10);
    }
  } finally {
    native.dispose();
    full.dispose();
  }
}, 30000);

test('pure unknown root policy rejects before any source geometry can be published', async () => {
  const known = inPlacePolicies('in-place-posture-xyz')[0];
  if (!known) throw Error('Missing fixture');
  await expect(
    preparePinnedSourceHead({
      derivedBytes: new Uint8Array(),
      rootPolicies: [
        { ...known, mode: 'future-mode' },
      ] as unknown as ClipRootPolicy[],
      signal: signal(),
    }),
  ).rejects.toThrow(/root.*policy/i);
});

test('three pinned native XYZ head bindings match original derived and canonical rig in arbitrary order', async () => {
  const rootPolicies = inPlacePolicies('in-place-posture-xyz');
  const a = await preparePinnedSourceHead({
    sources: originals(),
    rootPolicies,
    signal: signal(),
  });
  const b = await preparePinnedSourceHead({
    derivedBytes: derived(),
    rootPolicies,
    signal: signal(),
  });
  const pack = await createPinnedDerivedThreeAssetPack({
    derivedBytes: derived(),
    artifactBytes: new Uint8Array(
      readFileSync('public/game-assets/android/runtime-artifact-v1.json'),
    ),
    rootPolicies,
    signal: signal(),
  });
  const rig = pack.create('white'),
    parent = new Object3D();
  parent.position.set(3, -2, 1);
  parent.rotation.set(0.2, 0.7, -0.1);
  parent.add(rig.node);
  parent.updateMatrixWorld(true);
  const parentBefore = parent.matrixWorld.toArray(),
    meshes: SkinnedMesh[] = [];
  rig.node.traverse((part) => {
    if (part instanceof SkinnedMesh) meshes.push(part);
  });
  const receipt = {
    passed: false,
    mode: 'in-place-posture-xyz',
    clips: 3,
    poses: 0,
    witnesses: 0,
    maxErrorM: 0,
    criterionM: 1e-10,
    scope:
      'Matched actor-local/reference finite points only; no parent-basis invariance or continuous bound claim',
  };
  try {
    expect(a.poseBindings).toEqual(pack.poseBindings);
    expect(b.poseBindings).toEqual(pack.poseBindings);
    expect(a.descriptor).toEqual(b.descriptor);
    expect(meshes).toHaveLength(5);
    const seek = rig.seekPose?.bind(rig);
    if (!seek) throw Error('Missing canonical seek');
    const idle = a.poseBindings.clips.find((x) => x.clipId === 'Idle');
    if (!idle) throw Error('Missing interleaved binding');
    for (const recipe of [...inPlaceRecipes].reverse()) {
      const binding = a.poseBindings.clips.find(
        (x) => x.clipId === recipe.name,
      );
      if (!binding) throw Error('Missing native binding');
      const keys = originalRootKeys(recipe.index),
        first = keys.times[0],
        peak = keys.times[recipe.peak - 1],
        previous = keys.times[recipe.peak - 2];
      if (first === undefined || peak === undefined || previous === undefined)
        throw Error('Missing source clock');
      for (const ms of [
        peak * 1000,
        0,
        binding.durationMs,
        first * 500,
        first * 1000,
        (previous * 0.75 + peak * 0.25) * 1000,
        peak * 1000,
      ]) {
        const time = durationMs(ms),
          sample = a.evaluate(binding, time);
        expect(b.evaluate(binding, time)).toEqual(sample);
        if (sample.kind !== 'transform')
          throw Error('Unavailable native sample');
        expect(
          a.evaluate(
            { ...binding, sourceBindingId: 'mismatched-policy' },
            time,
          ),
        ).toMatchObject({ kind: 'unavailable', reason: 'invalid-binding' });
        a.evaluate(idle, durationMs(0));
        expect(a.evaluate(binding, time)).toEqual(sample);
        seek(idle, durationMs(0));
        seek(binding, time);
        parent.updateMatrixWorld(true);
        expect(parent.matrixWorld.toArray()).toEqual(parentBefore);
        const actorFromWorld = rig.node.matrixWorld.clone().invert(),
          matrix = new Matrix4().fromArray(sample.matrix);
        for (const vertex of a.descriptor.vertices) {
          const mesh = meshes[vertex.primitive];
          if (!mesh) throw Error('Missing primitive');
          const expected = mesh
            .getVertexPosition(vertex.vertexIndex, new Vector3())
            .applyMatrix4(mesh.matrixWorld)
            .applyMatrix4(actorFromWorld);
          const actual = new Vector3(
              vertex.position.x,
              vertex.position.y,
              vertex.position.z,
            ).applyMatrix4(matrix),
            error = expected.distanceTo(actual);
          if (!Number.isFinite(error) || error > 1e-10)
            throw Error(
              `${recipe.name} ${ms} ${vertex.primitive}/${vertex.vertexIndex} CPU error ${error}`,
            );
          receipt.maxErrorM = Math.max(receipt.maxErrorM, error);
          receipt.witnesses++;
        }
        receipt.poses++;
      }
    }
    expect(receipt.poses).toBe(21);
    expect(receipt.witnesses).toBe(93912);
    receipt.passed = true;
  } finally {
    rig.dispose();
    pack.dispose();
    a.dispose();
    b.dispose();
    if (process.env.IN_PLACE_HEAD_PROOF_RECEIPT)
      appendFileSync(
        process.env.IN_PLACE_HEAD_PROOF_RECEIPT,
        `${JSON.stringify(receipt)}\n`,
      );
  }
}, 30000);
