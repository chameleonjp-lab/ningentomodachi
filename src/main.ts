/// <reference types="vite/client" />
import { CONTRACT_VERSION } from './contracts';
import { mountApplication } from './app/mountApplication';
import { createDiagnosticPreviewConfiguration } from './app/diagnosticPreviewConfiguration';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Application mount point #app is missing');
root.dataset.contractVersion = String(CONTRACT_VERSION);
// Diagnostic preview is explicitly selected at build time. No test fixtures or legacy fallback.
const preview = import.meta.env.VITE_DIAGNOSTIC_PREVIEW === '1';
const app = mountApplication(root, {
  sessionId: `browser:${Date.now()}`,
  seed: Math.floor(Math.random() * 0x100000000),
  ...(preview
    ? {
        configuration: createDiagnosticPreviewConfiguration(),
        posePolicy: {
          version: 1 as const,
          mode: 'deterministic-pose-v1' as const,
        },
      }
    : {}),
});
if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
