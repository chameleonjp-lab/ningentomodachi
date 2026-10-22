import type {
  ActorId,
  ActorState,
  CommittedFrame,
  Projection,
  RunId,
} from '../contracts';
import { hudActors } from './viewModel';
type Point = { readonly x: number; readonly y: number };
interface Loss {
  low: number;
  high: number;
  started: number;
  ends: number;
  origin: Point | null;
  viewportRevision: number;
  intensity: number;
}
export interface LossView {
  readonly low: number;
  readonly high: number;
  readonly phase: 'red' | 'absorbing' | 'shrinking';
  readonly origin: Point | null;
  readonly progress: number;
}
export interface HpView {
  readonly hp: number;
  readonly maxHp: number;
  readonly greenRatio: number;
  readonly shakePx: number;
  readonly losses: readonly LossView[];
}
export function createDamageTimeline(runId: RunId) {
  let sequence = 0;
  let revision = -1;
  let now = 0;
  let actors = new Map<ActorId, ActorState>();
  const losses = new Map<ActorId, Loss[]>();
  const seen = new Set<string>();
  return {
    update(frame: CommittedFrame, projections: readonly Projection[]) {
      const snapshot = frame.snapshot;
      if (snapshot.runId !== runId || snapshot.revision < revision) return;
      revision = snapshot.revision;
      now = snapshot.clocks.presentationTimeMs;
      actors = new Map(hudActors(snapshot).map((a) => [a.actorId, a]));
      for (const id of losses.keys()) if (!actors.has(id)) losses.delete(id);
      for (const event of frame.events) {
        if (event.runId !== runId || event.sequence <= sequence) continue;
        sequence = event.sequence;
        if (seen.has(event.eventId)) continue;
        seen.add(event.eventId);
        if (seen.size > 2048) {
          const oldest = seen.values().next().value;
          if (oldest) seen.delete(oldest);
        }
        if (
          event.type === 'OpponentChanged' &&
          event.previousActorId &&
          !actors.has(event.previousActorId)
        )
          losses.delete(event.previousActorId);
        if (event.type === 'Healed') losses.delete(event.actorId);
        if (
          event.type !== 'HpChanged' ||
          !actors.has(event.actorId) ||
          event.actualHpLost <= 0 ||
          event.maxHp <= 0
        )
          continue;
        const high = Math.min(event.maxHp, Math.max(0, event.beforeHp));
        const amount = Math.max(
          0,
          Math.min(event.actualHpLost, high, high - Math.max(0, event.afterHp)),
        );
        if (!Number.isFinite(amount) || amount === 0) continue;
        const projection = projections.find(
          (p) =>
            p.runId === runId &&
            p.eventId === event.eventId &&
            p.actorId === event.actorId &&
            p.viewportRevision === frame.viewport.revision &&
            p.visibility === 'visible',
        );
        const point = projection?.cssPoint;
        const origin =
          point &&
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          point.x >= 0 &&
          point.y >= 0 &&
          point.x <= frame.viewport.widthCssPx &&
          point.y <= frame.viewport.heightCssPx
            ? { ...point }
            : null;
        const queue = losses.get(event.actorId) ?? [];
        queue.push({
          low: (high - amount) / event.maxHp,
          high: high / event.maxHp,
          started: now,
          ends: now + 700,
          origin,
          viewportRevision: frame.viewport.revision,
          intensity: Math.min(12, Math.sqrt(amount / event.maxHp) * 22),
        });
        if (queue.length > 16) {
          const oldest = queue.shift();
          const next = queue[0];
          if (oldest && next) {
            next.low = Math.min(next.low, oldest.low);
            next.high = Math.max(next.high, oldest.high);
            next.intensity = Math.max(next.intensity, oldest.intensity);
          }
        }
        losses.set(event.actorId, queue);
      }
      const stage = snapshot.presentation;
      for (const [id, queue] of losses) {
        for (const loss of queue) {
          if (loss.viewportRevision !== frame.viewport.revision)
            loss.origin = null;
          if ('endsAt' in stage) loss.ends = Math.min(loss.ends, stage.endsAt);
        }
        losses.set(
          id,
          stage.kind === 'results' || stage.kind === 'fade'
            ? []
            : queue.filter((loss) => now < loss.ends),
        );
      }
    },
    read(actorId: ActorId): HpView | null {
      const actor = actors.get(actorId);
      if (!actor) return null;
      const queue = losses.get(actorId) ?? [];
      let shake = 0;
      const views = queue.map((loss) => {
        const progress = Math.min(
          1,
          Math.max(
            0,
            (now - loss.started) / Math.max(1, loss.ends - loss.started),
          ),
        );
        shake = Math.max(
          shake,
          loss.intensity * (1 - progress) * Math.sin(progress * Math.PI * 12),
        );
        const phase =
          progress < 0.12 ? 'red' : progress < 0.58 ? 'absorbing' : 'shrinking';
        const high =
          phase === 'shrinking'
            ? loss.low + (loss.high - loss.low) * (1 - (progress - 0.58) / 0.42)
            : loss.high;
        return {
          low: loss.low,
          high,
          phase,
          origin: loss.origin,
          progress,
        } satisfies LossView;
      });
      // A nonzero initial impulse makes the first committed damage frame visible, without a wall timer.
      if (queue.some((loss) => loss.started === now))
        shake = Math.max(shake, ...queue.map((loss) => loss.intensity));
      return {
        hp: actor.hp,
        maxHp: actor.maxHp,
        greenRatio: Math.min(1, Math.max(0, actor.hp / actor.maxHp)),
        shakePx: shake,
        losses: views,
      };
    },
    clear() {
      losses.clear();
      actors.clear();
      seen.clear();
    },
  };
}
