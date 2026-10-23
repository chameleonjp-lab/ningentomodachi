/** Opt-in staged local pose preparation. No source loader, visible rig or world authority. */
import {
  capturePoseEpoch,
  captureRecoveryTimelinePolicy,
  createLivingPoseStamp,
  durationMs,
  gameTimeMs,
  isRecoveryPoseEpoch,
  resolvePoseEpoch,
  type ActorId,
  type DefeatPoseSupportObservation,
  type GameTimeMs,
  type PoseEpoch,
  type PoseSampleSide,
  type RecoveryTimelinePolicy,
  type RunId,
  type StampedDefeatSeek,
} from '../contracts';
import {
  capturePose,
  composePoseMatrices,
  type LocalPose,
} from './poseRecipeMath';
export type PoseFrameRequest = Readonly<{
  runId: RunId;
  actorId: ActorId;
  revision: number;
}> &
  (
    | Readonly<{
        kind: 'living';
        epoch: PoseEpoch;
        at: GameTimeMs;
        side: PoseSampleSide;
      }>
    | Readonly<{ kind: 'defeat'; input: StampedDefeatSeek }>
  );
export interface PreparedPoseFrame {
  readonly identity: string;
}
export type PoseFrameResult = Readonly<{
  pose: LocalPose;
  support?: Pick<
    DefeatPoseSupportObservation,
    'entryLocalMinY' | 'currentLocalBounds'
  >;
}>;
export interface PoseFrameDriver {
  readonly capability: RecoveryTimelinePolicy;
  prepare(request: PoseFrameRequest): PreparedPoseFrame;
  apply(command: PreparedPoseFrame): void;
  dispose(): void;
}
export const RECOVERY_FRAME_CAPABILITY: RecoveryTimelinePolicy = Object.freeze({
  version: 1,
  protocol: 'kungfu-recovery-epoch-diagnostic-v1',
  durationMs: durationMs(150),
  fixedLiftSign: 1,
});
export function captureDefeatSeek(input: StampedDefeatSeek): StampedDefeatSeek {
  if (
    !input?.runId?.trim() ||
    !input.actorId?.trim() ||
    !Number.isFinite(input.defeatStartedAt) ||
    input.defeatStartedAt < 0 ||
    !['DefeatPunch', 'DefeatKick'].includes(input.deathClipId) ||
    !Number.isFinite(input.deathClipTime) ||
    input.deathClipTime < 0 ||
    input.deathClipTime > 500 ||
    input.entry?.sampleSide !== 'left'
  )
    throw Error('Invalid composite defeat request');
  let entry: StampedDefeatSeek['entry'];
  if ('kind' in input.entry) {
    if (input.entry.kind !== 'recovery')
      throw Error('Unsupported defeat entry');
    const epoch = capturePoseEpoch(input.entry.epoch),
      at = gameTimeMs(input.entry.at);
    if (
      !isRecoveryPoseEpoch(epoch) ||
      epoch.runId !== input.runId ||
      epoch.actorId !== input.actorId
    )
      throw Error('Composite entry actor/run mismatch');
    resolvePoseEpoch(epoch, at, 'left');
    entry = Object.freeze({ kind: 'recovery', epoch, at, sampleSide: 'left' });
  } else {
    const binding = createLivingPoseStamp({
      version: 1,
      binding: input.entry.binding,
      mode: 'idle',
      startedAt: gameTimeMs(0),
      playback: 'loop',
      activationId: null,
    }).binding;
    const clipTime = durationMs(input.entry.clipTime);
    if (clipTime > binding.durationMs) throw Error('Invalid entry clip time');
    entry = Object.freeze({ binding, clipTime, sampleSide: 'left' });
  }
  return Object.freeze({
    runId: input.runId,
    actorId: input.actorId,
    defeatStartedAt: input.defeatStartedAt,
    deathClipId: input.deathClipId,
    deathClipTime: durationMs(input.deathClipTime),
    entry,
  });
}
function captureRequest(input: PoseFrameRequest): PoseFrameRequest {
  if (
    !input.runId?.trim() ||
    !input.actorId?.trim() ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0
  )
    throw Error('Invalid prepared frame authority');
  const owner = {
    runId: input.runId,
    actorId: input.actorId,
    revision: input.revision,
  };
  if (input.kind === 'defeat') {
    const value = captureDefeatSeek(input.input);
    if (value.runId !== owner.runId || value.actorId !== owner.actorId)
      throw Error('Defeat owner mismatch');
    return Object.freeze({ ...owner, kind: 'defeat', input: value });
  }
  if (input.kind !== 'living') throw Error('Invalid prepared pose kind');
  const epoch = capturePoseEpoch(input.epoch),
    at = gameTimeMs(input.at);
  if (
    isRecoveryPoseEpoch(epoch) &&
    (epoch.runId !== owner.runId || epoch.actorId !== owner.actorId)
  )
    throw Error('Epoch owner mismatch');
  resolvePoseEpoch(epoch, at, input.side);
  return Object.freeze({
    ...owner,
    kind: 'living',
    epoch,
    at,
    side: input.side,
  });
}
function captureResult(input: PoseFrameResult): PoseFrameResult {
  const pose = capturePose(input.pose);
  composePoseMatrices(pose);
  if (!input.support) return Object.freeze({ pose });
  const {
    entryLocalMinY,
    currentLocalBounds: { min, max },
  } = input.support;
  if (
    ![entryLocalMinY, min.x, min.y, min.z, max.x, max.y, max.z].every(
      Number.isFinite,
    ) ||
    min.x > max.x ||
    min.y > max.y ||
    min.z > max.z
  )
    throw Error('Invalid prepared support');
  return Object.freeze({
    pose,
    support: Object.freeze({
      entryLocalMinY,
      currentLocalBounds: Object.freeze({
        min: Object.freeze({ ...min }),
        max: Object.freeze({ ...max }),
      }),
    }),
  });
}
export function createPoseFrameDriver(
  evaluate: (request: PoseFrameRequest) => PoseFrameResult,
  write: (result: PoseFrameResult, request: PoseFrameRequest) => void,
  assertAlive: () => void,
): PoseFrameDriver {
  let receipts = new WeakMap<
      PreparedPoseFrame,
      { request: PoseFrameRequest; result: PoseFrameResult; generation: number }
    >(),
    disposed = false,
    owner: string | undefined,
    generation = 0,
    consumed = false;
  const alive = () => {
    if (disposed) throw Error('Prepared pose driver disposed');
    assertAlive();
  };
  return Object.freeze({
    capability: captureRecoveryTimelinePolicy(RECOVERY_FRAME_CAPABILITY),
    prepare(input: PoseFrameRequest) {
      alive();
      generation++;
      consumed = true;
      const request = captureRequest(input),
        key = JSON.stringify([request.runId, request.actorId]);
      if (owner !== undefined && owner !== key)
        throw Error('Stale or foreign prepared authority');
      const result = captureResult(evaluate(request));
      alive();
      const token = Object.freeze({
        identity: `prepared-pose:${JSON.stringify(request)}`,
      });
      consumed = false;
      receipts.set(token, { request, result, generation });
      return token;
    },
    apply(token: PreparedPoseFrame) {
      alive();
      const receipt = receipts.get(token);
      if (!receipt || receipt.generation !== generation || consumed)
        throw Error('Unknown, superseded or consumed prepared pose token');
      const { request, result } = receipt,
        key = JSON.stringify([request.runId, request.actorId]);
      if (owner !== undefined && owner !== key)
        throw Error('Stale or foreign prepared authority');
      consumed = true;
      write(result, request);
      alive();
      owner = key;
    },
    dispose() {
      disposed = true;
      receipts = new WeakMap();
      owner = undefined;
    },
  });
}
