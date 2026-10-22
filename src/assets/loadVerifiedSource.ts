import { inspectGlb, type SourceInspection } from './source';
/** Transport is injected; cancellation and source verification apply to local, fetch or cached bytes. */
export async function loadVerifiedSource(
  read: (signal: AbortSignal) => Promise<Uint8Array>,
  expected: { readonly bytes: number; readonly sha256: string },
  signal: AbortSignal,
): Promise<{
  readonly bytes: Uint8Array;
  readonly inspection: SourceInspection;
}> {
  if (
    !Number.isSafeInteger(expected.bytes) ||
    expected.bytes <= 0 ||
    !/^[0-9a-f]{64}$/.test(expected.sha256)
  )
    throw new Error('Invalid source lock');
  const check = () => {
    if (signal.aborted) throw new Error('Source load aborted');
  };
  check();
  const bytes = new Uint8Array(await read(signal));
  check();
  if (bytes.byteLength !== expected.bytes)
    throw new Error('Source size mismatch');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  check();
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (hash !== expected.sha256) throw new Error('Source hash mismatch');
  const inspection = inspectGlb(bytes);
  check();
  return { bytes, inspection };
}
