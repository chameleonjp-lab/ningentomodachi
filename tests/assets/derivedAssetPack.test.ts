import { expect, test } from 'vitest';
import * as assets from '../../src/assets';

test('lossless derived preparation has a distinct required pinned factory, not a legacy fallback', () => {
  expect(assets).toHaveProperty(
    'createPinnedDerivedThreeAssetPack',
    expect.any(Function),
  );
});

// Independent readback deliberately does not call the writer's certificate/parser.
// Component bytes are compared directly, not only by the writer's own hashes.
import { readFileSync } from 'node:fs';
import { ANDROID_RUNTIME_ARTIFACT_V1 } from '../../src/assets/runtimeArtifactManifest';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Object');
  return value as Record<string, unknown>;
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error('Array');
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Integer');
  return value;
}
function read(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    jsonLength = dv.getUint32(12, true);
  expect(dv.getUint32(0, true)).toBe(0x46546c67);
  expect(dv.getUint32(4, true)).toBe(2);
  expect(dv.getUint32(8, true)).toBe(bytes.length);
  expect(dv.getUint32(16, true)).toBe(0x4e4f534a);
  expect(dv.getUint32(24 + jsonLength, true)).toBe(0x004e4942);
  return {
    json: object(
      JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))),
    ),
    binary: bytes.subarray(28 + jsonLength),
  };
}
function packet(source: ReturnType<typeof read>, id: unknown) {
  const accessor = object(array(source.json.accessors)[number(id)]),
    view = object(array(source.json.bufferViews)[number(accessor.bufferView)]);
  const widths: Record<number, number> = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
  };
  const dimensions: Record<string, number> = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT4: 16,
  };
  const width = widths[number(accessor.componentType)],
    dimension =
      typeof accessor.type === 'string' ? dimensions[accessor.type] : undefined;
  if (
    !width ||
    !dimension ||
    view.byteStride !== undefined ||
    accessor.sparse !== undefined
  )
    throw new Error('Unsupported independent layout');
  const start = number(view.byteOffset ?? 0) + number(accessor.byteOffset ?? 0),
    length = number(accessor.count) * width * dimension;
  expect(number(accessor.byteOffset ?? 0) + length).toBeLessThanOrEqual(
    number(view.byteLength),
  );
  expect(
    number(view.byteOffset ?? 0) + number(view.byteLength),
  ).toBeLessThanOrEqual(
    number(object(array(source.json.buffers)[0]).byteLength),
  );
  return {
    definition: Object.fromEntries(
      Object.entries(accessor).filter(
        ([key]) => key !== 'bufferView' && key !== 'byteOffset',
      ),
    ),
    target: view.target,
    bytes: source.binary.subarray(start, start + length),
  };
}
function comparePacket(
  a: ReturnType<typeof read>,
  b: ReturnType<typeof read>,
  ai: unknown,
  bi: unknown,
) {
  const expected = packet(a, ai),
    actual = packet(b, bi);
  expect(actual.definition).toStrictEqual(expected.definition);
  expect(actual.target).toBe(expected.target);
  expect(
    Buffer.compare(Buffer.from(actual.bytes), Buffer.from(expected.bytes)),
  ).toBe(0);
}
test('independent GLB readback preserves every original static field and all42 accessor payloads bitwise', () => {
  const derived = read(
    new Uint8Array(
      readFileSync('public/game-assets/android/derived-pack-v1.glb'),
    ),
  );
  let clipIndex = 0;
  for (const pin of ANDROID_RUNTIME_ARTIFACT_V1.sources) {
    const source = read(new Uint8Array(readFileSync(pin.path)));
    for (const [key, value] of Object.entries(source.json)) {
      if (!['animations', 'accessors', 'bufferViews', 'buffers'].includes(key))
        expect(derived.json[key]).toStrictEqual(value);
    }
    for (const mesh of array(source.json.meshes))
      for (const primitive of array(object(mesh).primitives)) {
        const p = object(primitive);
        for (const id of [...Object.values(object(p.attributes)), p.indices])
          comparePacket(source, derived, id, id);
      }
    for (const skin of array(source.json.skins)) {
      const id = object(skin).inverseBindMatrices;
      comparePacket(source, derived, id, id);
    }
    for (const animation of array(source.json.animations)) {
      const a = object(animation),
        b = object(array(derived.json.animations)[clipIndex++]);
      expect(b.name).toBe(a.name);
      expect(b.channels).toStrictEqual(a.channels);
      const samplers = array(a.samplers),
        mapped = array(b.samplers);
      expect(mapped.length).toBe(samplers.length);
      samplers.forEach((sampler, index) => {
        const original = object(sampler),
          target = object(mapped[index]);
        expect(target.interpolation).toBe(original.interpolation);
        comparePacket(source, derived, original.input, target.input);
        comparePacket(source, derived, original.output, target.output);
      });
    }
  }
  expect(clipIndex).toBe(42);
  expect(array(derived.json.animations)).toHaveLength(42);
});

