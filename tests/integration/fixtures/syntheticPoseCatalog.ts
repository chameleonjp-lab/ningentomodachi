/** TEST ONLY. Complete configured clip IDs and exact visual durations, but ALL
 * impacts/windows, shapes, ranges and root/ownership curves below are synthetic.
 * They intentionally produce no contacts. Never import into production loaders. */
import { readFileSync } from 'node:fs';
import type { MotionAsset, ThreeAssetPack } from '../../../src/assets';
import {
  type ActorColor,
  clipId,
  durationMs,
  type MoveSet,
} from '../../../src/contracts';

function eligibleClips() {
  const index: { clips: Array<{ clip: string; primary_category: string }> } =
    JSON.parse(
      readFileSync(
        'assets/android/motions/completed42-speed15/index.json',
        'utf8',
      ),
    );
  return index.clips.filter(
    (clip) =>
      ['punch', 'kick'].includes(clip.primary_category) &&
      clip.clip !== 'AcrobaticCombo',
  );
}

export function createSyntheticTimingCatalog(pack: ThreeAssetPack) {
  const motions: MotionAsset[] = eligibleClips().map((clip) => {
    const id = clipId(clip.clip),
      end = pack.clipDuration(id);
    if (end === undefined)
      throw new Error('Required diagnostic visual missing');
    const at = [durationMs(0), end];
    return {
      definition: {
        clipId: id,
        category: clip.primary_category as 'punch' | 'kick',
        durationMs: end,
        effectiveRangeM: 1,
        impacts: [
          {
            impactIndex: 0,
            startMs: durationMs(0),
            endMs: end,
            damageShare: 1,
            shapeId: 'SYNTHETIC-NO-CONTACT',
          },
        ],
        rootCurve: at.map((atMs) => ({
          atMs,
          position: { x: 0, y: 0, z: 0 },
          visualYawRad: 0,
        })),
        sampling: {
          version: 1,
          sampleRateHz: 1,
          interpolation: 'piecewise-linear',
        },
      },
      shapes: [
        {
          shapeId: 'SYNTHETIC-NO-CONTACT',
          keys: at.map((atMs) => ({
            atMs,
            volume: {
              kind: 'sphere',
              center: { x: 0, y: 100, z: 0 },
              radiusM: 0.001,
            },
          })),
        },
      ],
      ownership: [
        {
          atMs: durationMs(0),
          horizontalOwner: 'spatial-movement',
          verticalOwner: 'spatial-jump',
        },
      ],
    };
  });
  return { motions, moves: syntheticTimingMoves() };
}

/** Configuration IDs can be prepared before any actual pack/rig allocation. */
export function syntheticTimingMoves(): Record<ActorColor, MoveSet> {
  const clips = eligibleClips();
  const punches = clips
    .filter((clip) => clip.primary_category === 'punch')
    .map((clip) => clipId(clip.clip));
  const kicks = clips
    .filter((clip) => clip.primary_category === 'kick')
    .map((clip) => clipId(clip.clip));
  if (punches.length !== 12 || kicks.length !== 19)
    throw new Error('Diagnostic roster drift');
  // Diagnostic partition only, not a production enemy move configuration.
  const moves: Record<ActorColor, MoveSet> = {
    white: { punches, kicks },
    black: { punches: [], kicks },
    blue: { punches: punches.slice(0, 4), kicks: kicks.slice(0, 4) },
    green: { punches: punches.slice(4, 8), kicks: kicks.slice(4, 8) },
    yellow: { punches: punches.slice(8, 12), kicks: kicks.slice(8, 12) },
  };
  return moves;
}
