import { readFileSync } from 'node:fs';
import {
  BufferGeometry,
  Material,
  Mesh,
  Object3D,
  Skeleton,
  SkinnedMesh,
} from 'three';
import {
  GLTFLoader,
  type GLTFParser,
} from 'three/addons/loaders/GLTFLoader.js';
import { expect, test, vi } from 'vitest';
import { parseGlbYielding } from '../../src/assets/yieldingGltf';

function resources(roots: readonly Object3D[]) {
  const geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>(),
    skeletons = new Set<Skeleton>();
  for (const root of roots)
    root.traverse((node) => {
      if (node instanceof SkinnedMesh && node.skeleton)
        skeletons.add(node.skeleton);
      if (!(node instanceof Mesh)) return;
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material])
        materials.add(material);
    });
  return [...geometries, ...materials, ...skeletons];
}
test('scheduled original loader preserves all42 real tracks, definitions and cached animation identities', async () => {
  const bytes = new Uint8Array(
    readFileSync('public/game-assets/android/derived-pack-v1.glb'),
  );
  const original = await new GLTFLoader().parseAsync(bytes.buffer, '');
  const stages: string[] = [];
  const scheduled = await parseGlbYielding(bytes, async (stage) => {
    stages.push(stage);
  });
  try {
    expect(JSON.stringify(scheduled.parser.json)).toBe(
      JSON.stringify(original.parser.json),
    );
    expect(scheduled.animations).toHaveLength(42);
    for (let i = 0; i < original.animations.length; i++) {
      const a = original.animations[i],
        b = scheduled.animations[i];
      if (!a || !b) throw new Error('Missing clip');
      expect([b.name, b.duration, b.blendMode, b.tracks.length]).toEqual([
        a.name,
        a.duration,
        a.blendMode,
        a.tracks.length,
      ]);
      expect(await scheduled.parser.getDependency('animation', i)).toBe(b);
      for (let j = 0; j < a.tracks.length; j++) {
        const x = a.tracks[j],
          y = b.tracks[j];
        if (!x || !y) throw new Error('Missing track');
        expect([
          y.name,
          y.ValueTypeName,
          y.getInterpolation(),
          y.getValueSize(),
        ]).toEqual([
          x.name,
          x.ValueTypeName,
          x.getInterpolation(),
          x.getValueSize(),
        ]);
        for (const field of ['times', 'values'] as const) {
          const p = x[field],
            q = y[field];
          expect(q.constructor).toBe(p.constructor);
          expect(
            Buffer.compare(
              Buffer.from(p.buffer, p.byteOffset, p.byteLength),
              Buffer.from(q.buffer, q.byteOffset, q.byteLength),
            ),
          ).toBe(0);
        }
      }
    }
    expect(stages).toEqual([
      'static:before',
      'static:after',
      ...Array.from({ length: 42 }, (_, i) => [
        `animation:${i}:before`,
        `animation:${i}:after`,
      ]).flat(),
      'root:ready',
    ]);
  } finally {
    for (const resource of resources([...original.scenes, ...scheduled.scenes]))
      resource.dispose();
  }
});

/** Tiny synthetic resource fixture for exhaustive scheduling/error ownership,
 * NOT source geometry, attack metadata, production or visual acceptance. */
