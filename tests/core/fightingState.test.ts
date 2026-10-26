import { describe, expect, test } from 'vitest';
import { durationMs, gameTimeMs } from '../../src/contracts/clock';
import { actorId, commandId, runId } from '../../src/contracts/ids';
import {
  FIGHTING_GROUND_ROUTES,
  FIGHTING_MOVE_SPECS,
  type FightingAttackDescriptor,
  type FightingCombatantState,
  type FightingInputEdge,
  type FightingMoveId,
  type FightingPolicy,
  type FightingPosture,
} from '../../src/contracts/fighting';
import {
  advanceFightingTick,
  applyFightingTransition,
  createFightingCombatant,
  fightingHeatCost,
  receiveFightingInputs,
} from '../../src/core/fightingState';
import {
  resolveFightingContact,
  resolveFightingMove,
} from '../../src/core/fightingRules';

const run = runId('run'),
  actor = actorId('player');
function edge(sequence: number, button: 'P' | 'K' = 'P'): FightingInputEdge {
  return {
    runId: run,
    actorId: actor,
    commandId: commandId(`press-${sequence}`),
    sequence,
    button,
  };
}
function attack(
  route: keyof typeof FIGHTING_GROUND_ROUTES,
  age?: number,
): FightingCombatantState {
  const moveId = FIGHTING_GROUND_ROUTES[route];
  const moveAgeTicks = age ?? FIGHTING_MOVE_SPECS[moveId].startupTicks;
  return {
    ...createFightingCombatant(),
    moveId,
    moveAgeTicks,
    route,
    stage: route.length as 1 | 2 | 3,
    phase:
      moveAgeTicks < FIGHTING_MOVE_SPECS[moveId].startupTicks
        ? 'startup'
        : 'active',
  };
}
function tickMany(
  state: FightingCombatantState,
  count: number,
): FightingCombatantState {
  let next = state;
  for (let i = 0; i < count; i++) next = advanceFightingTick(next, [], false);
  return next;
}

describe('approved A exclusions preserve paid attacks and their native recovery', () => {
  test.each(['PP', 'K', 'KP'] as const)(
    '%s + P cannot start an inactive role or a neutral replacement after a confirmed hit',
    (route) => {
      const active = attack(route);
      const confirmed = applyFightingTransition(active, {
        type: 'hit-confirmed',
        contactAgeTicks: active.moveAgeTicks,
      });
      let baseline = confirmed;
      let attempted = confirmed;
      const rejected = edge(100);
      let wall = 0;
      while (baseline.phase !== 'neutral' && wall < 100) {
        const before = attempted;
        baseline = advanceFightingTick(baseline, [], false);
        attempted = advanceFightingTick(
          attempted,
          wall === 0 ? [rejected, edge(101, 'K')] : [],
          false,
        );
        expect(fightingHeatCost(before, attempted)).toBe(0);
        const { buffer: _baselineBuffer, ...baselineMotion } = baseline;
        const { buffer: _attemptedBuffer, ...attemptedMotion } = attempted;
        expect(attemptedMotion).toEqual(baselineMotion);
        if (confirmed.stopTicksRemaining > wall)
          expect(attempted.buffer).toEqual({ edge: rejected, ageTicks: 0 });
        wall++;
      }
      expect(wall).toBe(route === 'PP' ? 24 : route === 'K' ? 30 : 34);
      expect(attempted).toMatchObject({
        phase: 'neutral',
        moveId: null,
        stage: 0,
        route: '',
        buffer: null,
      });
      expect(advanceFightingTick(attempted, [], false).moveId).toBeNull();
    },
  );
});

