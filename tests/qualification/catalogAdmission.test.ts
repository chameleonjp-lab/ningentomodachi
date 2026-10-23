import { expect, test } from 'vitest';
import { clipId, durationMs } from '../../src/contracts';
import {
  type CatalogDiagnosticInput,
  diagnoseCatalog,
  type InventoryMotion,
} from '../../src/qualification/catalogAdmission';

// Source inventory identities only. All motion geometry below is synthetic test data, never production.
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
      shapes: [],
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
function altered(edit: (input: ReturnType<typeof mutable>) => void) {
  const input = mutable();
  edit(input);
  return diagnoseCatalog(input);
}
function mutable() {
  return structuredClone(fixture()) as Mutable<CatalogDiagnosticInput>;
}
type Mutable<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer U)[]
    ? Mutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Mutable<T[K]> }
      : T;
function issue(report: ReturnType<typeof diagnoseCatalog>, expected: string) {
  expect(report.issues).toContain(expected);
  expect(report.qualification).toBe('not-evaluated');
}

test('complete synthetic metadata is only consistent, never qualified or returned as assets', () => {
  const input = fixture(),
    before = structuredClone(input),
    report = diagnoseCatalog(input);
  expect(report).toEqual({ qualification: 'not-evaluated', issues: [] });
  expect(Object.isFrozen(report)).toBe(true);
  expect(Object.isFrozen(report.issues)).toBe(true);
  expect(input).toEqual(before);
  expect(Object.isFrozen(input)).toBe(false);
});
test('missing motion is identified even with otherwise valid inputs', () =>
  issue(
    altered((x) => {
      x.candidates.pop();
    }),
    'candidate:KungFuAcrobaticCombo:coverage',
  ));
test('equal count synthetic substitution cannot replace original motion', () =>
  issue(
    altered((x) => {
      x.candidates[0]!.asset.definition.clipId = clipId('SyntheticJab');
    }),
    'candidate:Jab:coverage',
  ));
test('excluded AcrobaticCombo is not eligible', () =>
  issue(
    altered((x) => {
      x.candidates[0]!.asset.definition.clipId = clipId('AcrobaticCombo');
    }),
    'candidate:AcrobaticCombo:unexpected',
  ));
test('duplicate candidate does not fill missing identity', () =>
  issue(
    altered((x) => {
      x.candidates[1] = structuredClone(x.candidates[0]!);
    }),
    'candidate:Jab:coverage',
  ));
test('baseline itself requires original inventory identities', () =>
  issue(
    altered((x) => {
      x.inventory[0]!.clipId = 'SyntheticJab';
    }),
    'inventory:Jab:identity',
  ));
test('wrong source pin is a comparison failure, not an authentication verdict', () =>
  issue(
    altered((x) => {
      x.inventory[0]!.sourceSha256 = '0'.repeat(64);
      x.candidates[0]!.rootPolicy!.sourceSha256 = '0'.repeat(64);
    }),
    'inventory:Jab:identity',
  ));
test('heterogeneous source event pointer cannot be replaced by generic attack_events', () =>
  issue(
    altered((x) => {
      x.inventory[2]!.eventPointers[0] =
        '/clips/2/attack_and_timeline_events/attack_events/0';
    }),
    'inventory:Hook:identity',
  ));
test('duplicate source event cannot cover two impacts', () =>
  issue(
    altered((x) => {
      x.candidates[4]!.events[1]!.pointer = x.candidates[4]!.events[0]!.pointer;
    }),
    'events:PunchCombo4:bijection',
  ));
test('each actual impact index must be covered exactly once', () =>
  issue(
    altered((x) => {
      x.candidates[4]!.events[1]!.impactIndex = 0;
    }),
    'events:PunchCombo4:bijection',
  ));
test('event identity includes clip source and manifest, not pointer alone', () =>
  issue(
    altered((x) => {
      x.candidates[0]!.events[0]!.manifestSha256 =
        x.inventory[12]!.manifestSha256;
    }),
    'events:Jab:provenance',
  ));
test('missing event mapping stays missing rather than inferred', () =>
  issue(
    altered((x) => {
      x.candidates[0]!.events = [];
    }),
    'events:Jab:bijection',
  ));
test('existing motion metadata validation is reused', () =>
  issue(
    altered((x) => {
      x.candidates[0]!.asset.definition.effectiveRangeM = 0;
    }),
    'definition:Jab:effectiveRangeM',
  ));
