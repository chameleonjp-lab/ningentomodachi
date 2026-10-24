import { clipId, type ActorColor, type MoveSet } from '../contracts';
import { createParisStreetLayout } from '../scene';
import { decodeMotionAssetJson } from '../assets/motionAssetJson';
import { copyRootPolicy, type ClipRootPolicy } from '../assets/rootPolicy';
import { createPinnedDerivedThreeAssetPack } from '../assets/derivedAssetPack';
import {
  diagnoseCatalog,
  type CatalogCandidate,
  type InventoryMotion,
} from '../qualification/catalogAdmission';
import { prepareGameAssetBundle } from './prepareGameAssetBundle';
import type { AcceptedGameConfiguration } from './integratedGame';
import type { ThreeAssetPack } from '../assets/threeAssetPack';

export const PREVIEW_NOTICE =
  '実機確認用・未受入試験版。技・当たり判定・色別割当・バランスは仮設定です。完成版の受入を意味しません。';
export interface PreviewCatalogPin {
  readonly bytes: number;
  readonly sha256: string;
}
// Verified saved CI representatives + 29 diagnostic candidates; not acceptance.
// Three diagnostic impactId fields are retained in provenance and inverse-reconstructed exactly.
export const PREVIEW_CATALOG_PIN: PreviewCatalogPin | null = Object.freeze({
  bytes: 15711286,
  sha256: '0746cf12f393e9d083fbfd91b1a49bed64591f21ffbc614a7fd05c42ec417b9e',
});
const punches = [
    'Jab',
    'Cross',
    'Hook',
    'Uppercut',
    'PunchCombo4',
    'FlippingSlash',
    'DivingLunge',
    'KungFuStraight',
    'PalmStrike',
    'WhippingStrike',
    'ElbowStrike',
    'KungFuHandCombo5',
  ].map(clipId),
  kicks = [
    'FrontKick',
    'SideKick',
    'RoundhouseKick',
    'LowSweep',
    'KickCombo4',
    'SpinningAttack',
    'AerialKnee',
    'CartwheelKick',
    'FrontThrustKick',
    'SideThrustKick',
    'OutsideCrescentKick',
    'KungFuSweep',
    'KungFuKickChain4',
    'TornadoKick',
    'FlyingKick',
    'ButterflyKick',
    'ChineseCartwheelKick',
    'ChineseAerialKnee',
    'KungFuAcrobaticCombo',
  ].map(clipId);
const moveSet = (p: readonly string[], k: readonly string[]): MoveSet =>
  Object.freeze({
    punches: Object.freeze(p.map(clipId)),
    kicks: Object.freeze(k.map(clipId)),
  });