describe('actor tick phases, starts and deterministic hit-only routes', () => {
  test('an accepted start has age zero; existing phases use half-open S/A/R intervals', () => {
    const initial = createFightingCombatant();
    let state = advanceFightingTick(initial, [edge(1)], false);
    expect(state).toMatchObject({
      tick: 1,
      phase: 'startup',
      moveId: 'p_short',
      moveAgeTicks: 0,
      stage: 1,
      route: 'P',
      buffer: null,
    });
    expect(fightingHeatCost(initial, state)).toBe(1);
    state = tickMany(state, 4);
    expect(state).toMatchObject({ tick: 5, phase: 'startup', moveAgeTicks: 4 });
    state = advanceFightingTick(state, [], false);
    expect(state).toMatchObject({ phase: 'active', moveAgeTicks: 5 });
    state = advanceFightingTick(state, [], false);
    expect(state).toMatchObject({ phase: 'active', moveAgeTicks: 6 });
    state = advanceFightingTick(state, [], false);
    expect(state).toMatchObject({ phase: 'recovery', moveAgeTicks: 7 });
    expect(tickMany(state, 13).phase).toBe('recovery');
    expect(tickMany(state, 14)).toMatchObject({
      phase: 'neutral',
      moveId: null,
      route: '',
      stage: 0,
    });
    expect(initial.tick).toBe(0);
    expect(Object.isFrozen(state)).toBe(true);
  });
  test.each([
    ['P', ['p_short']],
    ['PP', ['p_short', 'p_body']],
    ['PPP', ['p_short', 'p_body']],
    ['PK', ['p_short', 'k_low']],
    ['PPK', ['p_short', 'p_body', 'k_turn']],
    ['K', ['k_front']],
    ['KK', ['k_front', 'k_turn']],
    ['KP', ['k_front']],
    ['KPP', ['k_front']],
  ] as const)(
    '%s sequentially starts only its active selected roles',
    (route, want) => {
      let state = createFightingCombatant();
      const moves: unknown[] = [];
      let index = 0;
      for (const button of route) {
        if (state.moveId) {
          state = tickMany(
            state,
            FIGHTING_MOVE_SPECS[state.moveId].startupTicks,
          );
          state = applyFightingTransition(state, {
            type: 'hit-confirmed',
            contactAgeTicks: state.moveAgeTicks,
          });
          state = tickMany(state, state.stopTicksRemaining);
        }
        const before = state;
        state = advanceFightingTick(
          state,
          [edge(++index, button as 'P' | 'K')],
          false,
        );
        if (index <= want.length) {
          expect(fightingHeatCost(before, state)).toBe(1);
          moves.push(state.moveId);
          expect(state.stage).toBe(index);
          expect(state.buffer).toBeNull();
        } else {
          expect(fightingHeatCost(before, state)).toBe(0);
          expect(state.moveId).toBe(before.moveId);
          expect(state.route).toBe(before.route);
          expect(state.stage).toBe(want.length);
        }
      }
      expect(moves).toEqual(want);
    },
  );
  test.each(['PPP', 'KPP'] as const)(
    '%s cannot accept stage four even on a real final hit',
    (route) => {
      for (const button of ['P', 'K'] as const) {
        const original = attack(route);
        let state = applyFightingTransition(original, {
          type: 'hit-confirmed',
          contactAgeTicks: original.moveAgeTicks,
        });
        state = tickMany(state, state.stopTicksRemaining);
        const next = advanceFightingTick(state, [edge(9, button)], false);
        expect(next.stage).toBe(3);
        expect(next.moveId).toBe('p_finish');
        expect(fightingHeatCost(state, next)).toBe(0);
      }
    },
  );
  test.each(['crouching', 'airborne'] as const)(
    '%s attacks have no chains and air attack is once per jump',
    (posture) => {
      for (const button of ['P', 'K'] as const) {
        let state = advanceFightingTick(
          createFightingCombatant(posture),
          [edge(1, button)],
          false,
        );
        expect(state.moveId).toBe(resolveFightingMove(posture, '', button));
        if (!state.moveId) throw new Error('Missing entry');
        state = tickMany(state, FIGHTING_MOVE_SPECS[state.moveId].startupTicks);
        state = applyFightingTransition(state, {
          type: 'hit-confirmed',
          contactAgeTicks: state.moveAgeTicks,
        });
        state = tickMany(state, state.stopTicksRemaining);
        const attempted = advanceFightingTick(state, [edge(2, button)], false);
        expect(attempted.stage).toBe(1);
        expect(fightingHeatCost(state, attempted)).toBe(0);
        if (posture === 'airborne') {
          const ended = tickMany(attempted, 100);
          expect(ended.airAttackUsed).toBe(true);
          expect(
            advanceFightingTick(ended, [edge(3, button)], false).moveId,
          ).toBeNull();
        }
      }
    },
  );
  test('whiff and blocked source do not open a cancel, preserving the paid stage and recovery', () => {
    for (const blocked of [false, true]) {
      const source = { ...attack('P'), stopTicksRemaining: blocked ? 4 : 0 };
      let next = advanceFightingTick(source, [edge(1)], false);
      next = tickMany(next, blocked ? 4 : 0);
      expect(next.hitConfirmed).toBe(false);
      expect(next.route).toBe('P');
      expect(fightingHeatCost(source, next)).toBe(0);
      const recovered = tickMany(next, 30);
      expect(recovered.phase).toBe('neutral');
      expect(recovered.moveId).toBeNull();
    }
  });
});

