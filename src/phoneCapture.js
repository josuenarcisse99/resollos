function normalizeText(value = "") {
  return String(value).trim().toLowerCase();
}

function deriveReceiptFingerprint(payload = {}) {
  const noteText = normalizeText(payload.note || payload.fileName || payload.code || "");
  const fileText = Array.isArray(payload.files) ? payload.files.join("|") : "";
  const sourceText = normalizeText(payload.type || "receipt");
  return `${sourceText}:${noteText}:${fileText.slice(0, 160)}`;
}

export function createReceiptLibraryEntry(payload = {}) {
  const noteText = String(payload.note || payload.fileName || "").trim();
  const merchant = noteText || payload.fileName || "Uploaded receipt";
  const dedupeKey = deriveReceiptFingerprint(payload);

  return {
    id: payload.id || `receipt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    merchant,
    date: new Date().toISOString().slice(0, 10),
    amount: 0,
    type: "uploaded",
    category: "Inventory",
    notes: `Captured from phone${noteText ? `: ${noteText}` : ""}`,
    linkedInventoryId: "",
    fileName: payload.fileName || "phone-capture",
    source: "phone",
    dedupeKey,
    createdAt: new Date().toISOString(),
    fileCount: Array.isArray(payload.files) ? payload.files.length : 0,
  };
}

export function findDuplicateReceipt(payload = {}, existingReceipts = []) {
  const key = deriveReceiptFingerprint(payload);
  return existingReceipts.find((entry) => entry.dedupeKey === key);
}

function isLocalhost(value = "") {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value);
}

export function buildPhoneCompanionUrl({ origin = "", pathname = "", search = "", href = "", lanOrigin = "" } = {}) {
  try {
    const preferredOrigin = lanOrigin && lanOrigin !== "null" && lanOrigin !== "undefined" ? lanOrigin : origin;
    const safeOrigin = preferredOrigin && preferredOrigin !== "null" && preferredOrigin !== "undefined" ? preferredOrigin : "https://example.com";
    const safePathname = pathname && pathname !== "null" && pathname !== "undefined" ? pathname : "/";

    if (href && href !== "null" && href !== "undefined") {
      const url = new URL(href);
      const params = new URLSearchParams(url.search);
      params.set("phone", "1");
      url.search = params.toString();
      if (safeOrigin && isLocalhost(url.hostname)) {
        const resolvedOrigin = new URL(safeOrigin);
        url.protocol = resolvedOrigin.protocol;
        url.host = resolvedOrigin.host;
      }
      return isLocalhost(url.hostname) ? "" : url.toString();
    }

    if (/^https?:\/\//i.test(safePathname) || /^file:\/\//i.test(safePathname)) {
      const url = new URL(safePathname);
      const params = new URLSearchParams(search || url.search);
      params.set("phone", "1");
      url.search = params.toString();
      if (safeOrigin && isLocalhost(url.hostname)) {
        const resolvedOrigin = new URL(safeOrigin);
        url.protocol = resolvedOrigin.protocol;
        url.host = resolvedOrigin.host;
      }
      return isLocalhost(url.hostname) ? "" : url.toString();
    }

    const url = new URL(safePathname.startsWith("/") ? safePathname : `/${safePathname}`, safeOrigin);
    const params = new URLSearchParams(search || url.search);
    params.set("phone", "1");
    url.search = params.toString();
    return isLocalhost(url.hostname) ? "" : url.toString();
  } catch {
    const fallbackUrl = new URL("/", "https://example.com");
    const params = new URLSearchParams(search || fallbackUrl.search);
    params.set("phone", "1");
    fallbackUrl.search = params.toString();
    return fallbackUrl.toString();
  }
}
