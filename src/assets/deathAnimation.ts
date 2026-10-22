import {
  AnimationClip,
  Bone,
  Euler,
  SkinnedMesh,
  VectorKeyframeTrack,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  type Object3D,
} from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
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
/** Offline/local candidate authoring. Articulated collapse and pelvis-only visual settlement.
 * Never writes actor/physical-root placement. Canonical local ground is y=0; real elevated
 * actor/world settlement remains C-owned. The full skinned mesh determines floor contact.
 * Call once on the source Idle0 seed, not once per animation frame or actor defeat. */
export function authorDeathClips(template: Object3D): readonly AnimationClip[] {
  const working = clone(template);
  const root = working.getObjectByName('root'),
    pelvis = working.getObjectByName('pelvis');
  if (!root || !pelvis)
    throw new Error('Death authoring requires original root and pelvis');
  const bones: Bone[] = [],
    meshes: SkinnedMesh[] = [];
  working.traverse((node) => {
    if (node instanceof Bone) bones.push(node);
    if (node instanceof SkinnedMesh) meshes.push(node);
  });
  const initial = bones.map((bone) => ({
    bone,
    position: bone.position.clone(),
    rotation: bone.quaternion.clone(),
    scale: bone.scale.clone(),
  }));
  const knots = [0, 0.055, 0.14, 0.26, 0.39, 0.46, 0.5];
  const curve = (values: readonly number[], time: number): number => {
    const next = knots.findIndex((k) => k >= time);
    if (next <= 0) return values[0] ?? 0;
    const lo = knots[next - 1] ?? 0,
      hi = knots[next] ?? 0.5;
    const fraction = (time - lo) / (hi - lo),
      eased = fraction * fraction * (3 - 2 * fraction);
    return (values[next - 1] ?? 0) * (1 - eased) + (values[next] ?? 0) * eased;
  };
  return (['Punch', 'Kick'] as const).map((cause) => {
    const punch = cause === 'Punch';
    const rotations = new Map<string, number[]>(),
      positions: number[] = [];
    for (const { bone } of initial) rotations.set(bone.name, []);
    const times = Array.from({ length: 121 }, (_, i) => i / 240);
    for (const time of times) {
      for (const state of initial) {
        state.bone.position.copy(state.position);
        state.bone.quaternion.copy(state.rotation);
        state.bone.scale.copy(state.scale);
      }
      const rotate = (
        name: string,
        x: readonly number[],
        y: readonly number[] = [],
        z: readonly number[] = [],
      ) => {
        const bone = working.getObjectByName(name);
        if (bone)
          bone.quaternion.multiply(
            new Quaternion().setFromEuler(
              new Euler(curve(x, time), curve(y, time), curve(z, time), 'XYZ'),
            ),
          );
      };
      rotate(
        'pelvis',
        punch
          ? [0, -0.08, -0.15, -0.75, -1.48, -1.48, -1.48]
          : [0, 0.1, 0.25, 0.3, 0.2, 0.18, 0.18],
        [],
        punch ? [] : [0, -0.12, 0.38, 1.05, 1.55, 1.52, 1.52],
      );
      rotate(
        'spine01',
        punch
          ? [0, -0.12, 0.18, 0.32, -0.04, -0.07, -0.07]
          : [0, -0.12, 0.18, 0.32, 0.12, 0.1, 0.1],
      );
      rotate(
        'spine02',
        punch
          ? [0, -0.18, 0.22, 0.26, -0.03, -0.06, -0.06]
          : [0, -0.18, 0.22, 0.26, 0.08, 0.06, 0.06],
      );
      rotate(
        'chest',
        punch
          ? [0, -0.08, 0.15, 0.18, -0.02, -0.04, -0.04]
          : [0, -0.08, 0.15, 0.18, 0.06, 0.04, 0.04],
        [],
        punch ? [] : [0, 0.1, -0.15, 0.12, 0.42, 0.48, 0.48],
      );
      rotate('neck', [0, 0.08, 0.16, 0.12, 0.05, 0.03, 0.03]);
      rotate(
        'head',
        [0, 0.15, 0.3, 0.2, 0.1, 0.06, 0.06],
        [],
        punch ? [] : [0, 0, 0, 0.05, 0.08, 0.08, 0.08],
      );
      for (const side of ['L', 'R']) {
        const sign = side === 'L' ? 1 : -1;
        rotate(
          `upper_arm${side}`,
          [0, -0.2, -0.5, -0.35, -0.1, -0.04, -0.04],
          [],
          [
            0,
            sign * 0.1,
            sign * 0.25,
            sign * 0.4,
            sign * 0.2,
            sign * 0.14,
            sign * 0.14,
          ],
        );
        rotate(`forearm${side}`, [0, -0.3, -1.05, -0.7, -0.22, -0.12, -0.12]);
        rotate(`hand${side}`, [0, 0.1, 0.22, 0.12, 0, -0.05, -0.05]);
        rotate(
          `thigh${side}`,
          punch
            ? [0, -0.18, -0.7, -0.9, -0.22, -0.1, -0.1]
            : side === 'R'
              ? [0, -0.25, -0.65, -0.8, -0.55, -0.5, -0.5]
              : [0, -0.05, -0.2, -0.5, -0.4, -0.35, -0.35],
        );
        rotate(
          `shin${side}`,
          punch
            ? [0, 0.3, 1.1, 1.35, 0.35, 0.2, 0.2]
            : side === 'R'
              ? [0, 0.25, 0.9, 1.2, 0.8, 0.7, 0.7]
              : [0, 0.15, 0.5, 0.7, 0.5, 0.45, 0.45],
        );
        rotate(`foot${side}`, [0, -0.1, -0.3, -0.4, -0.12, -0.08, -0.08]);
      }
      if (!punch) {
        const left = working.getObjectByName('thighL');
        left?.quaternion.multiply(
          new Quaternion().setFromAxisAngle(
            new Vector3(0, 0, 1),
            curve([0, 0, 0.05, 0.15, 0.3, 0.32, 0.32], time),
          ),
        );
        const fold = curve([0, 0, 0, 0.4, 1, 1, 1], time);
        for (const side of ['L', 'R'])
          for (const part of ['upper_arm', 'forearm']) {
            working.updateMatrixWorld(true);
            const bone = working.getObjectByName(`${part}${side}`);
            if (!bone?.parent) continue;
            const desired = new Vector3(
              side === 'L' ? (part === 'upper_arm' ? -0.55 : 0) : 0.45,
              part === 'upper_arm' ? -0.65 : -0.35,
              part === 'upper_arm' ? 0.35 : 0.45,
            )
              .normalize()
              .applyQuaternion(pelvis.getWorldQuaternion(new Quaternion()))
              .applyQuaternion(
                bone.parent.getWorldQuaternion(new Quaternion()).invert(),
              );
            const target = new Quaternion()
              .setFromUnitVectors(
                new Vector3(0, 1, 0).applyQuaternion(bone.quaternion),
                desired,
              )
              .multiply(bone.quaternion);
            bone.quaternion.slerp(target, fold);
          }
      }
      pelvis.position.y += curve(
        [0, -0.04, -0.23, -0.52, -0.86, -0.9, -0.9],
        time,
      );
      pelvis.position.z += curve(
        punch
          ? [0, -0.02, -0.08, -0.22, -0.38, -0.4, -0.4]
          : [0, 0.02, 0.05, 0.12, 0.17, 0.18, 0.18],
        time,
      );
      pelvis.position.x += curve(
        punch
          ? [0, 0, 0, 0, 0, 0, 0]
          : [0, 0.01, -0.07, -0.22, -0.38, -0.4, -0.4],
        time,
      );
      working.updateMatrixWorld(true);
      let minimum = Infinity;
      const point = new Vector3();
      for (const mesh of meshes) {
        mesh.skeleton.update();
        for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++)
          minimum = Math.min(
            minimum,
            mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).y,
          );
      }
      if (Number.isFinite(minimum) && time > 0) {
        const clearance = 0.002 * Math.min(1, time / 0.055);
        const target = pelvis.getWorldPosition(new Vector3());
        target.y += clearance - minimum;
        pelvis.position.copy(
          pelvis.parent ? pelvis.parent.worldToLocal(target) : target,
        );
      }
      positions.push(...pelvis.position.toArray());
      for (const { bone } of initial)
        rotations.get(bone.name)?.push(...bone.quaternion.toArray());
    }
    const tracks = [...rotations].map(
      ([name, values]) =>
        new QuaternionKeyframeTrack(`${name}.quaternion`, times, values),
    );
    const fixedPositions = initial
      .filter((state) => state.bone !== root && state.bone !== pelvis)
      .map(
        (state) =>
          new VectorKeyframeTrack(
            `${state.bone.name}.position`,
            [0, 0.5],
            [...state.position.toArray(), ...state.position.toArray()],
          ),
      );
    const fixedScales = initial.map(
      (state) =>
        new VectorKeyframeTrack(
          `${state.bone.name}.scale`,
          [0, 0.5],
          [...state.scale.toArray(), ...state.scale.toArray()],
        ),
    );
    return new AnimationClip(`Defeat${cause}`, 0.5, [
      ...tracks,
      ...fixedPositions,
      ...fixedScales,
      new VectorKeyframeTrack('pelvis.position', times, positions),
    ]);
  });
}
