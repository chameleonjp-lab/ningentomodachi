import { describe, expect, test } from 'vitest';
import { actorId, clipId, commandId, runId } from '../../src/contracts/ids';
import type { FightingGameplayCommand } from '../../src/contracts/commands';
import {
  FIGHTING_MOVE_SPECS,
  FIGHTING_GROUND_ROUTES,
  type FightingAttackDescriptor,
  type FightingCombatantState,
  type FightingMoveId,
  type FightingPolicy,
} from '../../src/contracts/fighting';
import {
  fightingDamageHp,
  latestCancelDelay,
  normalizeFightingInputs,
  resolveFightingContact,
  resolveFightingMove,
} from '../../src/core/fightingRules';

const run = runId('run'),
  actor = actorId('player');

test('excludedARoutesNeverStartOrRemap', () => {
  for (const route of ['PP', 'K', 'KP'])
    expect(resolveFightingMove('standing', route, 'P')).toBeNull();
  for (const [route, button, move] of [
    ['', 'P', 'p_short'],
    ['P', 'P', 'p_body'],
    ['P', 'K', 'k_low'],
    ['PP', 'K', 'k_turn'],
    ['', 'K', 'k_front'],
    ['K', 'K', 'k_turn'],
  ] as const)
    expect(resolveFightingMove('standing', route, button)).toBe(move);
  for (const [posture, button, move] of [
    ['crouching', 'P', 'c_body'],
    ['crouching', 'K', 'k_low'],
    ['airborne', 'P', 'a_palm'],
    ['airborne', 'K', 'a_kick'],
  ] as const) {
    expect(resolveFightingMove(posture, '', button)).toBe(move);
    for (const route of ['P', 'PP', 'K', 'KP'])
      expect(resolveFightingMove(posture, route, button)).toBeNull();
  }
});
const policy: FightingPolicy = {
  version: 3,
  hpPerNormalizedPoint: 5,
  guardFrontDotMin: 0,
  hitstunPosture: 'retain-contact-posture',
};
function packet(
  sequence: number,
  category: 'punch' | 'kick' = 'punch',
): FightingGameplayCommand {
  return {
    type: 'AttackRequested',
    runId: run,
    actorId: actor,
    category,
    input: { commandId: commandId(`command-${sequence}`), sequence },
  };
}
function target(
  patch: Partial<FightingCombatantState> = {},
): FightingCombatantState {
  return {
    tick: 0,
    phase: 'neutral',
    posture: 'standing',
    moveId: null,
    moveAgeTicks: 0,
    route: '',
    stage: 0,
    buffer: null,
    hitConfirmed: false,
    contactAgeTicks: null,
    stopTicksRemaining: 0,
    stunTicksRemaining: 0,
    guardHeld: false,
    guardHeight: null,
    airAttackUsed: false,
    landingTicksRemaining: 0,
    ...patch,
  };
}
function source(moveId: FightingMoveId = 'p_short'): FightingAttackDescriptor {
  const spec = FIGHTING_MOVE_SPECS[moveId];
  return {
    kind: 'v3',
    moveId,
    stage: 1,
    damage: { kind: 'v3-normalized', value: spec.damageNormalized },
    ...spec,
  };
}

