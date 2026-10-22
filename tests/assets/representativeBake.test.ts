import { Vector3 } from 'three';
import { createThreeAssetPack } from '../../src/assets/threeAssetPack';
import { selectSkinSurface } from '../../src/assets/skinSurface';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createMotionCatalog } from '../../src/assets/motionCatalog';
import { durationMs } from '../../src/contracts';
import {
  bakeRepresentative,
  sha256,
} from '../../tools/assets/representativeBake';

const artifacts = new Map<string, ReturnType<typeof bakeRepresentative>>();
function artifactFor(category: 'punch' | 'kick') {
  let pending = artifacts.get(category);
  if (!pending) {
    const sourcePath = `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`;
    const manifestPath = `assets/android/motions/completed42-speed15/${category}/manifest.json`;
    const bytes = readFileSync(sourcePath);
    pending = bakeRepresentative({
      category,
      bytes,
      manifestBytes: readFileSync(manifestPath),
      expectedGlbSha256: sha256(bytes),
      sourcePath,
      manifestPath,
    });
    artifacts.set(category, pending);
  }
  return pending;
}

for (const category of ['punch', 'kick'] as const) {
  test(`${category} representative retains exact source keys and explicit provisional provenance`, async () => {
    const sourcePath = `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`;
    const manifestPath = `assets/android/motions/completed42-speed15/${category}/manifest.json`;
    const bytes = readFileSync(sourcePath),
      manifestBytes = readFileSync(manifestPath);
    await expect(
      bakeRepresentative({
        category,
        bytes,
        manifestBytes,
        expectedGlbSha256: 'wrong',
        sourcePath,
        manifestPath,
      }),
    ).rejects.toThrow('Source hash');
    const result = await artifactFor(category);
    expect(result.status).toBe('PROVISIONAL_DIAGNOSTIC_NOT_PRODUCTION_READY');
    expect(
      result.candidate.definition.rootCurve.every(
        (key) => key.position.y === 0,
      ),
    ).toBe(true);
    expect(
      result.candidate.ownership.every(
        (key) => key.verticalOwner === 'spatial-jump',
      ),
    ).toBe(true);
    expect(result.rawRootCurve.some((key) => key.position.y < -0.002)).toBe(
      true,
    );
    expect(result.rootPolicy.mode).toBe('grounded-posture-y');
    expect(result.annotation.window.initialHoldEndMs).toBeGreaterThan(0);
    expect(result.annotation.window.acceptance).toBe('provisional-policy');
    expect(
      result.source.binaryAccessorTimesSeconds.every((time) =>
        result.candidate.definition.rootCurve.some(
          (key) => key.atMs === time * 1000,
        ),
      ),
    ).toBe(true);
    expect(
      result.surfaceSelections.every((surface) =>
        surface.meshes.every(
          (mesh) =>
            mesh.sourceMeshIndex !== undefined &&
            mesh.sourcePrimitiveIndex !== undefined &&
            mesh.vertexIndices.length > 0,
        ),
      ),
    ).toBe(true);
    expect(result.candidate.definition.effectiveRangeM).toBeGreaterThan(0);
    expect(sha256(bytes)).toBe(result.source.sha256);
    const catalog = createMotionCatalog(async () => [result.candidate]);
    try {
      await catalog.prepare(new AbortController().signal);
      const peak = result.annotation.window.peakMs;
      expect(
        catalog.sampleMotion(
          result.candidate.definition.clipId,
          durationMs(peak),
          durationMs(peak + 1),
        )?.hitVolumeSegments.length,
      ).toBeGreaterThan(0);
      const end = result.annotation.window.endMs;
      expect(
        catalog.sampleMotion(
          result.candidate.definition.clipId,
          durationMs(end),
          durationMs(end + 1),
        )?.hitVolumeSegments,
      ).toHaveLength(0);
    } finally {
      catalog.dispose();
    }
  }, 120000);
}

for (const category of ['punch', 'kick'] as const) {
  test(`${category} interpolated active envelope contains the independently posed rendered surface`, async () => {
    const sourcePath = `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`;
    const bytes = readFileSync(sourcePath);
    const artifact = await artifactFor(category);
    const pack = await createThreeAssetPack(
      [bytes],
      {},
      [],
      [artifact.rootPolicy],
    );
    const actor = pack.create('white');
    const catalog = createMotionCatalog(async () => [artifact.candidate]);
    try {
      await catalog.prepare(new AbortController().signal);
      const joint = actor.node.getObjectByName(
        category === 'punch' ? 'handR' : 'footR',
      );
      if (!joint) throw new Error('Missing strike joint');
      const surface = selectSkinSurface(actor.node, joint);
      const keys = artifact.candidate.shapes[0]?.keys;
      if (!keys) throw new Error('Missing shape curve');
      let maximumOutsideM = -Infinity;
      for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1],
          b = keys[i];
        if (!a || !b) throw new Error('Missing curve interval');
        for (const fraction of [0.25, 0.5, 0.75]) {
          const atMs = a.atMs + (b.atMs - a.atMs) * fraction;
          if (
            atMs < artifact.annotation.window.startMs ||
            atMs >= artifact.annotation.window.endMs
          )
            continue;
          const volume = catalog.sampleMotion(
            artifact.candidate.definition.clipId,
            durationMs(atMs),
            durationMs(Math.min(atMs + 0.01, artifact.annotation.window.endMs)),
          )?.hitVolumeSegments[0]?.from;
          if (volume?.kind !== 'sphere')
            throw new Error('Missing active sphere');
          actor.seek(artifact.candidate.definition.clipId, atMs / 1000);
          const center = new Vector3(
            volume.center.x,
            volume.center.y,
            volume.center.z,
          );
          for (const { mesh, vertexIndices } of surface) {
            mesh.skeleton.update();
            for (const index of vertexIndices) {
              const vertex = mesh
                .getVertexPosition(index, new Vector3())
                .applyMatrix4(mesh.matrixWorld);
              maximumOutsideM = Math.max(
                maximumOutsideM,
                vertex.distanceTo(center) - volume.radiusM,
              );
            }
          }
        }
      }
      expect(maximumOutsideM).toBeLessThanOrEqual(1e-6);
    } finally {
      catalog.dispose();
      actor.dispose();
      pack.dispose();
    }
  }, 120000);
}