test('missing explicit root policy is not legacy permission', () =>
  issue(
    altered((x) => {
      delete x.candidates[0]!.rootPolicy;
    }),
    'root:Jab:missing',
  ));
test('visual policy mismatch remains a root error', () =>
  issue(
    altered((x) => {
      x.visualRootPolicies[0]!.mode = 'grounded-posture-y';
      expect(x.candidates[0]!.rootPolicy!.mode).toBe('full-translation');
    }),
    'root:Jab:compatibility',
  ));
test('duplicate visual policy is not silently selected', () =>
  issue(
    altered((x) => {
      x.visualRootPolicies.push(structuredClone(x.visualRootPolicies[0]!));
    }),
    'visual:Jab:coverage',
  ));
test('root provenance matches supplied original inventory', () =>
  issue(
    altered((x) => {
      x.candidates[0]!.rootPolicy!.provenance.clipPointer = '/clips/1';
    }),
    'root:Jab:provenance',
  ));
test('grounded policy cannot retain authored vertical ownership', () =>
  issue(
    altered((x) => {
      x.candidates[0]!.rootPolicy!.mode = 'grounded-posture-y';
      x.visualRootPolicies[0]!.mode = 'grounded-posture-y';
    }),
    'root:Jab:compatibility',
  ));
test('in-place policy cannot retain extracted translation', () =>
  issue(
    altered((x) => {
      x.candidates[0]!.rootPolicy!.mode = 'in-place-posture-xyz';
      x.visualRootPolicies[0]!.mode = 'in-place-posture-xyz';
      x.candidates[0]!.asset.ownership[0]!.verticalOwner = 'spatial-jump';
      x.candidates[0]!.asset.definition.rootCurve[1]!.position.x = 1;
    }),
    'root:Jab:compatibility',
  ));
test('white must retain all12 punches despite weaker Core minimum', () =>
  issue(
    altered((x) => {
      x.moves.white.punches.pop();
    }),
    'moves:white:membership',
  ));
test('black has no punches and all19 kicks', () =>
  issue(
    altered((x) => {
      x.moves.black.punches.push(clipId('Jab'));
    }),
    'moves:black:membership',
  ));
test('normal duplicate or wrong-category moves are rejected', () =>
  issue(
    altered((x) => {
      x.moves.blue.punches[0] = clipId('FrontKick');
    }),
    'moves:blue:membership',
  ));
test('normal fixed assignments are not invented when absent', () =>
  issue(
    altered((x) => {
      delete x.normalAssignments;
    }),
    'assignments:missing',
  ));
test('valid normal alternatives must still match supplied fixed assignments', () =>
  issue(
    altered((x) => {
      x.moves.blue = structuredClone(x.moves.blue);
      x.moves.blue.punches[0] = clipId('PalmStrike');
    }),
    'moves:blue:assignment',
  ));
test('diagnostics are invariant under inventory candidate and mapping order', () => {
  const x = mutable();
  x.candidates[0]!.events = [];
  x.moves.white.punches.pop();
  const first = diagnoseCatalog(x);
  x.inventory.reverse();
  x.candidates.reverse();
  x.visualRootPolicies.reverse();
  for (const c of x.candidates) c.events.reverse();
  expect(diagnoseCatalog(x)).toEqual(first);
});
test('jointly changed synthetic geometry remains outside authenticity and shape coverage claims', () => {
  const x = mutable();
  x.candidates[0]!.asset.shapes = [];
  x.candidates[0]!.asset.definition.effectiveRangeM = 2;
  expect(diagnoseCatalog(x)).toEqual({
    qualification: 'not-evaluated',
    issues: [],
  });
});

test('conflicting duplicate inventory rows produce identical dependent diagnostics in either order', () => {
  const input = mutable();
  const duplicate = structuredClone(input.inventory[0]!);
  duplicate.sourceSha256 = '0'.repeat(64);
  duplicate.eventPointers = [
    '/clips/0/attack_and_timeline_events/attack_events/99',
  ];
  input.inventory.push(duplicate);
  const first = diagnoseCatalog(input);
  expect(first.issues).toContain('inventory:Jab:identity');
  input.inventory.reverse();
  expect(diagnoseCatalog(input)).toEqual(first);
});