describe('deterministic active A routes and historical robust timing', () => {
  test.each([
    ['', 'P', 'p_short'],
    ['P', 'P', 'p_body'],
    ['PP', 'P', null],
    ['P', 'K', 'k_low'],
    ['PP', 'K', 'k_turn'],
    ['', 'K', 'k_front'],
    ['K', 'K', 'k_turn'],
    ['K', 'P', null],
    ['KP', 'P', null],
  ] as const)(
    '%s + %s selects %s without any random source',
    (route, button, want) => {
      for (const seed of [0, 1, 42, 0xffffffff]) {
        // No seed is an input to this pure selector; repeated calls cannot draw a move.
        for (let repeat = 0; repeat <= seed % 7; repeat++)
          expect(resolveFightingMove('standing', route, button)).toBe(want);
      }
    },
  );
  test('terminal routes never start a fourth or unsupported stage', () => {
    for (const route of [
      'PPP',
      'KPP',
      'PK',
      'PPK',
      'KK',
      'unknown',
      '__proto__',
    ])
      for (const button of ['P', 'K'] as const)
        expect(resolveFightingMove('standing', route, button)).toBeNull();
  });
  test.each([
    ['crouching', 'P', 'c_body'],
    ['crouching', 'K', 'k_low'],
    ['airborne', 'P', 'a_palm'],
    ['airborne', 'K', 'a_kick'],
  ] as const)('%s entry %s is a single role %s', (posture, button, move) => {
    expect(resolveFightingMove(posture, '', button)).toBe(move);
    expect(resolveFightingMove(posture, button, button)).toBeNull();
  });
  test.each([
    ['p_short', 'p_body', 8],
    ['p_short', 'k_low', 3],
    ['p_body', 'p_finish', 8],
    ['p_body', 'k_turn', 3],
    ['k_front', 'k_turn', 5],
    ['k_front', 'p_entry', 7],
    ['p_entry', 'p_finish', 8],
  ] as const)(
    '%s to %s has the accepted robust maximum %i',
    (from, to, want) => {
      expect(
        latestCancelDelay(FIGHTING_MOVE_SPECS[from], FIGHTING_MOVE_SPECS[to]),
      ).toBe(want);
      for (
        let sourceActive = 0;
        sourceActive < FIGHTING_MOVE_SPECS[from].activeTicks;
        sourceActive++
      )
        for (
          let destActive = 0;
          destActive < FIGHTING_MOVE_SPECS[to].activeTicks;
          destActive++
        ) {
          // Relative to actual contact, not the source's first possible active tick.
          const nextContact =
            want + FIGHTING_MOVE_SPECS[to].startupTicks + destActive;
          expect(
            FIGHTING_MOVE_SPECS[from].hitstunTicks - nextContact,
          ).toBeGreaterThanOrEqual(2);
        }
    },
  );
  test('invalid cancel time inputs fail rather than produce NaN or negative windows', () => {
    for (const value of [NaN, Infinity, -1, 1.5])
      expect(() =>
        latestCancelDelay(
          { ...FIGHTING_MOVE_SPECS.p_short, hitstunTicks: value },
          FIGHTING_MOVE_SPECS.p_body,
        ),
      ).toThrow(RangeError);
  });
});