describe('four active and three inactive cancel boundaries use actual unfrozen contact', () => {
  const cases = [
    ['P', 'P', 'p_body', 8],
    ['P', 'K', 'k_low', 3],
    ['PP', 'P', null, 8],
    ['PP', 'K', 'k_turn', 3],
    ['K', 'K', 'k_turn', 5],
    ['K', 'P', null, 7],
    ['KP', 'P', null, 8],
  ] as const;
  for (const [route, button, move, maximum] of cases)
    test(`${route}+${button}: delays 1/${maximum}/${maximum + 1} at every source active offset`, () => {
      const spec = FIGHTING_MOVE_SPECS[FIGHTING_GROUND_ROUTES[route]];
      for (
        let activeOffset = 0;
        activeOffset < spec.activeTicks;
        activeOffset++
      ) {
        const contactAge = spec.startupTicks + activeOffset;
        for (const delay of [1, maximum, maximum + 1]) {
          const state = {
            ...attack(route, contactAge + delay - 1),
            phase: 'recovery' as const,
            hitConfirmed: true,
            contactAgeTicks: contactAge,
          };
          const next = advanceFightingTick(state, [edge(1, button)], false);
          const starts = move !== null && delay <= maximum;
          expect(next.moveId).toBe(starts ? move : state.moveId);
          expect(fightingHeatCost(state, next)).toBe(starts ? 1 : 0);
        }
        const beforeStop = applyFightingTransition(attack(route, contactAge), {
          type: 'hit-confirmed',
          contactAgeTicks: contactAge,
        });
        const bufferedDuringStop = advanceFightingTick(
          beforeStop,
          [edge(2, button)],
          false,
        );
        expect(bufferedDuringStop.moveId).toBe(beforeStop.moveId);
        expect(bufferedDuringStop.moveAgeTicks).toBe(contactAge);
        const atContact = tickMany(
          bufferedDuringStop,
          bufferedDuringStop.stopTicksRemaining,
        );
        expect(atContact.moveId).toBe(beforeStop.moveId);
        expect(atContact.moveAgeTicks - (atContact.contactAgeTicks ?? -1)).toBe(
          0,
        );
        const zeroDelay = receiveFightingInputs(atContact, [], false);
        expect(zeroDelay.moveId).toBe(beforeStop.moveId);
        expect(fightingHeatCost(atContact, zeroDelay)).toBe(0);
        expect(advanceFightingTick(atContact, [], false).moveId).toBe(
          move ?? beforeStop.moveId,
        );
      }
    });
});

describe('active A remains hit-only and guard never cancels paid recovery', () => {
  test.each([
    ['P', 'P'],
    ['P', 'K'],
    ['PP', 'K'],
    ['K', 'K'],
  ] as const)(
    '%s + %s never branches from a block or whiff',
    (route, button) => {
      const source = attack(route);
      if (!source.moveId) throw new Error('Expected a historical source role');
      const descriptor = incomingDescriptor(source.moveId);
      const block = resolveFightingContact(
        descriptor,
        {
          ...createFightingCombatant(),
          guardHeld: true,
          guardHeight: 'standing',
        },
        1,
        contactPolicy,
      );
      expect(block.kind).toBe('blocked');
      if (block.kind !== 'blocked')
        throw new Error('Expected a covered source');
      for (const stopTicksRemaining of [0, block.stopTicks]) {
        const unconfirmed = { ...source, stopTicksRemaining };
        const queued = receiveFightingInputs(
          unconfirmed,
          [edge(200, button)],
          false,
        );
        expect(queued.hitConfirmed).toBe(false);
        expect(fightingHeatCost(unconfirmed, queued)).toBe(0);
        const after = tickMany(queued, stopTicksRemaining + 1);
        expect(after).toMatchObject({
          moveId: source.moveId,
          route,
          stage: source.stage,
          moveAgeTicks: source.moveAgeTicks + 1,
          hitConfirmed: false,
        });
        expect(fightingHeatCost(queued, after)).toBe(0);
        expect(tickMany(after, 60)).toMatchObject({
          phase: 'neutral',
          moveId: null,
          buffer: null,
        });
      }
    },
  );
  test.each([
    ['PP', 16],
    ['PPK', 27],
    ['KK', 27],
    ['PK', 22],
    ['K', 20],
  ] as const)(
    '%s retains all %i recovery ticks when G is held',
    (route, recovery) => {
      const spec = FIGHTING_MOVE_SPECS[FIGHTING_GROUND_ROUTES[route]];
      let state: FightingCombatantState = {
        ...attack(route, spec.startupTicks + spec.activeTicks),
        phase: 'recovery' as const,
        hitConfirmed: true,
        contactAgeTicks: spec.startupTicks,
      };
      for (let elapsed = 1; elapsed <= recovery; elapsed++) {
        const before = state;
        state = advanceFightingTick(state, [edge(300 + elapsed)], true);
        expect(fightingHeatCost(before, state)).toBe(0);
        expect(state.buffer).toBeNull();
        if (elapsed < recovery) {
          expect(state).toMatchObject({
            phase: 'recovery',
            moveId: before.moveId,
            stage: route.length,
            moveAgeTicks: spec.startupTicks + spec.activeTicks + elapsed,
            guardHeight: null,
          });
        } else {
          expect(state).toMatchObject({
            phase: 'neutral',
            moveId: null,
            stage: 0,
            guardHeight: 'standing',
          });
        }
      }
    },
  );
});

