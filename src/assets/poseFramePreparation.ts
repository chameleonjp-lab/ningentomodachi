import { captureBasisLayer } from './recoveryDiagnostic';
/** Opt-in staged local pose preparation. No source loader, visible rig or world authority. */
import {
  capturePoseEpoch,
  captureStartupTimelinePolicy,
  type StartupTimelinePolicy,
  captureRecoveryTimelinePolicy,
  createLivingPoseStamp,
  durationMs,
  gameTimeMs,
  isRecoveryPoseEpoch,
  isStartupPoseEpoch,
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
  basisLayer?: readonly number[];
  support?: Pick<
    DefeatPoseSupportObservation,
    'entryLocalMinY' | 'currentLocalBounds'
  >;
}>;
export interface PoseFrameDriver {
  readonly capability: RecoveryTimelinePolicy;
  readonly startupCapability?: StartupFrameCapability;
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

export interface StartupFrameCapabilityV1 {
  readonly version: 1;
  readonly protocol: 'side-kick-startup-matrix-v1';
  readonly fixedLiftSign: 1;
  readonly deathLayerPolicy: 'freeze-entry-through-local-death-v1';
}
export interface StartupFrameCapabilityV2 {
  readonly version: 2;
  readonly protocol: 'startup-frame-laws-v2';
  readonly fixedLiftSign: 1;
  readonly deathLayerPolicy: 'freeze-entry-through-local-death-v1';
  readonly supportedProtocols: readonly [
    'side-kick-startup-matrix-v1',
    'side-kick-startup-matrix-v2',
  ];
  readonly domain: 'fixed-positive-lift-midpoint-half-v1';
}
export type StartupFrameCapability =
  | StartupFrameCapabilityV1
  | StartupFrameCapabilityV2;
export const STARTUP_FRAME_CAPABILITY_V2: StartupFrameCapabilityV2 =
  Object.freeze({
    version: 2,
    protocol: 'startup-frame-laws-v2',
    fixedLiftSign: 1,
    deathLayerPolicy: 'freeze-entry-through-local-death-v1',
    supportedProtocols: Object.freeze([
      'side-kick-startup-matrix-v1',
      'side-kick-startup-matrix-v2',
    ] as const),
    domain: 'fixed-positive-lift-midpoint-half-v1',
  });
export const STARTUP_FRAME_CAPABILITY: StartupFrameCapability = Object.freeze({
  version: 1,
  protocol: 'side-kick-startup-matrix-v1',
  fixedLiftSign: 1,
  deathLayerPolicy: 'freeze-entry-through-local-death-v1',
});
/** Without requiredPolicy this only captures a declaration, never authorizes execution. */
export function captureStartupFrameCapability(
  value: StartupFrameCapability | undefined,
  requiredPolicy?: StartupTimelinePolicy,
): StartupFrameCapability {
  const policy = requiredPolicy
    ? captureStartupTimelinePolicy(requiredPolicy)
    : undefined;
  const validCommon =
    value &&
    value.fixedLiftSign === 1 &&
    value.deathLayerPolicy === 'freeze-entry-through-local-death-v1';
  const validV1 =
    validCommon &&
    value.version === 1 &&
    value.protocol === 'side-kick-startup-matrix-v1';
  const validV2 =
    validCommon &&
    value.version === 2 &&
    value.protocol === 'startup-frame-laws-v2' &&
    value.domain === 'fixed-positive-lift-midpoint-half-v1' &&
    JSON.stringify(value.supportedProtocols) ===
      JSON.stringify(STARTUP_FRAME_CAPABILITY_V2.supportedProtocols);
  if ((!validV1 && !validV2) || (policy?.version === 2 && !validV2))
    throw Error('Missing matching startup frame capability');
  return validV2 ? STARTUP_FRAME_CAPABILITY_V2 : STARTUP_FRAME_CAPABILITY;
}

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
    if (input.entry.kind !== 'recovery' && input.entry.kind !== 'startup')
      throw Error('Unsupported defeat entry');
    const epoch = capturePoseEpoch(input.entry.epoch),
      at = gameTimeMs(input.entry.at);
    if (
      !(isRecoveryPoseEpoch(epoch) || isStartupPoseEpoch(epoch)) ||
      epoch.runId !== input.runId ||
      epoch.actorId !== input.actorId
    )
      throw Error('Composite entry actor/run mismatch');
    if (input.entry.kind !== epoch.kind)
      throw Error('Composite entry kind mismatch');
    resolvePoseEpoch(epoch, at, 'left');
    entry = isStartupPoseEpoch(epoch)
      ? Object.freeze({ kind: 'startup', epoch, at, sampleSide: 'left' })
      : Object.freeze({ kind: 'recovery', epoch, at, sampleSide: 'left' });
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
    (isRecoveryPoseEpoch(epoch) || isStartupPoseEpoch(epoch)) &&
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
  const basisLayer =
    input.basisLayer === undefined
      ? undefined
      : captureBasisLayer(input.basisLayer);
  composePoseMatrices(pose, basisLayer);
  const captured = { pose, ...(basisLayer ? { basisLayer } : {}) };
  if (!input.support) return Object.freeze(captured);
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
    ...captured,
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
  startupCapability?: StartupFrameCapability,
): PoseFrameDriver {
  const capturedStartupCapability = startupCapability
    ? captureStartupFrameCapability(startupCapability)
    : undefined;
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
    ...(capturedStartupCapability
      ? { startupCapability: capturedStartupCapability }
      : {}),
    prepare(input: PoseFrameRequest) {
      alive();
      generation++;
      consumed = true;
      const request = captureRequest(input),
        key = JSON.stringify([request.runId, request.actorId]);
      if (owner !== undefined && owner !== key)
        throw Error('Stale or foreign prepared authority');
      const startupRequest =
        request.kind === 'living'
          ? isStartupPoseEpoch(request.epoch)
          : 'kind' in request.input.entry &&
            request.input.entry.kind === 'startup';
      if (startupRequest) {
        const epoch =
          request.kind === 'living'
            ? request.epoch
            : 'kind' in request.input.entry &&
                request.input.entry.kind === 'startup'
              ? request.input.entry.epoch
              : undefined;
        if (!epoch || !isStartupPoseEpoch(epoch))
          throw Error('Missing startup epoch policy');
        captureStartupFrameCapability(capturedStartupCapability, epoch.policy);
      }
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
