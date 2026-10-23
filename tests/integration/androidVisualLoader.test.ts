import { readFileSync } from 'node:fs';
import { Group } from 'three';
import * as AssetModule from '../../src/assets';
import { afterEach, expect, test, vi } from 'vitest';
import {
  androidAssetUrls,
  prepareAndroidVisualAssets,
} from '../../src/app/androidVisualAssets';
import {
  ANDROID_DERIVED_PACK_V1,
  ANDROID_RUNTIME_ARTIFACT_V1,
  PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES,
} from '../../src/assets';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
test.each(['https://example.test/', 'https://example.test/ningentomodachi/'])(
  'fixed asset URLs resolve against explicit app base %s, not origin or bundle location',
  (base) => {
    expect(androidAssetUrls(base)).toEqual({
      derived: `${base}game-assets/android/derived-pack-v1.glb`,
      artifact: `${base}game-assets/android/runtime-artifact-v1.json`,
    });
  },
);
test.each([
  'https://example.test/ningentomodachi',
  'https://example.test/?source=other',
  'https://example.test/#override',
  'https://user:password@example.test/',
  'file:///game/',
  './assets/',
])('ambiguous or non-public app base %s is rejected', (base) => {
  expect(() => androidAssetUrls(base)).toThrow();
});
test('real pinned preparation requests only the two app-scoped files and returns capable required rigs', async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push(url);
      expect(init.redirect).toBe('error');
      expect(init.credentials).toBe('same-origin');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const file = url.endsWith('.glb')
        ? ANDROID_DERIVED_PACK_V1.url
        : ANDROID_RUNTIME_ARTIFACT_V1.url;
      return new Response(new Uint8Array(readFileSync(`public${file}`)));
    }),
  );
  const base = new URL('https://example.test/ningentomodachi/');
  const policies = PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES.map(
    (policy) => ({ ...policy, provenance: { ...policy.provenance } }),
  );
  const loading = prepareAndroidVisualAssets({
    appBase: base,
    signal: new AbortController().signal,
    rootPolicies: policies,
  });
  base.pathname = '/changed/';
  policies[0]!.provenance.supportPointer = 'mutated-after-load-start';
  policies.length = 0;
  const pack = await loading;
  try {
    expect(calls).toEqual(
      Object.values(androidAssetUrls('https://example.test/ningentomodachi/')),
    );
    expect(pack.clipNames()).toHaveLength(44);
    for (const policy of PROVISIONAL_GROUNDED_REPRESENTATIVE_POLICIES)
      expect(pack.rootPolicy(policy.clipId)).toEqual(policy);
    for (const color of ['white', 'blue'] as const) {
      const rig = pack.create(color);
      try {
        expect(typeof rig.defeatPoseSupport).toBe('function');
        expect(rig.defeatPoseSupport?.()).toBeUndefined();
      } finally {
        rig.dispose();
      }
    }
  } finally {
    pack.dispose();
  }
}, 30000);

test('already-aborted preparation performs no fetch', async () => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  const controller = new AbortController();
  controller.abort();
  await expect(
    prepareAndroidVisualAssets({
      appBase: 'https://example.test/game/',
      signal: controller.signal,
      rootPolicies: [],
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(request).not.toHaveBeenCalled();
});

test('abort cancels both outstanding required fetches and removes the parent listener', async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  let aborted = 0;
  const request = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => {
            aborted++;
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      }),
  );
  vi.stubGlobal('fetch', request);
  const loading = prepareAndroidVisualAssets({
    appBase: 'https://example.test/game/',
    signal: controller.signal,
    rootPolicies: [],
  });
  expect(request).toHaveBeenCalledTimes(2);
  controller.abort();
  await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
  expect(aborted).toBe(2);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  remove.mockRestore();
});

