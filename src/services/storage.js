const STORAGE_PREFIX = "resellos:";

function normalizeKey(key) {
  return `${STORAGE_PREFIX}${key}`;
}

function readJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(normalizeKey(key));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(normalizeKey(key), JSON.stringify(value));
  } catch {
    // ignore storage write failures
  }
}

export async function uploadAsset(file, options = {}) {
  const { provider = "local", path = "uploads" } = options;

  if (provider === "cloud") {
    return {
      provider: "cloud",
      objectKey: `${path}/${Date.now()}-${file.name}`,
      originalUrl: `https://example.com/${path}/${Date.now()}-${file.name}`,
      thumbnailUrl: `https://example.com/${path}/thumb-${Date.now()}-${file.name}`,
      size: file.size,
      name: file.name,
    };
  }

  const reader = new FileReader();
  const dataUrl = await new Promise((resolve, reject) => {
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });

  return {
    provider: "local",
    objectKey: `${path}/${Date.now()}-${file.name}`,
    originalUrl: dataUrl,
    thumbnailUrl: dataUrl,
    size: file.size,
    name: file.name,
  };
}

export function saveSyncState(key, value) {
  writeJson(key, value);
}

export function loadSyncState(key, fallback = null) {
  return readJson(key, fallback);
}