describe('one finite chronological input slot', () => {
  test('first edge wins, keeps all packet identity, and consumption never reuses another batch edge', () => {
    const first = edge(7, 'K'),
      second = edge(8, 'P');
    const busy = attack('P', 1);
    const queued = advanceFightingTick(busy, [first, second], false);
    expect(queued.buffer).toEqual({ edge: first, ageTicks: 0 });
    const refresh = advanceFightingTick(queued, [edge(9)], false);
    expect(refresh.buffer).toEqual({ edge: first, ageTicks: 1 });
    const neutral = createFightingCombatant();
    const started = advanceFightingTick(neutral, [first, second], false);
    expect(started.route).toBe('K');
    expect(started.buffer).toBeNull();
    expect(advanceFightingTick(started, [], false).buffer).toBeNull();
    expect(queued.buffer?.edge).not.toBe(first);
    expect(first.sequence).toBe(7);
  });
  test('age six is still consumed, age seven expires and rapid presses cannot refresh it', () => {
    const confirmed = {
      ...attack('P'),
      hitConfirmed: true,
      contactAgeTicks: 5,
    };
    const six = advanceFightingTick(
      { ...confirmed, buffer: { edge: edge(1), ageTicks: 5 } },
      [],
      false,
    );
    expect(six.moveId).toBe('p_body');
    expect(six.buffer).toBeNull();
    const seven = advanceFightingTick(
      { ...confirmed, buffer: { edge: edge(1), ageTicks: 6 } },
      [],
      false,
    );
    expect(seven.moveId).toBe('p_short');
    expect(seven.buffer).toBeNull();
    let state = advanceFightingTick(attack('K', 0), [edge(1)], false);
    for (let i = 1; i <= 6; i++) {
      state = advanceFightingTick(state, [edge(i + 1, 'K')], false);
      expect(state.buffer).toEqual({ edge: edge(1), ageTicks: i });
    }
    expect(advanceFightingTick(state, [], false).buffer).toBeNull();
  });
  test('hitstop accepts inputs but freezes every actor-age counter and does not refresh stop on duplicate confirmation', () => {
    const active = { ...attack('P'), tick: 18 };
    const stopped = applyFightingTransition(active, {
      type: 'hit-confirmed',
      contactAgeTicks: 5,
    });
    expect(stopped.stopTicksRemaining).toBe(6);
    let state = advanceFightingTick(stopped, [edge(1)], false);
    for (let remaining = 5; remaining >= 0; remaining--) {
      expect(state).toMatchObject({
        tick: 18,
        moveAgeTicks: 5,
        contactAgeTicks: 5,
        stopTicksRemaining: remaining,
        buffer: { ageTicks: 0 },
      });
      const repeated = applyFightingTransition(state, {
        type: 'hit-confirmed',
        contactAgeTicks: 5,
      });
      expect(repeated.stopTicksRemaining).toBe(remaining);
      if (remaining > 0)
        state = advanceFightingTick(
          repeated,
          [edge(10 + remaining, 'K')],
          false,
        );
    }
    const next = advanceFightingTick(state, [], false);
    expect(next).toMatchObject({
      tick: 19,
      moveAgeTicks: 0,
      moveId: 'p_body',
      buffer: null,
    });
  });
  test('stopped stun and landing timers do not consume the same wall-time twice', () => {
    const hit = applyFightingTransition(createFightingCombatant(), {
      type: 'received-hit',
      stunTicks: 18,
      stopTicks: 6,
    });
    const thawed = tickMany(hit, 6);
    expect(thawed).toMatchObject({
      tick: 0,
      stunTicksRemaining: 18,
      stopTicksRemaining: 0,
    });
    expect(tickMany(thawed, 17).phase).toBe('hitstun');
    expect(tickMany(thawed, 18)).toMatchObject({
      tick: 18,
      phase: 'neutral',
      stunTicksRemaining: 0,
    });
    const landing = {
      ...createFightingCombatant(),
      phase: 'landing' as const,
      landingTicksRemaining: 8,
      stopTicksRemaining: 4,
    };
    expect(tickMany(landing, 4)).toMatchObject({
      tick: 0,
      landingTicksRemaining: 8,
    });
  });
  test('unsorted, repeated, conflicting and foreign batch identities fail loudly', () => {
    const initial = createFightingCombatant();
    for (const batch of [
      [edge(1), edge(1)],
      [edge(2), edge(1)],
      [edge(1), { ...edge(2), sequence: 1 }],
      [edge(1), { ...edge(2), commandId: edge(1).commandId }],
      [edge(1), { ...edge(2), runId: runId('foreign') }],
      [edge(1), { ...edge(2), actorId: actorId('foreign') }],
      [{ ...edge(1), sequence: 1.5 }],
    ])
      expect(() => advanceFightingTick(initial, batch, false)).toThrow(
        RangeError,
      );
    expect(initial.tick).toBe(0);
  });
});

