/** Saved bytes and production catalog only. No source evaluator or external cache. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createMotionCatalog } from '../../src/assets/motionCatalog';
import { durationMs } from '../../src/contracts';
import { localToWorld } from '../../src/world/math';
import type { bakeKickComboFourCollisionCandidate } from '../../tools/assets/bakeKickComboFourCollisionCandidate';
type Candidate = Awaited<
  ReturnType<typeof bakeKickComboFourCollisionCandidate>
> & { readonly acceptance: null };
const directory = 'tests/assets/fixtures/kick-combo-four-whole-foot-v1/';
const raw = readFileSync(`${directory}candidate.json.fixture`);
const candidate = JSON.parse(raw.toString()) as Candidate;
const recipe = JSON.parse(
  readFileSync(`${directory}recipe.json.fixture`, 'utf8'),
);
const sha = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
const asset = candidate.asset;
test('pins exact saved bytes and native source provenance without loading source', () => {
  expect(raw.length).toBe(281988);
  expect(sha(raw)).toBe(
    '72f5cb0a81b910d3238d073acdbd26e2d1b6431a93fa4bf4b3a240714e763f76',
  );
  expect(recipe.candidateSha256).toBe(sha(raw));
  expect(recipe.sourcePins).toEqual(candidate.declaration.sourcePins);
  expect(recipe.nativeTimesSha256).toBe(
    '1f4e830ec599551be7ac8e9cc58d113d388417ec5326b2921a88133865f7c031',
  );
});
test('retains null acceptance and explicit whole-foot versus finer source caveats', () => {
  expect(candidate.acceptance).toBeNull();
  expect(recipe.acceptance).toBeNull();
  expect(candidate.declaration.model.includesShin).toBe(false);
  expect(candidate.declaration.model.narrowPatchUnion).toBe(false);
  expect(candidate.declaration.events.map((e) => e.sourceEvent.limb)).toEqual([
    'right foot',
    'right heel/sole',
    'right instep/shin',
    'right foot',
  ]);
  expect(recipe.model.limitation).toContain('other foot surfaces');
  expect(recipe.model.limitation).toContain('excludes shin');
});
test('preserves ordered rendered vertex identities and startup-inclusive measured budget', () => {
  const meshes = candidate.surfaceSelections[0]?.meshes ?? [];
  expect(meshes.map((m) => m.vertexIndices.length)).toEqual([
    615, 440, 386, 588, 255,
  ]);
  expect(meshes.map((m) => sha(JSON.stringify(m.vertexIndices)))).toEqual(
    recipe.selectionHashes,
  );
  expect(recipe.schedule).toEqual({
    baseKeys: 859,
    probeKeys: 477,
    uniquePoses: 1336,
    startupUpdates: 1,
    sourceUpdates: 1337,
    verticesPerPose: 2284,
    vertexEvaluations: 3051424,
  });
  expect(asset.shapes[0]?.keys).toHaveLength(859);
});
test('preserves four distinct half-open impacts with one shared curve and provisional total damage one', () => {
  expect(asset.shapes).toHaveLength(1);
  expect(asset.definition.impacts.map((i) => i.impactIndex)).toEqual([
    0, 1, 2, 3,
  ]);
  expect(asset.definition.impacts.map((i) => [i.startMs, i.endMs])).toEqual([
    [444.4444477558136, 533.3333611488342],
    [911.1111164093018, 1000],
    [1466.6666984558105, 1622.2223043441772],
    [2244.4443702697754, 2466.6666984558105],
  ]);
  expect(
    asset.definition.impacts.reduce((sum, i) => sum + i.damageShare, 0),
  ).toBe(1);
  expect(new Set(asset.definition.impacts.map((i) => i.shapeId)).size).toBe(1);
  expect(recipe.damageShareOrigin).toContain('provisional');
});
test('loads saved asset through actual catalog and preserves all four measured peak witnesses', async () => {
  const catalog = createMotionCatalog(async () => [asset]);
  try {
    await catalog.prepare(new AbortController().signal);
    for (const witness of recipe.peakWitnesses) {
      const sample = catalog.sampleMotion(
        asset.definition.clipId,
        durationMs(witness.atMs),
        durationMs(witness.atMs + 0.001),
      );
      if (!sample) throw new Error('Missing saved candidate sample');
      expect(
        sample.hitVolumeSegments.find(
          (s) => s.impactIndex === witness.impactIndex,
        )?.from,
      ).toEqual(witness.volume);
    }
  } finally {
    catalog.dispose();
  }
});
test('keeps native geometry once with zero transport and explicit local-only evidence limits', () => {
  expect(candidate.declaration.rootPolicy.mode).toBe('in-place-posture-xyz');
  for (const key of asset.definition.rootCurve) {
    expect(key.position).toEqual({ x: 0, y: 0, z: 0 });
  }
  expect(sha(JSON.stringify(asset.definition.rootCurve))).toBe(
    'e070dded3001953281a974ee507f1d04be7f90c9fb943f8fee8bdbee49a6f14b',
  );
  const yaws = asset.definition.rootCurve.map((key) => key.visualYawRad);
  expect(yaws.filter((yaw) => yaw !== 0)).toHaveLength(543);
  expect(Math.min(...yaws)).toBe(-0.2000000119780635);
  expect(Math.max(...yaws)).toBe(0.8500000549101201);
  expect(recipe.rootCurveWitness.sha256).toBe(
    sha(JSON.stringify(asset.definition.rootCurve)),
  );
  for (const witness of recipe.peakWitnesses) {
    const p = witness.volume.center;
    expect(localToWorld(p, { x: 1, y: 0, z: 0 })).toEqual({
      x: p.z,
      y: p.y,
      z: -p.x,
    });
  }
  expect(recipe.externalEvidence.availability).toContain('local-only');
  expect(recipe.diagnosticResult.sourceCalls).toBe(0);
  expect(recipe.finiteProbeLimit).toContain('not continuous');
});