describe('packet normalization owns no persistent duplicate history', () => {
  test('reverse delivery preserves chronological identity and never mutates packets or seen', () => {
    const commands = [packet(3), packet(1, 'kick'), packet(2)];
    const seen = new Set<ReturnType<typeof commandId>>();
    const before = structuredClone(commands);
    const result = normalizeFightingInputs(run, actor, commands, seen);
    expect(result).toEqual({
      edges: [
        {
          runId: run,
          actorId: actor,
          commandId: 'command-1',
          sequence: 1,
          button: 'K',
        },
        {
          runId: run,
          actorId: actor,
          commandId: 'command-2',
          sequence: 2,
          button: 'P',
        },
        {
          runId: run,
          actorId: actor,
          commandId: 'command-3',
          sequence: 3,
          button: 'P',
        },
      ],
      newlySeenCommandIds: ['command-1', 'command-2', 'command-3'],
    });
    expect(
      normalizeFightingInputs(run, actor, [...commands].reverse(), seen),
    ).toEqual(result);
    expect(commands).toEqual(before);
    expect(seen.size).toBe(0);
    expect(Object.isFrozen(result.edges[0])).toBe(true);
  });
  test('nonattack commands retain newly-seen identity but do not become P/K', () => {
    const guard: FightingGameplayCommand = {
      type: 'GuardRequested',
      runId: run,
      actorId: actor,
      active: true,
      input: { commandId: commandId('guard'), sequence: 1 },
    };
    const jump: FightingGameplayCommand = {
      type: 'JumpRequested',
      runId: run,
      actorId: actor,
      input: { commandId: commandId('jump'), sequence: 2 },
    };
    expect(
      normalizeFightingInputs(run, actor, [jump, guard], new Set()),
    ).toEqual({ edges: [], newlySeenCommandIds: ['guard', 'jump'] });
  });
  test('duplicates, seen IDs, foreign actor/run and sequence conflicts are rejected without consuming seen', () => {
    const p = packet(1);
    const seen = new Set([commandId('seen')]);
    const invalid: FightingGameplayCommand[][] = [
      [p, p],
      [
        p,
        { ...packet(2), input: { commandId: p.input.commandId, sequence: 2 } },
      ],
      [{ ...p, input: { commandId: commandId('seen'), sequence: 1 } }],
      [{ ...p, runId: runId('other-run') }],
      [{ ...p, actorId: actorId('other-actor') }],
      [p, { ...p, input: { commandId: commandId('competing'), sequence: 1 } }],
      ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(
        (sequence) => [{ ...p, input: { ...p.input, sequence } }],
      ),
    ];
    for (const batch of invalid)
      expect(() => normalizeFightingInputs(run, actor, batch, seen)).toThrow(
        RangeError,
      );
    expect([...seen]).toEqual(['seen']);
  });
});