describe('forced clears, guard lock, landing recovery and accepted-start heat only', () => {
  test('every forced-clear transition removes the one slot without replaying its edge', () => {
    const queued = { ...attack('P'), buffer: { edge: edge(1), ageTicks: 0 } };
    const events = [
      { type: 'received-hit', stunTicks: 4, stopTicks: 2 },
      {
        type: 'received-block',
        stunTicks: 4,
        stopTicks: 2,
        height: 'standing',
      },
      { type: 'guard-begin' },
      ...(['pause', 'KO', 'switch', 'retry'] as const).map((reason) => ({
        type: 'reset' as const,
        reason,
      })),
    ] as const;
    for (const event of events) {
      const cleared = applyFightingTransition(queued, event);
      expect(cleared.buffer).toBeNull();
      const after = tickMany(cleared, 100);
      expect(after.buffer).toBeNull();
      expect(after.moveId).toBeNull();
    }
    const airborne = {
      ...queued,
      posture: 'airborne' as const,
      moveId: 'a_palm' as const,
      airAttackUsed: true,
    };
    expect(
      applyFightingTransition(airborne, {
        type: 'landed',
        atGameMs: gameTimeMs(150.25),
        motionElapsedMs: durationMs(100),
      }).buffer,
    ).toBeNull();
    expect(queued.buffer?.edge.commandId).toBe('press-1');
  });
  test('inputs during hitstun, blockstun, landing or defeat are discarded even on the release tick', () => {
    for (const phase of [
      'hitstun',
      'blockstun',
      'landing',
      'defeated',
    ] as const) {
      const busy = {
        ...createFightingCombatant(),
        phase,
        stunTicksRemaining: phase.endsWith('stun') ? 1 : 0,
        landingTicksRemaining: phase === 'landing' ? 1 : 0,
      };
      const after = advanceFightingTick(busy, [edge(1)], false);
      expect(after.buffer).toBeNull();
      expect(after.moveId).toBeNull();
      expect(advanceFightingTick(after, [], false).moveId).toBeNull();
      expect(fightingHeatCost(busy, after)).toBe(0);
    }
  });
  test('guard cannot cancel attack; current held posture is applied only when blockstun releases', () => {
    const busy = attack('P', 1);
    const held = advanceFightingTick(busy, [edge(1)], true);
    expect(held).toMatchObject({
      moveId: 'p_short',
      phase: 'startup',
      moveAgeTicks: 2,
      buffer: null,
      guardHeld: true,
    });
    const blocked = applyFightingTransition(createFightingCombatant(), {
      type: 'received-block',
      stunTicks: 2,
      stopTicks: 0,
      height: 'standing',
    });
    const changedPosture = { ...blocked, posture: 'crouching' as const };
    expect(advanceFightingTick(changedPosture, [], true).guardHeight).toBe(
      'standing',
    );
    expect(
      tickMany(advanceFightingTick(changedPosture, [], true), 1).guardHeight,
    ).toBeNull();
    const oneLeft = advanceFightingTick(changedPosture, [], true);
    expect(advanceFightingTick(oneLeft, [], true)).toMatchObject({
      phase: 'neutral',
      guardHeight: 'crouching',
      guardHeld: true,
    });
  });
  test('hitstun retains contact posture and pause keeps committed ages while KO freezes actor time', () => {
    const crouched = { ...attack('P'), posture: 'crouching' as const };
    const hit = applyFightingTransition(crouched, {
      type: 'received-hit',
      stunTicks: 3,
      stopTicks: 2,
    });
    expect(tickMany(hit, 4)).toMatchObject({
      phase: 'hitstun',
      posture: 'crouching',
      stunTicksRemaining: 1,
    });
    const paused = applyFightingTransition(
      { ...attack('P', 3), buffer: { edge: edge(1), ageTicks: 2 } },
      { type: 'reset', reason: 'pause' },
    );
    expect(paused).toMatchObject({
      moveAgeTicks: 3,
      moveId: 'p_short',
      buffer: null,
      guardHeld: false,
    });
    const ko = applyFightingTransition(hit, { type: 'reset', reason: 'KO' });
    expect(tickMany(ko, 100)).toEqual(ko);
  });
  test('air landing cuts active immediately and honors max(landing+8, attackStart+S+A+R)', () => {
    const airborne = {
      ...createFightingCombatant('airborne'),
      moveId: 'a_palm' as const,
      moveAgeTicks: 10,
      phase: 'active' as const,
      route: 'P',
      stage: 1 as const,
      airAttackUsed: true,
    };
    const landed = applyFightingTransition(airborne, {
      type: 'landed',
      atGameMs: gameTimeMs(1000.25),
      motionElapsedMs: durationMs((10.25 * 1000) / 60),
    });
    expect(landed).toMatchObject({
      phase: 'landing',
      posture: 'standing',
      moveId: null,
      hitConfirmed: false,
      landingTicksRemaining: 15,
      airAttackUsed: false,
    });
    expect(tickMany(landed, 14).phase).toBe('landing');
    expect(tickMany(landed, 15).phase).toBe('neutral');
    expect(
      applyFightingTransition(airborne, {
        type: 'landed',
        atGameMs: gameTimeMs(1000),
        motionElapsedMs: durationMs((24.75 * 1000) / 60),
      }).landingTicksRemaining,
    ).toBe(8);
    const normal = applyFightingTransition(
      createFightingCombatant('airborne'),
      {
        type: 'landed',
        atGameMs: gameTimeMs(1000),
        motionElapsedMs: durationMs(0),
      },
    );
    expect(normal.landingTicksRemaining).toBe(3);
    expect(tickMany(normal, 3).phase).toBe('neutral');
  });
  test('reservations, rejected inputs, progression and freezes never spend heat', () => {
    for (const posture of [
      'standing',
      'crouching',
      'airborne',
    ] as FightingPosture[]) {
      const start = createFightingCombatant(posture);
      const accepted = advanceFightingTick(start, [edge(1)], false);
      expect(fightingHeatCost(start, accepted)).toBe(1);
      expect(
        fightingHeatCost(
          accepted,
          advanceFightingTick(accepted, [edge(2)], false),
        ),
      ).toBe(0);
      expect(
        fightingHeatCost(start, advanceFightingTick(start, [edge(1)], true)),
      ).toBe(0);
    }
  });
  test.each([
    ['P', 27, 1, 6],
    ['PP', 43, 2, 12],
    ['PPP', 43, 2, 12],
    ['PPK', 78, 3, 21],
    ['KPP', 40, 1, 7],
  ] as const)(
    '%s earliest legal full recovery is %i wall ticks including hitstop exactly once',
    (route, want, starts, stoppedTicks) => {
      let state = advanceFightingTick(
        createFightingCombatant(),
        [edge(1, route[0] as 'P' | 'K')],
        false,
      );
      let wall = 0,
        nextIndex = 1,
        heat = 1;
      for (; wall < 200 && state.phase !== 'neutral'; wall++) {
        if (state.phase === 'active' && !state.hitConfirmed) {
          state = applyFightingTransition(state, {
            type: 'hit-confirmed',
            contactAgeTicks: state.moveAgeTicks,
          });
        }
        const inputs =
          state.stopTicksRemaining > 0 &&
          nextIndex < route.length &&
          !state.buffer
            ? [edge(nextIndex + 1, route[nextIndex++] as 'P' | 'K')]
            : [];
        const next = advanceFightingTick(state, inputs, false);
        heat += fightingHeatCost(state, next);
        state = next;
      }
      expect(wall).toBe(want);
      expect(heat).toBe(starts);
      expect(state.tick - 1).toBe(want - stoppedTicks);
    },
  );
});