// v6 proposals, not final balance acceptance. White 12+19, black all 19 kicks.
export const PREVIEW_MOVES: Readonly<Record<ActorColor, MoveSet>> =
  Object.freeze({
    white: moveSet(punches, kicks),
    black: moveSet([], kicks),
    blue: moveSet(
      ['Jab', 'Cross', 'KungFuStraight', 'PalmStrike'],
      ['FrontKick', 'SideKick', 'FrontThrustKick', 'SideThrustKick'],
    ),
    green: moveSet(
      ['Hook', 'Uppercut', 'WhippingStrike', 'ElbowStrike'],
      ['RoundhouseKick', 'LowSweep', 'OutsideCrescentKick', 'KungFuSweep'],
    ),
    yellow: moveSet(
      ['PunchCombo4', 'KungFuHandCombo5', 'FlippingSlash', 'DivingLunge'],
      ['TornadoKick', 'FlyingKick', 'ButterflyKick', 'ChineseAerialKnee'],
    ),
  });
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('Invalid preview record');
  return v as Record<string, unknown>;
};
const digest = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
export async function validatePreviewEnvelope(
  bytes: Uint8Array,
  pin: PreviewCatalogPin | null,
): Promise<readonly CatalogCandidate[]> {
  if (
    !pin ||
    !Number.isSafeInteger(pin.bytes) ||
    pin.bytes <= 0 ||
    !/^[0-9a-f]{64}$/.test(pin.sha256)
  )
    throw new Error('Missing preview catalog pin');
  const captured = new Uint8Array(bytes),
    expected = { ...pin };
  if (captured.length !== expected.bytes)
    throw new Error('Preview catalog byte mismatch');
  if ((await digest(captured)) !== expected.sha256)
    throw new Error('Preview catalog hash mismatch');
  const value = record(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(captured)),
  );
  if (
    value.schemaVersion !== 1 ||
    value.status !== 'diagnostic-device-preview' ||
    value.acceptance !== null
  )
    throw new Error('Invalid preview qualification');
  if (
    !Array.isArray(value.inventory) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length !== 31
  )
    throw new Error('Preview requires 31 candidates');
  const candidates = value.candidates.map((input): CatalogCandidate => {
    const row = record(input),
      origin = record(row.origin),
      qualification = record(row.qualification);
    if (
      qualification.acceptance !== null ||
      typeof origin.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(origin.sha256) ||
      typeof origin.pointer !== 'string' ||
      !origin.pointer.startsWith('/')
    )
      throw new Error('Invalid preview provenance/qualification');
    if (!Array.isArray(row.events)) throw new Error('Invalid preview events');
    return {
      asset: decodeMotionAssetJson(row.asset),
      rootPolicy: copyRootPolicy(row.rootPolicy as ClipRootPolicy),
      events: row.events as CatalogCandidate['events'],
    };
  });
  if (
    candidates.reduce((n, r) => n + r.asset.definition.impacts.length, 0) !== 47
  )
    throw new Error('Preview requires 47 impacts');
  const policies = candidates.map((c) => c.rootPolicy!);
  const report = diagnoseCatalog({
    inventory: value.inventory as InventoryMotion[],
    candidates,
    visualRootPolicies: policies,
    moves: PREVIEW_MOVES,
    normalAssignments: {
      blue: PREVIEW_MOVES.blue,
      green: PREVIEW_MOVES.green,
      yellow: PREVIEW_MOVES.yellow,
    },
  });
  if (report.issues.length)
    throw new Error(
      `Preview catalog inconsistent: ${report.issues.join('; ')}`,
    );
  return candidates;
}
interface PreviewDependencies {
  readonly fetch?: typeof fetch;
  readonly loadVisuals?: (
    policies: readonly ClipRootPolicy[],
    signal: AbortSignal,
  ) => Promise<ThreeAssetPack>;
}
export function createDiagnosticPreviewConfiguration(
  pin: PreviewCatalogPin | null = PREVIEW_CATALOG_PIN,
  dependencies: PreviewDependencies = {},
): AcceptedGameConfiguration {
  const fixedPin = pin ? Object.freeze({ ...pin }) : null;
  const layout = createParisStreetLayout(),
    fetcher = dependencies.fetch ?? globalThis.fetch;
  const read = async (path: string, signal: AbortSignal) => {
    const response = await fetcher(
      `${import.meta.env.BASE_URL}game-assets/${path}`,
      { signal },
    );
    if (!response.ok)
      throw new Error(`Preview asset unavailable: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (signal.aborted) throw new DOMException('Preview aborted', 'AbortError');
    return bytes;
  };
  const loadVisuals =
    dependencies.loadVisuals ??
    (async (rootPolicies, signal) =>
      createPinnedDerivedThreeAssetPack({
        derivedBytes: await read('android/derived-pack-v1.glb', signal),
        artifactBytes: await read('android/runtime-artifact-v1.json', signal),
        rootPolicies,
        signal,
      }));
  return {
    moves: PREVIEW_MOVES,
    layout,
    world: {
      // Vehicle HP 100 is a v6 initial proposal; object durability 100 is the existing integration-test trial value, not a design decision.
      vehicles: layout.vehicles.map((v) => ({
        vehicleId: v.vehicleId,
        hp: 100,
      })),
      objects: layout.objects.map((o) => ({
        objectId: o.objectId,
        durability: 100,
      })),
    },
    loadAssets: async (_context, signal) => {
      if (signal.aborted)
        throw new DOMException('Preview aborted', 'AbortError');
      if (!fixedPin) throw new Error('Missing preview catalog pin');
      const candidates = await validatePreviewEnvelope(
        await read('diagnostic-preview-v1/catalog.json', signal),
        fixedPin,
      );
      if (signal.aborted)
        throw new DOMException('Preview aborted', 'AbortError');
      return prepareGameAssetBundle({
        motions: candidates.map((c) => ({
          asset: c.asset,
          rootPolicy: c.rootPolicy!,
        })),
        locomotionClips: {
          idle: clipId('Idle'),
          walk: clipId('Walk'),
          run: clipId('Run'),
          jump: clipId('Jump'),
        },
        signal,
        loadVisuals,
      });
    },
  };
}
