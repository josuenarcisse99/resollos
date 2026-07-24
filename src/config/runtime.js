export const DEFAULT_RUNTIME_CONFIG = {
  storageProvider: import.meta.env.VITE_STORAGE_PROVIDER || "local",
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "",
  syncEnabled: import.meta.env.VITE_SYNC_ENABLED === "true",
  uploadMode: import.meta.env.VITE_UPLOAD_MODE || "local",
};

export function resolveRuntimeConfig(overrides = {}) {
  return {
    ...DEFAULT_RUNTIME_CONFIG,
    ...overrides,
  };
}