test('a required HTTP failure aborts the sibling fetch without replacing the original failure', async () => {
  let siblingAborted = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) =>
      url.endsWith('.glb')
        ? Promise.resolve(new Response(null, { status: 404 }))
        : new Promise<Response>((_resolve, reject) =>
            init.signal?.addEventListener(
              'abort',
              () => {
                siblingAborted = true;
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true },
            ),
          ),
    ),
  );
  await expect(
    prepareAndroidVisualAssets({
      appBase: 'https://example.test/game/',
      signal: new AbortController().signal,
      rootPolicies: [],
    }),
  ).rejects.toThrow('HTTP 404');
  expect(siblingAborted).toBe(true);
});

test('same-length tampered bytes cannot authorize a visual pack', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const file = url.endsWith('.glb')
        ? ANDROID_DERIVED_PACK_V1.url
        : ANDROID_RUNTIME_ARTIFACT_V1.url;
      const bytes = new Uint8Array(readFileSync(`public${file}`));
      if (url.endsWith('.glb'))
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
      return new Response(bytes);
    }),
  );
  await expect(
    prepareAndroidVisualAssets({
      appBase: 'https://example.test/',
      signal: new AbortController().signal,
      rootPolicies: [],
    }),
  ).rejects.toThrow('Pinned derived hash mismatch');
});

test('cancellation at an actual parser checkpoint rejects without returning a pack', async () => {
  const controller = new AbortController();
  const stages: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          new Uint8Array(
            readFileSync(
              `public${url.endsWith('.glb') ? ANDROID_DERIVED_PACK_V1.url : ANDROID_RUNTIME_ARTIFACT_V1.url}`,
            ),
          ),
        ),
    ),
  );
  await expect(
    prepareAndroidVisualAssets({
      appBase: 'https://example.test/',
      signal: controller.signal,
      rootPolicies: [],
      checkpoint(stage) {
        stages.push(stage);
        if (stage === 'parse:0:static:after') controller.abort();
      },
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(stages).toContain('parse:0:static:after');
  expect(stages).not.toContain('parse:0:animation:0:before');
});

test.each([false, true])(
  'a non-capable required rig is released even if release throws: %s',
  async (cleanupThrows) => {
    const release = vi.fn(() => {
      if (cleanupThrows) throw new Error('cleanup');
    });
    const packRelease = vi.fn();
    const create = vi.fn(() => ({
      node: new Group(),
      seek() {},
      setEmissiveEnabled() {},
      dispose: release,
    }));
    vi.spyOn(
      AssetModule,
      'createPinnedDerivedThreeAssetPack',
    ).mockResolvedValue({
      create,
      clipDuration: () => undefined,
      clipNames: () => [],
      rootPolicy: () => undefined,
      dispose: packRelease,
    });
    // Deliberate factory test double isolates the capability boundary; it is not asset qualification.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            new Uint8Array(
              url.endsWith('.glb')
                ? ANDROID_DERIVED_PACK_V1.bytes
                : ANDROID_RUNTIME_ARTIFACT_V1.bytes,
            ),
          ),
      ),
    );
    const pack = await prepareAndroidVisualAssets({
      appBase: 'https://example.test/',
      signal: new AbortController().signal,
      rootPolicies: [],
    });
    expect(create).not.toHaveBeenCalled();
    expect(() => pack.create('white')).toThrow(
      'Required rig lacks bounds-v1 producer capability',
    );
    expect(create).toHaveBeenCalledExactlyOnceWith('white');
    expect(release).toHaveBeenCalledTimes(1);
    expect(packRelease).not.toHaveBeenCalled();
    pack.dispose();
    expect(packRelease).toHaveBeenCalledTimes(1);
  },
);

