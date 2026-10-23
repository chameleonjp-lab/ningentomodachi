/** Finite CPU composition only. Synthetic probe spheres are NOT attacks,
 * gameplay allowances, solid occupancy, continuous collision or HP authority.
 * Source transforms are sampled at explicitly selected local times, not inferred
 * from a rendered actor or advertised as an admitted simulation interval. */
import { readFileSync } from 'node:fs';
import { Matrix4, Triangle, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { preparePinnedSourceHead } from '../../src/assets/headSurface';
import { durationMs } from '../../src/contracts';
import { prepareHeadSurface } from '../../src/world/source-head-query';

test('pinned source head transforms compose with the finite surface query without a runtime contact path', async () => {
  const provider = await preparePinnedSourceHead({
    derivedBytes: new Uint8Array(
      readFileSync('public/game-assets/android/derived-pack-v1.glb'),
    ),
    signal: new AbortController().signal,
  });
  try {
    const surface = prepareHeadSurface(provider.descriptor.triangles);
    expect(surface.triangleCount).toBe(4326);
    const descriptorBefore = JSON.stringify(provider.descriptor);
    // Explicit synthetic physical anchor/facing, applied once after B's
    // root-policy-aware actor-local source transform. No scale or pose offset.
    const anchor = new Matrix4().makeTranslation(0.7, 2, -0.8);
    anchor.multiply(new Matrix4().makeRotationY(0.43));
    const selections = [
      ['Idle', 0],
      ['Uppercut', 0.731],
      ['Jump', 0.5],
      ['Idle', 0],
    ] as const;
    const results: unknown[] = [];
    const matrices: string[] = [];
    for (const [name, fraction] of selections) {
      const binding = provider.poseBindings.clips.find(
        (candidate) => candidate.clipId === name,
      );
      if (!binding) throw new Error(`Missing pinned binding ${name}`);
      const sample = provider.evaluate(
        binding,
        durationMs(binding.durationMs * fraction),
      );
      expect(sample.kind).toBe('transform');
      if (sample.kind !== 'transform') throw new Error(sample.reason);
      expect(sample.numerics).toBe('cpu-float64-not-certified');
      const world = anchor
        .clone()
        .multiply(new Matrix4().fromArray(sample.matrix));
      matrices.push(JSON.stringify(world.toArray()));
      // Independent exhaustive traversal verifies the acceleration/composition
      // boundary without changing source geometry or capturing a mesh fixture.
      const faces = provider.descriptor.triangles.map((face) => ({
        primitive: face.primitive,
        triangleIndex: face.triangleIndex,
        triangle: new Triangle(
          ...(face.vertices.map((p) =>
            new Vector3(p.x, p.y, p.z).applyMatrix4(world),
          ) as [Vector3, Vector3, Vector3]),
        ),
      }));
      const first = faces[0];
      if (!first) throw new Error('Pinned source has no head surface');
      const onSurface = first.triangle.getMidpoint(new Vector3());
      const probes = [
        { center: onSurface, radiusM: 0.0001, expectedOverlap: true },
        {
          center: new Vector3(100, -80, 70),
          radiusM: 0.001,
          expectedOverlap: false,
        },
      ];
      const poseResults = [];
      for (const probe of probes) {
        let nearest = Infinity;
        for (const face of faces) {
          const closest = face.triangle.closestPointToPoint(
            probe.center,
            new Vector3(),
          );
          nearest = Math.min(nearest, closest.distanceTo(probe.center));
        }
        const result = surface.query(world.toArray(), probe);
        expect(result.kind).toBe('surface-distance');
        if (result.kind !== 'surface-distance') throw new Error(result.reason);
        expect(result.numerics).toBe('float64-not-certified');
        expect(result.distanceM).toBeCloseTo(nearest, 10);
        expect(result.sphereGapM).toBeCloseTo(nearest - probe.radiusM, 10);
        expect(result.overlap).toBe(probe.expectedOverlap);
        const witness = faces.find(
          (face) =>
            face.primitive === result.triangle.primitive &&
            face.triangleIndex === result.triangle.triangleIndex,
        );
        if (!witness) throw new Error('Query lost original source identity');
        const reconstructed = witness.triangle.a
          .clone()
          .multiplyScalar(result.barycentric.x)
          .addScaledVector(witness.triangle.b, result.barycentric.y)
          .addScaledVector(witness.triangle.c, result.barycentric.z);
        expect(
          reconstructed.distanceTo(
            new Vector3(
              result.closestPoint.x,
              result.closestPoint.y,
              result.closestPoint.z,
            ),
          ),
        ).toBeLessThan(1e-10);
        poseResults.push(result);
      }
      results.push(poseResults);
    }
    expect(new Set(matrices).size).toBeGreaterThan(1);
    expect(results[3]).toEqual(results[0]);
    expect(JSON.stringify(provider.descriptor)).toBe(descriptorBefore);
    const binding = provider.poseBindings.clips[0];
    if (!binding) throw new Error('Missing pinned pose bindings');
    expect(
      provider.evaluate(
        { ...binding, sourceBindingId: 'untrusted' },
        durationMs(0),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'invalid-binding' });
    provider.dispose();
    expect(provider.evaluate(binding, durationMs(0))).toEqual({
      kind: 'unavailable',
      reason: 'disposed',
    });
    // Unavailable is intentionally not converted to an identity transform,
    // empty geometry, a SpatialCandidate, or an authoritative Core command.
  } finally {
    provider.dispose();
  }
}, 30000);