function tiny42(
  meshCount = 1,
  reuseMesh = false,
  separateSkins = false,
): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [],
    views: object[] = [],
    accessors: object[] = [];
  let length = 0;
  const add = (
    data: ArrayBufferView,
    componentType: number,
    type: string,
    count: number,
    extra = {},
  ) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
    padded.set(bytes);
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
    chunks.push(padded);
    length += padded.length;
    accessors.push({
      bufferView: views.length - 1,
      componentType,
      type,
      count,
      ...extra,
    });
    return accessors.length - 1;
  };
  const position = add(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    5126,
    'VEC3',
    3,
    { min: [0, 0, 0], max: [1, 1, 0] },
  );
  const indices = add(new Uint16Array([0, 1, 2]), 5123, 'SCALAR', 3);
  const joints = add(new Uint16Array(12), 5123, 'VEC4', 3);
  const weights = add(
    new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    5126,
    'VEC4',
    3,
  );
  const bind = add(
    new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    5126,
    'MAT4',
    1,
  );
  const time = add(new Float32Array([0, 1]), 5126, 'SCALAR', 2);
  const output = add(new Float32Array([0, 0, 0, 0, 1, 0]), 5126, 'VEC3', 2);
  const json = new TextEncoder().encode(
    JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ byteLength: length }],
      bufferViews: views,
      accessors,
      scenes: [
        {
          nodes: [
            0,
            1,
            ...Array.from({ length: meshCount - 1 }, (_, i) => i + 2),
          ],
        },
      ],
      scene: 0,
      nodes: [
        { name: 'mesh', mesh: 0, skin: 0 },
        { name: 'root' },
        ...Array.from({ length: meshCount - 1 }, (_, i) => ({
          name: `other${i}`,
          mesh: reuseMesh ? 0 : i + 1,
          skin: separateSkins ? i + 1 : 0,
        })),
      ],
      skins: Array.from({ length: separateSkins ? meshCount : 1 }, () => ({
        joints: [1],
        inverseBindMatrices: bind,
      })),
      materials: [{}],
      meshes: Array.from({ length: reuseMesh ? 1 : meshCount }, () => ({
        primitives: [
          {
            attributes: {
              POSITION: position,
              JOINTS_0: joints,
              WEIGHTS_0: weights,
            },
            indices,
            material: 0,
          },
        ],
      })),
      animations: Array.from({ length: 42 }, (_, i) => ({
        name: `clip${i}`,
        samplers: [{ input: time, output }],
        channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }],
      })),
    }),
  );
  const size = Math.ceil(json.length / 4) * 4,
    bytes = new Uint8Array(28 + size + length),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, size, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + size);
  bytes.set(json, 20);
  view.setUint32(20 + size, length, true);
  view.setUint32(24 + size, 0x004e4942, true);
  let offset = 28 + size;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