test('visual wrapper forwards the actual final pack pose descriptor without allocating a probe rig', async () => {
  const { clipId, durationMs } = await import('../../src/contracts');
  const bindings = {
    version: 1 as const,
    bindingSetId: 'fixture-pack',
    clips: ['idle', 'walk', 'run', 'jump'].map((id) => ({
      clipId: clipId(id),
      durationMs: durationMs(100),
      sourceBindingId: `fixture:${id}`,
    })),
    locomotion: {
      idle: clipId('idle'),
      walk: clipId('walk'),
      run: clipId('run'),
      jump: clipId('jump'),
    },
  };
  const create = vi.fn(),
    dispose = vi.fn();
  const read = vi.fn(() => bindings);
  vi.spyOn(AssetModule, 'createPinnedDerivedThreeAssetPack').mockResolvedValue({
    get poseBindings() {
      return read();
    },
    create,
    clipDuration: () => undefined,
    clipNames: () => [],
    rootPolicy: () => undefined,
    dispose,
  });
  // Factory double tests forwarding only, not source or descriptor qualification.
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          new Uint8Array(
            url.endsWith('.glb')
              ? ANDROID_DERIVED_PACK_V1.bytes
              : ANDROID_RUNTIME_ARTIFACT_V1.bytes,
          ),
        ),
    ),
  );
  const pack = await prepareAndroidVisualAssets({
    appBase: 'https://example.test/game/',
    signal: new AbortController().signal,
    rootPolicies: [],
  });
  try {
    expect(pack.poseBindings).toBe(bindings);
    expect(read).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  } finally {
    pack.dispose();
  }
  expect(dispose).toHaveBeenCalledTimes(1);
});

// Source-free wrapper boundary only: no GLB parse, actual model, or pose work.
async function forwardingFixture(
  options: { absent?: boolean; lateAbort?: boolean } = {},
) {
  const { RECOVERY_FRAME_CAPABILITY } = await import(
    '../../src/assets/poseFramePreparation'
  );
  const controller = new AbortController();
  let closed = false,
    released = false,
    transferred = false;
  const token = Object.freeze({ identity: 'synthetic-token' });
  const driver = {
    capability: RECOVERY_FRAME_CAPABILITY,
    prepare: vi.fn(() => token),
    apply: vi.fn(),
    dispose: vi.fn(),
  };
  const rig = {
    node: new Group(),
    seek() {},
    setEmissiveEnabled() {},
    defeatPoseSupport: () => undefined,
    poseFrame: driver,
    dispose: vi.fn(() => {
      released = true;
      driver.dispose();
    }),
  };
  const handle = {
    poseFrame: driver,
    materialize: vi.fn(() => {
      if (closed) throw Error('underlying pack closed');
      if (released || transferred) throw Error('underlying stage consumed');
      transferred = true;
      return rig;
    }),
    dispose: vi.fn(() => {
      if (released || transferred) return;
      released = true;
      driver.dispose();
    }),
  };
  const owned: AssetModule.ThreeAssetPack = {
    create: vi.fn(() => rig),
    clipDuration: () => undefined,
    clipNames: () => [],
    rootPolicy: () => undefined,
    dispose: vi.fn(() => {
      closed = true;
    }),
    ...(!options.absent
      ? {
          recoveryCapability: RECOVERY_FRAME_CAPABILITY,
          stageActor: vi.fn(function (this: AssetModule.ThreeAssetPack) {
            expect(this).toBe(owned);
            if (closed) throw Error('underlying pack closed');
            return handle;
          }),
        }
      : {}),
  };
  vi.spyOn(AssetModule, 'createPinnedDerivedThreeAssetPack').mockImplementation(
    async () => {
      if (options.lateAbort) controller.abort();
      return owned;
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          new Uint8Array(
            url.endsWith('.glb')
              ? ANDROID_DERIVED_PACK_V1.bytes
              : ANDROID_RUNTIME_ARTIFACT_V1.bytes,
          ),
        ),
    ),
  );
  const loading = prepareAndroidVisualAssets({
    appBase: 'https://example.test/',
    signal: controller.signal,
    rootPolicies: [],
  });
  return { loading, owned, handle, driver, rig, token, controller };
}

