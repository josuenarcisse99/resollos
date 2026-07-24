import { loadSyncState, saveSyncState } from './storage';
import { syncToCloud } from './api';
import { resolveRuntimeConfig } from '../config/runtime';

export async function syncUserState(entity, payload) {
  const runtime = resolveRuntimeConfig();
  const stateKey = `sync:${entity}`;
  const previous = loadSyncState(stateKey, []);
  const nextState = Array.isArray(previous) ? [...previous, payload] : [payload];
  saveSyncState(stateKey, nextState);

  if (runtime.syncEnabled && runtime.apiBaseUrl) {
    try {
      await syncToCloud({ entity, payload });
    } catch {
      // ignore sync failures; local state remains authoritative
    }
  }

  return nextState;
}