describe('contact guard policy and one-time HP conversion', () => {
  test.each([
    ['standing', 'p_short', 'blocked'],
    ['standing', 'p_body', 'blocked'],
    ['standing', 'k_low', 'hit'],
    ['crouching', 'p_short', 'ignored'],
    ['crouching', 'p_body', 'hit'],
    ['crouching', 'k_low', 'blocked'],
    ['airborne', 'p_short', 'hit'],
    ['airborne', 'p_body', 'hit'],
    ['airborne', 'k_low', 'hit'],
  ] as const)(
    '%s guard against %s resolves %s with zero chip',
    (posture, move, want) => {
      const decision = resolveFightingContact(
        source(move),
        target({
          posture,
          guardHeld: true,
          guardHeight: posture === 'airborne' ? null : posture,
        }),
        0,
        policy,
      );
      expect(decision.kind).toBe(want);
      if (decision.kind === 'blocked')
        expect(decision).toEqual({
          kind: 'blocked',
          damageHp: 0,
          blockstunTicks: FIGHTING_MOVE_SPECS[move].blockstunTicks,
          stopTicks: FIGHTING_MOVE_SPECS[move].blockstopTicks,
        });
    },
  );
  test('guard front boundary is inclusive, never covers the rear, and cannot cancel committed actions', () => {
    const guarding = target({ guardHeld: true, guardHeight: 'standing' });
    expect(resolveFightingContact(source(), guarding, 0, policy).kind).toBe(
      'blocked',
    );
    expect(
      resolveFightingContact(source(), guarding, -Number.EPSILON, policy).kind,
    ).toBe('hit');
    for (const phase of [
      'startup',
      'active',
      'recovery',
      'hitstun',
      'landing',
    ] as const)
      expect(
        resolveFightingContact(source(), { ...guarding, phase }, 1, policy)
          .kind,
      ).toBe('hit');
    expect(
      resolveFightingContact(source(), target({ phase: 'defeated' }), 1, policy)
        .kind,
    ).toBe('ignored');
    expect(() =>
      resolveFightingContact(source(), guarding, NaN, policy),
    ).toThrow(RangeError);
  });
  test('blockstun uses the contact guard height even when held posture changes or releases', () => {
    const locked = target({
      phase: 'blockstun',
      posture: 'crouching',
      guardHeight: 'standing',
      guardHeld: false,
      stunTicksRemaining: 1,
    });
    expect(
      resolveFightingContact(source('p_body'), locked, 1, policy).kind,
    ).toBe('blocked');
    expect(
      resolveFightingContact(source('k_low'), locked, 1, policy).kind,
    ).toBe('hit');
  });
  test('legacy HP damage is not remapped to a v3 role, scaled, or multiplied twice', () => {
    const legacy: FightingAttackDescriptor = {
      kind: 'legacy',
      clipId: clipId('source-backed-legacy'),
      impactIndex: 2,
      damage: { kind: 'legacy-hp', value: 37.25 },
      level: 'mid',
      hitstunTicks: 10,
      hitstopTicks: 4,
      blockstunTicks: 6,
      blockstopTicks: 2,
    };
    const decision = resolveFightingContact(legacy, target(), 1, policy);
    expect(decision).toEqual({
      kind: 'hit',
      damage: { kind: 'legacy-hp', value: 37.25 },
      hitstunTicks: 10,
      stopTicks: 4,
    });
    expect(fightingDamageHp(legacy.damage, 3, policy)).toBe(37.25);
    expect(resolveFightingContact(source(), target(), 1, policy)).toEqual({
      kind: 'hit',
      damage: { kind: 'v3-normalized', value: 10 },
      hitstunTicks: 18,
      stopTicks: 6,
    });
  });
  test.each([
    ['P', 10],
    ['PP', 19.6],
    ['PPP', 31.3],
    ['PPK', 35.2],
    ['KPP', 43.7],
  ] as const)(
    'historical %s retains normalized damage %f without granting active selection',
    (route, want) => {
      let prefix = '',
        total = 0,
        stage = 0;
      for (const button of route) {
        const move =
          FIGHTING_GROUND_ROUTES[
            (prefix + button) as keyof typeof FIGHTING_GROUND_ROUTES
          ];
        if (!move) throw new Error('Invalid test route');
        stage++;
        total += fightingDamageHp(
          {
            kind: 'v3-normalized',
            value: FIGHTING_MOVE_SPECS[move].damageNormalized,
          },
          stage as 1 | 2 | 3,
          { ...policy, hpPerNormalizedPoint: 1 },
        );
        prefix += button;
      }
      expect(total).toBeCloseTo(want, 12);
      // A fixed five HP/point is independent of a target's 500 versus 700 maximum HP.
      expect(total * 5).toBeCloseTo(want * 5, 12);
    },
  );
  test('HP conversion rejects an invalid explicit policy, damage, or stage', () => {
    for (const hpPerNormalizedPoint of [0, -1, NaN, Infinity])
      expect(() =>
        fightingDamageHp({ kind: 'v3-normalized', value: 10 }, 1, {
          ...policy,
          hpPerNormalizedPoint,
        }),
      ).toThrow(RangeError);
    expect(() =>
      fightingDamageHp({ kind: 'v3-normalized', value: 10 }, 4 as 1, policy),
    ).toThrow(RangeError);
    expect(() =>
      fightingDamageHp({ kind: 'legacy-hp', value: NaN }, 1, policy),
    ).toThrow(RangeError);
  });
});

test('explicit five HP per normalized point applies exactly once after stage scaling', () => {
  expect(
    fightingDamageHp({ kind: 'v3-normalized', value: 10 }, 1, policy),
  ).toBe(50);
  expect(
    fightingDamageHp({ kind: 'v3-normalized', value: 12 }, 2, policy),
  ).toBeCloseTo(48, 12);
  expect(
    fightingDamageHp({ kind: 'v3-normalized', value: 18 }, 3, policy),
  ).toBeCloseTo(58.5, 12);
});

test('route resolution does not coerce boxed or object-backed strings into attacks', () => {
  for (const route of [Object(''), { toString: () => '' }, null])
    expect(() =>
      resolveFightingMove('standing', route as unknown as string, 'P'),
    ).toThrow(RangeError);
});
