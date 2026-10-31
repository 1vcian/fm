// Worker threads do not inherit tsx's module resolution: register it, then load the TS worker.
import { register } from 'tsx/esm/api';
register();
await import('./presetWorker.ts');
