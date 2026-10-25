import type { FightingGameplayCommand } from '../contracts/commands';
import { tick } from '../contracts/clock';
import {
  captureFightingAttackDescriptor,
  captureFightingCombatantState,
  captureFightingDamage,
  captureFightingPolicy,
  captureNormalizedFightingInputs,
  FIGHTING_DAMAGE_SCALES,
  FIGHTING_GROUND_ROUTES,
  type FightingAttackDescriptor,
  type FightingButton,
  type FightingCombatantState,
  type FightingContactDecision,
  type FightingDamage,
  type FightingMoveDefinition,
  type FightingMoveId,
  type FightingPolicy,
  type FightingPosture,
  type NormalizedFightingInputs,
} from '../contracts/fighting';
import type { ActorId, CommandId, RunId } from '../contracts/ids';

/** Selection consumes only posture and chronological P/K, never a seeded random draw. */
export function resolveFightingMove(
  posture: FightingPosture,
  route: string,
  button: FightingButton,
): FightingMoveId | null {
  if (typeof route !== 'string')
    throw new RangeError('Route must be a primitive string');
  if (button !== 'P' && button !== 'K')
    throw new RangeError('Unknown fighting button');
  if (posture === 'standing') {
    const next = route + button;
    return Object.hasOwn(FIGHTING_GROUND_ROUTES, next)
      ? FIGHTING_GROUND_ROUTES[next as keyof typeof FIGHTING_GROUND_ROUTES]
      : null;
  }
  if (posture !== 'crouching' && posture !== 'airborne')
    throw new RangeError('Unknown fighting posture');
  if (route !== '') return null;
  return posture === 'crouching'
    ? button === 'P'
      ? 'c_body'
      : 'k_low'
    : button === 'P'
      ? 'a_palm'
      : 'a_kick';
}

/** Clip-independent timing also accepts the canonical unbound role specs. */
export function latestCancelDelay(
  from: Pick<FightingMoveDefinition, 'hitstunTicks'>,
  to: Pick<FightingMoveDefinition, 'startupTicks' | 'activeTicks'>,
): number {
  tick(from.hitstunTicks);
  tick(to.startupTicks);
  if (tick(to.activeTicks) === 0)
    throw new RangeError('Cancel destination requires an active tick');
  return Math.max(
    0,
    Math.min(8, from.hitstunTicks - to.startupTicks - (to.activeTicks - 1) - 2),
  );
}

function requireIdentity(value: unknown): void {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim())
    throw new RangeError('Invalid fighting input identity');
}

/** Reject the whole invalid batch; the owning Core alone commits the returned seen IDs. */
export function normalizeFightingInputs(
  runId: RunId,
  actorId: ActorId,
  commands: readonly FightingGameplayCommand[],
  seen: ReadonlySet<CommandId>,
): NormalizedFightingInputs {
  requireIdentity(runId);
  requireIdentity(actorId);
  const ids = new Set<CommandId>();
  const sequences = new Set<number>();
  for (const command of commands) {
    if (!command?.input) throw new RangeError('Missing fighting input packet');
    requireIdentity(command.runId);
    requireIdentity(command.actorId);
    requireIdentity(command.input.commandId);
    const { commandId, sequence } = command.input;
    if (
      command.runId !== runId ||
      command.actorId !== actorId ||
      tick(sequence) === 0 ||
      ids.has(commandId) ||
      seen.has(commandId) ||
      sequences.has(sequence)
    )
      throw new RangeError('Foreign, duplicate or conflicting fighting packet');
    ids.add(commandId);
    sequences.add(sequence);
  }
  const chronological = [...commands].sort(
    (a, b) =>
      a.input.sequence - b.input.sequence ||
      (a.input.commandId < b.input.commandId ? -1 : 1),
  );
  return captureNormalizedFightingInputs({
    edges: chronological.flatMap((command) => {
      if (command.type !== 'AttackRequested') return [];
      if (command.category !== 'punch' && command.category !== 'kick')
        throw new RangeError('Unknown fighting attack category');
      return [
        {
          runId,
          actorId,
          commandId: command.input.commandId,
          sequence: command.input.sequence,
          button:
            command.category === 'punch' ? ('P' as const) : ('K' as const),
        },
      ];
    }),
    newlySeenCommandIds: chronological.map(
      (command) => command.input.commandId,
    ),
  });
}

/** Contact resolution preserves trusted damage units; it never chooses a legacy role. */
export function resolveFightingContact(
  source: FightingAttackDescriptor,
  target: FightingCombatantState,
  frontDot: number,
  policy: FightingPolicy,
): FightingContactDecision {
  const attack = captureFightingAttackDescriptor(source);
  const defender = captureFightingCombatantState(target);
  const rules = captureFightingPolicy(policy);
  if (!Number.isFinite(frontDot) || frontDot < -1 || frontDot > 1)
    throw new RangeError('Guard facing dot must be normalized and finite');
  if (defender.phase === 'defeated')
    return Object.freeze({ kind: 'ignored', reason: 'defeated' });
  // A requested posture during blockstun does not replace its retained contact stance.
  const posture =
    defender.phase === 'blockstun' && defender.guardHeight !== null
      ? defender.guardHeight
      : defender.posture;
  if (posture === 'crouching' && attack.level === 'high')
    return Object.freeze({ kind: 'ignored', reason: 'high-over-crouch' });
  const guarding =
    posture !== 'airborne' &&
    ((defender.phase === 'neutral' && defender.guardHeld) ||
      (defender.phase === 'blockstun' && defender.guardHeight !== null));
  const height =
    defender.phase === 'blockstun' ? defender.guardHeight : posture;
  const covers =
    height === 'standing'
      ? attack.level === 'high' || attack.level === 'mid'
      : height === 'crouching' && attack.level === 'low';
  if (guarding && covers && frontDot >= rules.guardFrontDotMin)
    return Object.freeze({
      kind: 'blocked',
      damageHp: 0,
      blockstunTicks: attack.blockstunTicks,
      stopTicks: attack.blockstopTicks,
    });
  return Object.freeze({
    kind: 'hit',
    damage: attack.damage,
    hitstunTicks: attack.hitstunTicks,
    stopTicks: attack.hitstopTicks,
  });
}

/** Invoke once at Core's resolved-HP seam, not in a spatial candidate or animation adapter. */
export function fightingDamageHp(
  damage: FightingDamage,
  stage: 1 | 2 | 3,
  policy: FightingPolicy,
): number {
  const trusted = captureFightingDamage(damage);
  const rules = captureFightingPolicy(policy);
  if (stage !== 1 && stage !== 2 && stage !== 3)
    throw new RangeError('No fourth fighting damage stage');
  const hp =
    trusted.kind === 'legacy-hp'
      ? trusted.value
      : trusted.value *
        FIGHTING_DAMAGE_SCALES[stage === 1 ? 0 : stage === 2 ? 1 : 2] *
        rules.hpPerNormalizedPoint;
  if (!Number.isFinite(hp)) throw new RangeError('Fighting HP overflow');
  return hp;
}
