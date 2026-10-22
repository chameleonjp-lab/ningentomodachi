/// <reference types="vite/client" />
import { CONTRACT_VERSION } from './contracts';
import { mountApplication } from './app/mountApplication';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Application mount point #app is missing');
root.dataset.contractVersion = String(CONTRACT_VERSION);
// No accepted complete source catalog/visual pack exists yet. Do not import test fixtures here.
const app = mountApplication(root, {
  sessionId: `browser:${Date.now()}`,
  seed: Math.floor(Math.random() * 0x100000000),
});
if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
