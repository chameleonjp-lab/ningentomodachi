import type { ActorState, GameClocks, TerminalResult } from '../contracts';
export const actionLabels = {
  punch: 'パンチ',
  kick: 'キック',
  jump: 'ジャンプ',
  move: '移動',
} as const;
export const reasonLabels = {
  'not-running': '停止中',
  busy: '動作中',
  'cooling-lock': '冷却中',
  defeated: '撃破済み',
  unavailable: '利用不可',
} as const;
export function actorSummary(actor: ActorState, clocks: GameClocks) {
  return {
    actions: actor.actions,
    heatRatio: Math.min(
      1,
      Math.max(0, actor.heat.amount / actor.heat.capacity),
    ),
    heatText: `${Number(actor.heat.amount.toFixed(1))} / ${actor.heat.capacity}`,
    cooldownSeconds:
      actor.heat.lockedUntil === null
        ? 0
        : Math.max(
            0,
            (actor.heat.lockedUntil - clocks.activeRealTimeMs) / 1000,
          ),
  };
}
export function resultLines(
  result: TerminalResult,
): readonly (readonly [string, string])[] {
  const score = result.score;
  const points: (readonly [string, string])[] = score.contributions
    ? [
        ['生存点', String(score.contributions.survival)],
        ['撃破点', String(score.contributions.defeats)],
        ['残HP点', String(score.contributions.remainingHp)],
        ['クリア点', String(score.contributions.clear)],
        ['速攻点', String(score.contributions.speed)],
        ['損壊点', String(score.contributions.destruction)],
        ['丸め・下限調整', String(score.contributions.adjustment)],
      ]
    : [];
  return [
    ['結果', result.outcome === 'clear' ? 'クリア' : '敗北'],
    ['総合点', score.total.toLocaleString('ja-JP')],
    ['生存時間', `${(score.survivalTime / 1000).toFixed(1)} 秒`],
    [
      '全敵撃破時間',
      score.clearTime === null
        ? '未達'
        : `${(score.clearTime / 1000).toFixed(1)} 秒`,
    ],
    ['撃破数', `${score.defeatedEnemies} / 4`],
    ['残りHP', String(score.remainingHp)],
    ['街の損壊率', `${(score.streetDestructionRate * 100).toFixed(1)}%`],
    ['車の損壊率', `${(score.vehicleDestructionRate * 100).toFixed(1)}%`],
    ['損壊減点', String(score.destructionPenalty)],
    ...(score.playerCausedDestructionRate === undefined
      ? []
      : [
          [
            'プレイヤー起因の損壊率',
            `${(score.playerCausedDestructionRate * 100).toFixed(1)}%`,
          ] as const,
        ]),
    ...points,
  ];
}
