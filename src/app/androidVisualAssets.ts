import {
  ANDROID_DERIVED_PACK_V1,
  ANDROID_RUNTIME_ARTIFACT_V1,
  copyRootPolicy,
  createPinnedDerivedThreeAssetPack,
  type ClipRootPolicy,
  type ThreeAssetPack,
} from '../assets';

/** The caller supplies the application directory, never import.meta.url (the bundle directory).
 * No query parameter, caller source path, or caller-selected trust hash can override these files. */
export function androidAssetUrls(appBase: string | URL) {
  const base = new URL(appBase);
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    !base.pathname.endsWith('/') ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error(
      'Application base must be an absolute HTTP(S) directory without credentials, query or fragment',
    );
  return Object.freeze({
    derived: new URL(ANDROID_DERIVED_PACK_V1.url.slice(1), base).href,
    artifact: new URL(ANDROID_RUNTIME_ARTIFACT_V1.url.slice(1), base).href,
  });
}

/** Visual preparation only. This does NOT supply/approve attack metadata or unlock gameplay.
 * A complete loader must additionally verify its accepted catalog artifact and call
 * assertRootPolicyCompatibility on every loaded motion before PreparedGameAssets/readiness.
 * This is intentionally not connected to main while that catalog is unavailable. */
export async function prepareAndroidVisualAssets(input: {
  readonly appBase: string | URL;
  readonly signal: AbortSignal;
  readonly rootPolicies: readonly ClipRootPolicy[];
  readonly checkpoint?: (stage: string) => Promise<void> | void;
}): Promise<ThreeAssetPack> {
  const urls = androidAssetUrls(input.appBase);
  const policies = input.rootPolicies.map(copyRootPolicy);
  const signal = input.signal,
    checkpoint = input.checkpoint;
  const controller = new AbortController();
  const check = () => {
    if (signal.aborted || controller.signal.aborted)
      throw new DOMException('Visual preparation aborted', 'AbortError');
  };
  const cancel = () => controller.abort(signal.reason);
  check();
  signal.addEventListener('abort', cancel, { once: true });
  let pack: ThreeAssetPack | undefined;
  try {
    const read = async (url: string, expectedBytes: number) => {
      check();
      const response = await fetch(url, {
        signal: controller.signal,
        credentials: 'same-origin',
        redirect: 'error',
      });
      check();
      if (!response.ok)
        throw new Error(`Required visual asset HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      check();
      if (bytes.length !== expectedBytes)
        throw new Error('Required visual asset length mismatch');
      return bytes;
    };
    const [derivedBytes, artifactBytes] = await Promise.all([
      read(urls.derived, ANDROID_DERIVED_PACK_V1.bytes),
      read(urls.artifact, ANDROID_RUNTIME_ARTIFACT_V1.bytes),
    ]);
    check();
    pack = await createPinnedDerivedThreeAssetPack({
      derivedBytes,
      artifactBytes,
      rootPolicies: policies,
      signal: controller.signal,
      ...(checkpoint
        ? {
            checkpoint: async (stage) => {
              await checkpoint(stage);
            },
          }
        : {}),
    });
    check();
    const owned = pack;
    // The verified factory resolves with a final immutable descriptor.
    const poseBindings = owned.poseBindings;
    return {
      ...(poseBindings ? { poseBindings } : {}),
      create(color) {
        const rig = owned.create(color);
        if (typeof rig.defeatPoseSupport !== 'function') {
          try {
            rig.dispose();
          } catch {
            /* Keep the qualification failure primary. */
          }
          throw new Error('Required rig lacks bounds-v1 producer capability');
        }
        return rig;
      },
      clipDuration: (id) => owned.clipDuration(id),
      clipNames: () => owned.clipNames(),
      rootPolicy: (id) => owned.rootPolicy(id),
      dispose: () => owned.dispose(),
    };
  } catch (error) {
    controller.abort();
    try {
      pack?.dispose();
    } catch {
      /* Preserve the original load failure. */
    }
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
