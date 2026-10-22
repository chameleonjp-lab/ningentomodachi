/** Actual two-resident B/C world/camera qualification. Authority is synthetic, not combat acceptance. */
import { writeFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { deathClipSeconds } from '../../src/assets';
import { actorId } from '../../src/contracts';
import { viewport as baseViewport } from '../world/fixtures';
import {
  createDuelWorld,
  loadDuelAssets,
  projectedWorldBounds,
  worldSurface,
} from './fixtures/twoResidentWorld';
import { exportWorldPose } from './fixtures/worldPoseExport';

let assets: Awaited<ReturnType<typeof loadDuelAssets>>;
const reports: unknown[] = [];
beforeAll(async () => {
  assets = await loadDuelAssets();
}, 120000);
afterAll(() => {
  assets?.pack.dispose();
  if (process.env.DUEL_QUALIFICATION_OUTPUT_FILE)
    writeFileSync(
      process.env.DUEL_QUALIFICATION_OUTPUT_FILE,
      JSON.stringify(
        {
          scope:
            'Two actual source rigs, synthetic death authority, actual C production street camera. Actor-only exports do not prove rendered street occlusion/device performance.',
          reports,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
});
for (const [sourceCategory, name, entry] of [
  ['kick', 'ChineseCartwheelKick', 1.04],
  ['punch', 'DivingLunge', 0.6611110925674438],
] as const)
  for (const victim of ['white', 'blue'] as const)
    for (const orientation of ['portrait', 'landscape'] as const)
      test(`${name}/${victim}/${orientation}: both real residents stay framed through death and retirement`, async () => {
        const viewport = {
          ...baseViewport,
          widthCssPx: orientation === 'portrait' ? 400 : 800,
          heightCssPx: orientation === 'portrait' ? 800 : 400,
        };
        for (const deathCategory of ['punch', 'kick'] as const) {
          const bytes = assets.sources.get(sourceCategory);
          if (!bytes) throw Error('Missing original bytes');
          const h = await createDuelWorld(
            assets.pack,
            bytes,
            name,
            victim,
            viewport,
          );
          try {
            expect([...h.rigs.keys()]).toEqual(['white', 'blue']);
            expect(h.snapshot.actors).toHaveLength(5);
            expect(h.snapshot.residentActorIds).toEqual([
              actorId('white'),
              actorId('blue'),
            ]);
            expect(h.snapshot.currentOpponentId).toBe(actorId('blue'));
            const entered = h.advanceTo(entry);
            const rig = h.rigs.get(victim)!,
              witnessColor = victim === 'white' ? 'blue' : 'white',
              witness = h.rigs.get(witnessColor)!;
            const entryBounds = worldSurface(rig.node),
              witnessBounds = worldSurface(witness.node);
            const initialPhysical = entered.spatial.actors.find(
              (a) => a.actorId === actorId(victim),
            )!;
            const witnessPhysical = entered.spatial.actors.find(
              (a) => a.actorId === actorId(witnessColor),
            )!;
            expect(initialPhysical.facing.z).toBeCloseTo(
              victim === 'white' ? 1 : -1,
              14,
            );
            const death = h.beginDeath(deathCategory);
            const samples: unknown[] = [],
              cameraSteps: unknown[] = [];
            let previousCamera = h.camera.position.clone();
            for (let i = 0; i <= 120; i++) {
              const seconds = i / 240;
              const elapsed =
                seconds <= death.slowDurationMs * 0.00025
                  ? seconds * 4000
                  : death.slowDurationMs +
                    (seconds - death.slowDurationMs * 0.00025) * 1000;
              const draws = h.draws,
                frame = h.presentDeath(elapsed);
              expect(h.draws).toBe(draws + 1);
              expect(
                frame.spatial.actors.find((a) => a.actorId === actorId(victim))
                  ?.position,
              ).toEqual(initialPhysical.position);
              expect(
                frame.spatial.actors.find(
                  (a) => a.actorId === actorId(witnessColor),
                )?.position,
              ).toEqual(witnessPhysical.position);
              const support = rig.defeatPoseSupport?.();
              if (!support) throw Error('Missing actual B bounds');
              const bounds = {
                min: new Vector3(Infinity, Infinity, Infinity),
                max: new Vector3(-Infinity, -Infinity, -Infinity),
                vertices: 0,
              };
              const parent = rig.node.parent;
              if (!parent) throw Error('Unattached resident');
              for (const x of [
                support.currentLocalBounds.min.x,
                support.currentLocalBounds.max.x,
              ])
                for (const y of [
                  support.currentLocalBounds.min.y,
                  support.currentLocalBounds.max.y,
                ])
                  for (const z of [
                    support.currentLocalBounds.min.z,
                    support.currentLocalBounds.max.z,
                  ]) {
                    const p = new Vector3(x, y, z).applyMatrix4(
                      parent.matrixWorld,
                    );
                    bounds.min.min(p);
                    bounds.max.max(p);
                  }
              const expectedSupport =
                entryBounds.min.y +
                ((0.002 - entryBounds.min.y) * seconds) / 0.5;
              expect(bounds.min.y).toBeCloseTo(expectedSupport, 5);
              for (const b of [bounds, witnessBounds]) {
                const projection = projectedWorldBounds(b, h.camera);
                expect(projection.maxXY).toBeLessThanOrEqual(1.000001);
                expect(projection.minDepth).toBeGreaterThanOrEqual(-1);
                expect(projection.maxDepth).toBeLessThanOrEqual(1);
              }
              const cameraStep = h.camera.position.distanceTo(previousCamera);
              expect(Number.isFinite(cameraStep)).toBe(true);
              cameraSteps.push({
                elapsed,
                position: h.camera.position.toArray(),
                stepM: cameraStep,
              });
              previousCamera = h.camera.position.clone();
              if ([0, 24, 60, 90, 120].includes(i)) {
                const actors = [...h.rigs].map(([color, r]) => ({
                  actorId: actorId(color),
                  color,
                  bounds: worldSurface(r.node),
                  physical: frame.spatial.actors.find(
                    (a) => a.actorId === actorId(color),
                  ),
                }));
                for (const a of actors) {
                  expect(a.bounds.vertices).toBe(46181);
                  expect(
                    projectedWorldBounds(a.bounds, h.camera).maxXY,
                  ).toBeLessThanOrEqual(1.000001);
                }
                const metadata = {
                  sourceCategory,
                  name,
                  victim,
                  deathCategory,
                  orientation,
                  entry,
                  clipSeconds: deathClipSeconds(
                    death,
                    frame.snapshot.clocks.presentationTimeMs,
                  ),
                  presentationElapsedMs: elapsed,
                  death,
                  clocks: frame.snapshot.clocks,
                  residentActorIds: frame.snapshot.residentActorIds,
                  actors,
                  viewport,
                  scope:
                    'Actual production street affects C camera/collisions; exported geometry contains both robot meshes only, not the street.',
                };
                samples.push(metadata);
                if (process.env.DUEL_WORLD_EXPORT_DIRECTORY)
                  exportWorldPose(
                    process.env.DUEL_WORLD_EXPORT_DIRECTORY,
                    `${name}-${deathCategory}-${victim}-${orientation}-${i}`,
                    h.renderedScene,
                    h.camera,
                    metadata,
                  );
              }
            }
            expect(worldSurface(rig.node).min.y).toBeCloseTo(0.002, 5);
            expect(h.camera.position.y).not.toBe(5); // Blue cases cannot silently retain C's initial camera.
            // Record continuous-step displacement, not an invented aesthetic smoothness threshold.
            reports.push({
              name,
              victim,
              orientation,
              deathCategory,
              samples,
              cameraSteps,
            });
            if (victim === 'blue') {
              const saved = h.frame;
              const blue = rig.node;
              // Authoritative retirement removes blue; historical replay must never recreate it.
              h.retireBlue();
              expect([...h.rigs.keys()]).toEqual(['white', 'green']);
              expect(blue.parent).toBeNull();
              expect(h.events.indexOf('dispose:blue:detached')).toBeLessThan(
                h.events.indexOf('create:green'),
              );
              expect(() => h.scene.render(saved)).toThrow(
                'Retired actor cannot be recreated or visually replayed',
              );
            }
          } finally {
            h.dispose();
          }
        }
      }, 120000);

test('two actual rigs preserve ordinary tail movement/jump and retire before next mount', async () => {
  const bytes = assets.sources.get('punch');
  if (!bytes) throw Error('Missing source');
  const h = await createDuelWorld(
    assets.pack,
    bytes,
    'DivingLunge',
    'blue',
    baseViewport,
  );
  try {
    h.advanceTo(0.6611110925674438);
    const death = h.beginDeath('kick');
    h.presentDeath(1500);
    expect(h.snapshot.presentation.kind).toBe('opponent-defeat-finish');
    const before = h.frame.spatial.actors.find(
      (a) => a.actorId === actorId('white'),
    )!;
    const victim = h.frame.spatial.actors.find(
      (a) => a.actorId === actorId('blue'),
    )!;
    const moved = h
      .tailStep(50, true)
      .spatial.actors.find((a) => a.actorId === actorId('white'))!;
    expect(moved.position.y).toBeGreaterThan(before.position.y);
    expect(
      Math.hypot(
        moved.position.x - before.position.x,
        moved.position.z - before.position.z,
      ),
    ).toBeGreaterThan(0);
    h.tailStep(75);
    expect(
      h.frame.spatial.actors.find((a) => a.actorId === actorId('blue'))
        ?.position,
    ).toEqual(victim.position);
    expect(
      deathClipSeconds(death, h.snapshot.clocks.presentationTimeMs),
    ).toBeCloseTo(0.5, 10);
    for (const rig of h.rigs.values())
      expect(
        projectedWorldBounds(worldSurface(rig.node), h.camera).maxXY,
      ).toBeLessThanOrEqual(1.000001);
    const history = h.frame;
    h.retireBlue();
    expect([...h.rigs.keys()]).toEqual(['white', 'green']);
    expect(h.events.indexOf('dispose:blue:detached')).toBeLessThan(
      h.events.indexOf('create:green'),
    );
    expect(() => h.scene.render(history)).toThrow(
      'Retired actor cannot be recreated or visually replayed',
    );
  } finally {
    h.dispose();
  }
}, 120000);