test('source and defender share the same stopped wall intervals and the next hit precedes stun release', () => {
  let attacker = applyFightingTransition(attack('P'), {
    type: 'hit-confirmed',
    contactAgeTicks: 5,
  });
  let defender = applyFightingTransition(createFightingCombatant(), {
    type: 'received-hit',
    stunTicks: 18,
    stopTicks: 6,
  });
  const sourceTick = attacker.tick,
    targetTick = defender.tick;
  let wall = 0;
  for (; wall < 6; wall++) {
    attacker = advanceFightingTick(
      attacker,
      wall === 0 ? [edge(1)] : [],
      false,
    );
    defender = advanceFightingTick(defender, [], false);
    expect(attacker.tick).toBe(sourceTick);
    expect(defender.tick).toBe(targetTick);
    expect(defender.stunTicksRemaining).toBe(18);
  }
  attacker = advanceFightingTick(attacker, [], false);
  defender = advanceFightingTick(defender, [], false);
  wall++;
  expect(attacker).toMatchObject({ moveId: 'p_body', moveAgeTicks: 0 });
  for (let i = 0; i < 7; i++, wall++) {
    attacker = advanceFightingTick(attacker, [], false);
    defender = advanceFightingTick(defender, [], false);
  }
  expect(wall).toBe(14);
  expect(attacker).toMatchObject({
    phase: 'active',
    moveAgeTicks: 7,
    tick: sourceTick + 8,
  });
  expect(defender).toMatchObject({
    phase: 'hitstun',
    stunTicksRemaining: 10,
    tick: targetTick + 8,
  });
  expect(tickMany(defender, 9).phase).toBe('hitstun');
  expect(tickMany(defender, 10).phase).toBe('neutral');
});