import { createHash } from 'node:crypto';
import { Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { vi } from 'vitest';
import {
  ANDROID_DERIVED_PACK_V1,
  createPinnedDerivedThreeAssetPack,
} from '../../src/assets';
import * as deathAuthor from '../../src/assets/deathAnimation';
import { PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES } from '../../src/assets/representativePolicies';
import * as supportAuthor from '../../src/assets/skinBounds';
import { clipId, presentationTimeMs } from '../../src/contracts';
import {
  buildDerivedPack,
  certifySourceEquivalence,
  losslessJson,
} from '../../tools/assets/derivedPack';
const originalBytes = () =>
  ANDROID_RUNTIME_ARTIFACT_V1.sources.map(
    (pin) => new Uint8Array(readFileSync(pin.path)),
  );
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const derivedInput = () => ({
  derivedBytes: new Uint8Array(
    readFileSync(`public${ANDROID_DERIVED_PACK_V1.url}`),
  ),
  artifactBytes: new Uint8Array(
    readFileSync(`public${ANDROID_RUNTIME_ARTIFACT_V1.url}`),
  ),
  rootPolicies: PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES,
  signal: new AbortController().signal,
});
// Separate fixture encoder avoids making certificate tests tautological about -0.
function mutateJson(
  bytes: Uint8Array,
  mutate: (json: Record<string, unknown>) => void,
) {
  const parsed = read(bytes);
  mutate(parsed.json);
  const encoded = JSON.stringify(parsed.json, (_key, value: unknown) =>
    Object.is(value, -0) ? '__NEGATIVE_ZERO__' : value,
  ).replaceAll('"__NEGATIVE_ZERO__"', '-0');
  const json = new TextEncoder().encode(encoded),
    padded = Math.ceil(json.length / 4) * 4;
  const output = new Uint8Array(28 + padded + parsed.binary.length),
    dv = new DataView(output.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, output.length, true);
  dv.setUint32(12, padded, true);
  dv.setUint32(16, 0x4e4f534a, true);
  output.fill(32, 20, 20 + padded);
  output.set(json, 20);
  dv.setUint32(20 + padded, parsed.binary.length, true);
  dv.setUint32(24 + padded, 0x004e4942, true);
  output.set(parsed.binary, 28 + padded);
  return output;
}
test('offline certificate fails closed on unknown source features and signed-zero scene differences', () => {
  expect(losslessJson({ z: -0, a: [0, -0] }, true)).toBe('{"a":[0,-0],"z":-0}');
  const sources = originalBytes(),
    base = sources[0];
  if (!base) throw new Error('Source');
  const mutations: ((json: Record<string, unknown>) => void)[] = [
    (json) => {
      json.extras = {};
    },
    (json) => {
      json.textures = [];
    },
    (json) => {
      object(array(json.nodes)[0]).matrix = Array(16).fill(0);
    },
    (json) => {
      object(array(object(array(json.meshes)[0]).primitives)[0]).targets = [];
    },
    (json) => {
      object(array(json.accessors)[0]).normalized = false;
    },
    (json) => {
      object(array(json.bufferViews)[0]).byteStride = 12;
    },
    (json) => {
      json.extensionsUsed = ['KHR_unreviewed_extension'];
    },
  ];
  for (const mutate of mutations) {
    const changed = mutateJson(base, mutate);
    expect(() =>
      certifySourceEquivalence([changed, ...sources.slice(1)]),
    ).toThrow(/Unsupported/);
    expect(() => buildDerivedPack([changed, ...sources.slice(1)])).toThrow(
      /pin mismatch/,
    );
  }
  const changed = mutateJson(base, (json) => {
    const node = array(json.nodes)
      .map(object)
      .find(
        (node) =>
          Array.isArray(node.translation) &&
          node.translation.some((value: unknown) => value === 0),
      );
    if (!node) throw new Error('Zero translation fixture');
    const translation = [...array(node.translation)],
      at = translation.indexOf(0);
    translation[at] = Object.is(translation[at], -0) ? 0 : -0;
    node.translation = translation;
  });
  expect(() =>
    certifySourceEquivalence([changed, ...sources.slice(1)]),
  ).toThrow(/scene\/geometry\/bind\/material mismatch/);
});
test('checked-in derived bytes regenerate exactly and source/clip provenance remains original', () => {
  const sources = originalBytes(),
    built = buildDerivedPack(sources),
    manifest = ANDROID_DERIVED_PACK_V1;
  expect(
    Buffer.compare(
      Buffer.from(built.bytes),
      readFileSync(`public${manifest.url}`),
    ),
  ).toBe(0);
  expect(hash(built.bytes)).toBe(manifest.sha256);
  expect(built.certificate.staticSha256).toBe(manifest.staticSha256);
  expect(built.certificate.clips).toStrictEqual(manifest.clips);
  expect(manifest.sources).toStrictEqual(ANDROID_RUNTIME_ARTIFACT_V1.sources);
  expect(manifest.runtimeArtifactSha256).toBe(
    ANDROID_RUNTIME_ARTIFACT_V1.sha256,
  );
  let index = 0;
  sources.forEach((source, sourceIndex) => {
    array(read(source).json.animations).forEach((clip, sourceClipIndex) => {
      const origin = manifest.clips[index++];
      expect(origin).toMatchObject({
        name: object(clip).name,
        sourceIndex,
        sourceClipIndex,
        sourceSha256: hash(source),
      });
    });
  });
  expect(index).toBe(42);
  expect(Object.isFrozen(manifest)).toBe(true);
  expect(
    Object.isFrozen(manifest.sources) &&
      manifest.sources.every(Object.isFrozen),
  ).toBe(true);
  expect(
    Object.isFrozen(manifest.clips) && manifest.clips.every(Object.isFrozen),
  ).toBe(true);
});
test('derived factory rejects missing/tampered data before parsing and never certifies/authors at runtime', async () => {
  const parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync'),
    author = vi.spyOn(deathAuthor, 'authorDeathClips'),
    certify = vi.spyOn(supportAuthor, 'prepareSkinBounds');
  try {
    await expect(
      createPinnedDerivedThreeAssetPack({
        ...derivedInput(),
        derivedBytes: new Uint8Array(),
      }),
    ).rejects.toThrow('length');
    const tampered = derivedInput();
    tampered.derivedBytes[tampered.derivedBytes.length - 1] =
      (tampered.derivedBytes.at(-1) ?? 0) ^ 1;
    await expect(createPinnedDerivedThreeAssetPack(tampered)).rejects.toThrow(
      'derived hash',
    );
    const artifact = derivedInput();
    artifact.artifactBytes[artifact.artifactBytes.length - 2] =
      (artifact.artifactBytes.at(-2) ?? 0) ^ 1;
    await expect(createPinnedDerivedThreeAssetPack(artifact)).rejects.toThrow(
      'artifact hash',
    );
    expect(parse).not.toHaveBeenCalled();
    const pack = await createPinnedDerivedThreeAssetPack(derivedInput());
    try {
      expect(parse).toHaveBeenCalledTimes(1);
      expect(pack.clipNames()).toHaveLength(44);
      for (const policy of PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES)
        expect(pack.rootPolicy(policy.clipId)).toStrictEqual(policy);
      for (const name of ['DefeatPunch', 'DefeatKick'])
        expect(pack.clipDuration(clipId(name))).toBe(500);
      const rig = pack.create('white');
      try {
        rig.seek(clipId('FrontKick'), 0.55);
        rig.seek(
          clipId('DefeatKick'),
          0.0257509794179,
          presentationTimeMs(1000),
        );
        const bounds = rig.defeatPoseSupport?.();
        expect(bounds?.entryLocalMinY).toEqual(expect.any(Number));
        expect(bounds?.currentLocalBounds.min.y).toEqual(expect.any(Number));
      } finally {
        rig.dispose();
      }
    } finally {
      pack.dispose();
    }
    expect(author).not.toHaveBeenCalled();
    expect(certify).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
    author.mockRestore();
    certify.mockRestore();
  }
});
test('derived pin cannot replace original policy provenance and rejected policies allocate no scene', async () => {
  const parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
  try {
    const policy = PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES[0];
    if (!policy) throw new Error('Policy');
    for (const sourceSha256 of [
      ANDROID_DERIVED_PACK_V1.sha256,
      ANDROID_DERIVED_PACK_V1.sources[0]?.sha256 ?? '0'.repeat(64),
    ]) {
      await expect(
        createPinnedDerivedThreeAssetPack({
          ...derivedInput(),
          rootPolicies: [{ ...policy, sourceSha256 }],
        }),
      ).rejects.toThrow('original source');
    }
    expect(parse).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
  }
});
test('derived parsing and late abort clean allocated resources; final actor owns shared release', async () => {
  const base = GLTFLoader.prototype.parseAsync;
  const geometry: ReturnType<typeof vi.spyOn>[] = [],
    materials: ReturnType<typeof vi.spyOn>[] = [];
  const parse = vi
    .spyOn(GLTFLoader.prototype, 'parseAsync')
    .mockImplementation(async function (this: GLTFLoader, data, path) {
      const loaded = await base.call(this, data, path);
      loaded.scene.traverse((node) => {
        if (node instanceof Mesh) {
          geometry.push(vi.spyOn(node.geometry, 'dispose'));
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material])
            materials.push(vi.spyOn(material, 'dispose'));
        }
      });
      return loaded;
    });
  try {
    for (const stage of ['parse:0:after', 'artifact:support', 'pack:ready']) {
      geometry.length = 0;
      materials.length = 0;
      const controller = new AbortController();
      await expect(
        createPinnedDerivedThreeAssetPack({
          ...derivedInput(),
          signal: controller.signal,
          checkpoint: async (current) => {
            if (current === stage) controller.abort();
          },
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(geometry.length).toBe(5);
      expect(materials.length).toBe(5);
      for (const spy of [...geometry, ...materials])
        expect(spy).toHaveBeenCalledTimes(1);
    }
    geometry.length = 0;
    materials.length = 0;
    const pack = await createPinnedDerivedThreeAssetPack(derivedInput()),
      white = pack.create('white'),
      black = pack.create('black');
    pack.dispose();
    white.dispose();
    for (const spy of geometry) expect(spy).not.toHaveBeenCalled();
    black.dispose();
    for (const spy of geometry) expect(spy).toHaveBeenCalledTimes(1);
    expect(pack.clipNames()).toEqual([]);
  } finally {
    parse.mockRestore();
    for (const spy of [...geometry, ...materials]) spy.mockRestore();
  }
});
test('derived input snapshots cannot be swapped after await and every checkpoint yields a real timer task', async () => {
  let ticks = 0,
    previous = 0,
    checkpoints = 0;
  const timer = setInterval(() => ticks++, 1);
  const input = {
    ...derivedInput(),
    checkpoint: async () => {
      expect(ticks).toBeGreaterThan(previous);
      previous = ticks;
      checkpoints++;
    },
  };
  const pending = createPinnedDerivedThreeAssetPack(input);
  input.derivedBytes.fill(0);
  input.artifactBytes.fill(0);
  input.rootPolicies = [];
  const replacement = new AbortController();
  replacement.abort();
  input.signal = replacement.signal;
  try {
    const pack = await pending;
    try {
      expect(checkpoints).toBeGreaterThan(40);
      for (const policy of PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES)
        expect(pack.rootPolicy(policy.clipId)).toStrictEqual(policy);
    } finally {
      pack.dispose();
    }
  } finally {
    clearInterval(timer);
  }
});

import {
  AnimationMixer,
  Group,
  LoopOnce,
  Matrix3,
  SkinnedMesh,
  Vector3,
} from 'three';
import { createPinnedThreeAssetPack } from '../../src/assets';
function parts(node: import('three').Object3D) {
  const result: SkinnedMesh[] = [];
  node.traverse((part) => {
    if (part instanceof SkinnedMesh) result.push(part);
  });
  return result;
}
function displayedParent(node: import('three').Object3D) {
  const parent = new Group();
  parent.position.set(2, 3, -4);
  parent.rotation.set(0.07, 0.43, -0.03);
  node.position.set(0.1, -0.07, 0.2);
  node.rotation.set(0.02, 0.05, 0.01);
  node.scale.set(0.9, 1.1, 0.95);
  parent.add(node);
  parent.updateWorldMatrix(true, true);
  return parent;
}
function compareVertices(
  expected: readonly SkinnedMesh[],
  actual: readonly SkinnedMesh[],
  transport = new Vector3(),
) {
  expect(actual.length).toBe(expected.length);
  let maximum = 0,
    count = 0;
  const a = new Vector3(),
    b = new Vector3();
  expected.forEach((mesh, index) => {
    const other = actual[index];
    if (!other) throw new Error('Mesh');
    const vertices = mesh.geometry.getAttribute('position').count;
    expect(other.geometry.getAttribute('position').count).toBe(vertices);
    for (let vertex = 0; vertex < vertices; vertex++) {
      mesh.getVertexPosition(vertex, a).applyMatrix4(mesh.matrixWorld);
      other
        .getVertexPosition(vertex, b)
        .applyMatrix4(other.matrixWorld)
        .add(transport);
      maximum = Math.max(maximum, a.distanceTo(b));
      count++;
    }
  });
  return { maximum, count };
}
test('all42 original engine poses match full derived surfaces with transport restored once at exact keys and interpolated times', async () => {
  const input = derivedInput(),
    pack = await createPinnedDerivedThreeAssetPack(input),
    rig = pack.create('white');
  const parent = displayedParent(rig.node),
    derivedMeshes = parts(rig.node),
    loader = new GLTFLoader();
  let maximum = 0,
    poses = 0,
    vertices = 0,
    clips = 0;
  try {
    for (const bytes of originalBytes()) {
      const original = await loader.parseAsync(bytes.buffer, ''),
        sourceParent = displayedParent(original.scene),
        sourceMeshes = parts(original.scene),
        mixer = new AnimationMixer(original.scene);
      try {
        const root = original.scene.getObjectByName('root');
        if (!root) throw new Error('Original root');
        for (const clip of original.animations) {
          mixer.stopAllAction();
          const action = mixer.clipAction(clip);
          action.setLoop(LoopOnce, 1);
          action.clampWhenFinished = true;
          action.paused = true;
          action.play();
          action.time = 0;
          mixer.update(0);
          // Match the renderer path: updateWorldMatrix bypasses attached skin bind refresh.
          sourceParent.updateMatrixWorld(true);
          const start = original.scene.worldToLocal(
            root.getWorldPosition(new Vector3()),
          );
          const keys = [
              ...new Set(
                clip.tracks.flatMap((track) => Array.from(track.times)),
              ),
            ].sort((a, b) => a - b),
            middle = Math.floor(keys.length / 2);
          const first = keys[0],
            second = keys[1],
            mid = keys[middle],
            next = keys[middle + 1],
            last = keys.at(-1);
          if (
            first === undefined ||
            second === undefined ||
            mid === undefined ||
            next === undefined ||
            last === undefined
          )
            throw new Error('Source keys');
          const times = [
            ...new Set([
              0,
              first,
              mid,
              last,
              (first + second) / 2,
              (mid + next) / 2,
            ]),
          ].sort((a, b) => a - b);
          const policy = PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES.find(
            (policy) => policy.clipId === clip.name,
          );
          for (const time of times) {
            action.time = time;
            mixer.update(0);
            // Match the renderer path: updateWorldMatrix bypasses attached skin bind refresh.
            sourceParent.updateMatrixWorld(true);
            rig.seek(clipId(clip.name), time);
            const transport = original.scene
              .worldToLocal(root.getWorldPosition(new Vector3()))
              .sub(start);
            // This proves extraction is applied once, not a new gameplay flight policy.
            // Only the two already-accepted explicit posture receipts retain Y.
            if (policy?.mode === 'grounded-posture-y') transport.y = 0;
            transport.applyMatrix3(
              new Matrix3().setFromMatrix4(rig.node.matrixWorld),
            );
            const comparison = compareVertices(
              sourceMeshes,
              derivedMeshes,
              transport,
            );
            maximum = Math.max(maximum, comparison.maximum);
            vertices += comparison.count;
            poses++;
          }
          expect(pack.clipDuration(clipId(clip.name))).toBe(
            clip.duration * 1000,
          );
          clips++;
        }
      } finally {
        mixer.stopAllAction();
        mixer.uncacheRoot(original.scene);
        sourceParent.remove(original.scene);
        for (const mesh of sourceMeshes) {
          mesh.geometry.dispose();
          mesh.skeleton.dispose();
          for (const material of Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material])
            material.dispose();
        }
      }
    }
    expect(clips).toBe(42);
    expect(poses).toBe(252);
    expect(vertices).toBe(252 * 46181);
    expect(maximum).toBeLessThan(1e-10);
    console.log(
      JSON.stringify({
        kind: 'derived-original42-full-vertex-proof',
        clips,
        poses,
        vertices,
        maximum,
        coverage:
          'six selected exact/interpolated/initial poses per clip; every key payload separately bitwise verified; not new root-policy acceptance',
      }),
    );
  } finally {
    parent.remove(rig.node);
    rig.dispose();
    pack.dispose();
  }
}, 60000);
test('derived live and defeat surfaces/support preserve accepted original-pack entry, seam and terminal behavior', async () => {
  const input = derivedInput(),
    derived = await createPinnedDerivedThreeAssetPack(input),
    original = await createPinnedThreeAssetPack({
      sources: originalBytes(),
      artifactBytes: input.artifactBytes,
      rootPolicies: input.rootPolicies,
      signal: input.signal,
    });
  let maximum = 0,
    vertices = 0,
    poses = 0;
  try {
    for (const [index, [name, seconds]] of (
      [
        ['FrontKick', 0.55],
        ['CartwheelKick', 0.9],
        ['ChineseCartwheelKick', 1.04],
        ['DivingLunge', 0.7],
        ['ButterflyKick', 0.7],
        ['Cross', 0.4],
      ] as const
    ).entries()) {
      const a = original.create('white'),
        b = derived.create('white'),
        pa = displayedParent(a.node),
        pb = displayedParent(b.node),
        am = parts(a.node),
        bm = parts(b.node);
      try {
        a.seek(clipId(name), seconds);
        b.seek(clipId(name), seconds);
        for (const time of [0, 0.0257509794179, 0.1, 0.3, 0.5]) {
          const kind = index % 2 ? 'DefeatPunch' : 'DefeatKick',
            identity = presentationTimeMs(1000 + index);
          a.seek(clipId(kind), time, identity);
          b.seek(clipId(kind), time, identity);
          expect(b.defeatPoseSupport?.()).toStrictEqual(
            a.defeatPoseSupport?.(),
          );
          const comparison = compareVertices(am, bm);
          maximum = Math.max(maximum, comparison.maximum);
          vertices += comparison.count;
          poses++;
        }
      } finally {
        pa.remove(a.node);
        pb.remove(b.node);
        a.dispose();
        b.dispose();
      }
    }
    expect(poses).toBe(30);
    expect(vertices).toBe(30 * 46181);
    expect(maximum).toBeLessThan(1e-10);
    console.log(
      JSON.stringify({
        kind: 'derived-existing-death-equivalence',
        poses,
        vertices,
        maximum,
      }),
    );
  } finally {
    original.dispose();
    derived.dispose();
  }
}, 60000);

import { BufferAttribute } from 'three';
test('independent engine readback retains all bind, material, typed geometry and42 animation track values', async () => {
  const loader = new GLTFLoader(),
    parsed = await loader.parseAsync(derivedInput().derivedBytes.buffer, ''),
    derivedMeshes = parts(parsed.scene);
  const raw = (data: ArrayBufferView) =>
    Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const release = (node: import('three').Object3D) => {
    const meshes = parts(node);
    for (const geometry of new Set(meshes.map((mesh) => mesh.geometry)))
      geometry.dispose();
    for (const skeleton of new Set(meshes.map((mesh) => mesh.skeleton)))
      skeleton.dispose();
    for (const material of new Set(
      meshes.flatMap((mesh) =>
        Array.isArray(mesh.material) ? mesh.material : [mesh.material],
      ),
    ))
      material.dispose();
  };
  let count = 0;
  try {
    for (const bytes of originalBytes()) {
      const source = await loader.parseAsync(bytes.buffer, '');
      try {
        const expectedMeshes = parts(source.scene);
        expect(derivedMeshes.length).toBe(expectedMeshes.length);
        expectedMeshes.forEach((expected, index) => {
          const actual = derivedMeshes[index];
          if (!actual) throw new Error('Missing derived mesh');
          expect(actual.bindMode).toBe(expected.bindMode);
          expect(actual.bindMatrix.elements).toStrictEqual(
            expected.bindMatrix.elements,
          );
          expect(actual.bindMatrixInverse.elements).toStrictEqual(
            expected.bindMatrixInverse.elements,
          );
          expect(actual.skeleton.bones.map((bone) => bone.name)).toStrictEqual(
            expected.skeleton.bones.map((bone) => bone.name),
          );
          expect(
            actual.skeleton.boneInverses.map((matrix) => matrix.elements),
          ).toStrictEqual(
            expected.skeleton.boneInverses.map((matrix) => matrix.elements),
          );
          expect(Object.keys(actual.geometry.attributes)).toStrictEqual(
            Object.keys(expected.geometry.attributes),
          );
          for (const name of [
            ...Object.keys(expected.geometry.attributes),
            '__index',
          ]) {
            const a =
                name === '__index'
                  ? expected.geometry.index
                  : expected.geometry.getAttribute(name),
              b =
                name === '__index'
                  ? actual.geometry.index
                  : actual.geometry.getAttribute(name);
            if (
              !(a instanceof BufferAttribute) ||
              !(b instanceof BufferAttribute)
            )
              throw new Error('Expected packed source attribute');
            expect(b.itemSize).toBe(a.itemSize);
            expect(b.normalized).toBe(a.normalized);
            expect(b.array.constructor).toBe(a.array.constructor);
            expect(Buffer.compare(raw(a.array), raw(b.array))).toBe(0);
          }
          const materialValues = (mesh: SkinnedMesh) =>
            (Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material]
            ).map((material) =>
              Object.fromEntries(
                Object.entries(material.toJSON()).filter(
                  ([key]) => key !== 'uuid',
                ),
              ),
            );
          expect(materialValues(actual)).toStrictEqual(
            materialValues(expected),
          );
        });
        for (const expected of source.animations) {
          const actual = parsed.animations[count++];
          if (!actual) throw new Error('Missing derived clip');
          expect(actual.name).toBe(expected.name);
          expect(actual.duration).toBe(expected.duration);
          expect(actual.blendMode).toBe(expected.blendMode);
          expect(actual.tracks.length).toBe(expected.tracks.length);
          expected.tracks.forEach((track, index) => {
            const other = actual.tracks[index];
            if (!other) throw new Error('Missing track');
            expect(other.constructor).toBe(track.constructor);
            expect(other.name).toBe(track.name);
            expect(other.getInterpolation()).toBe(track.getInterpolation());
            expect(other.getValueSize()).toBe(track.getValueSize());
            expect(Buffer.compare(raw(other.times), raw(track.times))).toBe(0);
            expect(Buffer.compare(raw(other.values), raw(track.values))).toBe(
              0,
            );
          });
        }
      } finally {
        release(source.scene);
      }
    }
    expect(count).toBe(42);
    expect(parsed.animations.length).toBe(42);
  } finally {
    release(parsed.scene);
  }
});
