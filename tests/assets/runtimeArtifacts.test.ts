import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  Group,
  Matrix4,
  Mesh,
  type Object3D,
  SkinnedMesh,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { expect, test, vi } from 'vitest';
import { createPinnedThreeAssetPack } from '../../src/assets';
import * as deathAuthor from '../../src/assets/deathAnimation';
import { exportDeathClipArtifact } from '../../src/assets/deathClipArtifact';
import { PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES } from '../../src/assets/representativePolicies';
import { ANDROID_RUNTIME_ARTIFACT_V1 } from '../../src/assets/runtimeArtifactManifest';
import * as boundsAuthor from '../../src/assets/skinBounds';
import { exportSkinBoundsArtifact } from '../../src/assets/skinBoundsArtifact';
import { createThreeAssetPack } from '../../src/assets/threeAssetPack';
import { clipId, presentationTimeMs } from '../../src/contracts';

test('required-artifact runtime factory rejects absent pinned sources rather than falling back to authoring', async () => {
  await expect(
    createPinnedThreeAssetPack({
      sources: [],
      artifactBytes: new Uint8Array(),
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow('source');
});

// These tests read only repository source and the checked-in pinned artifact.
// They do not use private engineering-control receipts or synthetic production data.

const manifest = ANDROID_RUNTIME_ARTIFACT_V1;
const sources = manifest.sources.map(
  (source) => new Uint8Array(readFileSync(source.path)),
);
const artifactBytes = new Uint8Array(readFileSync(`public${manifest.url}`));
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const input = () => ({
  sources,
  artifactBytes,
  signal: new AbortController().signal,
  rootPolicies: PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES,
});
function fullBounds(node: Object3D) {
  node.updateWorldMatrix(true, true);
  const inverse = node.parent?.matrixWorld.clone().invert() ?? new Matrix4();
  const min = new Vector3(Infinity, Infinity, Infinity),
    max = new Vector3(-Infinity, -Infinity, -Infinity);
  node.traverse((part) => {
    if (part instanceof SkinnedMesh)
      for (let i = 0; i < part.geometry.getAttribute('position').count; i++) {
        const point = part
          .getVertexPosition(i, new Vector3())
          .applyMatrix4(part.matrixWorld)
          .applyMatrix4(inverse);
        min.min(point);
        max.max(point);
      }
  });
  return { min, max };
}

test('trusted manifest is deeply immutable and byte tampering cannot reach a parser', async () => {
  expect(Object.isFrozen(manifest)).toBe(true);
  expect(Object.isFrozen(manifest.sources)).toBe(true);
  expect(manifest.sources.every(Object.isFrozen)).toBe(true);
  expect(hash(artifactBytes)).toBe(manifest.sha256);
  const parser = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
  try {
    const artifact = new Uint8Array(artifactBytes);
    artifact[artifact.length - 2] = (artifact[artifact.length - 2] ?? 0) ^ 1;
    await expect(
      createPinnedThreeAssetPack({ ...input(), artifactBytes: artifact }),
    ).rejects.toThrow('artifact hash');
    const altered = sources.map((bytes) => new Uint8Array(bytes));
    const first = altered[0];
    if (!first) throw new Error('Fixture');
    first[first.length - 1] = (first[first.length - 1] ?? 0) ^ 1;
    await expect(
      createPinnedThreeAssetPack({ ...input(), sources: altered }),
    ).rejects.toThrow('source hash');
    expect(parser).not.toHaveBeenCalled();
  } finally {
    parser.mockRestore();
  }
});

test('required factory never authors or certifies and its real actor-local bounds enclose the complete displayed surface', async () => {
  const certify = vi
    .spyOn(boundsAuthor, 'prepareSkinBounds')
    .mockImplementation(() => {
      throw new Error('Runtime certification forbidden');
    });
  const author = vi
    .spyOn(deathAuthor, 'authorDeathClips')
    .mockImplementation(() => {
      throw new Error('Runtime authoring forbidden');
    });
  const stages: string[] = [];
  let tasks = 0;
  const interval = setInterval(() => tasks++, 1);
  try {
    const pack = await createPinnedThreeAssetPack({
      ...input(),
      checkpoint: async (stage) => {
        stages.push(stage);
      },
    });
    const white = pack.create('white'),
      black = pack.create('black'),
      parent = new Group();
    try {
      expect(pack.clipNames()).toHaveLength(44);
      expect(pack.rootPolicy(clipId('Cross'))).toEqual(
        PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES[0],
      );
      parent.position.set(3, 2.3, -4);
      parent.rotation.y = 0.9;
      parent.add(white.node, black.node);
      for (const [rig, sourceClip, seconds, death] of [
        [white, 'CartwheelKick', 0.9, 'DefeatPunch'],
        [black, 'FrontKick', 0.55, 'DefeatKick'],
      ] as const) {
        rig.node.position.set(0.1, 0.2, -0.3);
        rig.node.scale.set(0.9, 1.1, 1.02);
        rig.seek(clipId(sourceClip), seconds);
        const entry = fullBounds(rig.node);
        rig.seek(clipId(death), 0.17, presentationTimeMs(100));
        const observed = rig.defeatPoseSupport?.(),
          expected = fullBounds(rig.node);
        expect(observed?.entryLocalMinY).toBeCloseTo(entry.min.y, 10);
        for (const side of ['min', 'max'] as const)
          for (const axis of ['x', 'y', 'z'] as const)
            expect(observed?.currentLocalBounds[side][axis]).toBeCloseTo(
              expected[side][axis],
              10,
            );
      }
      expect(tasks).toBeGreaterThan(2);
      expect(stages).toContain('pack:ready');
      expect(certify).not.toHaveBeenCalled();
      expect(author).not.toHaveBeenCalled();
    } finally {
      white.dispose();
      black.dispose();
      pack.dispose();
    }
  } finally {
    clearInterval(interval);
    certify.mockRestore();
    author.mockRestore();
  }
}, 30000);

test('cancellation releases every partially parsed or fully prepared mesh/material and never publishes a pack', async () => {
  const original = GLTFLoader.prototype.parseAsync;
  for (const stage of ['parse:1:after', 'artifact:support', 'pack:ready']) {
    const controller = new AbortController(),
      geometries = new Set<import('three').BufferGeometry>(),
      materials = new Set<import('three').Material>();
    let geometryDisposed = 0,
      materialDisposed = 0;
    const parser = vi
      .spyOn(GLTFLoader.prototype, 'parseAsync')
      .mockImplementation(async function (this: GLTFLoader, data, path) {
        const result = await original.call(this, data, path);
        result.scene.traverse((node) => {
          if (node instanceof Mesh) {
            if (!geometries.has(node.geometry)) {
              geometries.add(node.geometry);
              node.geometry.addEventListener(
                'dispose',
                () => geometryDisposed++,
              );
            }
            for (const material of Array.isArray(node.material)
              ? node.material
              : [node.material])
              if (!materials.has(material)) {
                materials.add(material);
                material.addEventListener('dispose', () => materialDisposed++);
              }
          }
        });
        return result;
      });
    try {
      await expect(
        createPinnedThreeAssetPack({
          ...input(),
          signal: controller.signal,
          checkpoint: async (current) => {
            if (current === stage) controller.abort();
          },
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(geometries.size).toBeGreaterThan(0);
      expect(geometryDisposed).toBe(geometries.size);
      expect(materialDisposed).toBe(materials.size);
    } finally {
      parser.mockRestore();
    }
  }
}, 30000);

test('asynchronous input edits cannot replace captured source bytes, policies or abort identity', async () => {
  const copiedSources = sources.map((bytes) => new Uint8Array(bytes)),
    copiedArtifact = new Uint8Array(artifactBytes);
  const policies = structuredClone(
    PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES,
  );
  const pending = createPinnedThreeAssetPack({
    ...input(),
    sources: copiedSources,
    artifactBytes: copiedArtifact,
    rootPolicies: policies,
  });
  copiedArtifact[0] = (copiedArtifact[0] ?? 0) ^ 1;
  const first = copiedSources[0];
  if (!first) throw new Error('Fixture');
  first[0] = (first[0] ?? 0) ^ 1;
  Object.defineProperty(policies[0], 'sourceSha256', { value: '0'.repeat(64) });
  const pack = await pending;
  expect(pack.rootPolicy(clipId('Cross'))).toEqual(
    PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES[0],
  );
  pack.dispose();
  const controller = new AbortController(),
    options = { ...input(), signal: controller.signal };
  const cancelled = createPinnedThreeAssetPack(options);
  options.signal = new AbortController().signal;
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
}, 30000);

test('repository sources deterministically regenerate the complete exact artifact without modifying original tracks', async () => {
  const original = await createThreeAssetPack(sources),
    seed = original.create('white');
  try {
    seed.seek(clipId('Idle'), 0);
    const names = original.clipNames();
    expect(names).toHaveLength(42);
    const regenerated = {
      schemaVersion: 1,
      sourceHashes: sources.map(hash),
      support: exportSkinBoundsArtifact(
        boundsAuthor.prepareSkinBounds(seed.node),
      ),
      deaths: exportDeathClipArtifact(deathAuthor.authorDeathClips(seed.node)),
    };
    const bytes = new TextEncoder().encode(`${JSON.stringify(regenerated)}\n`);
    expect(hash(bytes)).toBe(manifest.sha256);
    expect(bytes).toEqual(artifactBytes);
    expect(original.clipNames()).toEqual(names);
  } finally {
    seed.dispose();
    original.dispose();
  }
}, 60000);

test('pre-abort and hash-stage abort allocate no parsed scene', async () => {
  const parser = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
  try {
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      createPinnedThreeAssetPack({ ...input(), signal: aborted.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const controller = new AbortController();
    await expect(
      createPinnedThreeAssetPack({
        ...input(),
        signal: controller.signal,
        checkpoint: async (stage) => {
          if (stage === 'hash:source:0') controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(parser).not.toHaveBeenCalled();
  } finally {
    parser.mockRestore();
  }
});

test('pack retirement preserves resources needed by two residents and releases them exactly once at the last actor', async () => {
  const pack = await createPinnedThreeAssetPack(input()),
    white = pack.create('white'),
    black = pack.create('black');
  const geometries = new Set<import('three').BufferGeometry>();
  let disposed = 0;
  white.node.traverse((node) => {
    if (node instanceof Mesh && !geometries.has(node.geometry)) {
      geometries.add(node.geometry);
      node.geometry.addEventListener('dispose', () => disposed++);
    }
  });
  try {
    pack.dispose();
    expect(disposed).toBe(0);
    expect(pack.clipNames()).toHaveLength(44);
    white.seek(clipId('Idle'), 0);
    black.seek(clipId('FrontKick'), 0.55);
    white.dispose();
    expect(disposed).toBe(0);
    black.seek(clipId('DefeatKick'), 0.2, presentationTimeMs(100));
    expect(black.defeatPoseSupport?.()).toBeDefined();
    black.dispose();
    expect(disposed).toBe(geometries.size);
    expect(pack.clipNames()).toEqual([]);
    expect(pack.rootPolicy(clipId('Cross'))).toBeUndefined();
    expect(() => pack.create('white')).toThrow('disposed');
    pack.dispose();
    black.dispose();
    white.dispose();
    expect(disposed).toBe(geometries.size);
  } finally {
    white.dispose();
    black.dispose();
    pack.dispose();
  }
}, 30000);
