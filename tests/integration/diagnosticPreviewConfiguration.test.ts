// @vitest-environment jsdom
// Synthetic structural evidence only, never accepted attack geometry.
import { webcrypto, createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { clipId, durationMs } from '../../src/contracts';
import type {
  InventoryMotion,
  CatalogDiagnosticInput,
} from '../../src/qualification/catalogAdmission';
import {
  validatePreviewEnvelope,
  createDiagnosticPreviewConfiguration,
  PREVIEW_NOTICE,
  PREVIEW_MOVES,
} from '../../src/app/diagnosticPreviewConfiguration';
vi.stubGlobal('crypto', webcrypto);
const inventory: readonly InventoryMotion[] = [
  {
    clipId: 'Jab',
    category: 'punch',
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
    clipPointer: '/clips/0',
    eventPointers: ['/clips/0/attack_and_timeline_events/strike_events/0'],
  },
  {
    clipId: 'Cross',
    category: 'punch',
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
    clipPointer: '/clips/1',
    eventPointers: ['/clips/1/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'Hook',
    category: 'punch',
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
    clipPointer: '/clips/2',
    eventPointers: ['/clips/2/attack_and_timeline_events/events/2'],
  },
  {
    clipId: 'Uppercut',
    category: 'punch',
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
    clipPointer: '/clips/3',
    eventPointers: ['/clips/3/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'PunchCombo4',
    category: 'punch',
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
    clipPointer: '/clips/4',
    eventPointers: [
      '/clips/4/attack_and_timeline_events/attack_events/0',
      '/clips/4/attack_and_timeline_events/attack_events/1',
      '/clips/4/attack_and_timeline_events/attack_events/2',
      '/clips/4/attack_and_timeline_events/attack_events/3',
    ],
  },
  {
    clipId: 'FlippingSlash',
    category: 'punch',
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
    clipPointer: '/clips/5',
    eventPointers: ['/clips/5/attack_and_timeline_events/strikes/0'],
  },
  {
    clipId: 'DivingLunge',
    category: 'punch',
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
    clipPointer: '/clips/6',
    eventPointers: ['/clips/6/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'KungFuStraight',
    category: 'punch',
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
    clipPointer: '/clips/8',
    eventPointers: ['/clips/8/attack_and_timeline_events/strike_events/0'],
  },
  {
    clipId: 'PalmStrike',
    category: 'punch',
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
    clipPointer: '/clips/9',
    eventPointers: ['/clips/9/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'WhippingStrike',
    category: 'punch',
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
    clipPointer: '/clips/10',
    eventPointers: ['/clips/10/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'ElbowStrike',
    category: 'punch',
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
    clipPointer: '/clips/11',
    eventPointers: ['/clips/11/attack_and_timeline_events/events/2'],
  },
  {
    clipId: 'KungFuHandCombo5',
    category: 'punch',
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
    clipPointer: '/clips/12',
    eventPointers: [
      '/clips/12/attack_and_timeline_events/attack_events/0',
      '/clips/12/attack_and_timeline_events/attack_events/1',
      '/clips/12/attack_and_timeline_events/attack_events/2',
      '/clips/12/attack_and_timeline_events/attack_events/3',
      '/clips/12/attack_and_timeline_events/attack_events/4',
    ],
  },
  {
    clipId: 'FrontKick',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/0',
    eventPointers: ['/clips/0/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'SideKick',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/1',
    eventPointers: ['/clips/1/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'RoundhouseKick',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/2',
    eventPointers: ['/clips/2/attack_and_timeline_events/strikes/0'],
  },
  {
    clipId: 'LowSweep',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/3',
    eventPointers: ['/clips/3/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'KickCombo4',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/4',
    eventPointers: [
      '/clips/4/attack_and_timeline_events/attack_events/0',
      '/clips/4/attack_and_timeline_events/attack_events/1',
      '/clips/4/attack_and_timeline_events/attack_events/2',
      '/clips/4/attack_and_timeline_events/attack_events/3',
    ],
  },
  {
    clipId: 'SpinningAttack',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/5',
    eventPointers: ['/clips/5/attack_and_timeline_events/strikes/0'],
  },
  {
    clipId: 'AerialKnee',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/6',
    eventPointers: ['/clips/6/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'CartwheelKick',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/7',
    eventPointers: ['/clips/7/attack_and_timeline_events/strikes/0'],
  },
  {
    clipId: 'FrontThrustKick',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/8',
    eventPointers: ['/clips/8/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'SideThrustKick',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/9',
    eventPointers: ['/clips/9/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'OutsideCrescentKick',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/10',
    eventPointers: ['/clips/10/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'KungFuSweep',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/11',
    eventPointers: ['/clips/11/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'KungFuKickChain4',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/12',
    eventPointers: [
      '/clips/12/attack_and_timeline_events/attack_events/0',
      '/clips/12/attack_and_timeline_events/attack_events/1',
      '/clips/12/attack_and_timeline_events/attack_events/2',
      '/clips/12/attack_and_timeline_events/attack_events/3',
    ],
  },
  {
    clipId: 'TornadoKick',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/13',
    eventPointers: ['/clips/13/attack_and_timeline_events/strikes/0'],
  },
  {
    clipId: 'FlyingKick',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/14',
    eventPointers: ['/clips/14/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'ButterflyKick',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/15',
    eventPointers: [
      '/clips/15/attack_and_timeline_events/strikes/0',
      '/clips/15/attack_and_timeline_events/strikes/1',
    ],
  },
  {
    clipId: 'ChineseCartwheelKick',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/16',
    eventPointers: ['/clips/16/attack_and_timeline_events/strikes/0'],
  },
  {
    clipId: 'ChineseAerialKnee',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/17',
    eventPointers: ['/clips/17/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'KungFuAcrobaticCombo',
    category: 'kick',
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
    clipPointer: '/clips/18',
    eventPointers: [
      '/clips/18/attack_and_timeline_events/attacks/0',
      '/clips/18/attack_and_timeline_events/attacks/1',
      '/clips/18/attack_and_timeline_events/attacks/2',
    ],
  },
];
function fixture(): CatalogDiagnosticInput {
  const policies = inventory.map((row) => ({
    version: 1 as const,
    clipId: clipId(row.clipId),
    sourceSha256: row.sourceSha256,
    mode: 'full-translation' as const,
    provenance: {
      manifestSha256: row.manifestSha256,
      clipPointer: row.clipPointer,
      supportPointer: `${row.clipPointer}/support_contacts`,
    },
  }));
  const candidates = inventory.map((row, i) => ({
    rootPolicy: policies[i]!,
    events: row.eventPointers.map((pointer, impactIndex) => ({
      sourceSha256: row.sourceSha256,
      manifestSha256: row.manifestSha256,
      clipId: row.clipId,
      pointer,
      impactIndex,
    })),
    asset: {
      definition: {
        clipId: clipId(row.clipId),
        category: row.category,
        durationMs: durationMs(100),
        effectiveRangeM: 1,
        impacts: row.eventPointers.map((_, impactIndex) => ({
          impactIndex,
          startMs: durationMs(10),
          endMs: durationMs(20),
          damageShare: 1 / row.eventPointers.length,
          shapeId: 'test-only',
        })),
        rootCurve: [
          {
            atMs: durationMs(0),
            position: { x: 0, y: 0, z: 0 },
            visualYawRad: 0,
          },
          {
            atMs: durationMs(100),
            position: { x: 0, y: 0, z: 0 },
            visualYawRad: 0,
          },
        ],
        sampling: {
          version: 1 as const,
          sampleRateHz: 45,
          interpolation: 'piecewise-linear' as const,
        },
      },
      shapes: [
        {
          shapeId: 'test-only',
          keys: [0, 100].map((atMs) => ({
            atMs: durationMs(atMs),
            volume: {
              kind: 'sphere' as const,
              center: { x: 0, y: 0, z: 0 },
              radiusM: 0.1,
            },
          })),
        },
      ],
      ownership: [
        {
          atMs: durationMs(0),
          horizontalOwner: 'authored-root' as const,
          verticalOwner: 'authored-root' as const,
        },
      ],
    },
  }));
  const punches = inventory
    .filter((r) => r.category === 'punch')
    .map((r) => clipId(r.clipId));
  const kicks = inventory
    .filter((r) => r.category === 'kick')
    .map((r) => clipId(r.clipId));
  const normal = { punches: punches.slice(0, 4), kicks: kicks.slice(0, 4) };
  return {
    inventory: structuredClone(inventory),
    candidates,
    visualRootPolicies: structuredClone(policies),
    moves: {
      white: { punches, kicks },
      black: { punches: [], kicks },
      blue: normal,
      green: normal,
      yellow: normal,
    },
    normalAssignments: { blue: normal, green: normal, yellow: normal },
  };
}

function envelope() {
  const f = fixture();
  return {
    schemaVersion: 1,
    status: 'diagnostic-device-preview',
    acceptance: null,
    inventory: f.inventory,
    candidates: f.candidates.map((c) => ({
      ...c,
      qualification: { acceptance: null },
      origin: { sha256: 'a'.repeat(64), pointer: '/results/0' },
    })),
  };
}
function encoded(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    bytes,
    pin: {
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}
test('complete synthetic 31/47 envelope remains unaccepted and uses provisional fixed moves', async () => {
  const x = encoded(envelope());
  const rows = await validatePreviewEnvelope(x.bytes, x.pin);
  expect(rows).toHaveLength(31);
  expect(rows.reduce((n, r) => n + r.asset.definition.impacts.length, 0)).toBe(
    47,
  );
  expect(
    PREVIEW_MOVES.white.punches.length + PREVIEW_MOVES.white.kicks.length,
  ).toBe(31);
  expect(PREVIEW_MOVES.black.kicks).toHaveLength(19);
  expect(PREVIEW_NOTICE).toContain('未受入');
});
test('missing byte pin fails closed', async () => {
  await expect(
    validatePreviewEnvelope(encoded(envelope()).bytes, null),
  ).rejects.toThrow(/pin/);
});
test('modified bytes fail before JSON parsing', async () => {
  const x = encoded(envelope());
  x.bytes[0] = 32;
  await expect(validatePreviewEnvelope(x.bytes, x.pin)).rejects.toThrow(/hash/);
});
test.each(['missing', 'events', 'accepted', 'origin', 'root'] as const)(
  'rejects %s envelope',
  async (kind) => {
    const x = envelope();
    if (kind === 'missing') x.candidates.pop();
    if (kind === 'events') x.candidates[0]!.events = [];
    if (kind === 'accepted') Object.assign(x, { acceptance: true });
    if (kind === 'origin') x.candidates[0]!.origin.sha256 = 'bad';
    if (kind === 'root')
      Object.assign(x.candidates[0]!.rootPolicy!, {
        sourceSha256: 'b'.repeat(64),
      });
    const e = encoded(x);
    await expect(validatePreviewEnvelope(e.bytes, e.pin)).rejects.toThrow();
  },
);
test('fetch failure never calls visual loader', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 });
  const visuals = vi.fn();
  const config = createDiagnosticPreviewConfiguration(encoded(envelope()).pin, {
    fetch: fetcher,
    loadVisuals: visuals,
  });
  await expect(
    config.loadAssets({} as never, new AbortController().signal),
  ).rejects.toThrow('Preview asset unavailable: 404');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(visuals).not.toHaveBeenCalled();
});
function visualPack(duration = 100) {
  const e = envelope();
  const dispose = vi.fn();
  return {
    dispose,
    poseBindings: {
      version: 1,
      bindingSetId: 'synthetic-preview-bindings',
      locomotion: {
        idle: 'Idle',
        walk: 'Walk',
        run: 'Run',
        jump: 'Jump',
        crouch: 'CrouchMove',
      },
      clips: [
        'Idle',
        'Walk',
        'Run',
        'Jump',
        'CrouchMove',
        ...e.candidates.map((c) => c.asset.definition.clipId),
      ].map((name) => ({
        clipId: name,
        durationMs: duration,
        sourceBindingId: `synthetic-${name}`,
      })),
    },
    rootPolicy: (id: string) =>
      e.candidates.find((c) => c.asset.definition.clipId === id)?.rootPolicy,
    clipDuration: (id: string) => (id.startsWith('Defeat') ? 500 : duration),
    create: vi.fn(),
    clipNames: () => [],
  } as unknown as import('../../src/assets/threeAssetPack').ThreeAssetPack;
}
function loader(bytes: Uint8Array) {
  return vi.fn().mockImplementation(async () => ({
    ok: true,
    arrayBuffer: async () => bytes.slice().buffer,
  }));
}
test('full synthetic envelope reaches real structural bundle helper', async () => {
  const x = encoded(envelope());
  const pack = visualPack();
  const config = createDiagnosticPreviewConfiguration(x.pin, {
    fetch: loader(x.bytes),
    loadVisuals: async () => pack,
  });
  const result = await config.loadAssets(
    {} as never,
    new AbortController().signal,
  );
  expect(result.motions).toHaveLength(31);
  result.animator.dispose();
  result.animator.dispose();
  expect(pack.dispose).toHaveBeenCalledTimes(1);
});
test('visual duration mismatch disposes acquired pack once', async () => {
  const x = encoded(envelope());
  const pack = visualPack(101);
  const config = createDiagnosticPreviewConfiguration(x.pin, {
    fetch: loader(x.bytes),
    loadVisuals: async () => pack,
  });
  await expect(
    config.loadAssets({} as never, new AbortController().signal),
  ).rejects.toThrow(/duration mismatch/);
  expect(pack.dispose).toHaveBeenCalledTimes(1);
});
test('root mismatch disposes acquired pack once', async () => {
  const x = encoded(envelope());
  const pack = visualPack();
  Object.assign(pack, { rootPolicy: () => undefined });
  const config = createDiagnosticPreviewConfiguration(x.pin, {
    fetch: loader(x.bytes),
    loadVisuals: async () => pack,
  });
  await expect(
    config.loadAssets({} as never, new AbortController().signal),
  ).rejects.toThrow();
  expect(pack.dispose).toHaveBeenCalledTimes(1);
});
test('aborted old load disposes its late pack and preserves a fresh load', async () => {
  const x = encoded(envelope());
  const old = visualPack(),
    fresh = visualPack();
  let resolve!: (p: typeof old) => void;
  let started!: () => void;
  const began = new Promise<void>((r) => (started = r));
  const pendingPack = new Promise<typeof old>((r) => (resolve = r));
  let calls = 0;
  const config = createDiagnosticPreviewConfiguration(x.pin, {
    fetch: loader(x.bytes),
    loadVisuals: async () => {
      if (calls++ === 0) {
        started();
        return pendingPack;
      }
      return fresh;
    },
  });
  const abort = new AbortController();
  const pending = config.loadAssets({} as never, abort.signal);
  await began;
  abort.abort();
  const next = await config.loadAssets(
    {} as never,
    new AbortController().signal,
  );
  resolve(old);
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(old.dispose).toHaveBeenCalledTimes(1);
  expect(fresh.dispose).not.toHaveBeenCalled();
  next.animator.dispose();
  expect(fresh.dispose).toHaveBeenCalledTimes(1);
});
test('already aborted run never fetches', async () => {
  const x = encoded(envelope());
  const fetcher = loader(x.bytes);
  const config = createDiagnosticPreviewConfiguration(x.pin, {
    fetch: fetcher,
  });
  const abort = new AbortController();
  abort.abort();
  await expect(
    config.loadAssets({} as never, abort.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).not.toHaveBeenCalled();
});
const mounted = vi.hoisted(() =>
  vi.fn((_root: HTMLElement, _options: unknown) => ({ dispose: vi.fn() })),
);
vi.mock('../../src/app/mountApplication', () => ({
  mountApplication: mounted,
}));
test.each([
  ['', false],
  ['0', false],
  ['1', true],
])(
  'main flag %s selects diagnostic configuration only explicitly',
  async (flag, enabled) => {
    vi.resetModules();
    vi.stubEnv('VITE_DIAGNOSTIC_PREVIEW', flag);
    document.body.innerHTML = '<main id="app"></main>';
    mounted.mockClear();
    await import('../../src/main');
    const options = mounted.mock.calls[0]?.[1] as unknown as {
      configuration?: unknown;
      posePolicy?: unknown;
    };
    expect(Boolean(options.configuration)).toBe(enabled);
    expect(options.posePolicy).toEqual(
      enabled ? { version: 1, mode: 'deterministic-pose-v1' } : undefined,
    );
    vi.unstubAllEnvs();
  },
);
test('byte length mismatch fails before decode', async () => {
  const x = encoded(envelope());
  await expect(
    validatePreviewEnvelope(x.bytes, { ...x.pin, bytes: x.pin.bytes + 1 }),
  ).rejects.toThrow('Preview catalog byte mismatch');
});
test('per-candidate acceptance cannot silently become approved', async () => {
  const e = envelope();
  Object.assign(e.candidates[0]!.qualification, { acceptance: true });
  const x = encoded(e);
  await expect(validatePreviewEnvelope(x.bytes, x.pin)).rejects.toThrow(
    'Invalid preview provenance/qualification',
  );
});
test('caller byte and pin mutation across digest cannot change captured envelope', async () => {
  const x = encoded(envelope());
  const pending = validatePreviewEnvelope(x.bytes, x.pin);
  x.bytes.fill(0);
  x.pin.sha256 = 'b'.repeat(64);
  x.pin.bytes = 1;
  expect(await pending).toHaveLength(31);
});

test('diagnostic preview starts a four-battle stage without street durability targets', () => {
  const config = createDiagnosticPreviewConfiguration();
  expect(config.layout?.battleStage?.mode).toBe('four-battle');
  expect(config.layout?.actorSpawns.white).toEqual({ x: 0, y: 0, z: -1.4 });
  expect(config.layout?.actorSpawns.blue).toEqual({ x: 0, y: 0, z: 1.4 });
  expect(config.world).toEqual({ vehicles: [], objects: [] });
  expect(config.layout?.vehicles).toEqual([]);
  expect(config.layout?.objects).toEqual([]);
});

test('diagnostic preview explicitly requires crouch CrouchMove and retains its optional binding', async () => {
  const x = encoded(envelope());
  const pack = visualPack();
  const config = createDiagnosticPreviewConfiguration(x.pin, {
    fetch: loader(x.bytes),
    loadVisuals: async () => pack,
  });
  const result = await config.loadAssets(
    {} as never,
    new AbortController().signal,
  );
  expect(result.animator.locomotionClips.crouch).toBe('CrouchMove');
  expect(result.animator.poseBindings?.locomotion.crouch).toBe('CrouchMove');
  result.animator.dispose();
});

test.each(['clip', 'binding'] as const)(
  'diagnostic preview rejects unavailable crouch %s before readiness',
  async (kind) => {
    const x = encoded(envelope());
    const pack = visualPack();
    if (kind === 'clip')
      Object.assign(pack, {
        clipDuration: (id: string) =>
          id === 'CrouchMove'
            ? undefined
            : durationMs(id.startsWith('Defeat') ? 500 : 100),
      });
    else Object.assign(pack, { poseBindings: undefined });
    const config = createDiagnosticPreviewConfiguration(x.pin, {
      fetch: loader(x.bytes),
      loadVisuals: async () => pack,
    });
    await expect(
      config.loadAssets({} as never, new AbortController().signal),
    ).rejects.toThrow(/Crouch|crouch/);
    expect(pack.dispose).toHaveBeenCalledTimes(1);
  },
);