test('recovery forwarding preserves capability, receiver, handle and token identity', async () => {
  const f = await forwardingFixture();
  const pack = await f.loading;
  expect(pack.recoveryCapability).toBe(f.owned.recoveryCapability);
  expect(f.owned.create).not.toHaveBeenCalled();
  const handle = pack.stageActor!('blue');
  expect(handle).toBe(f.handle);
  expect(f.owned.stageActor).toHaveBeenCalledExactlyOnceWith('blue');
  const request = {} as Parameters<typeof handle.poseFrame.prepare>[0];
  const token = handle.poseFrame.prepare(request);
  expect(token).toBe(f.token);
  expect(f.driver.prepare).toHaveBeenCalledExactlyOnceWith(request);
  const rig = handle.materialize();
  expect(rig).toBe(f.rig);
  rig.poseFrame!.apply(token);
  expect(f.driver.apply).toHaveBeenCalledExactlyOnceWith(token);
  rig.dispose();
  pack.dispose();
});
test('recovery forwarding absent optional methods leaves default creation unchanged', async () => {
  const f = await forwardingFixture({ absent: true });
  const pack = await f.loading;
  expect('stageActor' in pack).toBe(false);
  expect('recoveryCapability' in pack).toBe(false);
  expect(f.owned.create).not.toHaveBeenCalled();
  expect(pack.create('white')).toBe(f.rig);
  f.rig.dispose();
  pack.dispose();
  expect(f.owned.dispose).toHaveBeenCalledTimes(1);
});
test('recovery forwarding abandoned stage retains underlying disposal ownership', async () => {
  const f = await forwardingFixture();
  const pack = await f.loading;
  const handle = pack.stageActor!('white');
  handle.dispose();
  handle.dispose();
  expect(f.driver.dispose).toHaveBeenCalledTimes(1);
  expect(f.rig.dispose).not.toHaveBeenCalled();
  expect(f.owned.dispose).not.toHaveBeenCalled();
  pack.dispose();
});
test('recovery forwarding pack close does not dispose transferred actor or live stage', async () => {
  const f = await forwardingFixture();
  const pack = await f.loading;
  const handle = pack.stageActor!('white');
  const rig = handle.materialize();
  handle.dispose();
  expect(f.driver.dispose).not.toHaveBeenCalled();
  pack.dispose();
  expect(f.driver.dispose).not.toHaveBeenCalled();
  expect(() => pack.stageActor!('blue')).toThrow('underlying pack closed');
  expect(() => handle.materialize()).toThrow('underlying pack closed');
  rig.dispose();
  expect(f.driver.dispose).toHaveBeenCalledTimes(1);
});
test('recovery forwarding stage rejection preserves the underlying error', async () => {
  const f = await forwardingFixture();
  const error = Error('stage admission');
  vi.mocked(f.owned.stageActor!).mockImplementation(() => {
    throw error;
  });
  const pack = await f.loading;
  expect(() => pack.stageActor!('white')).toThrow(error);
  expect(f.owned.create).not.toHaveBeenCalled();
  expect(f.driver.dispose).not.toHaveBeenCalled();
  pack.dispose();
});
test('recovery forwarding late abort releases pack without staging or returning capabilities', async () => {
  const f = await forwardingFixture({ lateAbort: true });
  await expect(f.loading).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.owned.dispose).toHaveBeenCalledTimes(1);
  expect(f.owned.stageActor).not.toHaveBeenCalled();
  expect(f.owned.create).not.toHaveBeenCalled();
});

test('recovery forwarding close keeps a live unmaterialized stage owned until its release', async () => {
  const f = await forwardingFixture();
  const pack = await f.loading;
  const handle = pack.stageActor!('white');
  pack.dispose();
  expect(f.driver.dispose).not.toHaveBeenCalled();
  // The wrapper must not replace the underlying stage's post-close contract.
  const request = {} as Parameters<typeof handle.poseFrame.prepare>[0];
  expect(handle.poseFrame.prepare(request)).toBe(f.token);
  expect(() => handle.materialize()).toThrow('underlying pack closed');
  handle.dispose();
  handle.dispose();
  expect(f.driver.dispose).toHaveBeenCalledTimes(1);
  expect(f.rig.dispose).not.toHaveBeenCalled();
});