describe('landing cannot cancel an airborne contact stun', () => {
  test.each([
    [12, 8, 12],
    [3, 8, 8],
    [6, 3, 6],
  ] as const)(
    'stun %i and landing %i run concurrently until both expire after %i actor ticks',
    (stunTicks, landingTicks, actionableAfter) => {
      const airborne = {
        ...createFightingCombatant('airborne'),
        airAttackUsed: landingTicks === 8,
      };
      const hit = applyFightingTransition(airborne, {
        type: 'received-hit',
        stunTicks,
        stopTicks: 3,
      });
      let state = applyFightingTransition(hit, {
        type: 'landed',
        atGameMs: gameTimeMs(100.25),
        motionElapsedMs: durationMs(0),
      });
      expect(state).toMatchObject({
        phase: 'hitstun',
        posture: 'standing',
        stunTicksRemaining: stunTicks,
        stopTicksRemaining: 3,
        landingTicksRemaining: landingTicks,
        airAttackUsed: false,
        buffer: null,
      });
      state = tickMany(state, 3);
      expect(state).toMatchObject({
        phase: 'hitstun',
        tick: 0,
        stunTicksRemaining: stunTicks,
        landingTicksRemaining: landingTicks,
      });
      for (let i = 1; i < actionableAfter; i++) {
        state = advanceFightingTick(state, [edge(100 + i)], true);
        expect(state.phase).not.toBe('neutral');
        expect(state.guardHeight).toBeNull();
        expect(state.buffer).toBeNull();
        expect(state.moveId).toBeNull();
      }
      state = advanceFightingTick(state, [edge(200)], true);
      expect(state).toMatchObject({
        tick: actionableAfter,
        phase: 'neutral',
        stunTicksRemaining: 0,
        landingTicksRemaining: 0,
        guardHeight: 'standing',
        moveId: null,
        buffer: null,
      });
    },
  );
  test('a grounded crouched hit retains its contact posture until stun release', () => {
    const hit = applyFightingTransition(createFightingCombatant('crouching'), {
      type: 'received-hit',
      stunTicks: 4,
      stopTicks: 2,
    });
    expect(tickMany(hit, 5)).toMatchObject({
      posture: 'crouching',
      phase: 'hitstun',
      stunTicksRemaining: 1,
    });
    expect(tickMany(hit, 6)).toMatchObject({
      posture: 'crouching',
      phase: 'neutral',
    });
  });
});

test('a subsequent contact never shortens an already running landing lock', () => {
  const landing = {
    ...createFightingCombatant(),
    phase: 'landing' as const,
    landingTicksRemaining: 13,
  };
  let state = applyFightingTransition(landing, {
    type: 'received-hit',
    stunTicks: 3,
    stopTicks: 2,
  });
  expect(state).toMatchObject({
    phase: 'hitstun',
    landingTicksRemaining: 13,
    stunTicksRemaining: 3,
  });
  state = tickMany(state, 5);
  expect(state).toMatchObject({
    phase: 'landing',
    landingTicksRemaining: 10,
    stunTicksRemaining: 0,
    tick: 3,
  });
  expect(tickMany(state, 9).phase).toBe('landing');
  expect(tickMany(state, 10).phase).toBe('neutral');
});

const contactPolicy: FightingPolicy = {
  version: 3,
  hpPerNormalizedPoint: 5,
  guardFrontDotMin: 0,
  hitstunPosture: 'retain-contact-posture',
};
function incomingDescriptor(moveId: FightingMoveId): FightingAttackDescriptor {
  const spec = FIGHTING_MOVE_SPECS[moveId];
  return {
    ...spec,
    kind: 'v3',
    moveId,
    stage: 1,
    damage: { kind: 'v3-normalized', value: spec.damageNormalized },
  };
}
function normalLanding(): FightingCombatantState {
  return applyFightingTransition(createFightingCombatant('airborne'), {
    type: 'landed',
    atGameMs: gameTimeMs(100.25),
    motionElapsedMs: durationMs(0),
  });
}