test('every87 static/animation/root rejection releases the captured scene exactly once', async () => {
  let parser: GLTFParser | undefined;
  const register = GLTFLoader.prototype.register;
  const hook = vi
    .spyOn(GLTFLoader.prototype, 'register')
    .mockImplementation(function (this: GLTFLoader, callback) {
      return register.call(this, (value) => {
        const plugin = callback(value);
        if (plugin.name === 'B_YIELD_ANIMATIONS_V1') parser = value;
        return plugin;
      });
    });
  const points = [
    'static:before',
    'static:after',
    ...Array.from({ length: 42 }, (_, i) => [
      `animation:${i}:before`,
      `animation:${i}:after`,
    ]).flat(),
    'root:ready',
  ];
  try {
    for (const stop of points) {
      const disposals: ReturnType<typeof vi.spyOn>[] = [],
        seen: string[] = [];
      const reason = new Error(stop);
      await expect(
        parseGlbYielding(tiny42(), async (stage) => {
          seen.push(stage);
          if (stage === 'static:after') {
            if (!parser) throw new Error('Missing parser');
            const roots: unknown = await parser.getDependencies('scene');
            if (
              !Array.isArray(roots) ||
              !roots.every((root) => root instanceof Object3D)
            )
              throw new Error('Invalid roots');
            // Narrow through the actual engine base class below, not guessed objects.
            for (const resource of resources(roots))
              disposals.push(vi.spyOn(resource, 'dispose'));
          }
          if (stage === stop) throw reason;
        }),
      ).rejects.toBe(reason);
      expect(seen.at(-1)).toBe(stop);
      expect(disposals).toHaveLength(stop === 'static:before' ? 0 : 3);
      for (const dispose of disposals) {
        expect(dispose).toHaveBeenCalledTimes(1);
        dispose.mockRestore();
      }
    }
  } finally {
    hook.mockRestore();
  }
});
test('a static aggregation rejection after resolved meshes still releases their resources', async () => {
  const register = GLTFLoader.prototype.register;
  const reason = new Error('scene aggregation failed');
  const disposals: ReturnType<typeof vi.spyOn>[] = [];
  const allocated: ReturnType<typeof resources> = [];
  const hook = vi
    .spyOn(GLTFLoader.prototype, 'register')
    .mockImplementation(function (this: GLTFLoader, callback) {
      return register.call(this, (parser) => {
        const plugin = callback(parser);
        if (plugin.name === 'B_YIELD_ANIMATIONS_V1') {
          const get = parser.getDependencies.bind(parser);
          vi.spyOn(parser, 'getDependencies').mockImplementation(
            async (type) => {
              const result = await get(type);
              if (type === 'scene') {
                const roots: unknown = result;
                if (
                  !Array.isArray(roots) ||
                  !roots.every((root) => root instanceof Object3D)
                )
                  throw new Error('Fixture roots');
                allocated.push(...resources(roots));
                for (const item of allocated)
                  disposals.push(vi.spyOn(item, 'dispose'));
                throw reason;
              }
              return result;
            },
          );
        }
        return plugin;
      });
    });
  try {
    await expect(parseGlbYielding(tiny42(), async () => {})).rejects.toBe(
      reason,
    );
    expect(disposals).toHaveLength(3);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  } finally {
    for (let i = 0; i < allocated.length; i++) {
      if (!disposals[i]?.mock.calls.length) allocated[i]?.dispose();
      disposals[i]?.mockRestore();
    }
    hook.mockRestore();
  }
});
test('original loadAnimation failures at first/middle/final retain their error and release the scene', async () => {
  for (const stop of [0, 21, 41]) {
    const register = GLTFLoader.prototype.register,
      reason = new Error(`engine${stop}`);
    const disposals: ReturnType<typeof vi.spyOn>[] = [],
      called: number[] = [];
    let parser: GLTFParser | undefined;
    const hook = vi
      .spyOn(GLTFLoader.prototype, 'register')
      .mockImplementation(function (this: GLTFLoader, callback) {
        return register.call(this, (value) => {
          const plugin = callback(value);
          if (plugin.name === 'B_YIELD_ANIMATIONS_V1') {
            parser = value;
            const load = value.loadAnimation.bind(value);
            vi.spyOn(value, 'loadAnimation').mockImplementation((index) => {
              called.push(index);
              return index === stop ? Promise.reject(reason) : load(index);
            });
          }
          return plugin;
        });
      });
    try {
      await expect(
        parseGlbYielding(tiny42(), async (stage) => {
          if (stage === 'static:after') {
            const roots: unknown = await parser?.getDependencies('scene');
            if (
              !Array.isArray(roots) ||
              !roots.every((root) => root instanceof Object3D)
            )
              throw new Error('Fixture roots');
            for (const resource of resources(roots))
              disposals.push(vi.spyOn(resource, 'dispose'));
          }
        }),
      ).rejects.toBe(reason);
      expect(called).toEqual(Array.from({ length: stop + 1 }, (_, i) => i));
      expect(disposals).toHaveLength(3);
      for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      for (const dispose of disposals) dispose.mockRestore();
      hook.mockRestore();
    }
  }
});
test('failure waits for delayed requested mesh before freeing shared resources', async () => {
  const register = GLTFLoader.prototype.register,
    reason = new Error('partial static failure');
  const order: string[] = [],
    allocated = new Set<ReturnType<typeof resources>[number]>();
  const disposals: ReturnType<typeof vi.spyOn>[] = [];
  const hook = vi
    .spyOn(GLTFLoader.prototype, 'register')
    .mockImplementation(function (this: GLTFLoader, callback) {
      return register.call(this, (parser) => {
        const plugin = callback(parser);
        if (plugin.name === 'B_YIELD_ANIMATIONS_V1') {
          const load = parser.loadMesh.bind(parser),
            get = parser.getDependencies.bind(parser);
          vi.spyOn(parser, 'loadMesh').mockImplementation(async (index) => {
            const mesh = await load(index);
            for (const resource of resources([mesh]))
              if (!allocated.has(resource)) {
                allocated.add(resource);
                const dispose = resource.dispose.bind(resource);
                disposals.push(
                  vi.spyOn(resource, 'dispose').mockImplementation(() => {
                    order.push('dispose');
                    dispose();
                  }),
                );
              }
            if (index === 1)
              await new Promise<void>((resolve) => setTimeout(resolve, 5));
            order.push(`mesh${index}`);
            return mesh;
          });
          vi.spyOn(parser, 'getDependencies').mockImplementation((type) => {
            if (type !== 'scene') return get(type);
            const first = parser.getDependency('mesh', 0);
            // Both dependencies are requested. The second is still pending when
            // the aggregate fails; it shares geometry/material with the first.
            void parser.getDependency('mesh', 1);
            return first.then(() => {
              order.push('reject');
              throw reason;
            });
          });
        }
        return plugin;
      });
    });
  try {
    await expect(parseGlbYielding(tiny42(2), async () => {})).rejects.toBe(
      reason,
    );
    expect(disposals).toHaveLength(2);
    expect(order.indexOf('reject')).toBeLessThan(order.indexOf('mesh1'));
    expect(order.indexOf('mesh1')).toBeLessThan(order.indexOf('dispose'));
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  } finally {
    for (const dispose of disposals) dispose.mockRestore();
    hook.mockRestore();
  }
});
test('a parallel root dependency rejection stops and settles the queued animation work before cleanup', async () => {
  const register = GLTFLoader.prototype.register,
    reason = new Error('parallel root dependency failed');
  const calls: number[] = [],
    order: string[] = [],
    disposals: ReturnType<typeof vi.spyOn>[] = [];
  let parser: GLTFParser | undefined;
  const hook = vi
    .spyOn(GLTFLoader.prototype, 'register')
    .mockImplementation(function (this: GLTFLoader, callback) {
      return register.call(this, (value) => {
        const plugin = callback(value);
        if (plugin.name === 'B_YIELD_ANIMATIONS_V1') {
          parser = value;
          const get = value.getDependencies.bind(value),
            load = value.loadAnimation.bind(value);
          vi.spyOn(value, 'getDependencies').mockImplementation((type) =>
            type === 'camera' ? Promise.reject(reason) : get(type),
          );
          vi.spyOn(value, 'loadAnimation').mockImplementation((index) => {
            calls.push(index);
            return load(index);
          });
        }
        return plugin;
      });
    });
  try {
    await expect(
      parseGlbYielding(tiny42(), async (stage) => {
        if (stage === 'static:after') {
          const roots: unknown = await parser?.getDependencies('scene');
          if (
            !Array.isArray(roots) ||
            !roots.every((root) => root instanceof Object3D)
          )
            throw new Error('Fixture roots');
          for (const resource of resources(roots)) {
            const dispose = resource.dispose.bind(resource);
            disposals.push(
              vi.spyOn(resource, 'dispose').mockImplementation(() => {
                order.push('dispose');
                dispose();
              }),
            );
          }
        }
        if (stage === 'animation:0:before') {
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
          order.push('checkpoint settled');
        }
      }),
    ).rejects.toBe(reason);
    await new Promise<void>((resolve) => setTimeout(resolve, 15));
    expect(calls).toEqual([]);
    expect(order.indexOf('checkpoint settled')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('checkpoint settled')).toBeLessThan(
      order.indexOf('dispose'),
    );
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  } finally {
    for (const dispose of disposals) dispose.mockRestore();
    hook.mockRestore();
  }
});
test.each([
  {
    name: 'real pinned scene aggregation',
    real: true,
    rejectNode: false,
    skinCount: 1,
  },
  {
    name: 'cloned mesh scene aggregation',
    real: false,
    rejectNode: false,
    skinCount: 2,
  },
  {
    name: 'node rejection before its independent skin completes',
    real: false,
    rejectNode: true,
    skinCount: 2,
  },
])(
  '$name waits for late skins and disposes every unique resource before rejecting',
  async ({ real, rejectNode, skinCount }) => {
    const bytes = real
      ? new Uint8Array(
          readFileSync('public/game-assets/android/derived-pack-v1.glb'),
        )
      : tiny42(2, true, true);
    let releaseSkin = () => {},
      failureStarted = () => {},
      settled = false;
    const skinGate = new Promise<void>((resolve) => {
        releaseSkin = resolve;
      }),
      failureGate = new Promise<void>((resolve) => {
        failureStarted = resolve;
      });
    const reason = new Error('early static failure'),
      events: string[] = [],
      roots: Object3D[] = [],
      work: Promise<unknown>[] = [],
      disposed: (BufferGeometry | Material | Skeleton)[] = [];
    const geometryDispose = BufferGeometry.prototype.dispose,
      materialDispose = Material.prototype.dispose,
      skeletonDispose = Skeleton.prototype.dispose;
    const gd = vi
      .spyOn(BufferGeometry.prototype, 'dispose')
      .mockImplementation(function (this: BufferGeometry) {
        events.push('dispose');
        disposed.push(this);
        geometryDispose.call(this);
      });
    const md = vi
      .spyOn(Material.prototype, 'dispose')
      .mockImplementation(function (this: Material) {
        events.push('dispose');
        disposed.push(this);
        materialDispose.call(this);
      });
    const sd = vi
      .spyOn(Skeleton.prototype, 'dispose')
      .mockImplementation(function (this: Skeleton) {
        events.push('dispose');
        disposed.push(this);
        skeletonDispose.call(this);
      });
    const register = GLTFLoader.prototype.register;
    const hook = vi
      .spyOn(GLTFLoader.prototype, 'register')
      .mockImplementation(function (this: GLTFLoader, callback) {
        return register.call(this, (parser) => {
          const plugin = callback(parser);
          if (plugin.name === 'B_YIELD_ANIMATIONS_V1') {
            const skin = parser.loadSkin.bind(parser),
              node = parser.loadNode.bind(parser),
              get = parser.getDependencies.bind(parser);
            vi.spyOn(parser, 'loadSkin').mockImplementation(async (index) => {
              await skinGate;
              const result = await skin(index);
              events.push('skin ready');
              return result;
            });
            vi.spyOn(parser, 'loadNode').mockImplementation((index) => {
              const actual = node(index).then((value) => {
                roots.push(value);
                events.push('node ready');
                return value;
              });
              work.push(actual);
              void actual.catch(() => {});
              if (rejectNode && index === 0)
                return parser.getDependency('mesh', 0).then(() => {
                  failureStarted();
                  throw reason;
                });
              return actual;
            });
            vi.spyOn(parser, 'getDependencies').mockImplementation((type) => {
              if (type !== 'scene') return get(type);
              const actual = get(type).then((values) => {
                const observed: unknown = values;
                if (
                  !Array.isArray(observed) ||
                  !observed.every((value) => value instanceof Object3D)
                )
                  throw new Error('Fixture scenes');
                roots.push(...observed);
                events.push('scene ready');
                return values;
              });
              work.push(actual);
              void actual.catch(() => {});
              return rejectNode
                ? actual
                : parser.getDependency('mesh', 0).then(() => {
                    failureStarted();
                    throw reason;
                  });
            });
          }
          return plugin;
        });
      });
    const outcome: Promise<unknown> = parseGlbYielding(
      bytes,
      async () => {},
    ).then(
      (value) => {
        settled = true;
        return value;
      },
      (error) => {
        settled = true;
        events.push('parse rejected');
        return error;
      },
    );
    try {
      await failureGate;
      // This task turn permits rejection handlers to run; the skin gate remains
      // deliberately CLOSED. No fixed sleep is used to infer skin completion.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);
      releaseSkin();
      expect(await outcome).toBe(reason);
      await Promise.allSettled(work);
      const owned = resources(roots);
      expect(owned.filter((value) => value instanceof Skeleton)).toHaveLength(
        skinCount,
      );
      expect(
        owned.filter((value) => value instanceof BufferGeometry),
      ).toHaveLength(real ? 5 : 1);
      expect(owned.filter((value) => value instanceof Material)).toHaveLength(
        real ? 5 : 1,
      );
      expect(new Set(disposed)).toEqual(new Set(owned));
      for (const value of owned)
        expect(disposed.filter((item) => item === value)).toHaveLength(1);
      expect(events.lastIndexOf('skin ready')).toBeLessThan(
        events.indexOf('dispose'),
      );
      expect(events.lastIndexOf('node ready')).toBeLessThan(
        events.indexOf('dispose'),
      );
      if (!rejectNode)
        expect(events.indexOf('scene ready')).toBeLessThan(
          events.indexOf('parse rejected'),
        );
      expect(events.lastIndexOf('dispose')).toBeLessThan(
        events.indexOf('parse rejected'),
      );
    } finally {
      releaseSkin();
      await outcome;
      await Promise.allSettled(work);
      for (const value of resources(roots))
        if (!disposed.includes(value)) value.dispose();
      hook.mockRestore();
      gd.mockRestore();
      md.mockRestore();
      sd.mockRestore();
    }
  },
);
test('normal node/skin/scene observers reuse initiated dependencies without additional native loading or reordering', async () => {
  const bytes = new Uint8Array(
    readFileSync('public/game-assets/android/derived-pack-v1.glb'),
  );
  const originalCalls: string[] = [],
    scheduledCalls: string[] = [],
    counts = [new Map<string, number>(), new Map<string, number>()] as const;
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  const observeParser = (
    parser: GLTFParser,
    calls: string[],
    counts: Map<string, number>,
  ) => {
    const node = parser.loadNode.bind(parser),
      mesh = parser.loadMesh.bind(parser),
      skin = parser.loadSkin.bind(parser),
      scene = parser.loadScene.bind(parser),
      animation = parser.loadAnimation.bind(parser),
      get = parser.getDependency.bind(parser);
    spies.push(
      vi.spyOn(parser, 'loadNode').mockImplementation((index) => {
        calls.push(`node:${index}`);
        return node(index);
      }),
    );
    spies.push(
      vi.spyOn(parser, 'loadMesh').mockImplementation((index) => {
        calls.push(`mesh:${index}`);
        return mesh(index);
      }),
    );
    spies.push(
      vi.spyOn(parser, 'loadSkin').mockImplementation((index) => {
        calls.push(`skin:${index}`);
        return skin(index);
      }),
    );
    spies.push(
      vi.spyOn(parser, 'loadScene').mockImplementation((...args) => {
        calls.push('scene');
        return scene(...args);
      }),
    );
    spies.push(
      vi.spyOn(parser, 'loadAnimation').mockImplementation((index) => {
        calls.push(`animation:${index}`);
        return animation(index);
      }),
    );
    const seen = new Map<string, Promise<unknown>>();
    spies.push(
      vi.spyOn(parser, 'getDependency').mockImplementation((type, index) => {
        const key = `${type}:${index}`,
          result: Promise<unknown> = get(type, index);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (seen.has(key)) expect(result).toBe(seen.get(key));
        else seen.set(key, result);
        return result;
      }),
    );
  };
  const register = GLTFLoader.prototype.register;
  const hook = vi
    .spyOn(GLTFLoader.prototype, 'register')
    .mockImplementation(function (this: GLTFLoader, callback) {
      return register.call(this, (parser) => {
        const plugin = callback(parser);
        if (plugin.name === 'TEST_ORIGINAL_TRACE')
          observeParser(parser, originalCalls, counts[0]);
        if (plugin.name === 'B_YIELD_ANIMATIONS_V1')
          observeParser(parser, scheduledCalls, counts[1]);
        return plugin;
      });
    });
  const roots: Object3D[] = [];
  try {
    const original = await new GLTFLoader()
      .register(() => ({ name: 'TEST_ORIGINAL_TRACE' }))
      .parseAsync(bytes.buffer, '');
    roots.push(original.scene);
    const scheduled = await parseGlbYielding(bytes, async () => {});
    roots.push(scheduled.scene);
    expect(scheduledCalls).toEqual(originalCalls);
    expect(
      scheduledCalls.filter((value) => value.startsWith('skin:')),
    ).toHaveLength(1);
    expect(scheduledCalls.filter((value) => value === 'scene')).toHaveLength(1);
    expect(
      scheduledCalls.filter((value) => value.startsWith('animation:')),
    ).toHaveLength(42);
    expect(counts[1].get('skin:0')).toBe((counts[0].get('skin:0') ?? 0) + 1);
    expect(counts[1].get('scene:0')).toBe((counts[0].get('scene:0') ?? 0) + 1);
  } finally {
    for (const resource of resources(roots)) resource.dispose();
    for (const spy of spies) spy.mockRestore();
    hook.mockRestore();
  }
});
