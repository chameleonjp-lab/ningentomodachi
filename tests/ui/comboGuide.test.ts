import { expect, test } from 'vitest';
import {
  attackActivationId,
  clipId,
  commandId,
  gameTimeMs,
  runId,
  type ActorState,
  type FightingCombatantState,
} from '../../src/contracts';
import * as viewModel from '../../src/ui/viewModel';
import { actor, player, run, snapshot } from './fixtures/core';

async function guideModule() {
  const module = await import('../../src/ui/comboGuide').catch(() => null);
  expect(module, 'v3 combo guide module must exist').not.toBeNull();
  if (!module) throw Error('Missing combo guide');
  return module;
}
function combatant(
  overrides: Partial<FightingCombatantState> = {},
): FightingCombatantState {
  return {
    tick: 10,
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
    ...overrides,
  };
}
function fighter(overrides: Partial<FightingCombatantState> = {}): ActorState {
  return { ...actor(), fighting: combatant(overrides) };
}
test('guide exposes all nine ground routes and four posture controls without inventing stages', async () => {
  const { FIGHTING_COMBO_GUIDE: guide } = await guideModule();
  expect(
    guide.ground.map((row) => [row.input, row.moveId, row.stage, row.level]),
  ).toEqual([
    ['P', 'p_short', 1, '上段'],
    ['PP', 'p_body', 2, '中段'],
    ['PPP', 'p_finish', 3, '中段'],
    ['PK', 'k_low', 2, '下段'],
    ['PPK', 'k_turn', 3, '中段'],
    ['K', 'k_front', 1, '中段'],
    ['KK', 'k_turn', 2, '中段'],
    ['KP', 'p_entry', 2, '中段'],
    ['KPP', 'p_finish', 3, '中段'],
  ]);
  expect(
    guide.posture.map((row) => [row.posture, row.input, row.moveId, row.stage]),
  ).toEqual([
    ['crouching', 'P', 'c_body', 1],
    ['crouching', 'K', 'k_low', 1],
    ['airborne', 'P', 'a_palm', 1],
    ['airborne', 'K', 'a_kick', 1],
  ]);
  expect(guide.maxStage).toBe(3);
  expect(guide.controls).toMatchObject({
    punch: { text: 'P' },
    kick: { text: 'K' },
    guard: { text: 'G' },
  });
  expect(guide.controls.guard.accessibleName).toContain('押している間');
});
test('non-hover guide teaches hit-only, distance failures and exact guard-height caveats', async () => {
  const { FIGHTING_COMBO_GUIDE: guide } = await guideModule();
  expect(guide.notes.join(' ')).toMatch(/実命中/);
  expect(guide.notes.join(' ')).toMatch(/空振り.*ガード|ガード.*空振り/);
  expect(guide.notes.join(' ')).toMatch(/距離.*外れ/);
  expect(guide.notes.join(' ')).toMatch(/最大3/);
  expect(guide.notes.join(' ')).toMatch(/空中.*1回/);
  expect(guide.guardHelp).toMatch(/下スワイプ/);
  expect(guide.guardRules).toEqual([
    { posture: 'standing', blocks: ['high', 'mid'], evades: [] },
    { posture: 'crouching', blocks: ['low'], evades: ['high'] },
  ]);
  expect(guide.guardNotes.join(' ')).toMatch(/中段.*しゃがみガード.*命中/);
  expect(guide.guardNotes.join(' ')).toMatch(/空中ガードなし/);
  expect(guide.guardNotes.join(' ')).toMatch(/削り0/);
  expect(guide.guardNotes.join(' ')).toMatch(/前方/);
});
test('legacy actors remain unchanged and never acquire v3 UI state implicitly', () => {
  expect(viewModel.fightingActorSummary(actor())).toBeNull();
  expect(viewModel.actorSummary(actor(), snapshot().clocks).actions).toEqual(
    actor().actions,
  );
  expect(viewModel.actionLabels).toEqual({
    punch: 'パンチ',
    kick: 'キック',
    jump: 'ジャンプ',
    move: '移動',
  });
});
test.each([
  [false, null, 'neutral', 'ガードしていません'],
  [true, null, 'neutral', 'ガードしていません'],
  [true, 'standing', 'neutral', '立ちガード'],
  [true, 'crouching', 'neutral', 'しゃがみガード'],
  [false, 'standing', 'blockstun', 'ガード硬直（立ちガード）'],
  [false, 'crouching', 'blockstun', 'ガード硬直（しゃがみガード）'],
] as const)(
  'guard label consumes Core height, not held flag: %j/%j/%j',
  (guardHeld, guardHeight, phase, label) => {
    const summary = viewModel.fightingActorSummary(
      fighter({ guardHeld, guardHeight, phase }),
    );
    expect(summary?.guardLabel).toBe(label);
    expect(summary?.guardHeight).toBe(guardHeight);
  },
);
test('Core action permissions and buffered intent are displayed separately from started/hit-confirmed stages', () => {
  const busy = { allowed: false, reason: 'busy' } as const;
  const a: ActorState = {
    ...fighter({
      phase: 'recovery',
      route: 'P',
      stage: 1,
      moveId: 'p_short',
      buffer: {
        edge: {
          runId: run,
          actorId: player,
          commandId: commandId('next-k'),
          sequence: 2,
          button: 'K',
        },
        ageTicks: 4,
      },
    }),
    actions: { punch: busy, kick: busy, jump: busy, move: busy },
  };
  const summary = viewModel.fightingActorSummary(a);
  expect(summary).toMatchObject({
    route: 'P',
    stage: 1,
    phase: 'recovery',
    bufferedButton: 'K',
    hitConfirmed: false,
    actions: a.actions,
  });
  expect(summary).not.toHaveProperty('nextRoutes');
  expect(summary).not.toHaveProperty('guardAllowed');
  expect(a.fighting?.buffer?.ageTicks).toBe(4);
});
test('airborne held G is not labeled defense and airAttackUsed stays authoritative', () => {
  const summary = viewModel.fightingActorSummary(
    fighter({
      posture: 'airborne',
      guardHeld: true,
      guardHeight: null,
      airAttackUsed: true,
    }),
  );
  expect(summary).toMatchObject({
    guardLabel: 'ガードしていません',
    airAttackUsed: true,
    posture: 'airborne',
  });
});
test('guide projection ignores foreign/stale snapshots and announces each committed stage once', async () => {
  const { createComboGuideModel } = await guideModule();
  const model = createComboGuideModel(run);
  const first = snapshot({
    actors: [
      fighter({ phase: 'startup', moveId: 'p_short', route: 'P', stage: 1 }),
    ],
  });
  expect(model.update({ ...first, runId: runId('old') })).toBeNull();
  expect(model.update(first)?.announcement).toBe('P · 1 / 3');
  expect(model.update(first)).toBeNull();
  expect(model.update({ ...first, revision: 2 })?.announcement).toBeNull();
  expect(model.update(first)).toBeNull();
  expect(
    model.update(
      snapshot({
        revision: 3,
        actors: [
          fighter({
            phase: 'startup',
            moveId: 'p_body',
            route: 'PP',
            stage: 2,
          }),
        ],
      }),
    )?.announcement,
  ).toBe('PP · 2 / 3');
  // Repeated same-stage publications, including a newly queued edge, cannot announce another stage.
  expect(
    model.update(
      snapshot({
        revision: 4,
        actors: [
          fighter({
            phase: 'active',
            moveId: 'p_body',
            route: 'PP',
            stage: 2,
            hitConfirmed: true,
          }),
        ],
      }),
    )?.announcement,
  ).toBeNull();
});
test('neutral/reset and a new actor/activation rearm announcement without replaying stale stages', async () => {
  const { createComboGuideModel } = await guideModule();
  const model = createComboGuideModel(run);
  const active = (revision: number, activation: string) =>
    snapshot({
      revision,
      actors: [
        {
          ...fighter({
            phase: 'startup',
            moveId: 'p_short',
            route: 'P',
            stage: 1,
          }),
          attack: {
            activationId: attackActivationId(activation),
            clipId: clipId('p-short'),
            category: 'punch',
            startedAt: gameTimeMs(0),
            consumedImpacts: [],
            impactBindings: [],
          },
        },
      ],
    });
  expect(model.update(active(1, 'one'))?.announcement).toBe('P · 1 / 3');
  expect(model.update(active(2, 'one'))?.announcement).toBeNull();
  expect(model.update(active(3, 'two'))?.announcement).toBe('P · 1 / 3');
  expect(
    model.update(snapshot({ revision: 4, actors: [fighter()] }))?.announcement,
  ).toBeNull();
  expect(model.update(active(5, 'three'))?.announcement).toBe('P · 1 / 3');
  model.reset();
  expect(model.update(active(1, 'retry'))?.announcement).toBe('P · 1 / 3');
});
test('paused/terminal state cannot announce a stage or treat a buffered button as an attack start', async () => {
  const { createComboGuideModel } = await guideModule();
  const model = createComboGuideModel(run);
  const f = fighter({
    phase: 'startup',
    route: 'P',
    stage: 1,
    moveId: 'p_short',
  });
  expect(
    model.update(snapshot({ phase: 'paused', actors: [f] }))?.announcement,
  ).toBeNull();
  expect(
    model.update(snapshot({ revision: 2, phase: 'terminal', actors: [f] }))
      ?.announcement,
  ).toBeNull();
  expect(model.update(snapshot({ revision: 3, actors: [actor()] }))).toBeNull();
});