describe('zero-stun contacts cannot make a physical landing actionable', () => {
  test.each([
    ['received-hit', 0],
    ['received-hit', 2],
    ['received-block', 0],
    ['received-block', 2],
  ] as const)(
    '%s with zero stun and stop %i preserves the actual three-tick landing lock',
    (type, stopTicks) => {
      const landed = normalLanding();
      let state = applyFightingTransition(
        landed,
        type === 'received-hit'
          ? { type, stunTicks: 0, stopTicks }
          : { type, stunTicks: 0, stopTicks, height: 'standing' },
      );
      expect(state).toMatchObject({
        phase: 'landing',
        landingTicksRemaining: 3,
        stunTicksRemaining: 0,
        stopTicksRemaining: stopTicks,
        guardHeight: null,
      });
      for (let i = 0; i < stopTicks; i++) {
        state = advanceFightingTick(state, [edge(300 + i)], false);
        expect(state).toMatchObject({
          phase: 'landing',
          landingTicksRemaining: 3,
          tick: 0,
          stopTicksRemaining: stopTicks - i - 1,
          buffer: null,
          moveId: null,
          guardHeight: null,
        });
      }
      for (let i = 0; i < 3; i++) {
        expect(
          resolveFightingContact(
            incomingDescriptor('p_short'),
            { ...state, guardHeld: true },
            1,
            contactPolicy,
          ).kind,
        ).toBe('hit');
        state = advanceFightingTick(state, [edge(400 + i)], false);
        expect(state).toMatchObject({
          landingTicksRemaining: 2 - i,
          tick: i + 1,
          buffer: null,
          moveId: null,
          guardHeight: null,
        });
        expect(state.phase).toBe(i === 2 ? 'neutral' : 'landing');
      }
      expect(
        resolveFightingContact(
          incomingDescriptor('p_short'),
          { ...state, guardHeld: true },
          1,
          contactPolicy,
        ).kind,
      ).toBe('blocked');
      expect(advanceFightingTick(state, [], false).moveId).toBeNull();
      expect(advanceFightingTick(state, [edge(500)], false).moveId).toBe(
        'p_short',
      );
    },
  );
  test.each(['received-hit', 'received-block'] as const)(
    '%s positive-stun control still overlaps landing and stop',
    (type) => {
      const landed = normalLanding();
      let state = applyFightingTransition(
        landed,
        type === 'received-hit'
          ? { type, stunTicks: 2, stopTicks: 2 }
          : { type, stunTicks: 2, stopTicks: 2, height: 'standing' },
      );
      expect(state.phase).toBe(
        type === 'received-hit' ? 'hitstun' : 'blockstun',
      );
      state = tickMany(state, 2);
      expect(state).toMatchObject({
        tick: 0,
        landingTicksRemaining: 3,
        stunTicksRemaining: 2,
        stopTicksRemaining: 0,
      });
      state = tickMany(state, 2);
      expect(state).toMatchObject({
        tick: 2,
        phase: 'landing',
        landingTicksRemaining: 1,
        stunTicksRemaining: 0,
        guardHeight: null,
      });
      expect(tickMany(state, 1).phase).toBe('neutral');
    },
  );
});

describe('an unblocked hit during blockstun retains the effective contact posture', () => {
  test.each([
    ['standing', 'crouching', 'k_low', 'hit'],
    ['crouching', 'standing', 'p_body', 'ignored'],
  ] as const)(
    '%s guard plus pending %s and %s hit keeps subsequent high outcome %s',
    (contactPosture, pendingPosture, incomingMove, expectedHigh) => {
      const heldGuard = applyFightingTransition(
        createFightingCombatant(contactPosture),
        { type: 'guard-begin' },
      );
      const blocked = applyFightingTransition(heldGuard, {
        type: 'received-block',
        height: contactPosture,
        stunTicks: 10,
        stopTicks: 0,
      });
      const pending = { ...blocked, posture: pendingPosture };
      const incoming = resolveFightingContact(
        incomingDescriptor(incomingMove),
        pending,
        1,
        contactPolicy,
      );
      expect(incoming.kind).toBe('hit');
      if (incoming.kind !== 'hit')
        throw new Error('Test requires an unblocked canonical body hit');
      let hit = applyFightingTransition(pending, {
        type: 'received-hit',
        stunTicks: incoming.hitstunTicks,
        stopTicks: incoming.stopTicks,
      });
      expect(hit).toMatchObject({
        phase: 'hitstun',
        posture: contactPosture,
        guardHeight: null,
        stopTicksRemaining: incoming.stopTicks,
        stunTicksRemaining: incoming.hitstunTicks,
      });
      for (let i = 0; i < incoming.stopTicks; i++) {
        expect(
          resolveFightingContact(
            incomingDescriptor('p_short'),
            hit,
            1,
            contactPolicy,
          ).kind,
        ).toBe(expectedHigh);
        hit = advanceFightingTick(hit, [], false);
        expect(hit).toMatchObject({
          tick: 0,
          phase: 'hitstun',
          posture: contactPosture,
          stunTicksRemaining: incoming.hitstunTicks,
          stopTicksRemaining: incoming.stopTicks - i - 1,
        });
      }
      for (let i = 1; i < incoming.hitstunTicks; i++) {
        hit = advanceFightingTick(hit, [], false);
        expect(hit).toMatchObject({
          phase: 'hitstun',
          posture: contactPosture,
          stunTicksRemaining: incoming.hitstunTicks - i,
          guardHeight: null,
        });
        expect(
          resolveFightingContact(
            incomingDescriptor('p_short'),
            hit,
            1,
            contactPolicy,
          ).kind,
        ).toBe(expectedHigh);
      }
      expect(advanceFightingTick(hit, [], false)).toMatchObject({
        phase: 'neutral',
        posture: contactPosture,
      });
      expect(pending.posture).toBe(pendingPosture);
      expect(pending.guardHeight).toBe(contactPosture);
    },
  );
});
