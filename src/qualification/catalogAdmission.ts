import type { MotionAsset } from '../assets/motionCatalog';
import {
  assertRootPolicyCompatibility,
  type ClipRootPolicy,
  copyRootPolicy,
} from '../assets/rootPolicy';
import {
  type ActorColor,
  type AttackCategory,
  type MoveSet,
  validateMotionDefinition,
} from '../contracts';

/** Caller-supplied metadata, not authenticated source bytes or qualification evidence. */
export interface InventoryMotion {
  readonly clipId: string;
  readonly category: AttackCategory;
  readonly sourceSha256: string;
  readonly manifestSha256: string;
  readonly clipPointer: string;
  readonly eventPointers: readonly string[];
}
export interface CatalogCandidate {
  readonly asset: MotionAsset;
  readonly rootPolicy?: ClipRootPolicy;
  readonly events: readonly {
    readonly sourceSha256: string;
    readonly manifestSha256: string;
    readonly clipId: string;
    readonly pointer: string;
    readonly impactIndex: number;
  }[];
}
export interface CatalogDiagnosticInput {
  readonly inventory: readonly InventoryMotion[];
  readonly candidates: readonly CatalogCandidate[];
  readonly visualRootPolicies: readonly ClipRootPolicy[];
  readonly moves: Readonly<Record<ActorColor, MoveSet>>;
  readonly normalAssignments?: Readonly<
    Record<'blue' | 'green' | 'yellow', MoveSet>
  >;
}
export interface CatalogDiagnosticReport {
  readonly qualification: 'not-evaluated';
  readonly issues: readonly string[];
}
// Original completed42-speed15 source inventory, excluding AcrobaticCombo.
// These are comparison identities, not proof that supplied bytes or metadata are authentic.
const SOURCE_PINS = {
  punch: {
    sourceSha256:
      'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
    manifestSha256:
      'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
  },
  kick: {
    sourceSha256:
      '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
    manifestSha256:
      'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
  },
} as const;
const ORIGINALS: readonly InventoryMotion[] = [
  {
    clipId: 'Jab',
    category: 'punch',
    ...SOURCE_PINS.punch,
    clipPointer: '/clips/0',
    eventPointers: ['/clips/0/attack_and_timeline_events/strike_events/0'],
  },
  {
    clipId: 'Cross',
    category: 'punch',
    ...SOURCE_PINS.punch,
    clipPointer: '/clips/1',
    eventPointers: ['/clips/1/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'Hook',
    category: 'punch',
    ...SOURCE_PINS.punch,
    clipPointer: '/clips/2',
    eventPointers: ['/clips/2/attack_and_timeline_events/events/2'],
  },
  {
    clipId: 'Uppercut',
    category: 'punch',
    ...SOURCE_PINS.punch,
    clipPointer: '/clips/3',
    eventPointers: ['/clips/3/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'PunchCombo4',
    category: 'punch',
    ...SOURCE_PINS.punch,
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
    ...SOURCE_PINS.punch,
    clipPointer: '/clips/5',
    eventPointers: ['/clips/5/attack_and_timeline_events/strikes/0'],
  },
  {
    clipId: 'DivingLunge',
    category: 'punch',
    ...SOURCE_PINS.punch,
    clipPointer: '/clips/6',
    eventPointers: ['/clips/6/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'KungFuStraight',
    category: 'punch',
    ...SOURCE_PINS.punch,
    clipPointer: '/clips/8',
    eventPointers: ['/clips/8/attack_and_timeline_events/strike_events/0'],
  },
  {
    clipId: 'PalmStrike',
    category: 'punch',
    ...SOURCE_PINS.punch,
    clipPointer: '/clips/9',
    eventPointers: ['/clips/9/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'WhippingStrike',
    category: 'punch',
    ...SOURCE_PINS.punch,
    clipPointer: '/clips/10',
    eventPointers: ['/clips/10/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'ElbowStrike',
    category: 'punch',
    ...SOURCE_PINS.punch,
    clipPointer: '/clips/11',
    eventPointers: ['/clips/11/attack_and_timeline_events/events/2'],
  },
  {
    clipId: 'KungFuHandCombo5',
    category: 'punch',
    ...SOURCE_PINS.punch,
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
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/0',
    eventPointers: ['/clips/0/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'SideKick',
    category: 'kick',
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/1',
    eventPointers: ['/clips/1/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'RoundhouseKick',
    category: 'kick',
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/2',
    eventPointers: ['/clips/2/attack_and_timeline_events/strikes/0'],
  },
  {
    clipId: 'LowSweep',
    category: 'kick',
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/3',
    eventPointers: ['/clips/3/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'KickCombo4',
    category: 'kick',
    ...SOURCE_PINS.kick,
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
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/5',
    eventPointers: ['/clips/5/attack_and_timeline_events/strikes/0'],
  },
  {
    clipId: 'AerialKnee',
    category: 'kick',
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/6',
    eventPointers: ['/clips/6/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'CartwheelKick',
    category: 'kick',
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/7',
    eventPointers: ['/clips/7/attack_and_timeline_events/strikes/0'],
  },
  {
    clipId: 'FrontThrustKick',
    category: 'kick',
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/8',
    eventPointers: ['/clips/8/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'SideThrustKick',
    category: 'kick',
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/9',
    eventPointers: ['/clips/9/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'OutsideCrescentKick',
    category: 'kick',
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/10',
    eventPointers: ['/clips/10/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'KungFuSweep',
    category: 'kick',
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/11',
    eventPointers: ['/clips/11/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'KungFuKickChain4',
    category: 'kick',
    ...SOURCE_PINS.kick,
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
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/13',
    eventPointers: ['/clips/13/attack_and_timeline_events/strikes/0'],
  },
  {
    clipId: 'FlyingKick',
    category: 'kick',
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/14',
    eventPointers: ['/clips/14/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'ButterflyKick',
    category: 'kick',
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/15',
    eventPointers: [
      '/clips/15/attack_and_timeline_events/strikes/0',
      '/clips/15/attack_and_timeline_events/strikes/1',
    ],
  },
  {
    clipId: 'ChineseCartwheelKick',
    category: 'kick',
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/16',
    eventPointers: ['/clips/16/attack_and_timeline_events/strikes/0'],
  },
  {
    clipId: 'ChineseAerialKnee',
    category: 'kick',
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/17',
    eventPointers: ['/clips/17/attack_and_timeline_events/attack_events/0'],
  },
  {
    clipId: 'KungFuAcrobaticCombo',
    category: 'kick',
    ...SOURCE_PINS.kick,
    clipPointer: '/clips/18',
    eventPointers: [
      '/clips/18/attack_and_timeline_events/attacks/0',
      '/clips/18/attack_and_timeline_events/attacks/1',
      '/clips/18/attack_and_timeline_events/attacks/2',
    ],
  },
];
function sameSet(
  a: readonly (string | number)[],
  b: readonly (string | number)[],
) {
  return (
    a.length === b.length &&
    new Set(a).size === a.length &&
    new Set(b).size === b.length &&
    a.every((value) => b.includes(value))
  );
}
function sameInventory(a: InventoryMotion, b: InventoryMotion) {
  return (
    a.clipId === b.clipId &&
    a.category === b.category &&
    a.sourceSha256 === b.sourceSha256 &&
    a.manifestSha256 === b.manifestSha256 &&
    a.clipPointer === b.clipPointer &&
    sameSet(a.eventPointers, b.eventPointers)
  );
}
/**
 * Supplied metadata consistency only: no byte decoding, source authentication,
 * scientific qualification, shape-curve coverage or resource loading. Even zero
 * issues conveys no authority to admit assets. Jointly fabricated metadata cannot
 * be identified as authentic or inauthentic by this comparison.
 */
export function diagnoseCatalog(
  input: CatalogDiagnosticInput,
): CatalogDiagnosticReport {
  const issues = new Set<string>();
  const add = (message: string) => {
    issues.add(message);
  };
  const originalIds = ORIGINALS.map((row) => row.clipId);
  for (const row of input.inventory) {
    if (!originalIds.includes(row.clipId))
      add(`inventory:${row.clipId}:unexpected`);
  }
  for (const original of ORIGINALS) {
    const rows = input.inventory.filter(
      (row) => row.clipId === original.clipId,
    );
    if (rows.length !== 1 || !rows[0] || !sameInventory(rows[0], original))
      add(`inventory:${original.clipId}:identity`);
  }
  for (const candidate of input.candidates) {
    if (!originalIds.includes(candidate.asset.definition.clipId))
      add(`candidate:${candidate.asset.definition.clipId}:unexpected`);
  }
  for (const policy of input.visualRootPolicies) {
    if (!originalIds.includes(policy.clipId))
      add(`visual:${policy.clipId}:unexpected`);
  }
  for (const original of ORIGINALS) {
    const id = original.clipId;
    const candidates = input.candidates.filter(
      (row) => row.asset.definition.clipId === id,
    );
    if (candidates.length !== 1) add(`candidate:${id}:coverage`);
    const visuals = input.visualRootPolicies.filter((row) => row.clipId === id);
    if (visuals.length !== 1) add(`visual:${id}:coverage`);
    const baselines = input.inventory.filter((row) => row.clipId === id);
    const baseline = baselines.length === 1 ? baselines[0] : undefined;
    for (const candidate of candidates) {
      const { asset, events } = candidate;
      const definition = asset.definition;
      for (const error of validateMotionDefinition(definition).errors)
        add(`definition:${id}:${error}`);
      if (definition.category !== original.category)
        add(`definition:${id}:category`);
      // Ambiguous/noncanonical input still reports its inventory conflict above.
      // Fall back only to known identity, never invent root policy or qualification.
      const expected =
        baseline && sameInventory(baseline, original) ? baseline : original;
      if (
        events.some(
          (event) =>
            event.clipId !== id ||
            event.sourceSha256 !== expected.sourceSha256 ||
            event.manifestSha256 !== expected.manifestSha256,
        )
      )
        add(`events:${id}:provenance`);
      if (
        !sameSet(
          events.map((event) => event.pointer),
          expected.eventPointers,
        ) ||
        !sameSet(
          events.map((event) => event.impactIndex),
          definition.impacts.map((impact) => impact.impactIndex),
        )
      )
        add(`events:${id}:bijection`);
      const policy = candidate.rootPolicy;
      if (!policy) {
        add(`root:${id}:missing`);
        continue;
      }
      if (
        policy.clipId !== id ||
        policy.sourceSha256 !== expected.sourceSha256 ||
        policy.provenance.manifestSha256 !== expected.manifestSha256 ||
        policy.provenance.clipPointer !== expected.clipPointer
      )
        add(`root:${id}:provenance`);
      try {
        copyRootPolicy(policy);
        assertRootPolicyCompatibility([{ asset, rootPolicy: policy }], {
          rootPolicy: () => (visuals.length === 1 ? visuals[0] : undefined),
        });
      } catch {
        add(`root:${id}:compatibility`);
      }
    }
  }
  const punches = ORIGINALS.filter((row) => row.category === 'punch').map(
    (row) => row.clipId,
  );
  const kicks = ORIGINALS.filter((row) => row.category === 'kick').map(
    (row) => row.clipId,
  );
  const validNormal = (set: MoveSet) =>
    set.punches.length === 4 &&
    set.kicks.length === 4 &&
    new Set(set.punches).size === 4 &&
    new Set(set.kicks).size === 4 &&
    set.punches.every((id) => punches.includes(id)) &&
    set.kicks.every((id) => kicks.includes(id));
  if (
    !sameSet(input.moves.white.punches, punches) ||
    !sameSet(input.moves.white.kicks, kicks)
  )
    add('moves:white:membership');
  if (
    input.moves.black.punches.length !== 0 ||
    !sameSet(input.moves.black.kicks, kicks)
  )
    add('moves:black:membership');
  if (!input.normalAssignments) add('assignments:missing');
  for (const color of ['blue', 'green', 'yellow'] as const) {
    const set = input.moves[color];
    if (!validNormal(set)) add(`moves:${color}:membership`);
    const assignment = input.normalAssignments?.[color];
    if (!assignment) {
      add(`assignments:${color}:missing`);
      continue;
    }
    if (!validNormal(assignment)) add(`assignments:${color}:membership`);
    if (
      !sameSet(set.punches, assignment.punches) ||
      !sameSet(set.kicks, assignment.kicks)
    )
      add(`moves:${color}:assignment`);
  }
  return Object.freeze({
    qualification: 'not-evaluated',
    issues: Object.freeze([...issues].sort()),
  });
}
