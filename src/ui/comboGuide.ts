import {
  FIGHTING_ACTIVE_GROUND_ROUTES,
  FIGHTING_MAX_STAGE,
  FIGHTING_MOVE_SPECS,
  type ActorId,
  type FightingMoveId,
  type FightingPosture,
  type GameSnapshot,
  type RunId,
} from '../contracts';
import { fightingActorSummary } from './viewModel';

const levelLabels = { high: '上段', mid: '中段', low: '下段' } as const;
function row(input: string, moveId: FightingMoveId, posture: FightingPosture) {
  return Object.freeze({
    input,
    moveId,
    posture,
    stage: input.length,
    level: levelLabels[FIGHTING_MOVE_SPECS[moveId].level],
  });
}

/** Data for an explicitly mounted guide; this module inserts no unmeasured UI. */
export const FIGHTING_COMBO_GUIDE = Object.freeze({
  maxStage: FIGHTING_MAX_STAGE,
  controls: Object.freeze({
    punch: Object.freeze({ text: 'P', accessibleName: 'P パンチ' }),
    kick: Object.freeze({ text: 'K', accessibleName: 'K キック' }),
    guard: Object.freeze({
      text: 'G',
      accessibleName: 'G ガード（押している間）',
    }),
  }),
  ground: Object.freeze(
    Object.entries(FIGHTING_ACTIVE_GROUND_ROUTES).map(([input, moveId]) =>
      row(input, moveId, 'standing'),
    ),
  ),
  posture: Object.freeze([
    row('P', 'c_body', 'crouching'),
    row('K', 'k_low', 'crouching'),
    row('P', 'a_palm', 'airborne'),
    row('K', 'a_kick', 'airborne'),
  ]),
  notes: Object.freeze([
    '地上の連係は最大3打。第4打はありません。',
    '派生は実命中時のみ。ガード・空振りでは終了し、後隙が残ります。',
    '実際の距離や姿勢で途中の打撃が外れます。接続は保証されません。',
    'しゃがみ・空中では派生なし。空中攻撃は1ジャンプ1回。',
    '入力予約は開始・命中の表示とは別です。',
  ]),
  guardHelp: 'G保持でガード／下スワイプ保持と組合せてしゃがみガード',
  guardRules: Object.freeze([
    Object.freeze({
      posture: 'standing',
      blocks: Object.freeze(['high', 'mid']),
      evades: Object.freeze([]),
    }),
    Object.freeze({
      posture: 'crouching',
      blocks: Object.freeze(['low']),
      evades: Object.freeze(['high']),
    }),
  ]),
  guardNotes: Object.freeze([
    '立ちガードは前方の上段・中段、しゃがみガードは前方の下段を防ぎます。',
    'しゃがみ姿勢は上段を回避しますが、中段はしゃがみガードに命中します。',
    '空中ガードなし、削り0。攻撃・後隙はGで自由キャンセルできません。',
    'Gの押下はガード成功を意味しません。防御状態はCoreの確定状態を表示します。',
  ]),
});

/** Per-run, committed-snapshot projection. No cancel-window or contact authority. */
export function createComboGuideModel(runId: RunId) {
  let revision = -1;
  let priorStage: string | null = null;
  return {
    update(snapshot: GameSnapshot, selectedActor?: ActorId) {
      if (snapshot.runId !== runId || snapshot.revision <= revision)
        return null;
      revision = snapshot.revision;
      const actor = snapshot.actors.find((candidate) =>
        selectedActor
          ? candidate.actorId === selectedActor
          : candidate.color === 'white',
      );
      const state = actor ? fightingActorSummary(actor) : null;
      if (!actor || !state) {
        priorStage = null;
        return null;
      }
      const stageKey =
        state.stage > 0
          ? JSON.stringify([
              actor.actorId,
              actor.attack?.activationId ?? null,
              state.route,
              state.stage,
            ])
          : null;
      const announce =
        stageKey !== null &&
        stageKey !== priorStage &&
        snapshot.phase === 'running' &&
        snapshot.pauseReasons.length === 0 &&
        ['startup', 'active', 'recovery'].includes(state.phase);
      priorStage = stageKey;
      return Object.freeze({
        guide: FIGHTING_COMBO_GUIDE,
        state,
        announcement: announce
          ? `${state.route} · ${state.stage} / ${FIGHTING_MAX_STAGE}`
          : null,
      });
    },
    reset() {
      revision = -1;
      priorStage = null;
    },
  };
}
