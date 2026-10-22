import {
  AnimationClip,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  type Object3D,
} from 'three';
import type { ActorState, PresentationTimeMs } from '../contracts';
export function deathClipSeconds(
  state: NonNullable<ActorState['defeatPresentation']>,
  now: PresentationTimeMs,
): number {
  const elapsed = Math.max(0, now - state.startedAt);
  return (
    Math.min(
      500,
      Math.min(elapsed, state.slowDurationMs) * state.playbackRate +
        Math.max(0, elapsed - state.slowDurationMs),
    ) / 1000
  );
}
/** Local derivative authoring, not a visual-acceptance certificate. Existing rig and mesh stay intact.
 * Uses the supplied rest/guard pose. Final holds are driven by A's durable presentation record. */
export function authorDeathClips(template: Object3D): readonly AnimationClip[] {
  const root = template.getObjectByName('root'),
    pelvis = template.getObjectByName('pelvis');
  if (!root || !pelvis)
    throw new Error('Death authoring requires original root and pelvis');
  return (['Punch', 'Kick'] as const).map((cause) => {
    const axis =
      cause === 'Punch' ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
    const angle = cause === 'Punch' ? -Math.PI / 2 : Math.PI / 2;
    const tracks = [root, pelvis].map((bone, index) => {
      const values: number[] = [];
      for (const factor of [0, 0.1, 0.65, 1]) {
        const rotation = bone.quaternion
          .clone()
          .multiply(
            new Quaternion().setFromAxisAngle(
              axis,
              angle * factor * (index === 0 ? 1 : 0.18),
            ),
          );
        values.push(rotation.x, rotation.y, rotation.z, rotation.w);
      }
      return new QuaternionKeyframeTrack(
        `${bone.name}.quaternion`,
        [0, 0.08, 0.3, 0.5],
        values,
      );
    });
    return new AnimationClip(`Defeat${cause}`, 0.5, tracks);
  });
}
