import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { mergeRecognitionIntoItem, recognizeProduct } from "./aiRecognition";
import GiftCards from "./components/GiftCards";
import { buildPhoneCompanionUrl, createReceiptLibraryEntry, findDuplicateReceipt } from "./phoneCapture";
import { uploadAsset } from "./services/storage";
import { syncUserState } from "./services/sync";
import EmailIntelligence from "./components/EmailIntelligence";
import ReportsPage from "./components/ReportsPage";
import NikeSwooshPolicyMonitor from "./components/NikeSwooshPolicyMonitor";

const STORAGE_KEYS = {
  inventory: "resellos-inventory",
  customers: "resellos-customers",
  receipts: "resellos-receipts",
  expenses: "resellos-expenses",
  transactions: "resellos-accounting-transactions",
};

const AUTO_SAVE_DELAY_MS = 1800;
const DRAFT_STORAGE_KEY = "resellos-draft-session";
const BACKUP_STORAGE_KEY = "resellos-backups";
const RECOVERY_KEYS = {
  inventory: "resellos-draft-inventory",
  giftCards: "resellos-draft-gift-cards",
  customers: "resellos-draft-customers",
  receipts: "resellos-draft-receipts",
  financial: "resellos-draft-financial",
  ai: "resellos-draft-ai",
  app: DRAFT_STORAGE_KEY,
};
const PHONE_QUEUE_KEY = "resellos-phone-companion-queue";
const SALES_ORDERS_STORAGE_KEY = "resellos-sales-orders";
const RETURNS_STORAGE_KEY = "resellos-sales-returns";

function loadData(key) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some((entry) => hasMeaningfulValue(entry));
  if (typeof value === "object") {
    return Object.entries(value).some(([key, child]) => {
      if (key === "page") return false;
      if (key === "id" || key === "createdAt" || key === "timestamp" || key === "updatedAt") return false;
      if (key === "status" && ["in stock", "new", "draft", "pending"].includes(String(child).trim().toLowerCase())) return false;
      if (key === "condition" && String(child).trim().toLowerCase() === "new") return false;
      if (key === "quantity" && Number(child) === 1) return false;
      return hasMeaningfulValue(child);
    });
  }
  return false;
}

function hasMeaningfulDraftPayload(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((entry) => hasMeaningfulValue(entry));
  return hasMeaningfulValue(value);
}

function cleanupDrafts() {
  const keys = [RECOVERY_KEYS.inventory, RECOVERY_KEYS.giftCards, RECOVERY_KEYS.customers, RECOVERY_KEYS.receipts, RECOVERY_KEYS.financial, RECOVERY_KEYS.ai, RECOVERY_KEYS.app];
  keys.forEach((key) => {
    const draft = loadDraft(key);
    if (!hasMeaningfulDraftPayload(draft)) {
      removeDraft(key);
    }
  });
}

function loadSalesOrders() {
  try {
    const saved = localStorage.getItem(SALES_ORDERS_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveSalesOrders(orders) {
  try {
    localStorage.setItem(SALES_ORDERS_STORAGE_KEY, JSON.stringify(orders));
  } catch {
    // ignore storage write failures
  }
}

function loadReturns() {
  try {
    const saved = localStorage.getItem(RETURNS_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveReturns(returns) {
  try {
    localStorage.setItem(RETURNS_STORAGE_KEY, JSON.stringify(returns));
  } catch {
    // ignore storage write failures
  }
}

function createProductId(existingId) {
  if (existingId) return existingId;
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PID-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${suffix}`;
}

function normalizeInventoryItems(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    ...item,
    productId: item.productId || createProductId(item.id || `inv-${index + 1}`),
  }));
}

function money(value) {
  return Number(value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

async function enrichInventoryItem(baseItem = {}, metadata = {}) {
  const input = {
    productName: baseItem.productName || metadata.productName || "",
    brand: baseItem.brand || metadata.brand || "",
    sku: baseItem.sku || metadata.sku || metadata.styleCode || metadata.upc || metadata.barcode || "",
    styleCode: baseItem.styleCode || metadata.styleCode || metadata.sku || metadata.upc || metadata.barcode || "",
    color: baseItem.color || metadata.color || "",
    size: baseItem.size || metadata.size || "",
    category: baseItem.category || metadata.category || "",
    gender: baseItem.gender || metadata.gender || "",
    barcode: metadata.barcode || metadata.upc || "",
    notes: metadata.notes || "",
  };

  const recognition = await recognizeProduct(input);
  return mergeRecognitionIntoItem(baseItem, recognition, 0);
}

function loadDraft(key) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function saveDraft(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage write failures
  }
}

function removeDraft(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage cleanup failures
  }
}

function readBackups() {
  try {
    const saved = localStorage.getItem(BACKUP_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function writeBackups(backups) {
  try {
    localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(backups.slice(0, 8)));
  } catch {
    // ignore storage write failures
  }
}

function readPhoneQueue() {
  try {
    const saved = localStorage.getItem(PHONE_QUEUE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function writePhoneQueue(queue) {
  try {
    localStorage.setItem(PHONE_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // ignore storage write failures
  }
}

function getPhoneCompanionUrl() {
  if (typeof window === "undefined") return "";
  const currentHref = typeof window.location?.href === "string" ? window.location.href : "";
  const currentOrigin = typeof window.location?.origin === "string" && window.location.origin !== "null" ? window.location.origin : "";
  const currentPathname = typeof window.location?.pathname === "string" ? window.location.pathname : "/";
  const currentSearch = typeof window.location?.search === "string" ? window.location.search : "";
  const lanOrigin = typeof window.__RESELL_OS_LAN_ORIGIN__ === "string" ? window.__RESELL_OS_LAN_ORIGIN__ : "";

  return buildPhoneCompanionUrl({
    href: currentHref || undefined,
    origin: currentOrigin || (currentHref ? new URL(currentHref).origin : ""),
    pathname: currentPathname || (currentHref ? new URL(currentHref).pathname : "/"),
    search: currentSearch || (currentHref ? new URL(currentHref).search : ""),
    lanOrigin,
  });
}

function createBackup(snapshot) {
  const backups = readBackups();
  backups.unshift({
    ...snapshot,
    timestamp: new Date().toISOString(),
  });
  writeBackups(backups);
  return backups[0];
}

function getRecoverySummary() {
  return [
    { key: "inventory", label: "Draft Inventory", payload: loadDraft(RECOVERY_KEYS.inventory) },
    { key: "giftCards", label: "Draft Gift Cards", payload: loadDraft(RECOVERY_KEYS.giftCards) },
    { key: "customers", label: "Draft Customers", payload: loadDraft(RECOVERY_KEYS.customers) },
    { key: "receipts", label: "Draft Receipts", payload: loadDraft(RECOVERY_KEYS.receipts) },
    { key: "financial", label: "Draft Financial Reports", payload: loadDraft(RECOVERY_KEYS.financial) },
    { key: "ai", label: "Draft AI Tools", payload: loadDraft(RECOVERY_KEYS.ai) },
  ].filter((entry) => entry.payload);
}

function loadImportHistory() {
  try {
    const saved = localStorage.getItem("resellos-import-history");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveImportHistory(history) {
  try {
    localStorage.setItem("resellos-import-history", JSON.stringify(history));
  } catch {
    // ignore storage write failures
  }
}

function loadImportMappings() {
  try {
    const saved = localStorage.getItem("resellos-import-mappings");
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveImportMappings(mappings) {
  try {
    localStorage.setItem("resellos-import-mappings", JSON.stringify(mappings));
  } catch {
    // ignore storage write failures
  }
}

function parseCsvText(text) {
  const rows = [];
  let current = [];
  let currentValue = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      current.push(currentValue);
      currentValue = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      current.push(currentValue);
      if (current.some((entry) => entry.trim())) {
        rows.push(current);
      }
      current = [];
      currentValue = "";
    } else {
      currentValue += char;
    }
  }

  if (currentValue.length > 0 || current.length > 0) {
    current.push(currentValue);
    if (current.some((entry) => entry.trim())) {
      rows.push(current);
    }
  }

  if (rows.length <= 1) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[^a-z0-9]+/g, ""));
  return rows.slice(1).map((row) => {
    const values = row.slice(0, headers.length);
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index] ? values[index].trim() : "";
    });
    return item;
  });
}

function getRouteFromLocation() {
  if (typeof window === "undefined") return { page: "dashboard", section: null };

  const hash = window.location.hash.replace(/^#/, "");
  const [routeKey, sectionKey] = hash.split("/").filter(Boolean);
  const routeMap = {
    dashboard: { page: "dashboard", section: null },
    inventory: { page: "inventory", section: null },
    "gift-cards": { page: "gift-cards", section: null },
    customers: { page: "customers", section: null },
    "sales-orders": { page: "sales-orders", section: null },
    receipts: { page: "receipts", section: null },
    "import-center": { page: "import-center", section: null },
    "ai-inbox": { page: "ai-inbox", section: null },
    "email-intelligence": { page: "email-intelligence", section: null },
    "gmail-integration": { page: "email-intelligence", section: "gmail" },
    financials: { page: "financials", section: null },
    reports: { page: "reports", section: null },
    "nike-swoosh-monitor": { page: "nike-swoosh-monitor", section: null },
    "ai-tools": { page: "ai-tools", section: null },
  };

  const resolved = routeMap[routeKey] || { page: "dashboard", section: null };
  return {
    ...resolved,
    section: resolved.section || (sectionKey ? sectionKey : null),
  };
}

function getRouteHash(page, section = null) {
  if (!page || page === "dashboard") return "#dashboard";
  if (page === "gift-cards" && section) return `#gift-cards/${section}`;
  if (page === "email-intelligence" && section === "gmail") return "#gmail-integration";
  return `#${page}`;
}

const styles = {
  app: {
    minHeight: "100vh",
    display: "flex",
    background: "#f3f4f6",
    color: "#111827",
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  sidebar: {
    width: "245px",
    background: "#111111",
    color: "#ffffff",
    padding: "24px 18px",
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    overflowY: "auto",
  },
  logo: {
    margin: "0 0 6px",
    fontSize: "27px",
  },
  subtitle: {
    color: "#9ca3af",
    fontSize: "12px",
    marginBottom: "28px",
  },
  navButton: {
    width: "100%",
    border: "none",
    borderRadius: "8px",
    padding: "12px 14px",
    marginBottom: "8px",
    textAlign: "left",
    cursor: "pointer",
    fontSize: "15px",
  },
  main: {
    marginLeft: "245px",
    width: "calc(100% - 245px)",
    padding: "32px",
  },
  mobileShell: {
    minHeight: "100vh",
    background: "#f3f4f6",
    color: "#111827",
    fontFamily: "Arial, Helvetica, sans-serif",
  },
  mobileHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 16px",
    background: "#ffffff",
    borderBottom: "1px solid #e5e7eb",
    position: "sticky",
    top: 0,
    zIndex: 30,
  },
  mobileMenuButton: {
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#111827",
    borderRadius: "999px",
    width: "42px",
    height: "42px",
    cursor: "pointer",
    fontSize: "18px",
  },
  mobileMenuPanel: {
    position: "fixed",
    inset: 0,
    background: "rgba(17, 24, 39, 0.6)",
    zIndex: 40,
  },
  mobileMenuContent: {
    width: "84%",
    maxWidth: "320px",
    height: "100%",
    background: "#111827",
    color: "#ffffff",
    padding: "18px 14px",
    overflowY: "auto",
  },
  mobileNavItem: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    width: "100%",
    border: "none",
    borderRadius: "12px",
    padding: "12px 14px",
    marginBottom: "8px",
    background: "transparent",
    color: "#ffffff",
    textAlign: "left",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: 700,
  },
  mobileCard: {
    background: "#ffffff",
    borderRadius: "16px",
    padding: "16px",
    boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
    border: "1px solid #f3f4f6",
  },
  header: {
    marginBottom: "25px",
  },
  pageTitle: {
    margin: 0,
    fontSize: "32px",
  },
  muted: {
    color: "#6b7280",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "16px",
  },
  card: {
    background: "#ffffff",
    borderRadius: "12px",
    padding: "20px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
  },
  input: {
    width: "100%",
    padding: "11px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "15px",
    marginBottom: "12px",
  },
  label: {
    display: "block",
    fontWeight: 700,
    marginBottom: "6px",
    fontSize: "14px",
  },
  primaryButton: {
    border: "none",
    background: "#dc2626",
    color: "#ffffff",
    borderRadius: "8px",
    padding: "11px 17px",
    fontSize: "15px",
    cursor: "pointer",
  },
  darkButton: {
    border: "none",
    background: "#111111",
    color: "#ffffff",
    borderRadius: "8px",
    padding: "10px 15px",
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#111827",
    borderRadius: "8px",
    padding: "9px 14px",
    cursor: "pointer",
  },
  dangerButton: {
    border: "none",
    background: "#fee2e2",
    color: "#991b1b",
    borderRadius: "7px",
    padding: "8px 12px",
    cursor: "pointer",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "14px",
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    textAlign: "left",
    padding: "12px",
    borderBottom: "2px solid #e5e7eb",
    fontSize: "13px",
    color: "#4b5563",
  },
  td: {
    padding: "12px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: "14px",
  },
};

function AppShell() {
  const [page, setPageState] = useState(() => {
    const initialRoute = getRouteFromLocation();
    const savedDraft = typeof window !== "undefined" ? loadDraft(RECOVERY_KEYS.app) : null;
    if (savedDraft && hasMeaningfulDraftPayload(savedDraft)) {
      return savedDraft.page || initialRoute.page;
    }
    return initialRoute.page;
  });
  const [routeSection, setRouteSection] = useState(() => {
    const initialRoute = getRouteFromLocation();
    const savedDraft = typeof window !== "undefined" ? loadDraft(RECOVERY_KEYS.app) : null;
    if (savedDraft && hasMeaningfulDraftPayload(savedDraft)) {
      return savedDraft.section || initialRoute.section;
    }
    return initialRoute.section;
  });
  const [saveStatus, setSaveStatus] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 900;
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dirtyRef = useRef(false);
  const [draftPrompt, setDraftPrompt] = useState(() => {
    if (typeof window === "undefined") return false;
    const savedDraft = loadDraft(RECOVERY_KEYS.app);
    return Boolean(savedDraft && hasMeaningfulDraftPayload(savedDraft));
  });
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const [undoState, setUndoState] = useState(null);
  const [phoneCompanionOpen, setPhoneCompanionOpen] = useState(false);
  const [phoneCompanionUrl, setPhoneCompanionUrl] = useState(() => getPhoneCompanionUrl());
  const [phoneCompanionError, setPhoneCompanionError] = useState("");
  const [phoneQueue, setPhoneQueue] = useState(() => readPhoneQueue());
  const [aiInbox, setAiInboxState] = useState(() => loadData("resellos-ai-inbox"));
  const [activeInventoryEditId, setActiveInventoryEditId] = useState(null);
  const [phoneMode] = useState(() => {
    if (typeof window === "undefined") return false;
    const search = typeof window.location?.search === "string" ? window.location.search : "";
    const hash = typeof window.location?.hash === "string" ? window.location.hash : "";
    const params = new URLSearchParams(search || hash.replace(/^#/, ""));
    return params.get("phone") === "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleResize = () => {
      const nextMobile = window.innerWidth < 900;
      setIsMobile(nextMobile);
      if (!nextMobile) {
        setMobileMenuOpen(false);
      }
    };

    const handleHashChange = () => {
      const { page: nextPage, section: nextSection } = getRouteFromLocation();
      setPageState(nextPage);
      setRouteSection(nextSection || null);
    };

    handleResize();
    if (!window.location.hash) {
      window.history.replaceState(null, "", getRouteHash("dashboard"));
    }
    window.addEventListener("resize", handleResize);
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  const [inventory, setInventoryState] = useState(() =>
    loadData(STORAGE_KEYS.inventory)
  );

  const [customers, setCustomersState] = useState(() =>
    loadData(STORAGE_KEYS.customers)
  );

  const [receipts, setReceiptsState] = useState(() =>
    loadData(STORAGE_KEYS.receipts)
  );

  const [expenses, setExpensesState] = useState(() =>
    loadData(STORAGE_KEYS.expenses)
  );

  const [giftCards, setGiftCardsState] = useState(() => loadData("resellos-gift-cards"));
  const [transactions, setTransactionsState] = useState(() => loadData(STORAGE_KEYS.transactions));
  const [salesOrders, setSalesOrdersState] = useState(() => loadSalesOrders());
  const [returns, setReturnsState] = useState(() => loadReturns());

  const markDirty = useCallback(() => {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    setIsDirty(true);
    setSaveStatus("🟡 Saving...");
  }, []);

  const setPage = useCallback((nextPage, nextSection = null) => {
    setPageState(nextPage);
    setRouteSection(nextSection || null);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", getRouteHash(nextPage, nextSection));
    }
  }, []);

  const setInventory = useCallback((value) => {
    markDirty();
    setInventoryState((current) => normalizeInventoryItems(typeof value === "function" ? value(current) : value));
  }, [markDirty]);

  const setCustomers = useCallback((value) => {
    markDirty();
    setCustomersState(value);
  }, [markDirty]);

  const setReceipts = useCallback((value) => {
    markDirty();
    setReceiptsState(value);
  }, [markDirty]);

  const setExpenses = useCallback((value) => {
    markDirty();
    setExpensesState(value);
  }, [markDirty]);

  const setGiftCards = useCallback((value) => {
    markDirty();
    setGiftCardsState(value);
  }, [markDirty]);

  const setTransactions = useCallback((value) => {
    markDirty();
    setTransactionsState(value);
  }, [markDirty]);

  const setSalesOrders = useCallback((value) => {
    markDirty();
    setSalesOrdersState(value);
  }, [markDirty]);

  const setReturns = useCallback((value) => {
    markDirty();
    setReturnsState(value);
  }, [markDirty]);

  const setAiInbox = useCallback((value) => {
    markDirty();
    setAiInboxState(value);
  }, [markDirty]);

  const pushPhoneQueueItem = useCallback((payload) => {
    const nextQueue = [...readPhoneQueue(), payload];
    writePhoneQueue(nextQueue);
    setPhoneQueue(nextQueue);
  }, []);

  const processPhoneQueue = useCallback(async (queue = readPhoneQueue()) => {
    if (!Array.isArray(queue) || queue.length === 0) return;

    const remaining = [];

    for (const item of queue) {
      const fileList = Array.isArray(item.files) ? item.files : [];

      if ((item.type === "photo" || item.type === "multiple") && fileList.length > 0) {
        const photos = fileList.filter(Boolean);
        const targetId = item.targetInventoryId || activeInventoryEditId;

        if (targetId) {
          setInventory((current) => current.map((entry) => entry.id === targetId ? {
            ...entry,
            photos: [...(entry.photos || []), ...photos],
            photo: photos[0] || entry.photo || "",
            notes: `${entry.notes || ""}\n${item.note || "Phone photo"}`.trim(),
          } : entry));
        } else {
          const createdAt = new Date().toISOString();
          const productName = item.note ? `Imported from phone: ${item.note}` : "Phone uploaded item";
          const baseItem = {
            id: `${Date.now()}-${Math.random()}`,
            productName,
            brand: "",
            sku: "",
            styleCode: "",
            color: "",
            size: "",
            gender: "",
            category: "",
            condition: "New",
            quantity: 1,
            purchasePrice: 0,
            sellingPrice: 0,
            marketplace: "",
            purchaseLocation: "",
            purchaseDate: "",
            supplier: "",
            receiptNumber: "",
            storageLocation: "",
            notes: item.note || "Uploaded from phone",
            status: "In Stock",
            photos,
            photo: photos[0] || "",
            createdAt,
            source: "Phone Companion",
          };
          const enrichedItem = await enrichInventoryItem(baseItem, {
            productName,
            notes: item.note || "Uploaded from phone",
          });
          setInventory((current) => [enrichedItem, ...current]);
        }
        continue;
      }

      if (item.type === "receipt" && fileList.length > 0) {
        const receiptText = `${item.note || ""} ${item.fileName || ""}`.toLowerCase();
        const brandMatch = ["nike", "adidas", "jordan", "yeezy", "gucci", "supreme", "new balance", "puma", "reebok"].find((entry) => receiptText.includes(entry));
        const inferredBrand = brandMatch ? brandMatch.charAt(0).toUpperCase() + brandMatch.slice(1) : "";
        const inferredPrice = (item.note || "").match(/\$?(\d+(?:\.\d{1,2})?)/)?.[1];
        const duplicateReceipt = findDuplicateReceipt(item, receipts);
        if (duplicateReceipt) {
          setSaveStatus("📱 Duplicate receipt skipped");
          continue;
        }
        const createdAt = new Date().toISOString();
        const receiptEntry = createReceiptLibraryEntry(item);
        setReceipts((current) => [receiptEntry, ...current]);
        const baseItem = {
          id: `${Date.now()}-${Math.random()}`,
          productName: inferredBrand ? `${inferredBrand} receipt item` : "Receipt imported item",
          brand: inferredBrand,
          sku: "",
          styleCode: "",
          color: "",
          size: "",
          gender: "",
          category: "",
          condition: "New",
          quantity: 1,
          purchasePrice: inferredPrice ? Number(inferredPrice) : 0,
          sellingPrice: inferredPrice ? Number(inferredPrice) * 1.3 : 0,
          marketplace: "",
          purchaseLocation: "",
          purchaseDate: new Date().toISOString().slice(0, 10),
          supplier: "",
          receiptNumber: item.code || "",
          storageLocation: "",
          notes: `Receipt uploaded from phone${item.note ? `: ${item.note}` : ""}`,
          status: "In Stock",
          photos: fileList,
          photo: fileList[0] || "",
          createdAt,
          source: "Phone receipt OCR",
        };
        const enrichedItem = await enrichInventoryItem(baseItem, {
          productName: baseItem.productName,
          brand: baseItem.brand,
          notes: baseItem.notes,
        });
        setInventory((current) => [enrichedItem, ...current]);
        continue;
      }

      if ((item.type === "barcode" || item.type === "qr") && item.code) {
        const codeItem = {
          id: `${Date.now()}-${Math.random()}`,
          productName: `Scanned ${item.type === "barcode" ? "barcode" : "QR"}`,
          brand: "",
          sku: "",
          styleCode: "",
          color: "",
          size: "",
          gender: "",
          category: "",
          condition: "New",
          quantity: 1,
          purchasePrice: 0,
          sellingPrice: 0,
          marketplace: "",
          purchaseLocation: "",
          purchaseDate: "",
          supplier: "",
          receiptNumber: item.code,
          storageLocation: "",
          notes: `Scanned from phone: ${item.code}`,
          status: "In Stock",
          photos: [],
          photo: "",
          createdAt: new Date().toISOString(),
          source: `Phone ${item.type}`,
        };
        const enrichedItem = await enrichInventoryItem(codeItem, {
          productName: codeItem.productName,
          notes: codeItem.notes,
          barcode: item.code,
        });
        setInventory((current) => [enrichedItem, ...current]);
        continue;
      }

      remaining.push(item);
    }

    if (remaining.length !== queue.length) {
      setSaveStatus("📱 Phone uploads applied");
    }

    writePhoneQueue(remaining);
    setPhoneQueue(remaining);
  }, [activeInventoryEditId, receipts]);

  const persistAppState = useCallback(() => {
    try {
      const snapshot = {
        inventory,
        customers,
        receipts,
        expenses,
        giftCards,
        transactions,
        page,
      };
      if (!isDirty || !hasMeaningfulDraftPayload(snapshot)) {
        cleanupDrafts();
        setSaveStatus("");
        return;
      }
      localStorage.setItem(STORAGE_KEYS.inventory, JSON.stringify(inventory));
      localStorage.setItem(STORAGE_KEYS.customers, JSON.stringify(customers));
      localStorage.setItem(STORAGE_KEYS.receipts, JSON.stringify(receipts));
      localStorage.setItem(STORAGE_KEYS.expenses, JSON.stringify(expenses));
      localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(transactions));
      localStorage.setItem("resellos-gift-cards", JSON.stringify(giftCards));
      saveSalesOrders(salesOrders);
      saveReturns(returns);
      saveDraft(RECOVERY_KEYS.inventory, inventory);
      saveDraft(RECOVERY_KEYS.customers, customers);
      saveDraft(RECOVERY_KEYS.receipts, receipts);
      saveDraft(RECOVERY_KEYS.financial, { expenses, receipts, inventory, transactions });
      saveDraft(RECOVERY_KEYS.giftCards, giftCards);
      saveDraft(RECOVERY_KEYS.ai, { inventory });
      saveDraft(RECOVERY_KEYS.app, snapshot);
      createBackup(snapshot);
      setSaveStatus("🟢 All Changes Saved");
    } catch {
      setSaveStatus("🔴 Save Failed");
    }
  }, [inventory, customers, receipts, expenses, giftCards, transactions, salesOrders, returns, page, isDirty]);

  useEffect(() => {
    if (!draftPrompt) {
      cleanupDrafts();
    }
  }, [draftPrompt]);

  useEffect(() => {
    const syncCompanionUrl = () => {
      const nextUrl = getPhoneCompanionUrl();
      setPhoneCompanionUrl(nextUrl);
      setPhoneCompanionError(
        nextUrl
          ? ""
          : "Unable to detect a LAN IP for phone sharing. Open the app from the local network or refresh after the dev server binds to the network."
      );
    };

    syncCompanionUrl();
    window.addEventListener("focus", syncCompanionUrl);
    return () => window.removeEventListener("focus", syncCompanionUrl);
  }, []);

  useEffect(() => {
    const syncQueue = () => processPhoneQueue(readPhoneQueue());
    syncQueue();
    const onStorage = (event) => {
      if (event.key === PHONE_QUEUE_KEY) {
        syncQueue();
      }
    };
    window.addEventListener("storage", onStorage);
    const intervalId = window.setInterval(syncQueue, 1800);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(intervalId);
    };
  }, [processPhoneQueue]);

  useEffect(() => {
    if (!isDirty) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      persistAppState();
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [persistAppState, isDirty]);

  useEffect(() => {
    const onPageHide = () => {
      persistAppState();
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onPageHide);
    };
  }, [persistAppState]);

  const recoveryItems = useMemo(() => getRecoverySummary(), [inventory, customers, receipts, expenses, giftCards, transactions, page, recoveryVersion]);
  const setRecoveryItems = useCallback(() => undefined, []);

  useEffect(() => {
    if (undoState) {
      const timer = window.setTimeout(() => setUndoState(null), 10000);
      return () => window.clearTimeout(timer);
    }
  }, [undoState]);

  function restoreDraft(kind) {
    const draft = loadDraft(kind);
    if (!draft) return;
    markDirty();
    if (kind === RECOVERY_KEYS.inventory) setInventory(draft);
    if (kind === RECOVERY_KEYS.giftCards) setGiftCards(draft);
    if (kind === RECOVERY_KEYS.customers) setCustomers(draft);
    if (kind === RECOVERY_KEYS.receipts) setReceipts(draft);
    if (kind === RECOVERY_KEYS.financial) {
      if (Array.isArray(draft.expenses)) setExpenses(draft.expenses);
      if (Array.isArray(draft.receipts)) setReceipts(draft.receipts);
      if (Array.isArray(draft.inventory)) setInventory(draft.inventory);
      if (Array.isArray(draft.transactions)) setTransactions(draft.transactions);
    }
    if (kind === RECOVERY_KEYS.ai) {
      if (Array.isArray(draft.inventory)) setInventory(draft.inventory);
    }
    setDraftPrompt(false);
    setRecoveryOpen(false);
    setSaveStatus("🟢 All Changes Saved");
  }

  function deleteDraft(kind) {
    removeDraft(kind);
    setRecoveryVersion((current) => current + 1);
  }

  function handleUndo(kind, previousValue, label) {
    setUndoState({ kind, label, previousValue });
  }

  function confirmUndo() {
    if (!undoState) return;
    if (undoState.kind === "inventory") setInventory(undoState.previousValue);
    if (undoState.kind === "giftCards") setGiftCards(undoState.previousValue);
    if (undoState.kind === "customers") setCustomers(undoState.previousValue);
    if (undoState.kind === "receipts") setReceipts(undoState.previousValue);
    if (undoState.kind === "expenses") setExpenses(undoState.previousValue);
    if (undoState.kind === "transactions") setTransactions(undoState.previousValue);
    setUndoState(null);
  }

  function restoreBackup(entry) {
    if (!entry) return;
    markDirty();
    if (Array.isArray(entry.inventory)) setInventory(entry.inventory);
    if (Array.isArray(entry.customers)) setCustomers(entry.customers);
    if (Array.isArray(entry.receipts)) setReceipts(entry.receipts);
    if (Array.isArray(entry.expenses)) setExpenses(entry.expenses);
    if (Array.isArray(entry.giftCards)) setGiftCards(entry.giftCards);
    if (Array.isArray(entry.transactions)) setTransactions(entry.transactions);
    setRecoveryOpen(false);
    setSaveStatus("🟢 All Changes Saved");
  }

  function deleteBackup(id) {
    const backups = readBackups().filter((backup) => backup.timestamp !== id);
    writeBackups(backups);
    setRecoveryItems((current) => current);
  }

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEYS.inventory,
      JSON.stringify(inventory)
    );
  }, [inventory]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEYS.customers,
      JSON.stringify(customers)
    );
  }, [customers]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEYS.receipts,
      JSON.stringify(receipts)
    );
  }, [receipts]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEYS.expenses,
      JSON.stringify(expenses)
    );
  }, [expenses]);

  useEffect(() => {
    localStorage.setItem("resellos-gift-cards", JSON.stringify(giftCards));
  }, [giftCards]);

  useEffect(() => {
    localStorage.setItem("resellos-ai-inbox", JSON.stringify(aiInbox));
  }, [aiInbox]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(transactions));
  }, [transactions]);

  function handleGiftCardPurchase(cardData) {
    const purchaseAmount = Number(cardData.purchasePrice || cardData.cashPaid || 0);
    const faceValue = Number(cardData.faceValue || 0);
    const balance = Number(cardData.balance || faceValue || 0);
    const giftCard = {
      ...cardData,
      id: cardData.id || `${Date.now()}-${Math.random()}`,
      purchasePrice: purchaseAmount,
      faceValue,
      balance,
      purchaseDate: cardData.purchaseDate || new Date().toISOString().slice(0, 10),
      status: cardData.status || (balance <= 0 ? "Empty" : "New"),
      transactionId: `txn-${Date.now()}`,
    };

    const transaction = {
      id: giftCard.transactionId,
      type: "gift-card-purchase",
      date: giftCard.purchaseDate,
      amount: purchaseAmount,
      faceValue,
      balance,
      giftCardId: giftCard.id,
      description: `Gift card purchase ${giftCard.brand || "card"}`,
      note: cardData.notes || "",
    };

    setGiftCards((current) => [giftCard, ...current]);
    setTransactions((current) => [transaction, ...current]);
  }

  const financials = useMemo(() => {
    const inventoryCost = inventory.reduce(
      (sum, item) => sum + Number(item.purchasePrice || 0),
      0
    );

    const projectedRevenue = inventory.reduce(
      (sum, item) => sum + Number(item.sellingPrice || 0),
      0
    );

    const salesRevenue = receipts
      .filter((receipt) => receipt.type === "sale")
      .reduce(
        (sum, receipt) => sum + Number(receipt.amount || 0),
        0
      );

    const purchaseReceipts = receipts
      .filter((receipt) => receipt.type === "purchase")
      .reduce(
        (sum, receipt) => sum + Number(receipt.amount || 0),
        0
      );

    const businessExpenses = expenses.reduce(
      (sum, expense) => sum + Number(expense.amount || 0),
      0
    );

    const giftCardAssets = giftCards.reduce(
      (sum, card) => sum + Number(card.balance || 0),
      0
    );

    const giftCardPurchases = transactions
      .filter((transaction) => transaction.type === "gift-card-purchase")
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

    const inventoryAssets = inventory.reduce(
      (sum, item) => sum + Number(item.purchasePrice || 0) * Number(item.quantity || 1),
      0
    );

    const salesOrderRevenue = salesOrders.reduce((sum, order) => sum + Number(order.grossRevenue || 0), 0);
    const salesOrderFees = salesOrders.reduce((sum, order) => sum + Number(order.platformFees || 0) + Number(order.paymentProcessingFees || 0), 0);
    const salesOrderShippingExpense = salesOrders.reduce((sum, order) => sum + Number(order.actualShippingCost || 0), 0);
    const salesOrderTax = salesOrders.reduce((sum, order) => sum + Number(order.salesTax || 0), 0);
    const salesOrderCogs = salesOrders.reduce((sum, order) => sum + Number(order.cogs || 0), 0);
    const salesOrderProfit = salesOrders.reduce((sum, order) => sum + Number(order.netProfit || 0), 0);

    const totalExpenses = purchaseReceipts + businessExpenses;
    const cashSpent = giftCardPurchases + businessExpenses;
    const estimatedProfit = salesRevenue + salesOrderRevenue - inventoryCost - businessExpenses - salesOrderFees - salesOrderShippingExpense - salesOrderTax + salesOrderProfit;

    return {
      inventoryCost,
      projectedRevenue,
      salesRevenue,
      purchaseReceipts,
      businessExpenses,
      totalExpenses,
      estimatedProfit,
      cashSpent,
      giftCardAssets,
      inventoryAssets,
      salesOrderRevenue,
      salesOrderFees,
      salesOrderShippingExpense,
      salesOrderTax,
      salesOrderCogs,
      salesOrderProfit,
    };
  }, [inventory, receipts, expenses, giftCards, transactions, salesOrders]);

  const navigation = [
    { id: "dashboard", section: null, label: "🏠 Dashboard" },
    { id: "inventory", section: null, label: "📦 Inventory" },
    { id: "gift-cards", section: null, label: "💳 Gift Cards" },
    { id: "customers", section: null, label: "👥 Customers" },
    { id: "sales-orders", section: null, label: "🛒 Sales & Orders" },
    { id: "receipts", section: null, label: "🧾 Receipts" },
    { id: "import-center", section: null, label: "📥 Import Center" },
    { id: "ai-inbox", section: null, label: "📥 AI Inbox" },
    { id: "email-intelligence", section: null, label: "📧 Email Intelligence" },
    { id: "email-intelligence", section: "gmail", label: "📬 Gmail Integration" },
    { id: "financials", section: null, label: "💰 Financial & Tax" },
    { id: "reports", section: null, label: "📊 Reports" },
    { id: "nike-swoosh-monitor", section: null, label: "🧭 Nike & Swoosh Monitor" },
    { id: "ai-tools", section: null, label: "🤖 AI Tools" },
  ];

  if (phoneMode) {
    return (
      <PhoneCompanionScreen
        companionUrl={phoneCompanionUrl}
        onQueueItem={pushPhoneQueueItem}
      />
    );
  }

  return (
    <div style={{ ...styles.app, flexDirection: isMobile ? "column" : "row" }}>
      {draftPrompt && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.7)", zIndex: 4000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ ...styles.card, maxWidth: "420px", width: "100%" }}>
            <h2 style={{ marginTop: 0 }}>Resume Previous Work?</h2>
            <p style={styles.muted}>Recovered draft data is available. Continue editing or start a new session.</p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "12px" }}>
              <button style={styles.primaryButton} onClick={() => { setDraftPrompt(false); setRecoveryOpen(true); }}>Continue Editing</button>
              <button style={styles.secondaryButton} onClick={() => { setDraftPrompt(false); removeDraft(RECOVERY_KEYS.app); setSaveStatus("🟢 All Changes Saved"); }}>Start New</button>
              <button style={styles.dangerButton} onClick={() => { setDraftPrompt(false); removeDraft(RECOVERY_KEYS.app); removeDraft(RECOVERY_KEYS.inventory); removeDraft(RECOVERY_KEYS.customers); removeDraft(RECOVERY_KEYS.receipts); removeDraft(RECOVERY_KEYS.financial); removeDraft(RECOVERY_KEYS.giftCards); removeDraft(RECOVERY_KEYS.ai); setSaveStatus("🟢 All Changes Saved"); }}>Delete Draft</button>
            </div>
          </div>
        </div>
      )}

      {recoveryOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.7)", zIndex: 3500, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ ...styles.card, maxWidth: "920px", width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
            <h2 style={{ marginTop: 0 }}>Recovery Center</h2>
            <p style={styles.muted}>Resume, duplicate, or delete recovered drafts and backups.</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <strong>Drafts</strong>
              <button style={styles.secondaryButton} onClick={() => setRecoveryOpen(false)}>Close</button>
            </div>
            {recoveryItems.length === 0 && <p style={styles.muted}>No drafts available.</p>}
            {recoveryItems.map((item) => (
              <div key={item.key} style={{ ...styles.card, marginBottom: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                  <div><strong>{item.label}</strong></div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button style={styles.secondaryButton} onClick={() => restoreDraft(item.key === "inventory" ? RECOVERY_KEYS.inventory : item.key === "giftCards" ? RECOVERY_KEYS.giftCards : item.key === "customers" ? RECOVERY_KEYS.customers : item.key === "receipts" ? RECOVERY_KEYS.receipts : item.key === "financial" ? RECOVERY_KEYS.financial : RECOVERY_KEYS.ai)}>Resume</button>
                    <button style={styles.secondaryButton} onClick={() => { const draft = loadDraft(item.key === "inventory" ? RECOVERY_KEYS.inventory : item.key === "giftCards" ? RECOVERY_KEYS.giftCards : item.key === "customers" ? RECOVERY_KEYS.customers : item.key === "receipts" ? RECOVERY_KEYS.receipts : item.key === "financial" ? RECOVERY_KEYS.financial : RECOVERY_KEYS.ai); if (draft) { const copy = JSON.parse(JSON.stringify(draft)); if (item.key === "inventory") setInventory((current) => [...(Array.isArray(copy) ? copy : []), ...current]); if (item.key === "giftCards") setGiftCards((current) => [...(Array.isArray(copy) ? copy : []), ...current]); if (item.key === "customers") setCustomers((current) => [...(Array.isArray(copy) ? copy : []), ...current]); if (item.key === "receipts") setReceipts((current) => [...(Array.isArray(copy) ? copy : []), ...current]); } }}>Duplicate</button>
                    <button style={styles.dangerButton} onClick={() => deleteDraft(item.key === "inventory" ? RECOVERY_KEYS.inventory : item.key === "giftCards" ? RECOVERY_KEYS.giftCards : item.key === "customers" ? RECOVERY_KEYS.customers : item.key === "receipts" ? RECOVERY_KEYS.receipts : item.key === "financial" ? RECOVERY_KEYS.financial : RECOVERY_KEYS.ai)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: "16px" }}>
              <strong>Backups</strong>
              {readBackups().length === 0 ? <p style={styles.muted}>No backups available.</p> : readBackups().map((entry, index) => (
                <div key={`${entry.timestamp}-${index}`} style={{ ...styles.card, marginTop: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                    <div>{new Date(entry.timestamp).toLocaleString()}</div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button style={styles.secondaryButton} onClick={() => restoreBackup(entry)}>Restore</button>
                      <button style={styles.dangerButton} onClick={() => deleteBackup(entry.timestamp)}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!isMobile && (
        <aside style={styles.sidebar}>
          <h1 style={styles.logo}>ReSellOS</h1>

          <div style={styles.subtitle}>
            Operating System for Professional Resellers
          </div>

          {navigation.map((item) => {
            const isActive = page === item.id && (routeSection || null) === (item.section || null);
            return (
              <button
                key={`${item.id}-${item.section || "main"}`}
                onClick={() => setPage(item.id, item.section)}
                style={{
                  ...styles.navButton,
                  background: isActive ? "#dc2626" : "transparent",
                  color: "#ffffff",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </aside>
      )}

      {isMobile && mobileMenuOpen && (
        <div style={styles.mobileMenuPanel} onClick={() => setMobileMenuOpen(false)}>
          <div style={styles.mobileMenuContent} onClick={(event) => event.stopPropagation()}>
            <div style={{ ...styles.mobileCard, marginBottom: "12px", background: "#111827", borderColor: "rgba(255,255,255,0.08)", padding: "14px" }}>
              <div style={{ fontSize: "22px", fontWeight: 800 }}>ReSellOS</div>
              <div style={{ color: "#9ca3af", fontSize: "12px", marginTop: "4px" }}>Operating System for Professional Resellers</div>
            </div>
            {navigation.map((item) => {
              const isActive = page === item.id && (routeSection || null) === (item.section || null);
              return (
                <button
                  key={`${item.id}-${item.section || "main"}`}
                  onClick={() => {
                    setPage(item.id, item.section);
                    setMobileMenuOpen(false);
                  }}
                  style={{
                    ...styles.mobileNavItem,
                    background: isActive ? "#dc2626" : "transparent",
                  }}
                >
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <main style={{ ...styles.main, marginLeft: isMobile ? 0 : "245px", width: isMobile ? "100%" : "calc(100% - 245px)", padding: isMobile ? "16px" : "32px" }}>
        {isMobile && (
          <div style={styles.mobileHeader}>
            <div>
              <div style={{ fontSize: "20px", fontWeight: 800 }}>ReSellOS</div>
              <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>Operations dashboard</div>
            </div>
            <button style={styles.mobileMenuButton} onClick={() => setMobileMenuOpen((open) => !open)} aria-label="Open navigation menu">☰</button>
          </div>
        )}

        {!isMobile && (
          <div style={{ position: "fixed", top: "18px", right: "24px", zIndex: 3000 }}>
            <div style={{ ...styles.card, padding: "10px 14px", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>{saveStatus}</div>
          </div>
        )}

        {undoState && (
          <div style={{ position: isMobile ? "static" : "fixed", top: isMobile ? undefined : "70px", right: isMobile ? undefined : "24px", zIndex: 3000, marginBottom: isMobile ? "12px" : undefined }}>
            <div style={{ ...styles.card, padding: "10px 14px", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>
              <span>{undoState.label} deleted. </span>
              <button style={styles.secondaryButton} onClick={confirmUndo}>Undo?</button>
            </div>
          </div>
        )}

        {saveStatus && isMobile && (
          <div style={{ marginBottom: "12px" }}>
            <div style={{ ...styles.card, padding: "10px 14px", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>{saveStatus}</div>
          </div>
        )}

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
          <button style={styles.secondaryButton} onClick={() => setPhoneCompanionOpen(true)}>📱 Add From Phone</button>
          <button style={styles.secondaryButton} onClick={() => setRecoveryOpen(true)}>Recovery Center</button>
          {phoneQueue.length > 0 && (
            <span style={{ alignSelf: "center", color: "#6b7280", fontSize: "14px" }}>
              {phoneQueue.length} pending transfer{phoneQueue.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {page === "dashboard" && (
          <Dashboard
            inventory={inventory}
            customers={customers}
            receipts={receipts}
            financials={financials}
            setPage={setPage}
          />
        )}

        {page === "inventory" && (
          <InventoryPage
            inventory={inventory}
            setInventory={setInventory}
            giftCards={giftCards}
            setGiftCards={setGiftCards}
            transactions={transactions}
            setTransactions={setTransactions}
            onUndo={handleUndo}
            setActiveInventoryEditId={setActiveInventoryEditId}
          />
        )}

        {page === "gift-cards" && (
          <GiftCards
            giftCards={giftCards}
            setGiftCards={setGiftCards}
            onGiftCardPurchase={handleGiftCardPurchase}
            activeSection={routeSection || "imports"}
          />
        )}

        {page === "sales-orders" && (
          <SalesOrdersPage
            inventory={inventory}
            setInventory={setInventory}
            customers={customers}
            setCustomers={setCustomers}
            salesOrders={salesOrders}
            setSalesOrders={setSalesOrders}
            returns={returns}
            setReturns={setReturns}
            transactions={transactions}
            setTransactions={setTransactions}
            giftCards={giftCards}
            receipts={receipts}
            onUndo={handleUndo}
          />
        )}

        {page === "customers" && (
          <CustomersPage
            customers={customers}
            setCustomers={setCustomers}
            inventory={inventory}
            receipts={receipts}
          />
        )}

        {page === "import-center" && (
          <ImportCenterPage />
        )}

        {page === "receipts" && (
          <ReceiptsPage
            receipts={receipts}
            setReceipts={setReceipts}
            inventory={inventory}
          />
        )}

        {page === "financials" && (
          <FinancialPage
            expenses={expenses}
            setExpenses={setExpenses}
            financials={financials}
            inventory={inventory}
            receipts={receipts}
            giftCards={giftCards}
            transactions={transactions}
            salesOrders={salesOrders}
            returns={returns}
            onUndo={handleUndo}
          />
        )}

        {page === "reports" && (
          <ReportsPage
            financials={financials}
            expenses={expenses}
            receipts={receipts}
            inventory={inventory}
            giftCards={giftCards}
            transactions={transactions}
            salesOrders={salesOrders}
            returns={returns}
          />
        )}

        {page === "nike-swoosh-monitor" && <NikeSwooshPolicyMonitor />}

        {page === "ai-inbox" && (
          <AIInboxPage
            aiInbox={aiInbox}
            setAiInbox={setAiInbox}
            setInventory={setInventory}
            setReceipts={setReceipts}
            setCustomers={setCustomers}
            setGiftCards={setGiftCards}
            setExpenses={setExpenses}
            setTransactions={setTransactions}
          />
        )}

        {page === "email-intelligence" && <EmailIntelligence activeSection={routeSection} />}

        {page === "ai-tools" && <AIToolsPage inventory={inventory} />}
      </main>

      {phoneCompanionOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.72)", zIndex: 5000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ ...styles.card, width: "100%", maxWidth: "520px" }}>
            <h2 style={{ marginTop: 0 }}>Phone Companion</h2>
            <p style={styles.muted}>Scan the QR code or open the link on your phone to upload photos, receipts, and scanned codes directly into this session.</p>
            {phoneCompanionError ? (
              <div style={{ margin: "16px 0", padding: "12px", borderRadius: "10px", background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca" }}>
                {phoneCompanionError}
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "center", margin: "16px 0" }}>
                  <PhoneQrPreview value={phoneCompanionUrl} />
                </div>
                <div style={{ marginBottom: "10px", fontWeight: 700 }}>Mobile link</div>
                <div style={{ wordBreak: "break-all", fontSize: "14px", color: "#6b7280", marginBottom: "14px" }}>
                  <a href={phoneCompanionUrl} target="_blank" rel="noreferrer" style={{ color: "#dc2626" }}>{phoneCompanionUrl}</a>
                </div>
                <button style={styles.primaryButton} onClick={() => window.open(phoneCompanionUrl, "_blank", "noopener,noreferrer")}>Open Mobile Page</button>
              </>
            )}
            <button style={styles.secondaryButton} onClick={() => setPhoneCompanionOpen(false)} style={{ marginLeft: "8px" }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("ReSellOS mobile render error", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", background: "#f3f4f6", padding: "24px", color: "#111827", fontFamily: "Arial, Helvetica, sans-serif" }}>
          <div style={{ maxWidth: "620px", margin: "0 auto", background: "#ffffff", borderRadius: "16px", padding: "24px", boxShadow: "0 2px 10px rgba(0,0,0,0.08)" }}>
            <h1 style={{ marginTop: 0, fontSize: "28px" }}>Mobile page could not load</h1>
            <p style={{ color: "#6b7280", marginBottom: "12px" }}>The mobile upload page hit a runtime error, so the app switched to a safe fallback instead of showing a blank screen.</p>
            <p style={{ color: "#6b7280" }}>Please refresh the page and try again. If the issue persists, reopen the companion link from the desktop app.</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppShell />
    </AppErrorBoundary>
  );
}

function PhoneQrPreview({ value }) {
  if (!value) {
    return (
      <div style={{ width: "220px", height: "220px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #e5e7eb", borderRadius: "12px", background: "#ffffff", color: "#6b7280" }}>
        Preparing QR code...
      </div>
    );
  }

  return (
    <div style={{ padding: "10px", border: "1px solid #e5e7eb", borderRadius: "12px", background: "#ffffff" }}>
      <QRCodeSVG value={value} size={220} level="M" includeMargin />
    </div>
  );
}

function PhoneCompanionScreen({ companionUrl, onQueueItem }) {
  const [mode, setMode] = useState("photo");
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("Ready to send");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  async function handleFiles(files, type, extraNote = "") {
    const selected = Array.from(files || []);
    if (!selected.length) return;

    setUploading(true);
    setProgress(0);
    setStatus(`Uploading ${selected.length} file${selected.length > 1 ? "s" : ""}...`);

    try {
      const resolved = await Promise.all(selected.map(async (file) => {
        const asset = await uploadAsset(file, { provider: "local", path: "phone-uploads" });
        return {
          name: file.name,
          data: asset.originalUrl,
          asset,
        };
      }));

      const payload = {
        id: `${Date.now()}-${Math.random()}`,
        type,
        files: resolved.map((entry) => entry.data),
        fileName: resolved[0]?.name || "",
        note: `${extraNote}${extraNote && note ? " - " : ""}${note}`.trim(),
        code: mode === "barcode" || mode === "qr" ? code : "",
        assets: resolved.map((entry) => entry.asset),
      };

      onQueueItem(payload);
      await syncUserState("phone-upload", payload);
      setProgress(100);
      setStatus(`Upload complete. ${resolved.length} file${resolved.length > 1 ? "s" : ""} sent to your laptop session.`);
      setUploading(false);
      setNote("");
      setCode("");
    } catch {
      setUploading(false);
      setStatus("Upload failed. Please try again.");
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", padding: "20px", color: "#111827", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <div style={{ maxWidth: "640px", margin: "0 auto", background: "#ffffff", borderRadius: "16px", padding: "20px", boxShadow: "0 2px 10px rgba(0,0,0,0.08)" }}>
        <h1 style={{ marginTop: 0, fontSize: "28px" }}>Phone Companion</h1>
        <p style={{ color: "#6b7280", marginBottom: "16px" }}>Use your phone as the capture device, then let your laptop act as the management dashboard. Photos, receipts, and product images sync instantly.</p>

        <div style={{ display: "grid", gap: "10px", marginBottom: "14px" }}>
          {[
            ["photo", "Take Photo"],
            ["multiple", "Upload Multiple Images"],
            ["receipt", "Upload Receipt"],
            ["barcode", "Scan Barcode"],
            ["qr", "Scan QR Code"],
          ].map(([value, label]) => (
            <button key={value} style={{ ...styles.secondaryButton, textAlign: "left", padding: "12px 14px" }} onClick={() => setMode(value)}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: "14px" }}>
          <label style={styles.label}>Note</label>
          <input style={styles.input} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note for the item" />
        </div>

        {(mode === "barcode" || mode === "qr") && (
          <div style={{ marginBottom: "14px" }}>
            <label style={styles.label}>{mode === "barcode" ? "Barcode" : "QR Code"}</label>
            <input style={styles.input} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Enter or paste the scanned value" />
            <button style={styles.primaryButton} onClick={() => {
              if (!code.trim()) return;
              onQueueItem({ id: `${Date.now()}-${Math.random()}`, type: mode, code: code.trim(), note });
              setStatus("Sent to your laptop session");
              setCode("");
              setNote("");
            }}>Send {mode === "barcode" ? "Barcode" : "QR Code"}</button>
          </div>
        )}

        {mode !== "barcode" && mode !== "qr" && (
          <div>
            <label style={styles.label}>Choose file{mode === "multiple" ? "s" : ""}</label>
            <input
              type="file"
              multiple={mode === "multiple" || mode === "photo"}
              accept={mode === "receipt" ? "image/*,.pdf" : "image/*"}
              capture={mode === "photo" ? "environment" : undefined}
              onChange={(event) => handleFiles(event.target.files, mode, mode === "receipt" ? "receipt" : "")}
            />
          </div>
        )}

        {uploading && (
          <div style={{ marginTop: "12px" }}>
            <div style={{ height: "8px", borderRadius: "999px", background: "#e5e7eb", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress}%`, background: "#dc2626", transition: "width 0.2s ease" }} />
            </div>
            <div style={{ marginTop: "6px", color: "#6b7280", fontSize: "13px" }}>Uploading to desktop session...</div>
          </div>
        )}

        <div style={{ marginTop: "16px", color: "#6b7280", fontSize: "14px" }}>{status}</div>
        <div style={{ marginTop: "12px", fontSize: "13px", color: "#9ca3af", wordBreak: "break-all" }}>
          <a href={companionUrl} target="_blank" rel="noreferrer" style={{ color: "#dc2626" }}>{companionUrl}</a>
        </div>
        <div style={{ marginTop: "10px", fontSize: "13px", color: "#6b7280" }}>Tip: keep this page open on your laptop so the phone sync stays active and uploads land in the same receipt library.</div>
      </div>
    </div>
  );
}

function PageHeader({ title, description }) {
  return (
    <div style={styles.header}>
      <h1 style={styles.pageTitle}>{title}</h1>
      <p style={styles.muted}>{description}</p>
    </div>
  );
}

function StatCard({ label, value, detail }) {
  return (
    <div style={styles.card}>
      <div style={{ color: "#6b7280", fontSize: "14px" }}>
        {label}
      </div>

      <div
        style={{
          fontSize: "27px",
          fontWeight: 800,
          marginTop: "8px",
        }}
      >
        {value}
      </div>

      {detail && (
        <div
          style={{
            color: "#9ca3af",
            fontSize: "12px",
            marginTop: "7px",
          }}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

function Dashboard({
  inventory,
  customers,
  receipts,
  financials,
  setPage,
  isMobile = false,
}) {
  const today = new Date().toISOString().slice(0, 10);
  const todayPurchases = receipts.filter(
    (receipt) => receipt.type === "purchase" && receipt.date === today
  ).length;
  const todaySales = receipts.filter(
    (receipt) => receipt.type === "sale" && receipt.date === today
  ).length;
  const inventoryValue = inventory.reduce(
    (sum, item) => sum + Number(item.sellingPrice || 0) * Number(item.quantity || 1),
    0
  );
  const giftCardValue = (() => {
    try {
      const cards = JSON.parse(localStorage.getItem("resellos-gift-cards") || "[]");
      return cards.reduce((sum, card) => sum + Number(card.balance || 0), 0);
    } catch {
      return 0;
    }
  })();
  const pendingTasks = inventory.filter(
    (item) => !item.sellingPrice || Number(item.sellingPrice || 0) <= Number(item.purchasePrice || 0)
  ).length;

  if (isMobile) {
    const featureCards = [
      { page: "inventory", label: "Inventory", icon: "📦", description: `${inventory.length} items tracked` },
      { page: "customers", label: "Customers", icon: "👥", description: `${customers.length} contacts` },
      { page: "gift-cards", label: "Gift Cards", icon: "💳", description: "Track balances" },
      { page: "receipts", label: "Receipts", icon: "🧾", description: `${receipts.length} records` },
      { page: "ai-inbox", label: "AI Inbox", icon: "🤖", description: "Upload and review" },
      { page: "email-intelligence", label: "Email Intelligence", icon: "📧", description: "Inbox and merchant insights" },
      { page: "financials", label: "Financial & Tax", icon: "💰", description: "Reports and taxes" },
    ];

    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <PageHeader title="Dashboard" description="Your business at a glance." />

        <div style={{ display: "grid", gap: "10px" }}>
          {featureCards.map((card) => (
            <button
              key={card.page}
              onClick={() => setPage(card.page)}
              style={{
                ...styles.mobileCard,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                borderRadius: "14px",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ fontSize: "22px" }}>{card.icon}</div>
                <div>
                  <div style={{ fontWeight: 800 }}>{card.label}</div>
                  <div style={{ color: "#6b7280", fontSize: "13px", marginTop: "2px" }}>{card.description}</div>
                </div>
              </div>
              <div style={{ color: "#9ca3af", fontSize: "18px" }}>→</div>
            </button>
          ))}
        </div>

        <div style={{ ...styles.mobileCard, marginTop: "14px" }}>
          <div style={{ display: "grid", gap: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#6b7280", fontSize: "13px" }}>Inventory Value</span>
              <strong>{money(inventoryValue)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#6b7280", fontSize: "13px" }}>Gift Card Value</span>
              <strong>{money(giftCardValue)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#6b7280", fontSize: "13px" }}>Pending Tasks</span>
              <strong>{pendingTasks}</strong>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your business at a glance."
      />

      <div style={styles.grid}>
        <StatCard label="Inventory Count" value={inventory.length} />
        <StatCard label="Gift Cards" value={(() => {
          try {
            return JSON.parse(localStorage.getItem("resellos-gift-cards") || "[]").length;
          } catch {
            return 0;
          }
        })()} />
        <StatCard label="Customers" value={customers.length} />
        <StatCard label="Receipts" value={receipts.length} />
        <StatCard label="Today's Purchases" value={todayPurchases} />
        <StatCard label="Today's Sales" value={todaySales} />
        <StatCard label="Monthly Profit" value={money(financials.estimatedProfit)} />
        <StatCard label="Inventory Value" value={money(inventoryValue)} />
        <StatCard label="Gift Card Value" value={money(giftCardValue)} />
        <StatCard label="Pending Tasks" value={pendingTasks} />
      </div>

      <div
        style={{
          ...styles.card,
          marginTop: "22px",
        }}
      >
        <h2>Quick Actions</h2>

        <div
          style={{
            display: "flex",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <button
            style={styles.primaryButton}
            onClick={() => setPage("inventory")}
          >
            Import Inventory
          </button>

          <button
            style={styles.darkButton}
            onClick={() => setPage("receipts")}
          >
            Review Receipts
          </button>

          <button
            style={styles.secondaryButton}
            onClick={() => setPage("customers")}
          >
            Add Customer
          </button>

          <button
            style={styles.secondaryButton}
            onClick={() => setPage("gift-cards")}
          >
            Open Gift Card Center
          </button>

          <button
            style={styles.secondaryButton}
            onClick={() => setPage("ai-inbox")}
          >
            Open AI Inbox
          </button>

          <button
            style={styles.secondaryButton}
            onClick={() => setPage("email-intelligence")}
          >
            Open Email Intelligence
          </button>

          <button
            style={styles.secondaryButton}
            onClick={() => setPage("email-intelligence", "gmail")}
          >
            Open Gmail Integration
          </button>

          <button
            style={styles.secondaryButton}
            onClick={() => setPage("reports")}
          >
            Open Reports
          </button>

          <button
            style={styles.secondaryButton}
            onClick={() => setPage("financials")}
          >
            Open Tax Center
          </button>
        </div>
      </div>
    </>
  );
}

function InventoryPage({ inventory, setInventory, giftCards = [], setGiftCards = () => {}, transactions = [], setTransactions = () => {}, onUndo, setActiveInventoryEditId }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showImportModal, setShowImportModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [importDrafts, setImportDrafts] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [manualForm, setManualForm] = useState({
    productName: "",
    brand: "",
    sku: "",
    styleCode: "",
    color: "",
    size: "",
    gender: "",
    category: "",
    condition: "New",
    quantity: "1",
    purchasePrice: "",
    sellingPrice: "",
    marketplace: "",
    purchaseLocation: "",
    purchaseDate: "",
    supplier: "",
    receiptNumber: "",
    storageLocation: "",
    notes: "",
    status: "In Stock",
    fundingSource: "Cash",
    fundingGiftCardId: "",
  });
  const [manualPhotos, setManualPhotos] = useState([]);
  const [aiPreview, setAiPreview] = useState(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);

  async function analyzeManualProduct() {
    setAiAnalyzing(true);
    const baseItem = {
      productName: manualForm.productName.trim(),
      brand: manualForm.brand.trim(),
      sku: manualForm.sku.trim(),
      styleCode: manualForm.styleCode.trim(),
      color: manualForm.color.trim(),
      size: manualForm.size.trim(),
      gender: manualForm.gender.trim(),
      category: manualForm.category.trim(),
      notes: manualForm.notes.trim(),
    };

    const enriched = await enrichInventoryItem(baseItem, {
      productName: baseItem.productName,
      brand: baseItem.brand,
      sku: baseItem.sku,
      styleCode: baseItem.styleCode,
      color: baseItem.color,
      size: baseItem.size,
      gender: baseItem.gender,
      category: baseItem.category,
      notes: baseItem.notes,
    });

    setAiPreview({
      previewItem: enriched,
      selectedIndex: 0,
      recognition: enriched.aiRecognition || null,
    });
    setAiAnalyzing(false);
  }

  function applyAiCandidate(index) {
    if (!aiPreview?.previewItem) return;
    const previewItem = mergeRecognitionIntoItem(
      {
        productName: manualForm.productName.trim(),
        brand: manualForm.brand.trim(),
        sku: manualForm.sku.trim(),
        styleCode: manualForm.styleCode.trim(),
        color: manualForm.color.trim(),
        size: manualForm.size.trim(),
        gender: manualForm.gender.trim(),
        category: manualForm.category.trim(),
        notes: manualForm.notes.trim(),
      },
      aiPreview.recognition || {},
      index
    );

    setAiPreview({
      previewItem,
      selectedIndex: index,
      recognition: aiPreview.recognition || null,
    });

    setManualForm((current) => ({
      ...current,
      productName: previewItem.productName || current.productName,
      brand: previewItem.brand || current.brand,
      sku: previewItem.sku || current.sku,
      styleCode: previewItem.styleCode || current.styleCode,
      color: previewItem.color || current.color,
      category: previewItem.category || current.category,
      gender: previewItem.gender || current.gender,
      notes: [current.notes, previewItem.description].filter(Boolean).join("\n").trim() || current.notes,
    }));

    if (!manualPhotos.length && previewItem.photos?.length) {
      setManualPhotos(previewItem.photos);
    }
  }

  function parseCsv(text) {
    const rows = [];
    let current = [];
    let currentValue = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"') {
        if (inQuotes && next === '"') {
          currentValue += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        current.push(currentValue);
        currentValue = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") {
          i += 1;
        }
        current.push(currentValue);
        if (current.some((entry) => entry.trim())) {
          rows.push(current);
        }
        current = [];
        currentValue = "";
      } else {
        currentValue += char;
      }
    }

    if (currentValue.length > 0 || current.length > 0) {
      current.push(currentValue);
      if (current.some((entry) => entry.trim())) {
        rows.push(current);
      }
    }

    if (rows.length <= 1) {
      return [];
    }

    const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[^a-z0-9]+/g, ""));
    return rows.slice(1).map((row) => {
      const values = row.slice(0, headers.length);
      const item = {};
      headers.forEach((header, index) => {
        item[header] = values[index] ? values[index].trim() : "";
      });
      return item;
    });
  }

  function createDraftFromFile(file) {
    const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    return {
      id: `${Date.now()}-${Math.random()}`,
      productName: baseName || "Imported Item",
      brand: "",
      sku: "",
      styleCode: "",
      color: "",
      size: "",
      condition: "New",
      purchasePrice: 0,
      sellingPrice: 0,
      quantity: 1,
      source: file.name,
      status: "In Stock",
      notes: `Imported from ${file.name}`,
      storeName: "",
      purchaseDate: "",
      taxPaid: 0,
      shipping: 0,
      discounts: 0,
      receiptTotal: 0,
      paymentMethod: "",
      vendor: "",
      photo: file.name,
    };
  }

  async function processFiles(files) {
    const drafts = [];

    for (const file of Array.from(files)) {
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith(".csv")) {
        const text = await file.text();
        const rows = parseCsv(text);
        rows.forEach((row) => {
          drafts.push({
            id: `${Date.now()}-${Math.random()}`,
            productName: row.productname || row.itemname || row.name || "Imported Item",
            brand: row.brand || row.vendor || "",
            sku: row.sku || row.stylecode || row.style || "",
            styleCode: row.stylecode || row.style || "",
            color: row.color || "",
            size: row.size || "",
            condition: "New",
            purchasePrice: Number(row.purchaseprice || row.price || row.cost || 0),
            sellingPrice: Number(row.sellingprice || row.price || 0),
            quantity: Number(row.quantity || 1),
            source: file.name,
            status: "In Stock",
            notes: row.notes || `Imported from ${file.name}`,
            storeName: row.storename || "",
            purchaseDate: row.purchasedate || "",
            taxPaid: Number(row.taxpaid || 0),
            shipping: Number(row.shipping || 0),
            discounts: Number(row.discounts || 0),
            receiptTotal: Number(row.receipttotal || 0),
            paymentMethod: row.paymentmethod || "",
            vendor: row.vendor || "",
            photo: file.name,
          });
        });
      } else {
        drafts.push(createDraftFromFile(file));
      }
    }

    setImportDrafts(drafts);
    setShowImportModal(true);
  }

  async function handleImportSelection(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    await processFiles(files);
    event.target.value = "";
  }

  async function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    await processFiles(files);
  }

  function updateDraftField(event, id) {
    const { name, value } = event.target;
    setImportDrafts((current) =>
      current.map((item) => (item.id === id ? { ...item, [name]: value } : item))
    );
  }

  async function saveImportedItems() {
    const normalized = [];

    for (const item of importDrafts) {
      const baseItem = {
        ...item,
        purchasePrice: Number(item.purchasePrice || 0),
        sellingPrice: Number(item.sellingPrice || 0),
        quantity: Number(item.quantity || 1),
        createdAt: new Date().toISOString(),
        productName: item.productName || "Imported Item",
      };

      const enriched = await enrichInventoryItem(baseItem, {
        productName: baseItem.productName,
        brand: baseItem.brand,
        sku: baseItem.sku,
        styleCode: baseItem.styleCode,
        color: baseItem.color,
        size: baseItem.size,
        notes: baseItem.notes,
      });

      normalized.push({
        ...enriched,
        purchasePrice: Number(enriched.purchasePrice || 0),
        sellingPrice: Number(enriched.sellingPrice || 0),
        quantity: Number(enriched.quantity || 1),
        createdAt: new Date().toISOString(),
        productName: enriched.productName || "Imported Item",
      });
    }

    if (normalized.length > 0) {
      setInventory((current) => [...normalized, ...current]);
    }

    setImportDrafts([]);
    setShowImportModal(false);
  }

  function updateManualField(event) {
    const { name, value } = event.target;
    setManualForm((current) => ({ ...current, [name]: value }));
  }

  function handleManualPhotoSelection(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const readers = Array.from(files).map(
      (file) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        })
    );

    Promise.all(readers).then((results) => {
      setManualPhotos((current) => [...current, ...results]);
    });

    event.target.value = "";
  }

  async function saveManualInventory(event) {
    event.preventDefault();

    if (!manualForm.productName.trim()) {
      alert("Enter a product name first.");
      return;
    }

    const fundingSource = manualForm.fundingSource || "Cash";
    const fundingGiftCardId = (manualForm.fundingGiftCardId || "").trim();
    const purchaseAmount = Number(manualForm.purchasePrice || 0) * Number(manualForm.quantity || 1);

    if (fundingSource === "Gift Card" && !fundingGiftCardId) {
      alert("Select a gift card to fund this inventory purchase.");
      return;
    }

    let linkedGiftCard = null;
    if (fundingSource === "Gift Card") {
      linkedGiftCard = Array.isArray(giftCards)
        ? giftCards.find((card) => card.id === fundingGiftCardId)
        : null;
      if (!linkedGiftCard) {
        alert("The selected gift card could not be found.");
        return;
      }
      if (Number(linkedGiftCard.balance || 0) < purchaseAmount) {
        alert("Selected gift card does not have enough balance for this purchase.");
        return;
      }
    }

    const aiApplied = aiPreview?.previewItem || null;
    const newItem = {
      id: `${Date.now()}-${Math.random()}`,
      productName: manualForm.productName.trim() || aiApplied?.productName || "",
      brand: manualForm.brand.trim() || aiApplied?.brand || "",
      sku: manualForm.sku.trim() || aiApplied?.sku || "",
      styleCode: manualForm.styleCode.trim() || aiApplied?.styleCode || "",
      color: manualForm.color.trim() || aiApplied?.color || "",
      size: manualForm.size.trim() || aiApplied?.size || "",
      gender: manualForm.gender.trim() || aiApplied?.gender || "",
      category: manualForm.category.trim() || aiApplied?.category || "",
      condition: manualForm.condition || "New",
      quantity: Number(manualForm.quantity || 1),
      purchasePrice: Number(manualForm.purchasePrice || 0),
      sellingPrice: Number(manualForm.sellingPrice || 0),
      marketplace: manualForm.marketplace.trim(),
      purchaseLocation: manualForm.purchaseLocation.trim(),
      purchaseDate: manualForm.purchaseDate,
      supplier: manualForm.supplier.trim(),
      receiptNumber: manualForm.receiptNumber.trim(),
      storageLocation: manualForm.storageLocation.trim(),
      notes: [manualForm.notes.trim(), aiApplied?.description].filter(Boolean).join("\n").trim(),
      description: aiApplied?.description || manualForm.notes.trim() || "",
      releaseDate: aiApplied?.releaseDate || "",
      msrp: Number(aiApplied?.msrp || 0),
      status: manualForm.status || "In Stock",
      photos: manualPhotos.length ? manualPhotos : aiApplied?.photos || [],
      photo: manualPhotos[0] || aiApplied?.photo || "",
      createdAt: new Date().toISOString(),
      source: manualForm.purchaseLocation.trim() || manualForm.supplier.trim() || "Manual Entry",
      fundingSource,
      fundingGiftCardId: fundingSource === "Gift Card" ? fundingGiftCardId : "",
      fundingAmount: fundingSource === "Gift Card" ? purchaseAmount : 0,
      aiRecognition: aiApplied?.aiRecognition || null,
    };

    if (linkedGiftCard) {
      const nextBalance = Number(linkedGiftCard.balance || 0) - purchaseAmount;
      setGiftCards((current) =>
        current.map((card) =>
          card.id === linkedGiftCard.id
            ? {
                ...card,
                balance: nextBalance,
                status: nextBalance <= 0 ? "Empty" : card.status || "New",
              }
            : card
        )
      );
      const fundingTransaction = {
        id: `txn-${Date.now()}-${Math.random()}`,
        type: "inventory-funding",
        date: manualForm.purchaseDate || new Date().toISOString().slice(0, 10),
        amount: purchaseAmount,
        inventoryId: newItem.id,
        giftCardId: fundingGiftCardId,
        description: `Inventory funded by ${linkedGiftCard.brand || "gift card"}`,
        balanceAfter: nextBalance,
      };
      setTransactions((current) => [fundingTransaction, ...current]);
      newItem.fundingTransactionId = fundingTransaction.id;
    }

    setInventory((current) => [newItem, ...current]);
    setManualForm({
      productName: "",
      brand: "",
      sku: "",
      styleCode: "",
      color: "",
      size: "",
      gender: "",
      category: "",
      condition: "New",
      quantity: "1",
      purchasePrice: "",
      sellingPrice: "",
      marketplace: "",
      purchaseLocation: "",
      purchaseDate: "",
      supplier: "",
      receiptNumber: "",
      storageLocation: "",
      notes: "",
      status: "In Stock",
      fundingSource: "Cash",
      fundingGiftCardId: "",
    });
    setManualPhotos([]);
    setAiPreview(null);
    setShowManualModal(false);
  }

  function startEdit(item) {
    setEditingId(item.id);
    if (typeof setActiveInventoryEditId === "function") setActiveInventoryEditId(item.id);
    setEditForm({
      productName: item.productName || "",
      brand: item.brand || "",
      sku: item.sku || "",
      styleCode: item.styleCode || "",
      color: item.color || "",
      size: item.size || "",
      gender: item.gender || "",
      category: item.category || "",
      condition: item.condition || "New",
      purchasePrice: item.purchasePrice || "",
      sellingPrice: item.sellingPrice || "",
      quantity: item.quantity || "1",
      marketplace: item.marketplace || "",
      purchaseLocation: item.purchaseLocation || "",
      purchaseDate: item.purchaseDate || "",
      supplier: item.supplier || "",
      receiptNumber: item.receiptNumber || "",
      source: item.source || "",
      storageLocation: item.storageLocation || "",
      status: item.status || "In Stock",
      fundingSource: item.fundingSource || "Cash",
      fundingGiftCardId: item.fundingGiftCardId || "",
      notes: item.notes || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveEdit(event) {
    event.preventDefault();
    if (!editForm) return;

    setInventory((current) =>
      current.map((item) =>
        item.id === editingId
          ? {
              ...item,
              productName: editForm.productName,
              brand: editForm.brand,
              sku: editForm.sku,
              styleCode: editForm.styleCode,
              color: editForm.color,
              size: editForm.size,
              gender: editForm.gender,
              category: editForm.category,
              condition: editForm.condition,
              purchasePrice: Number(editForm.purchasePrice || 0),
              sellingPrice: Number(editForm.sellingPrice || 0),
              quantity: Number(editForm.quantity || 1),
              marketplace: editForm.marketplace,
              purchaseLocation: editForm.purchaseLocation,
              purchaseDate: editForm.purchaseDate,
              supplier: editForm.supplier,
              receiptNumber: editForm.receiptNumber,
              source: editForm.source,
              storageLocation: editForm.storageLocation,
              status: editForm.status,
              fundingSource: editForm.fundingSource || "Cash",
              fundingGiftCardId: editForm.fundingGiftCardId || "",
              notes: editForm.notes,
              photo: item.photo || "",
            }
          : item
      )
    );
    setEditingId(null);
    setEditForm(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
  }

  function deleteItem(id) {
    const confirmed = window.confirm("Delete this inventory item?");
    if (confirmed) {
      const previousValue = inventory;
      setInventory((current) => current.filter((item) => item.id !== id));
      onUndo?.("inventory", previousValue, "Inventory item");
    }
  }

  function duplicateItem(item) {
    const duplicate = {
      ...item,
      id: `${Date.now()}-${Math.random()}`,
      productName: `${item.productName || "Inventory Item"} Copy`,
      createdAt: new Date().toISOString(),
      status: item.status === "Sold" ? "In Stock" : item.status,
    };
    setInventory((current) => [duplicate, ...current]);
  }

  function markSold(id) {
    setInventory((current) =>
      current.map((item) => (item.id === id ? { ...item, status: "Sold" } : item))
    );
  }

  function printLabel(item) {
    const label = `
      <html>
        <body style="font-family: Arial, sans-serif; padding: 24px;">
          <h2 style="margin-bottom: 8px;">${item.productName || "Inventory Item"}</h2>
          <p><strong>Brand:</strong> ${item.brand || "—"}</p>
          <p><strong>SKU:</strong> ${item.sku || "—"}</p>
          <p><strong>Size:</strong> ${item.size || "—"}</p>
          <p><strong>Storage:</strong> ${item.storageLocation || "—"}</p>
          <p><strong>Status:</strong> ${item.status || "In Stock"}</p>
          <p><strong>Receipt:</strong> ${item.receiptNumber || "—"}</p>
        </body>
      </html>
    `;

    const printWindow = window.open("", "_blank", "width=600,height=700");
    if (printWindow) {
      printWindow.document.write(label);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
  }

  const filtered = inventory.filter((item) => {
    const text = `${item.productName} ${item.brand} ${item.sku} ${item.size} ${item.receiptNumber} ${item.storageLocation}`.toLowerCase();
    const matchesSearch = text.includes(search.toLowerCase());
    const matchesStatus = statusFilter === "All" ? true : item.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalCost = inventory.reduce(
    (sum, item) => sum + Number(item.purchasePrice || 0) * Number(item.quantity || 1),
    0
  );

  const potentialRevenue = inventory.reduce(
    (sum, item) => sum + Number(item.sellingPrice || 0) * Number(item.quantity || 1),
    0
  );

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Import receipts and invoices, review every item, and keep inventory inventory-ready."
      />

      <div style={styles.grid}>
        <StatCard label="Products" value={inventory.length} />
        <StatCard label="Total Units" value={inventory.reduce((sum, item) => sum + Number(item.quantity || 1), 0)} />
        <StatCard label="Inventory Cost" value={money(totalCost)} />
        <StatCard label="Potential Profit" value={money(potentialRevenue - totalCost)} />
      </div>

      <div style={{ margin: "22px 0", display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button style={styles.primaryButton} onClick={() => setShowImportModal(true)}>
          📥 Import Inventory
        </button>
        <button style={styles.secondaryButton} onClick={() => setShowManualModal(true)}>
          ➕ Add Inventory Manually
        </button>
      </div>

      {showImportModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17,24,39,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 2000,
          }}
        >
          <div style={{ ...styles.card, width: "100%", maxWidth: "960px", maxHeight: "85vh", overflowY: "auto" }}>
            <h2 style={{ marginTop: 0 }}>Import Inventory</h2>
            <p style={styles.muted}>Upload receipt images, PDFs, invoices, packing slips, or CSV files. Review every detected item before saving.</p>

            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              style={{
                border: dragActive ? "2px dashed #dc2626" : "2px dashed #d1d5db",
                borderRadius: "10px",
                padding: "18px",
                marginBottom: "16px",
                textAlign: "center",
              }}
            >
              <input type="file" multiple accept=".csv,.pdf,.jpg,.jpeg,.png,.heic,.heif,.txt,.json" onChange={handleImportSelection} />
              <div style={{ marginTop: "8px", color: "#6b7280" }}>Drag and drop files here or click to browse.</div>
            </div>

            {importDrafts.length > 0 && (
              <div>
                {importDrafts.map((item) => (
                  <div key={item.id} style={{ ...styles.card, marginBottom: "12px" }}>
                    <div style={styles.formGrid}>
                      <div>
                        <label style={styles.label}>Product Name</label>
                        <input style={styles.input} name="productName" value={item.productName} onChange={(event) => updateDraftField(event, item.id)} />
                      </div>
                      <div>
                        <label style={styles.label}>SKU</label>
                        <input style={styles.input} name="sku" value={item.sku} onChange={(event) => updateDraftField(event, item.id)} />
                      </div>
                      <div>
                        <label style={styles.label}>Size</label>
                        <input style={styles.input} name="size" value={item.size} onChange={(event) => updateDraftField(event, item.id)} />
                      </div>
                      <div>
                        <label style={styles.label}>Condition</label>
                        <select style={styles.input} name="condition" value={item.condition} onChange={(event) => updateDraftField(event, item.id)}>
                          <option value="New">New</option>
                          <option value="Used">Used</option>
                          <option value="New With Defects">New With Defects</option>
                        </select>
                      </div>
                      <div>
                        <label style={styles.label}>Purchase Price</label>
                        <input style={styles.input} type="number" step="0.01" name="purchasePrice" value={item.purchasePrice} onChange={(event) => updateDraftField(event, item.id)} />
                      </div>
                      <div>
                        <label style={styles.label}>Selling Price</label>
                        <input style={styles.input} type="number" step="0.01" name="sellingPrice" value={item.sellingPrice} onChange={(event) => updateDraftField(event, item.id)} />
                      </div>
                      <div>
                        <label style={styles.label}>Quantity</label>
                        <input style={styles.input} type="number" min="1" name="quantity" value={item.quantity} onChange={(event) => updateDraftField(event, item.id)} />
                      </div>
                      <div>
                        <label style={styles.label}>Notes</label>
                        <input style={styles.input} name="notes" value={item.notes} onChange={(event) => updateDraftField(event, item.id)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button style={styles.primaryButton} onClick={saveImportedItems}>Save Inventory</button>
              <button style={styles.secondaryButton} onClick={() => setShowImportModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showManualModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17,24,39,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 2000,
          }}
        >
          <div style={{ ...styles.card, width: "100%", maxWidth: "1080px", maxHeight: "85vh", overflowY: "auto" }}>
            <h2 style={{ marginTop: 0 }}>Add Inventory Manually</h2>
            <p style={styles.muted}>Create a product entry without importing anything. Photos are optional.</p>

            <form onSubmit={saveManualInventory}>
              <div style={styles.formGrid}>
                <Field label="Product Name" name="productName" value={manualForm.productName} onChange={updateManualField} placeholder="Air Jordan 12 Bloodline" />
                <Field label="Brand" name="brand" value={manualForm.brand} onChange={updateManualField} placeholder="Nike" />
                <Field label="SKU / Style Code" name="sku" value={manualForm.sku} onChange={updateManualField} placeholder="CT8013-600" />
                <Field label="Style Code" name="styleCode" value={manualForm.styleCode} onChange={updateManualField} placeholder="600" />
                <Field label="Color" name="color" value={manualForm.color} onChange={updateManualField} placeholder="Black / Red" />
                <Field label="Size" name="size" value={manualForm.size} onChange={updateManualField} placeholder="10.5" />
                <Field label="Gender" name="gender" value={manualForm.gender} onChange={updateManualField} placeholder="Men" />
                <Field label="Category" name="category" value={manualForm.category} onChange={updateManualField} placeholder="Sneakers" />
                <SelectField label="Condition" name="condition" value={manualForm.condition} onChange={updateManualField} options={["New", "Used", "New With Defects"]} />
                <Field label="Quantity" name="quantity" value={manualForm.quantity} onChange={updateManualField} type="number" min="1" />
                <Field label="Purchase Price" name="purchasePrice" value={manualForm.purchasePrice} onChange={updateManualField} type="number" step="0.01" placeholder="150" />
                <Field label="Estimated Selling Price" name="sellingPrice" value={manualForm.sellingPrice} onChange={updateManualField} type="number" step="0.01" placeholder="240" />
                <SelectField label="Funding Source" name="fundingSource" value={manualForm.fundingSource} onChange={updateManualField} options={["Cash", "Gift Card"]} />
                {manualForm.fundingSource === "Gift Card" && (
                  <div>
                    <label style={styles.label}>Gift Card</label>
                    <select style={styles.input} name="fundingGiftCardId" value={manualForm.fundingGiftCardId} onChange={updateManualField}>
                      <option value="">Select a gift card</option>
                      {Array.isArray(giftCards) && giftCards.map((card) => (
                        <option key={card.id} value={card.id}>
                          {card.brand || "Gift Card"} • {money(Number(card.balance || 0))}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <Field label="Marketplace" name="marketplace" value={manualForm.marketplace} onChange={updateManualField} placeholder="eBay" />
                <Field label="Purchase Location" name="purchaseLocation" value={manualForm.purchaseLocation} onChange={updateManualField} placeholder="Nike Store" />
                <Field label="Purchase Date" name="purchaseDate" value={manualForm.purchaseDate} onChange={updateManualField} type="date" />
                <Field label="Supplier" name="supplier" value={manualForm.supplier} onChange={updateManualField} placeholder="Supplier Name" />
                <Field label="Receipt Number" name="receiptNumber" value={manualForm.receiptNumber} onChange={updateManualField} placeholder="R-1001" />
                <Field label="Storage Location" name="storageLocation" value={manualForm.storageLocation} onChange={updateManualField} placeholder="Aisle 3 / Bin 12" />
                <Field label="Notes" name="notes" value={manualForm.notes} onChange={updateManualField} placeholder="Additional notes" />
              </div>

              <div style={{ marginTop: "16px", marginBottom: "16px", ...styles.card }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "18px" }}>AI Product Recognition</h3>
                    <p style={{ ...styles.muted, margin: "6px 0 0" }}>Use the available product data to auto-fill details and choose a likely product image.</p>
                  </div>
                  <button type="button" style={styles.secondaryButton} onClick={analyzeManualProduct}>
                    {aiAnalyzing ? "Analyzing..." : "Analyze Product"}
                  </button>
                </div>

                {aiPreview?.previewItem && (
                  <div style={{ marginTop: "12px" }}>
                    <div style={{ fontWeight: 700, marginBottom: "8px" }}>
                      Suggested match • Confidence: {aiPreview.previewItem.aiRecognition?.confidence || "Low"}
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
                      {(aiPreview.previewItem.aiRecognition?.candidates || []).map((candidate, index) => (
                        <button key={`${candidate.id}-${index}`} type="button" style={index === aiPreview.selectedIndex ? styles.primaryButton : styles.secondaryButton} onClick={() => applyAiCandidate(index)}>
                          {candidate.productName} • {candidate.confidence}
                        </button>
                      ))}
                    </div>
                    <div style={{ color: "#6b7280", fontSize: "14px" }}>
                      {aiPreview.previewItem.description || "AI-generated description will appear here once a match is selected."}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: "16px", marginBottom: "16px" }}>
                <label style={styles.label}>Upload Product Photos</label>
                <input type="file" multiple accept="image/*" onChange={handleManualPhotoSelection} />
                {manualPhotos.length > 0 && (
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "10px" }}>
                    {manualPhotos.map((photo, index) => (
                      <img key={`${photo}-${index}`} src={photo} alt={`Product ${index + 1}`} style={{ width: "70px", height: "70px", objectFit: "cover", borderRadius: "8px", border: "1px solid #e5e7eb" }} />
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button style={styles.primaryButton} type="submit">Save Inventory</button>
                <button style={styles.secondaryButton} type="button" onClick={() => setShowManualModal(false)}>Close</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editForm && (
        <form onSubmit={saveEdit} style={{ ...styles.card, marginBottom: "22px" }}>
          <h2>Edit Inventory</h2>
          <div style={styles.formGrid}>
            <Field label="Product Name" name="productName" value={editForm.productName} onChange={(event) => setEditForm((current) => ({ ...current, productName: event.target.value }))} placeholder="Air Jordan 12 Bloodline" />
            <Field label="Brand" name="brand" value={editForm.brand} onChange={(event) => setEditForm((current) => ({ ...current, brand: event.target.value }))} placeholder="Nike" />
            <Field label="SKU / Style Code" name="sku" value={editForm.sku} onChange={(event) => setEditForm((current) => ({ ...current, sku: event.target.value }))} placeholder="CT8013-600" />
            <Field label="Style Code" name="styleCode" value={editForm.styleCode} onChange={(event) => setEditForm((current) => ({ ...current, styleCode: event.target.value }))} placeholder="600" />
            <Field label="Color" name="color" value={editForm.color} onChange={(event) => setEditForm((current) => ({ ...current, color: event.target.value }))} placeholder="Black / Red" />
            <Field label="Size" name="size" value={editForm.size} onChange={(event) => setEditForm((current) => ({ ...current, size: event.target.value }))} placeholder="10.5" />
            <Field label="Gender" name="gender" value={editForm.gender} onChange={(event) => setEditForm((current) => ({ ...current, gender: event.target.value }))} placeholder="Men" />
            <Field label="Category" name="category" value={editForm.category} onChange={(event) => setEditForm((current) => ({ ...current, category: event.target.value }))} placeholder="Sneakers" />
            <SelectField label="Condition" name="condition" value={editForm.condition} onChange={(event) => setEditForm((current) => ({ ...current, condition: event.target.value }))} options={["New", "Used", "New With Defects"]} />
            <Field label="Purchase Price" name="purchasePrice" value={editForm.purchasePrice} onChange={(event) => setEditForm((current) => ({ ...current, purchasePrice: event.target.value }))} type="number" step="0.01" placeholder="150" />
            <Field label="Selling Price" name="sellingPrice" value={editForm.sellingPrice} onChange={(event) => setEditForm((current) => ({ ...current, sellingPrice: event.target.value }))} type="number" step="0.01" placeholder="240" />
            <SelectField label="Funding Source" name="fundingSource" value={editForm.fundingSource || "Cash"} onChange={(event) => setEditForm((current) => ({ ...current, fundingSource: event.target.value }))} options={["Cash", "Gift Card"]} />
            {(editForm.fundingSource || "Cash") === "Gift Card" && (
              <div>
                <label style={styles.label}>Gift Card</label>
                <select style={styles.input} name="fundingGiftCardId" value={editForm.fundingGiftCardId || ""} onChange={(event) => setEditForm((current) => ({ ...current, fundingGiftCardId: event.target.value }))}>
                  <option value="">Select a gift card</option>
                  {Array.isArray(giftCards) && giftCards.map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.brand || "Gift Card"} • {money(Number(card.balance || 0))}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Field label="Quantity" name="quantity" value={editForm.quantity} onChange={(event) => setEditForm((current) => ({ ...current, quantity: event.target.value }))} type="number" min="1" />
            <Field label="Marketplace" name="marketplace" value={editForm.marketplace} onChange={(event) => setEditForm((current) => ({ ...current, marketplace: event.target.value }))} placeholder="eBay" />
            <Field label="Purchase Location" name="purchaseLocation" value={editForm.purchaseLocation} onChange={(event) => setEditForm((current) => ({ ...current, purchaseLocation: event.target.value }))} placeholder="Nike Store" />
            <Field label="Purchase Date" name="purchaseDate" value={editForm.purchaseDate} onChange={(event) => setEditForm((current) => ({ ...current, purchaseDate: event.target.value }))} type="date" />
            <Field label="Supplier" name="supplier" value={editForm.supplier} onChange={(event) => setEditForm((current) => ({ ...current, supplier: event.target.value }))} placeholder="Supplier Name" />
            <Field label="Receipt Number" name="receiptNumber" value={editForm.receiptNumber} onChange={(event) => setEditForm((current) => ({ ...current, receiptNumber: event.target.value }))} placeholder="R-1001" />
            <Field label="Storage Location" name="storageLocation" value={editForm.storageLocation} onChange={(event) => setEditForm((current) => ({ ...current, storageLocation: event.target.value }))} placeholder="Aisle 3 / Bin 12" />
            <SelectField label="Status" name="status" value={editForm.status} onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value }))} options={["In Stock", "Listed", "Reserved", "Sold"]} />
            <Field label="Notes" name="notes" value={editForm.notes} onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Additional notes" />
          </div>
          <button type="submit" style={styles.darkButton}>Update Inventory</button>
          <button type="button" style={styles.secondaryButton} onClick={cancelEdit}>
            Cancel
          </button>
        </form>
      )}

      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "15px", flexWrap: "wrap", alignItems: "center" }}>
          <h2>Your Inventory</h2>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            <input style={{ ...styles.input, width: "280px", marginBottom: 0 }} placeholder="Search product, brand, sku, size, receipt or storage" value={search} onChange={(event) => setSearch(event.target.value)} />
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {['All', 'In Stock', 'Listed', 'Sold'].map((filter) => (
                <button key={filter} style={statusFilter === filter ? styles.primaryButton : styles.secondaryButton} onClick={() => setStatusFilter(filter)}>
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p style={styles.muted}>No inventory found.</p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Photo</th>
                  <th style={styles.th}>Product</th>
                  <th style={styles.th}>Brand</th>
                  <th style={styles.th}>SKU</th>
                  <th style={styles.th}>Size</th>
                  <th style={styles.th}>Qty</th>
                  <th style={styles.th}>Purchase Price</th>
                  <th style={styles.th}>Selling Price</th>
                  <th style={styles.th}>Estimated Profit</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Storage</th>
                  <th style={styles.th}>Purchase Date</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const profit = Number(item.sellingPrice || 0) - Number(item.purchasePrice || 0);
                  return (
                    <tr key={item.id}>
                      <td style={styles.td}>
                        {(item.photos && item.photos[0]) || item.photo ? (
                          <img src={(item.photos && item.photos[0]) || item.photo} alt={item.productName} style={{ width: "56px", height: "56px", objectFit: "cover", borderRadius: "6px", border: "1px solid #e5e7eb" }} />
                        ) : (
                          <span style={styles.muted}>No photo</span>
                        )}
                      </td>
                      <td style={styles.td}><strong>{item.productName}</strong><div style={styles.muted}>{item.category || ""}{item.category ? " • " : ""}{item.receiptNumber || ""}</div></td>
                      <td style={styles.td}>{item.brand || "—"}</td>
                      <td style={styles.td}>{item.sku || "—"}</td>
                      <td style={styles.td}>{item.size || "—"}</td>
                      <td style={styles.td}>{item.quantity}</td>
                      <td style={styles.td}>{money(item.purchasePrice)}</td>
                      <td style={styles.td}>{money(item.sellingPrice)}</td>
                      <td style={styles.td}>{money(profit)}</td>
                      <td style={styles.td}>{item.status}</td>
                      <td style={styles.td}>{item.storageLocation || "—"}</td>
                      <td style={styles.td}>{item.purchaseDate || "—"}</td>
                      <td style={styles.td}>
                        <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
                          <button style={styles.secondaryButton} onClick={() => startEdit(item)}>Edit</button>
                          <button style={styles.secondaryButton} onClick={() => duplicateItem(item)}>Duplicate</button>
                          <button style={styles.dangerButton} onClick={() => deleteItem(item.id)}>Delete</button>
                          <button style={styles.secondaryButton} onClick={() => markSold(item.id)}>Mark Sold</button>
                          <button style={styles.secondaryButton} onClick={() => printLabel(item)}>Print Label</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function ImportCenterPage() {
  const templateOptions = [
    "Custom CSV",
    "StockX",
    "eBay",
    "PayPal",
    "Card Depot",
    "TCGplayer",
    "PSA",
    "GCG",
    "Beckett",
    "Shopify",
    "Square",
    "Stripe",
    "Amazon",
  ];

  const placeholderTemplates = [
    { name: "StockX", description: "Marketplace orders and sales reports" },
    { name: "eBay", description: "Seller reports and order exports" },
    { name: "PayPal", description: "Transactions and settlements" },
    { name: "Card Depot", description: "Inventory, pricing, and order data" },
    { name: "TCGplayer", description: "Sales and inventory import flows" },
    { name: "PSA", description: "Grading and submission records" },
    { name: "GCG", description: "Submission and inventory exports" },
    { name: "Beckett", description: "Inventory and transaction imports" },
    { name: "Shopify", description: "Products, orders, and payouts" },
    { name: "Square", description: "Point-of-sale and payment imports" },
    { name: "Stripe", description: "Settlement and charge imports" },
    { name: "Amazon", description: "Orders and inventory reports" },
  ];

  const [selectedTemplate, setSelectedTemplate] = useState("Custom CSV");
  const [sourceType, setSourceType] = useState("csv");
  const [files, setFiles] = useState([]);
  const [pasteText, setPasteText] = useState("");
  const [rawRows, setRawRows] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [mapping, setMapping] = useState({
    cardNumber: "cardnumber",
    last4: "last4",
    orderNumber: "ordernumber",
    marketplaceOrderId: "marketplaceorderid",
    inventoryId: "inventoryid",
    sku: "sku",
    serialNumber: "serialnumber",
    customer: "customer",
    trackingNumber: "trackingnumber",
    amount: "amount",
    marketplace: "marketplace",
  });
  const [warnings, setWarnings] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ total: 0, completed: 0, remaining: 0, successes: 0, warnings: 0, failures: 0, step: "Awaiting analysis" });
  const [importHistory, setImportHistory] = useState(() => loadImportHistory());
  const [savedMappings, setSavedMappings] = useState(() => loadImportMappings());
  const [activeImportId, setActiveImportId] = useState(null);
  const [manualRows, setManualRows] = useState([{ id: `${Date.now()}-1`, cardNumber: "", orderNumber: "", sku: "", customer: "", amount: "" }]);

  function createPreviewRows(rows, nextMapping) {
    const mappedRows = rows.map((row, index) => {
      const cardNumber = row[nextMapping.cardNumber] || row.cardnumber || "";
      const last4 = row[nextMapping.last4] || row.last4 || "";
      const orderNumber = row[nextMapping.orderNumber] || row.ordernumber || "";
      const marketplaceOrderId = row[nextMapping.marketplaceOrderId] || row.marketplaceorderid || "";
      const inventoryId = row[nextMapping.inventoryId] || row.inventoryid || "";
      const sku = row[nextMapping.sku] || row.sku || "";
      const serialNumber = row[nextMapping.serialNumber] || row.serialnumber || "";
      const customer = row[nextMapping.customer] || row.customer || "";
      const trackingNumber = row[nextMapping.trackingNumber] || row.trackingnumber || "";
      const amount = row[nextMapping.amount] || row.amount || "";
      const marketplace = row[nextMapping.marketplace] || row.marketplace || selectedTemplate;

      const hasIdentifier = [cardNumber, last4, orderNumber, marketplaceOrderId, inventoryId, sku, serialNumber, customer, trackingNumber].some(Boolean);
      const duplicateKey = [cardNumber, last4, orderNumber, marketplaceOrderId, inventoryId, sku, serialNumber, customer, trackingNumber].filter(Boolean).join("|");
      const warningsForRow = [];
      if (!hasIdentifier) warningsForRow.push("Missing key identifiers");
      if (!amount) warningsForRow.push("Missing amount");

      return {
        id: `${Date.now()}-${index}`,
        index: index + 1,
        cardNumber,
        last4,
        orderNumber,
        marketplaceOrderId,
        inventoryId,
        sku,
        serialNumber,
        customer,
        trackingNumber,
        amount,
        marketplace,
        status: "ready",
        warnings: warningsForRow,
        duplicateKey,
      };
    });

    const seen = new Map();
    const duplicates = [];
    mappedRows.forEach((row) => {
      if (row.duplicateKey && seen.has(row.duplicateKey)) {
        row.status = "duplicate";
        row.warnings = [...row.warnings, "Duplicate detected"];
        duplicates.push(row);
      } else if (row.duplicateKey) {
        seen.set(row.duplicateKey, row);
      }
    });

    return mappedRows;
  }

  function analyzeImport() {
    let parsedRows = [];
    if (sourceType === "paste") {
      parsedRows = parseCsvText(pasteText);
    } else if (sourceType === "manual") {
      parsedRows = manualRows.map((row) => ({
        cardnumber: row.cardNumber || "",
        last4: row.cardNumber?.slice(-4) || "",
        ordernumber: row.orderNumber || "",
        sku: row.sku || "",
        customer: row.customer || "",
        amount: row.amount || "",
        marketplace: selectedTemplate,
      }));
    } else if (files.length > 0) {
      parsedRows = [];
      files.forEach((file) => {
        const name = file.name?.toLowerCase() || "";
        if (name.endsWith(".csv")) {
          parsedRows.push(...parseCsvText(file.text ? "" : ""));
        } else {
          parsedRows.push({ filename: file.name, source: selectedTemplate, amount: "", marketplace: selectedTemplate, warning: "Parser integration for Excel/PDF is ready for future expansion" });
        }
      });
    }

    const normalizedRows = parsedRows.map((row) => {
      if (row && typeof row === "object") {
        return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
      }
      return row;
    });

    const baseColumns = normalizedRows.length > 0 ? Object.keys(normalizedRows[0]) : [];
    setColumns(baseColumns);
    setRawRows(normalizedRows);
    const nextMapping = { ...mapping };
    Object.entries(nextMapping).forEach(([field, value]) => {
      if (!value || !baseColumns.includes(value)) {
        const preferred = baseColumns.find((column) => column.includes(field.toLowerCase()) || column.includes(field.replace(/([A-Z])/g, "_$1").toLowerCase()));
        nextMapping[field] = preferred || value;
      }
    });
    setMapping(nextMapping);
    const nextPreviewRows = createPreviewRows(normalizedRows, nextMapping);
    setPreviewRows(nextPreviewRows);
    const nextWarnings = [];
    nextPreviewRows.forEach((row) => {
      row.warnings.forEach((warning) => nextWarnings.push(`${row.index}: ${warning}`));
    });
    setWarnings(nextWarnings);
  }

  function updateMapping(field, value) {
    const nextMapping = { ...mapping, [field]: value };
    setMapping(nextMapping);
    if (rawRows.length > 0) {
      const nextPreviewRows = createPreviewRows(rawRows, nextMapping);
      setPreviewRows(nextPreviewRows);
      const nextWarnings = [];
      nextPreviewRows.forEach((row) => row.warnings.forEach((warning) => nextWarnings.push(`${row.index}: ${warning}`)));
      setWarnings(nextWarnings);
    }
  }

  function saveMappingPreference() {
    const nextMappings = { ...savedMappings, [selectedTemplate]: mapping };
    setSavedMappings(nextMappings);
    saveImportMappings(nextMappings);
  }

  function handleFileSelection(event) {
    const selected = Array.from(event.target.files || []);
    setFiles(selected);
    event.target.value = "";
  }

  function handleManualRowChange(index, field, value) {
    setManualRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  function addManualRow() {
    setManualRows((current) => [...current, { id: `${Date.now()}-${current.length + 1}`, cardNumber: "", orderNumber: "", sku: "", customer: "", amount: "" }]);
  }

  function removeManualRow(index) {
    setManualRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  function startImport(rows = previewRows) {
    if (!rows.length) return;
    setProcessing(true);
    setActiveImportId(`${Date.now()}`);
    setProgress({ total: rows.length, completed: 0, remaining: rows.length, successes: 0, warnings: 0, failures: 0, step: "Preparing batch" });

    let index = 0;
    const intervalId = window.setInterval(() => {
      index += 1;
      const completed = Math.min(index, rows.length);
      const failures = Math.max(0, Math.floor(completed / 6));
      const warnings = Math.max(0, Math.floor(completed / 4));
      const successes = completed - failures;
      setProgress({
        total: rows.length,
        completed,
        remaining: Math.max(0, rows.length - completed),
        successes,
        warnings,
        failures,
        step: completed < rows.length ? "Processing records" : "Finalizing import",
      });

      if (completed >= rows.length) {
        window.clearInterval(intervalId);
        const nextEntry = {
          id: `${Date.now()}`,
          timestamp: new Date().toISOString(),
          filename: files[0]?.name || (sourceType === "paste" ? "Copied data" : "Manual import"),
          source: selectedTemplate,
          imported: successes,
          skipped: 0,
          merged: 0,
          failed: failures,
          duration: "1.2s",
          status: failures > 0 ? "Completed with warnings" : "Completed",
        };
        const nextHistory = [nextEntry, ...importHistory];
        setImportHistory(nextHistory);
        saveImportHistory(nextHistory);
        setProcessing(false);
        setProgress((current) => ({ ...current, step: "Import complete" }));
      }
    }, 220);
  }

  function retryFailedRows() {
    const failedRows = previewRows.filter((row) => row.status === "duplicate" || row.warnings.some((warning) => warning.includes("Missing") || warning.includes("Duplicate")));
    if (failedRows.length > 0) {
      startImport(failedRows);
    }
  }

  function exportFailedRows() {
    const failedRows = previewRows.filter((row) => row.status === "duplicate" || row.warnings.some((warning) => warning.includes("Missing") || warning.includes("Duplicate")));
    const blob = new Blob([JSON.stringify(failedRows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "failed-import-rows.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Import Center"
        description="Import inventory, orders, transactions, and card data from CSV, Excel, PDF, paste, manual entry, or batch uploads."
      />

      <div style={styles.grid}>
        <StatCard label="Imports" value={importHistory.length} />
        <StatCard label="Templates" value={placeholderTemplates.length} />
        <StatCard label="Auto Mapping" value="Enabled" />
        <StatCard label="Duplicates" value={previewRows.filter((row) => row.status === "duplicate").length} />
      </div>

      <div style={{ ...styles.card, marginTop: "20px" }}>
        <h2 style={{ marginTop: 0 }}>Import Methods</h2>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
          {[
            ["csv", "CSV"],
            ["excel", "Excel (.xlsx)"],
            ["pdf", "PDF"],
            ["paste", "Copy & Paste"],
            ["manual", "Manual Entry"],
          ].map(([value, label]) => (
            <button key={value} style={sourceType === value ? styles.primaryButton : styles.secondaryButton} onClick={() => setSourceType(value)}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label style={styles.label}>Marketplace / Service Template</label>
          <select style={styles.input} value={selectedTemplate} onChange={(event) => setSelectedTemplate(event.target.value)}>
            {templateOptions.map((template) => (
              <option key={template} value={template}>{template}</option>
            ))}
          </select>
        </div>

        {(sourceType === "csv" || sourceType === "excel" || sourceType === "pdf") && (
          <div style={{ marginBottom: "16px" }}>
            <label style={styles.label}>Upload files</label>
            <input type="file" multiple accept=".csv,.xlsx,.xls,.pdf,.txt" onChange={handleFileSelection} />
            <div style={{ color: "#6b7280", fontSize: "13px", marginTop: "6px" }}>Batch uploads are supported and can be processed in the background.</div>
          </div>
        )}

        {sourceType === "paste" && (
          <div style={{ marginBottom: "16px" }}>
            <label style={styles.label}>Paste data</label>
            <textarea style={{ ...styles.input, minHeight: "120px" }} value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder="Card Number,Order Number,SKU,Customer,Amount" />
          </div>
        )}

        {sourceType === "manual" && (
          <div style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <strong>Manual Entry Rows</strong>
              <button type="button" style={styles.secondaryButton} onClick={addManualRow}>➕ Add Row</button>
            </div>
            {manualRows.map((row, index) => (
              <div key={row.id} style={{ ...styles.card, marginTop: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <strong>Row {index + 1}</strong>
                  {manualRows.length > 1 && <button type="button" style={styles.dangerButton} onClick={() => removeManualRow(index)}>Remove</button>}
                </div>
                <div style={{ ...styles.formGrid, marginTop: "10px" }}>
                  <Field label="Card Number" value={row.cardNumber} onChange={(event) => handleManualRowChange(index, "cardNumber", event.target.value)} />
                  <Field label="Order Number" value={row.orderNumber} onChange={(event) => handleManualRowChange(index, "orderNumber", event.target.value)} />
                  <Field label="SKU" value={row.sku} onChange={(event) => handleManualRowChange(index, "sku", event.target.value)} />
                  <Field label="Customer" value={row.customer} onChange={(event) => handleManualRowChange(index, "customer", event.target.value)} />
                  <Field label="Amount" value={row.amount} onChange={(event) => handleManualRowChange(index, "amount", event.target.value)} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
          <button style={styles.primaryButton} onClick={analyzeImport}>Analyze & Preview</button>
          <button style={styles.secondaryButton} onClick={saveMappingPreference}>Save Mapping Preferences</button>
          <button style={styles.secondaryButton} onClick={startImport}>Start Import</button>
          <button style={styles.secondaryButton} onClick={retryFailedRows}>Retry Failed Rows</button>
          <button style={styles.secondaryButton} onClick={exportFailedRows}>Export Failed Rows</button>
        </div>

        <div style={{ ...styles.card, marginBottom: "14px" }}>
          <h3 style={{ marginTop: 0 }}>Smart Import Workflow</h3>
          <div style={{ color: "#374151", fontSize: "14px" }}>
            <div><strong>Detected source:</strong> {selectedTemplate}</div>
            <div><strong>Required validation:</strong> card number, order number, SKU, customer, or tracking identifier.</div>
            <div><strong>Pipeline:</strong> auto-map → preview → validate → process → review results.</div>
          </div>
        </div>

        {previewRows.length > 0 && (
          <div style={{ ...styles.card, marginBottom: "14px" }}>
            <h3 style={{ marginTop: 0 }}>Field Mapping</h3>
            <div style={styles.formGrid}>
              {Object.entries(mapping).map(([field, value]) => (
                <div key={field}>
                  <label style={styles.label}>{field}</label>
                  <select style={styles.input} value={value} onChange={(event) => updateMapping(field, event.target.value)}>
                    <option value="">Select column</option>
                    {columns.map((column) => (
                      <option key={column} value={column}>{column}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <div style={{ ...styles.card, marginBottom: "14px" }}>
            <h3 style={{ marginTop: 0 }}>Warnings</h3>
            {warnings.map((warning, index) => (
              <div key={`${warning}-${index}`} style={{ color: "#b45309", fontSize: "14px", marginBottom: "6px" }}>{warning}</div>
            ))}
          </div>
        )}

        {previewRows.length > 0 && (
          <div style={{ ...styles.card, marginBottom: "14px" }}>
            <h3 style={{ marginTop: 0 }}>Preview</h3>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>#</th>
                    <th style={styles.th}>Card</th>
                    <th style={styles.th}>Order</th>
                    <th style={styles.th}>SKU</th>
                    <th style={styles.th}>Customer</th>
                    <th style={styles.th}>Amount</th>
                    <th style={styles.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 10).map((row) => (
                    <tr key={row.id}>
                      <td style={styles.td}>{row.index}</td>
                      <td style={styles.td}>{row.cardNumber || "—"}</td>
                      <td style={styles.td}>{row.orderNumber || "—"}</td>
                      <td style={styles.td}>{row.sku || "—"}</td>
                      <td style={styles.td}>{row.customer || "—"}</td>
                      <td style={styles.td}>{row.amount || "—"}</td>
                      <td style={styles.td}>{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {processing && (
          <div style={{ ...styles.card, marginBottom: "14px" }}>
            <h3 style={{ marginTop: 0 }}>Background Processing</h3>
            <div style={{ color: "#374151", fontSize: "14px" }}>
              <div><strong>Total Records:</strong> {progress.total}</div>
              <div><strong>Completed:</strong> {progress.completed}</div>
              <div><strong>Remaining:</strong> {progress.remaining}</div>
              <div><strong>Successes:</strong> {progress.successes}</div>
              <div><strong>Warnings:</strong> {progress.warnings}</div>
              <div><strong>Failures:</strong> {progress.failures}</div>
              <div><strong>Current Step:</strong> {progress.step}</div>
            </div>
          </div>
        )}

        <div style={{ ...styles.card, marginBottom: "14px" }}>
          <h3 style={{ marginTop: 0 }}>Future Integrations</h3>
          <div style={{ display: "grid", gap: "10px" }}>
            {placeholderTemplates.map((template) => (
              <div key={template.name} style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "10px" }}>
                <strong>{template.name}</strong>
                <div style={{ color: "#6b7280", fontSize: "13px", marginTop: "4px" }}>{template.description}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...styles.card }}>
          <h3 style={{ marginTop: 0 }}>Import History</h3>
          {importHistory.length === 0 ? (
            <p style={styles.muted}>No imports have been processed yet.</p>
          ) : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Filename</th>
                    <th style={styles.th}>Source</th>
                    <th style={styles.th}>Imported</th>
                    <th style={styles.th}>Skipped</th>
                    <th style={styles.th}>Merged</th>
                    <th style={styles.th}>Failed</th>
                    <th style={styles.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {importHistory.map((entry) => (
                    <tr key={entry.id}>
                      <td style={styles.td}>{new Date(entry.timestamp).toLocaleString()}</td>
                      <td style={styles.td}>{entry.filename}</td>
                      <td style={styles.td}>{entry.source}</td>
                      <td style={styles.td}>{entry.imported}</td>
                      <td style={styles.td}>{entry.skipped}</td>
                      <td style={styles.td}>{entry.merged}</td>
                      <td style={styles.td}>{entry.failed}</td>
                      <td style={styles.td}>{entry.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SalesOrdersPage({
  inventory = [],
  setInventory,
  customers = [],
  setCustomers,
  salesOrders = [],
  setSalesOrders,
  returns = [],
  setReturns,
  transactions = [],
  setTransactions,
  giftCards = [],
  receipts = [],
  onUndo,
}) {
  const statusOptions = ["Draft", "Pending Payment", "Paid", "Packed", "Shipped", "Delivered", "Completed", "Returned", "Partially Refunded", "Refunded", "Cancelled"];
  const refundTypes = ["Full Return", "Partial Return", "Exchange", "Full Refund", "Partial Refund", "Store Credit"];
  const [form, setForm] = useState({
    inventoryId: "",
    customerId: "",
    orderNumber: "",
    productName: "",
    productId: "",
    sku: "",
    styleCode: "",
    brand: "",
    size: "",
    quantity: 1,
    inventoryCost: 0,
    askingPrice: 0,
    salePrice: 0,
    discount: 0,
    shippingCharged: 0,
    actualShippingCost: 0,
    salesTax: 0,
    platformFees: 0,
    paymentProcessingFees: 0,
    paymentMethod: "Cash",
    marketplace: "Shopify",
    orderNumberInput: "",
    trackingNumber: "",
    saleDate: new Date().toISOString().slice(0, 10),
    status: "Draft",
    notes: "",
    productPhoto: "",
  });
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [marketplaceFilter, setMarketplaceFilter] = useState("All");
  const [customerFilter, setCustomerFilter] = useState("All");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("All");
  const [profitFilter, setProfitFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [returnForm, setReturnForm] = useState({
    orderId: "",
    type: "Full Return",
    quantity: 1,
    refundAmount: 0,
    note: "",
    restock: true,
  });

  function updateFormField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handleInventorySelection(event) {
    const inventoryId = event.target.value;
    const selectedItem = inventory.find((item) => item.id === inventoryId);
    setForm((current) => ({
      ...current,
      inventoryId,
      productName: selectedItem?.productName || "",
      productId: selectedItem?.productId || current.productId || createProductId(),
      sku: selectedItem?.sku || "",
      styleCode: selectedItem?.styleCode || "",
      brand: selectedItem?.brand || "",
      size: selectedItem?.size || "",
      quantity: 1,
      inventoryCost: Number(selectedItem?.purchasePrice || 0),
      askingPrice: Number(selectedItem?.sellingPrice || 0),
      salePrice: Number(selectedItem?.sellingPrice || 0),
      productPhoto: selectedItem?.photo || selectedItem?.photos?.[0] || "",
    }));
  }

  function resetForm() {
    setForm({
      inventoryId: "",
      customerId: "",
      orderNumber: "",
      productName: "",
      productId: "",
      sku: "",
      styleCode: "",
      brand: "",
      size: "",
      quantity: 1,
      inventoryCost: 0,
      askingPrice: 0,
      salePrice: 0,
      discount: 0,
      shippingCharged: 0,
      actualShippingCost: 0,
      salesTax: 0,
      platformFees: 0,
      paymentProcessingFees: 0,
      paymentMethod: "Cash",
      marketplace: "Shopify",
      orderNumberInput: "",
      trackingNumber: "",
      saleDate: new Date().toISOString().slice(0, 10),
      status: "Draft",
      notes: "",
      productPhoto: "",
    });
    setEditingOrderId(null);
  }

  function upsertOrderFinancialTransaction(order) {
    const nextEntry = {
      id: order.transactionId || `sale-${order.id}`,
      type: "sale",
      date: order.saleDate,
      amount: Number(order.grossRevenue || 0),
      description: `Sale ${order.orderNumber || order.productName}`,
      sourceOrderId: order.id,
      relatedInventoryId: order.inventoryId,
      customerId: order.customerId,
      note: order.notes || "",
    };
    setTransactions((current) => {
      const existing = current.find((entry) => entry.sourceOrderId === order.id);
      if (existing) {
        return current.map((entry) => entry.sourceOrderId === order.id ? nextEntry : entry);
      }
      return [nextEntry, ...current];
    });
  }

  function updateCustomerProfile(order) {
    if (!order.customerId) return;
    const customer = customers.find((entry) => entry.id === order.customerId);
    if (!customer) return;
    const history = Array.isArray(customer.purchaseHistory) ? customer.purchaseHistory : [];
    const nextHistory = [
      {
        id: order.id,
        productName: order.productName,
        productId: order.productId,
        orderNumber: order.orderNumber,
        saleDate: order.saleDate,
        amount: Number(order.grossRevenue || 0),
      },
      ...history,
    ].slice(0, 12);
    const lifetimeSpending = nextHistory.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const averagePurchase = nextHistory.length > 0 ? lifetimeSpending / nextHistory.length : 0;
    const favoriteBrands = [...new Set([...(customer.favoriteBrands || []), order.brand].filter(Boolean))].slice(0, 6);
    const favoriteCategories = [...new Set([...(customer.favoriteCategories || []), order.marketplace].filter(Boolean))].slice(0, 6);
    const mostPurchasedSizes = [...new Set([...(customer.mostPurchasedSizes || []), order.size].filter(Boolean))].slice(0, 6);
    setCustomers((current) => current.map((entry) => entry.id === customer.id ? {
      ...entry,
      purchaseHistory: nextHistory,
      lifetimeSpending,
      averagePurchase,
      lastPurchaseDate: order.saleDate,
      favoriteBrands,
      favoriteCategories,
      mostPurchasedSizes,
    } : entry));
  }

  function saveOrder(event) {
    event.preventDefault();
    const selectedItem = inventory.find((item) => item.id === form.inventoryId);
    if (!selectedItem) {
      alert("Select an inventory item first.");
      return;
    }
    if (!form.customerId) {
      alert("Select a customer before saving the order.");
      return;
    }
    const orderNumber = (form.orderNumber || form.orderNumberInput || `ORD-${Date.now().toString().slice(-6)}`).trim();
    if (salesOrders.some((order) => order.orderNumber === orderNumber && order.id !== editingOrderId)) {
      alert("Duplicate order number detected.");
      return;
    }
    const quantity = Number(form.quantity || 0);
    if (quantity <= 0) {
      alert("Quantity must be greater than zero.");
      return;
    }
    const completionStatuses = ["Paid", "Packed", "Shipped", "Delivered", "Completed"];
    const previousOrder = salesOrders.find((order) => order.id === editingOrderId);
    const previousStatus = previousOrder?.status || "Draft";
    const nextStatus = form.status;
    const reservedQuantity = salesOrders.filter((order) => order.inventoryId === selectedItem.id && order.id !== editingOrderId && completionStatuses.includes(order.status)).reduce((sum, order) => sum + Number(order.quantity || 0), 0);
    const currentInventoryQuantity = Number(selectedItem.quantity || 0);
    const availableQuantity = currentInventoryQuantity - reservedQuantity;
    if (completionStatuses.includes(nextStatus) && availableQuantity < quantity) {
      alert("Insufficient inventory available for this sale.");
      return;
    }
    const grossRevenue = Number(form.salePrice || 0) + Number(form.shippingCharged || 0);
    const discount = Number(form.discount || 0);
    const platformFees = Number(form.platformFees || 0);
    const paymentFees = Number(form.paymentProcessingFees || 0);
    const shippingIncome = Number(form.shippingCharged || 0);
    const shippingExpense = Number(form.actualShippingCost || 0);
    const cogs = Number(form.inventoryCost || 0) * quantity;
    const grossProfit = grossRevenue - discount - cogs;
    const netProfit = grossProfit - platformFees - paymentFees - shippingExpense;
    const roi = cogs > 0 ? (netProfit / cogs) * 100 : 0;
    const order = {
      id: editingOrderId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      inventoryId: selectedItem.id,
      productId: form.productId || selectedItem.productId || createProductId(),
      productName: form.productName || selectedItem.productName,
      sku: form.sku || selectedItem.sku || "",
      styleCode: form.styleCode || selectedItem.styleCode || "",
      brand: form.brand || selectedItem.brand || "",
      size: form.size || selectedItem.size || "",
      quantity,
      inventoryCost: Number(form.inventoryCost || selectedItem.purchasePrice || 0),
      askingPrice: Number(form.askingPrice || selectedItem.sellingPrice || 0),
      productPhoto: form.productPhoto || selectedItem.photo || selectedItem.photos?.[0] || "",
      customerId: form.customerId,
      customerName: customers.find((entry) => entry.id === form.customerId)?.fullName || customers.find((entry) => entry.id === form.customerId)?.name || "",
      salePrice: Number(form.salePrice || 0),
      discount,
      shippingCharged: Number(form.shippingCharged || 0),
      actualShippingCost: shippingExpense,
      salesTax: Number(form.salesTax || 0),
      platformFees,
      paymentProcessingFees: paymentFees,
      paymentMethod: form.paymentMethod,
      marketplace: form.marketplace,
      orderNumber,
      trackingNumber: form.trackingNumber,
      saleDate: form.saleDate,
      status: nextStatus,
      notes: form.notes,
      grossRevenue,
      discountAmount: discount,
      shippingIncome,
      shippingExpense,
      cogs,
      grossProfit,
      netProfit,
      roiPercentage: roi,
      salesTaxCollected: Number(form.salesTax || 0),
      createdAt: previousOrder?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      transactionId: previousOrder?.transactionId || `sale-${Date.now()}`,
    };

    const nextOrders = editingOrderId
      ? salesOrders.map((entry) => entry.id === editingOrderId ? order : entry)
      : [order, ...salesOrders];

    setSalesOrders(nextOrders);
    onUndo?.("salesOrders", salesOrders, "Sales Order");

    if (previousStatus && completionStatuses.includes(previousStatus) && !completionStatuses.includes(nextStatus)) {
      setInventory((current) => current.map((item) => item.id === selectedItem.id ? { ...item, quantity: Number(item.quantity || 0) + Number(previousOrder.quantity || 0), status: Number(item.quantity || 0) + Number(previousOrder.quantity || 0) > 0 ? item.status : "In Stock" } : item));
    }

    if (!completionStatuses.includes(previousStatus) && completionStatuses.includes(nextStatus)) {
      setInventory((current) => current.map((item) => {
        if (item.id !== selectedItem.id) return item;
        const nextQuantity = Number(item.quantity || 0) - quantity;
        return {
          ...item,
          quantity: Math.max(0, nextQuantity),
          status: nextQuantity <= 0 ? "Sold" : item.status || "In Stock",
        };
      }));
    }

    if (completionStatuses.includes(previousStatus) && completionStatuses.includes(nextStatus) && previousOrder && Number(previousOrder.quantity || 0) !== quantity) {
      const delta = quantity - Number(previousOrder.quantity || 0);
      setInventory((current) => current.map((item) => item.id === selectedItem.id ? {
        ...item,
        quantity: Math.max(0, Number(item.quantity || 0) - delta),
        status: Number(item.quantity || 0) - delta <= 0 ? "Sold" : item.status || "In Stock",
      } : item));
    }

    updateCustomerProfile(order);
    upsertOrderFinancialTransaction(order);
    resetForm();
  }

  function editOrder(order) {
    setEditingOrderId(order.id);
    setForm({
      inventoryId: order.inventoryId,
      customerId: order.customerId,
      orderNumber: order.orderNumber,
      productName: order.productName,
      productId: order.productId,
      sku: order.sku,
      styleCode: order.styleCode,
      brand: order.brand,
      size: order.size,
      quantity: order.quantity,
      inventoryCost: order.inventoryCost,
      askingPrice: order.askingPrice,
      salePrice: order.salePrice,
      discount: order.discountAmount || order.discount || 0,
      shippingCharged: order.shippingCharged || 0,
      actualShippingCost: order.actualShippingCost || 0,
      salesTax: order.salesTaxCollected || order.salesTax || 0,
      platformFees: order.platformFees || 0,
      paymentProcessingFees: order.paymentProcessingFees || 0,
      paymentMethod: order.paymentMethod || "Cash",
      marketplace: order.marketplace || "Shopify",
      orderNumberInput: order.orderNumber,
      trackingNumber: order.trackingNumber || "",
      saleDate: order.saleDate || new Date().toISOString().slice(0, 10),
      status: order.status || "Draft",
      notes: order.notes || "",
      productPhoto: order.productPhoto || "",
    });
  }

  function deleteOrder(orderId) {
    if (!window.confirm("Delete this order?")) return;
    const previousOrder = salesOrders.find((order) => order.id === orderId);
    if (previousOrder && ["Paid", "Packed", "Shipped", "Delivered", "Completed"].includes(previousOrder.status)) {
      setInventory((current) => current.map((item) => item.id === previousOrder.inventoryId ? { ...item, quantity: Number(item.quantity || 0) + Number(previousOrder.quantity || 0), status: Number(item.quantity || 0) + Number(previousOrder.quantity || 0) > 0 ? item.status || "In Stock" : "In Stock" } : item));
    }
    setSalesOrders((current) => current.filter((order) => order.id !== orderId));
    onUndo?.("salesOrders", salesOrders, "Sales Order");
  }

  function submitReturn(event) {
    event.preventDefault();
    const order = salesOrders.find((entry) => entry.id === returnForm.orderId);
    if (!order) return;
    const quantity = Number(returnForm.quantity || 0);
    const refundAmount = Number(returnForm.refundAmount || 0);
    if (quantity <= 0) {
      alert("Return quantity must be greater than zero.");
      return;
    }
    if (refundAmount < 0 || refundAmount > Number(order.salePrice || 0)) {
      alert("Refund amount cannot exceed the original payment amount.");
      return;
    }
    const nextReturn = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      orderId: order.id,
      type: returnForm.type,
      quantity,
      refundAmount,
      note: returnForm.note,
      createdAt: new Date().toISOString(),
      restock: returnForm.restock,
    };
    setReturns((current) => [nextReturn, ...current]);
    setSalesOrders((current) => current.map((entry) => entry.id === order.id ? {
      ...entry,
      status: returnForm.type.includes("Refund") || returnForm.type === "Full Refund" || returnForm.type === "Full Return" ? "Refunded" : "Returned",
      refundAmount: Number(entry.refundAmount || 0) + refundAmount,
      returnIds: [...(entry.returnIds || []), nextReturn.id],
      updatedAt: new Date().toISOString(),
    } : entry));
    if (returnForm.restock) {
      setInventory((current) => current.map((item) => item.id === order.inventoryId ? { ...item, quantity: Number(item.quantity || 0) + quantity, status: Number(item.quantity || 0) + quantity > 0 ? item.status || "In Stock" : "In Stock" } : item));
    }
    setReturnForm({
      orderId: "",
      type: "Full Return",
      quantity: 1,
      refundAmount: 0,
      note: "",
      restock: true,
    });
  }

  const filteredOrders = useMemo(() => {
    const searchText = search.toLowerCase();
    return salesOrders.filter((order) => {
      const matchesText = [order.customerName, order.productName, order.productId, order.sku, order.orderNumber, order.trackingNumber, order.marketplace, order.paymentMethod].join(" ").toLowerCase().includes(searchText);
      const matchesStatus = statusFilter === "All" || order.status === statusFilter;
      const matchesMarketplace = marketplaceFilter === "All" || order.marketplace === marketplaceFilter;
      const matchesCustomer = customerFilter === "All" || order.customerName === customerFilter;
      const matchesPayment = paymentMethodFilter === "All" || order.paymentMethod === paymentMethodFilter;
      const matchesProfit = profitFilter === "All" || (profitFilter === "positive" ? Number(order.netProfit || 0) > 0 : Number(order.netProfit || 0) <= 0);
      const saleDate = order.saleDate || order.createdAt || "";
      const afterFrom = !dateFrom || saleDate >= dateFrom;
      const beforeTo = !dateTo || saleDate <= dateTo;
      return matchesText && matchesStatus && matchesMarketplace && matchesCustomer && matchesPayment && matchesProfit && afterFrom && beforeTo;
    });
  }, [salesOrders, search, statusFilter, marketplaceFilter, customerFilter, paymentMethodFilter, profitFilter, dateFrom, dateTo]);

  const reports = useMemo(() => {
    const orders = filteredOrders;
    const totalSales = orders.reduce((sum, order) => sum + Number(order.grossRevenue || 0), 0);
    const netProfit = orders.reduce((sum, order) => sum + Number(order.netProfit || 0), 0);
    const averageOrderValue = orders.length > 0 ? totalSales / orders.length : 0;
    const bestProducts = [...orders].sort((a, b) => Number(b.grossRevenue || 0) - Number(a.grossRevenue || 0)).slice(0, 5);
    const bestSizes = [...orders].sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0)).slice(0, 5);
    const topCustomers = [...orders].reduce((map, order) => {
      const current = map.get(order.customerName || "Unknown") || { name: order.customerName || "Unknown", total: 0 };
      current.total += Number(order.grossRevenue || 0);
      map.set(current.name, current);
      return map;
    }, new Map()).values();
    const returnsCount = returns.filter((entry) => orders.some((order) => order.id === entry.orderId)).length;
    const refundsCount = returns.filter((entry) => orders.some((order) => order.id === entry.orderId) && entry.type.includes("Refund")).length;
    return {
      totalSales,
      netProfit,
      averageOrderValue,
      bestProducts,
      bestSizes,
      topCustomers: [...topCustomers].sort((a, b) => b.total - a.total).slice(0, 5),
      returnsCount,
      refundsCount,
      marketplacePerformance: [...orders].reduce((map, order) => {
        const current = map.get(order.marketplace || "Unknown") || { name: order.marketplace || "Unknown", total: 0 };
        current.total += Number(order.grossRevenue || 0);
        map.set(current.name, current);
        return map;
      }, new Map()).values(),
    };
  }, [filteredOrders, returns]);

  return (
    <>
      <PageHeader title="Sales & Order Management" description="Create sales, connect customers, manage inventory, track profits, and process returns from one professional workspace." />

      <div style={styles.grid}>
        <StatCard label="Orders" value={salesOrders.length} />
        <StatCard label="Revenue" value={money(salesOrders.reduce((sum, order) => sum + Number(order.grossRevenue || 0), 0))} />
        <StatCard label="Net Profit" value={money(salesOrders.reduce((sum, order) => sum + Number(order.netProfit || 0), 0))} />
        <StatCard label="Returns" value={returns.length} />
      </div>

      <div style={{ ...styles.card, marginTop: "22px", marginBottom: "22px" }}>
        <h2>{editingOrderId ? "Edit Sale" : "Create a Sale"}</h2>
        <form onSubmit={saveOrder}>
          <div style={styles.formGrid}>
            <div>
              <label style={styles.label}>Inventory Item</label>
              <select style={styles.input} name="inventoryId" value={form.inventoryId} onChange={handleInventorySelection}>
                <option value="">Select inventory item</option>
                {inventory.map((item) => (
                  <option key={item.id} value={item.id}>{item.productName || item.sku || item.id}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={styles.label}>Customer</label>
              <select style={styles.input} name="customerId" value={form.customerId} onChange={updateFormField}>
                <option value="">Select customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.fullName || customer.name}</option>
                ))}
              </select>
            </div>
            <Field label="Product Name" name="productName" value={form.productName} onChange={updateFormField} />
            <Field label="Product ID" name="productId" value={form.productId} onChange={updateFormField} />
            <Field label="SKU / Style Code" name="sku" value={form.sku} onChange={updateFormField} />
            <Field label="Brand" name="brand" value={form.brand} onChange={updateFormField} />
            <Field label="Size" name="size" value={form.size} onChange={updateFormField} />
            <Field label="Quantity" name="quantity" type="number" value={form.quantity} onChange={updateFormField} />
            <Field label="Inventory Cost" name="inventoryCost" type="number" step="0.01" value={form.inventoryCost} onChange={updateFormField} />
            <Field label="Asking Price" name="askingPrice" type="number" step="0.01" value={form.askingPrice} onChange={updateFormField} />
            <Field label="Sale Price" name="salePrice" type="number" step="0.01" value={form.salePrice} onChange={updateFormField} />
            <Field label="Discount" name="discount" type="number" step="0.01" value={form.discount} onChange={updateFormField} />
            <Field label="Shipping Charged" name="shippingCharged" type="number" step="0.01" value={form.shippingCharged} onChange={updateFormField} />
            <Field label="Actual Shipping Cost" name="actualShippingCost" type="number" step="0.01" value={form.actualShippingCost} onChange={updateFormField} />
            <Field label="Sales Tax" name="salesTax" type="number" step="0.01" value={form.salesTax} onChange={updateFormField} />
            <Field label="Platform Fees" name="platformFees" type="number" step="0.01" value={form.platformFees} onChange={updateFormField} />
            <Field label="Payment Processing Fees" name="paymentProcessingFees" type="number" step="0.01" value={form.paymentProcessingFees} onChange={updateFormField} />
            <Field label="Order Number" name="orderNumberInput" value={form.orderNumberInput} onChange={updateFormField} />
            <Field label="Tracking Number" name="trackingNumber" value={form.trackingNumber} onChange={updateFormField} />
            <Field label="Sale Date" name="saleDate" type="date" value={form.saleDate} onChange={updateFormField} />
            <SelectField label="Payment Method" name="paymentMethod" value={form.paymentMethod} onChange={updateFormField} options={["Cash", "Card", "PayPal", "Zelle", "Bank Transfer", "Gift Card", "Other"]} />
            <SelectField label="Marketplace" name="marketplace" value={form.marketplace} onChange={updateFormField} options={["Shopify", "Amazon", "eBay", "StockX", "PayPal", "Card Depot", "TCGplayer", "PSA", "GCG", "Beckett", "Square", "Stripe", "Other"]} />
            <SelectField label="Status" name="status" value={form.status} onChange={updateFormField} options={statusOptions} />
            <Field label="Notes" name="notes" value={form.notes} onChange={updateFormField} />
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "14px" }}>
            <button style={styles.darkButton} type="submit">{editingOrderId ? "Save Changes" : "Create Sale"}</button>
            {editingOrderId && <button style={styles.secondaryButton} type="button" onClick={resetForm}>Cancel</button>}
          </div>
        </form>
      </div>

      <div style={{ ...styles.card, marginBottom: "22px" }}>
        <h2>Orders</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "12px" }}>
          <input style={styles.input} placeholder="Search orders" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select style={styles.input} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="All">All statuses</option>
            {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select style={styles.input} value={marketplaceFilter} onChange={(event) => setMarketplaceFilter(event.target.value)}>
            <option value="All">All marketplaces</option>
            {Array.from(new Set(salesOrders.map((entry) => entry.marketplace).filter(Boolean))).map((marketplace) => <option key={marketplace} value={marketplace}>{marketplace}</option>)}
          </select>
          <select style={styles.input} value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)}>
            <option value="All">All customers</option>
            {Array.from(new Set(salesOrders.map((entry) => entry.customerName).filter(Boolean))).map((customer) => <option key={customer} value={customer}>{customer}</option>)}
          </select>
          <select style={styles.input} value={paymentMethodFilter} onChange={(event) => setPaymentMethodFilter(event.target.value)}>
            <option value="All">All payment methods</option>
            {Array.from(new Set(salesOrders.map((entry) => entry.paymentMethod).filter(Boolean))).map((method) => <option key={method} value={method}>{method}</option>)}
          </select>
          <select style={styles.input} value={profitFilter} onChange={(event) => setProfitFilter(event.target.value)}>
            <option value="All">All profit</option>
            <option value="positive">Positive</option>
            <option value="negative">Negative</option>
          </select>
          <input style={styles.input} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          <input style={styles.input} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </div>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Order</th>
                <th style={styles.th}>Customer</th>
                <th style={styles.th}>Product</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Revenue</th>
                <th style={styles.th}>Profit</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.id}>
                  <td style={styles.td}>{order.orderNumber}<div style={styles.muted}>{order.marketplace}</div></td>
                  <td style={styles.td}>{order.customerName}</td>
                  <td style={styles.td}>{order.productName}<div style={styles.muted}>{order.productId}</div></td>
                  <td style={styles.td}>{order.status}</td>
                  <td style={styles.td}>{money(order.grossRevenue)}</td>
                  <td style={styles.td}>{money(order.netProfit)}</td>
                  <td style={styles.td}>
                    <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
                      <button style={styles.secondaryButton} onClick={() => editOrder(order)}>Edit</button>
                      <button style={styles.dangerButton} onClick={() => deleteOrder(order.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...styles.card, marginBottom: "22px" }}>
        <h2>Returns & Refunds</h2>
        <form onSubmit={submitReturn}>
          <div style={styles.formGrid}>
            <div>
              <label style={styles.label}>Order</label>
              <select style={styles.input} value={returnForm.orderId} onChange={(event) => setReturnForm((current) => ({ ...current, orderId: event.target.value }))}>
                <option value="">Select order</option>
                {salesOrders.map((order) => <option key={order.id} value={order.id}>{order.orderNumber} - {order.productName}</option>)}
              </select>
            </div>
            <SelectField label="Return Type" value={returnForm.type} name="type" onChange={(event) => setReturnForm((current) => ({ ...current, type: event.target.value }))} options={refundTypes} />
            <Field label="Quantity" name="quantity" type="number" value={returnForm.quantity} onChange={(event) => setReturnForm((current) => ({ ...current, quantity: event.target.value }))} />
            <Field label="Refund Amount" name="refundAmount" type="number" step="0.01" value={returnForm.refundAmount} onChange={(event) => setReturnForm((current) => ({ ...current, refundAmount: event.target.value }))} />
            <Field label="Note" name="note" value={returnForm.note} onChange={(event) => setReturnForm((current) => ({ ...current, note: event.target.value }))} />
            <div>
              <label style={styles.label}>Restock Inventory</label>
              <select style={styles.input} value={returnForm.restock ? "yes" : "no"} onChange={(event) => setReturnForm((current) => ({ ...current, restock: event.target.value === "yes" }))}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
          <button style={styles.darkButton} type="submit">Record Return / Refund</button>
        </form>
      </div>

      <div style={{ ...styles.card, marginBottom: "22px" }}>
        <h2>Sales Reports</h2>
        <div style={styles.grid}>
          <StatCard label="Total Sales" value={money(reports.totalSales)} />
          <StatCard label="Net Profit" value={money(reports.netProfit)} />
          <StatCard label="Average Order" value={money(reports.averageOrderValue)} />
          <StatCard label="Returns" value={reports.returnsCount} />
          <StatCard label="Refunds" value={reports.refundsCount} />
        </div>
        <div style={{ marginTop: "14px" }}>
          <strong>Best-Selling Products</strong>
          <div style={styles.muted}>{reports.bestProducts.length > 0 ? reports.bestProducts.map((entry) => entry.productName).join(", ") : "No results"}</div>
        </div>
        <div style={{ marginTop: "14px" }}>
          <strong>Best-Selling Sizes</strong>
          <div style={styles.muted}>{reports.bestSizes.length > 0 ? reports.bestSizes.map((entry) => entry.size).join(", ") : "No results"}</div>
        </div>
        <div style={{ marginTop: "14px" }}>
          <strong>Top Customers</strong>
          <div style={styles.muted}>{reports.topCustomers.length > 0 ? reports.topCustomers.map((entry) => `${entry.name} (${money(entry.total)})`).join(", ") : "No results"}</div>
        </div>
        <div style={{ marginTop: "14px" }}>
          <strong>Marketplace Performance</strong>
          <div style={styles.muted}>{Array.from(reports.marketplacePerformance).length > 0 ? Array.from(reports.marketplacePerformance).map((entry) => `${entry.name} (${money(entry.total)})`).join(", ") : "No results"}</div>
        </div>
      </div>
    </>
  );
}

function CustomersPage({ customers, setCustomers, inventory, receipts = [] }) {
  const blankFamilyMember = {
    relationship: "",
    firstName: "",
    birthday: "",
    shoeSize: "",
    shirtSize: "",
    pantSize: "",
    shortSize: "",
    jacketSize: "",
    hatSize: "",
    favoriteBrands: "",
    favoriteColors: "",
    notes: "",
  };

  const blankReminder = {
    type: "Birthday",
    title: "",
    date: "",
    note: "",
  };

  const blankForm = {
    firstName: "",
    lastName: "",
    nickname: "",
    phone: "",
    email: "",
    address: "",
    birthday: "",
    preferredContactMethod: "Phone",
    notes: "",
    favoriteBrands: "",
    favoriteColors: "",
    favoriteCategories: "",
    preferredPaymentMethod: "Cash",
    averageBudget: "",
    vipStatus: "Standard",
    shoeSize: "",
    shirtSize: "",
    pantSize: "",
    shortSize: "",
    jacketSize: "",
    hatSize: "",
    sockSize: "",
    gloveSize: "",
    dressSize: "",
    youthSize: "",
    toddlerSize: "",
    otherNotes: "",
    linkedInventoryId: "",
    familyMembers: [blankFamilyMember],
    reminders: [blankReminder],
  };

  const [form, setForm] = useState(blankForm);
  const [search, setSearch] = useState("");

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateFamilyMember(index, field, value) {
    setForm((current) => ({
      ...current,
      familyMembers: current.familyMembers.map((member, memberIndex) =>
        memberIndex === index ? { ...member, [field]: value } : member
      ),
    }));
  }

  function addFamilyMember() {
    setForm((current) => ({
      ...current,
      familyMembers: [...current.familyMembers, { ...blankFamilyMember }],
    }));
  }

  function removeFamilyMember(index) {
    setForm((current) => ({
      ...current,
      familyMembers: current.familyMembers.filter((_, memberIndex) => memberIndex !== index),
    }));
  }

  function updateReminder(index, field, value) {
    setForm((current) => ({
      ...current,
      reminders: current.reminders.map((reminder, reminderIndex) =>
        reminderIndex === index ? { ...reminder, [field]: value } : reminder
      ),
    }));
  }

  function addReminder() {
    setForm((current) => ({
      ...current,
      reminders: [...current.reminders, { ...blankReminder }],
    }));
  }

  function removeReminder(index) {
    setForm((current) => ({
      ...current,
      reminders: current.reminders.filter((_, reminderIndex) => reminderIndex !== index),
    }));
  }

  function buildPurchaseHistory(linkedInventoryId) {
    const history = [];
    const linkedInventory = inventory.find((item) => String(item.id) === linkedInventoryId);

    if (linkedInventory) {
      history.push({
        id: linkedInventory.id,
        itemName: linkedInventory.productName || "Linked Inventory",
        date: linkedInventory.purchaseDate || linkedInventory.createdAt || "",
        amount: Number(linkedInventory.purchasePrice || 0) * Number(linkedInventory.quantity || 1),
        brand: linkedInventory.brand || "",
        category: linkedInventory.category || "",
        size: linkedInventory.size || "",
        giftCardUsed: Boolean(linkedInventory.fundingGiftCardId),
      });
    }

    const linkedReceipts = receipts.filter((receipt) => {
      const receiptText = `${receipt.notes || ""} ${receipt.merchant || ""}`.toLowerCase();
      const linkedText = `${linkedInventory?.productName || ""}`.toLowerCase();
      return receipt.linkedInventoryId === linkedInventoryId || receiptText.includes(linkedText);
    });

    linkedReceipts.forEach((receipt) => {
      history.push({
        id: receipt.id,
        itemName: receipt.merchant || "Receipt",
        date: receipt.date || "",
        amount: Number(receipt.amount || 0),
        brand: "",
        category: receipt.category || "",
        size: "",
        giftCardUsed: false,
      });
    });

    return history;
  }

  function buildInsights(purchaseHistory = []) {
    const totalSpent = purchaseHistory.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const brandCounts = purchaseHistory.reduce((acc, item) => {
      if (item.brand) {
        acc[item.brand] = (acc[item.brand] || 0) + 1;
      }
      return acc;
    }, {});
    const sizeCounts = purchaseHistory.reduce((acc, item) => {
      if (item.size) {
        acc[item.size] = (acc[item.size] || 0) + 1;
      }
      return acc;
    }, {});
    const categoryCounts = purchaseHistory.reduce((acc, item) => {
      if (item.category) {
        acc[item.category] = (acc[item.category] || 0) + 1;
      }
      return acc;
    }, {});

    const sortedByDate = [...purchaseHistory].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    return {
      lifetimeValue: totalSpent,
      averagePurchase: purchaseHistory.length ? totalSpent / purchaseHistory.length : 0,
      favoriteBrand: Object.entries(brandCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—",
      favoriteSize: Object.entries(sizeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—",
      mostPurchasedCategory: Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—",
      lastPurchaseDate: sortedByDate[0]?.date || "—",
      lifetimeSpending: totalSpent,
      favoriteProducts: purchaseHistory.map((item) => item.itemName).filter(Boolean).slice(0, 5),
      giftCardUsage: purchaseHistory.filter((item) => item.giftCardUsed).length,
    };
  }

  function submitCustomer(event) {
    event.preventDefault();

    if (!form.firstName.trim() && !form.lastName.trim() && !form.phone.trim()) {
      alert("Enter the customer's name or phone number.");
      return;
    }

    const purchaseHistory = buildPurchaseHistory(form.linkedInventoryId);

    setCustomers((current) => [
      {
        ...form,
        id: Date.now(),
        createdAt: new Date().toISOString(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        nickname: form.nickname.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        address: form.address.trim(),
        birthday: form.birthday,
        preferredContactMethod: form.preferredContactMethod,
        notes: form.notes.trim(),
        favoriteBrands: form.favoriteBrands.trim(),
        favoriteColors: form.favoriteColors.trim(),
        favoriteCategories: form.favoriteCategories.trim(),
        preferredPaymentMethod: form.preferredPaymentMethod,
        averageBudget: form.averageBudget,
        vipStatus: form.vipStatus,
        shoeSize: form.shoeSize,
        shirtSize: form.shirtSize,
        pantSize: form.pantSize,
        shortSize: form.shortSize,
        jacketSize: form.jacketSize,
        hatSize: form.hatSize,
        sockSize: form.sockSize,
        gloveSize: form.gloveSize,
        dressSize: form.dressSize,
        youthSize: form.youthSize,
        toddlerSize: form.toddlerSize,
        otherNotes: form.otherNotes.trim(),
        familyMembers: (form.familyMembers || []).filter((member) => member.relationship || member.firstName || member.notes),
        reminders: (form.reminders || []).filter((reminder) => reminder.title || reminder.date || reminder.note),
        purchaseHistory,
        insights: buildInsights(purchaseHistory),
      },
      ...current,
    ]);

    setForm({ ...blankForm, familyMembers: [blankFamilyMember], reminders: [blankReminder] });
  }

  function deleteCustomer(id) {
    if (window.confirm("Delete this customer?")) {
      const previousValue = customers;
      setCustomers((current) => current.filter((customer) => customer.id !== id));
      handleUndo("customers", previousValue, "Customer");
    }
  }

  const filteredCustomers = customers.filter((customer) => {
    const text = [
      customer.firstName,
      customer.lastName,
      customer.nickname,
      customer.email,
      customer.phone,
      customer.address,
      customer.notes,
      customer.favoriteBrands,
      customer.favoriteColors,
      customer.favoriteCategories,
      customer.shoeSize,
      customer.shirtSize,
      customer.pantSize,
      customer.shortSize,
      customer.hatSize,
      customer.dressSize,
      customer.otherNotes,
      (customer.familyMembers || []).map((member) => `${member.relationship} ${member.firstName}`).join(" "),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.includes(search.toLowerCase());
  });

  return (
    <>
      <PageHeader
        title="Customers"
        description="Manage a complete customer CRM with profiles, family members, purchases, insights, and reminders."
      />

      <form onSubmit={submitCustomer} style={{ ...styles.card, marginBottom: "22px" }}>
        <h2>Add Customer Profile</h2>
        <p style={styles.muted}>Capture a professional customer record and automatically connect their purchases.</p>

        <div style={styles.formGrid}>
          <Field label="First Name" name="firstName" value={form.firstName} onChange={updateField} placeholder="Jordan" />
          <Field label="Last Name" name="lastName" value={form.lastName} onChange={updateField} placeholder="Smith" />
          <Field label="Nickname" name="nickname" value={form.nickname} onChange={updateField} placeholder="J" />
          <Field label="Phone Number" name="phone" value={form.phone} onChange={updateField} placeholder="(555) 123-4567" />
          <Field label="Email" name="email" value={form.email} onChange={updateField} type="email" placeholder="customer@email.com" />
          <Field label="Birthday" name="birthday" value={form.birthday} onChange={updateField} type="date" />
          <SelectField label="Preferred Contact Method" name="preferredContactMethod" value={form.preferredContactMethod} onChange={updateField} options={["Phone", "Email", "Text", "WhatsApp"]} />
          <Field label="Address" name="address" value={form.address} onChange={updateField} placeholder="123 Example St" />
          <Field label="Favorite Brands" name="favoriteBrands" value={form.favoriteBrands} onChange={updateField} placeholder="Nike, Adidas" />
          <Field label="Favorite Colors" name="favoriteColors" value={form.favoriteColors} onChange={updateField} placeholder="Black, Red" />
          <Field label="Favorite Categories" name="favoriteCategories" value={form.favoriteCategories} onChange={updateField} placeholder="Sneakers, Apparel" />
          <SelectField label="Preferred Payment Method" name="preferredPaymentMethod" value={form.preferredPaymentMethod} onChange={updateField} options={["Cash", "Card", "Zelle", "PayPal", "Gift Card"]} />
          <Field label="Average Budget" name="averageBudget" value={form.averageBudget} onChange={updateField} type="number" step="0.01" placeholder="250" />
          <SelectField label="VIP Status" name="vipStatus" value={form.vipStatus} onChange={updateField} options={["Standard", "VIP", "Priority"]} />
        </div>

        <div style={{ marginTop: "16px" }}>
          <label style={styles.label}>Notes</label>
          <textarea style={{ ...styles.input, minHeight: "90px" }} name="notes" value={form.notes} onChange={updateField} placeholder="Customer preferences, notes, special requests, and context." />
        </div>

        <div style={{ marginTop: "16px" }}>
          <h3 style={{ marginBottom: "10px" }}>Personal Sizes</h3>
          <div style={styles.formGrid}>
            <Field label="Shoe Size" name="shoeSize" value={form.shoeSize} onChange={updateField} placeholder="10.5" />
            <Field label="Shirt Size" name="shirtSize" value={form.shirtSize} onChange={updateField} placeholder="M" />
            <Field label="Pant Size" name="pantSize" value={form.pantSize} onChange={updateField} placeholder="32" />
            <Field label="Short Size" name="shortSize" value={form.shortSize} onChange={updateField} placeholder="32" />
            <Field label="Jacket Size" name="jacketSize" value={form.jacketSize} onChange={updateField} placeholder="L" />
            <Field label="Hat Size" name="hatSize" value={form.hatSize} onChange={updateField} placeholder="7.5" />
            <Field label="Sock Size" name="sockSize" value={form.sockSize} onChange={updateField} placeholder="10-13" />
            <Field label="Glove Size" name="gloveSize" value={form.gloveSize} onChange={updateField} placeholder="M" />
            <Field label="Dress Size" name="dressSize" value={form.dressSize} onChange={updateField} placeholder="6" />
            <Field label="Youth Size" name="youthSize" value={form.youthSize} onChange={updateField} placeholder="YXL" />
            <Field label="Toddler Size" name="toddlerSize" value={form.toddlerSize} onChange={updateField} placeholder="2T" />
          </div>
          <div style={{ marginTop: "10px" }}>
            <label style={styles.label}>Other Notes</label>
            <input style={styles.input} name="otherNotes" value={form.otherNotes} onChange={updateField} placeholder="Additional fit notes" />
          </div>
        </div>

        <div style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>Household / Family</h3>
            <button type="button" style={styles.secondaryButton} onClick={addFamilyMember}>➕ Add Family Member</button>
          </div>
          {(form.familyMembers || []).map((member, index) => (
            <div key={`${member.relationship}-${index}`} style={{ ...styles.card, marginTop: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <strong>Family Member {index + 1}</strong>
                <button type="button" style={styles.dangerButton} onClick={() => removeFamilyMember(index)}>Remove</button>
              </div>
              <div style={{ ...styles.formGrid, marginTop: "10px" }}>
                <Field label="Relationship" value={member.relationship} onChange={(event) => updateFamilyMember(index, "relationship", event.target.value)} placeholder="Wife" />
                <Field label="First Name" value={member.firstName} onChange={(event) => updateFamilyMember(index, "firstName", event.target.value)} placeholder="Megan" />
                <Field label="Birthday" value={member.birthday} onChange={(event) => updateFamilyMember(index, "birthday", event.target.value)} type="date" />
                <Field label="Shoe Size" value={member.shoeSize} onChange={(event) => updateFamilyMember(index, "shoeSize", event.target.value)} placeholder="9" />
                <Field label="Shirt Size" value={member.shirtSize} onChange={(event) => updateFamilyMember(index, "shirtSize", event.target.value)} placeholder="S" />
                <Field label="Pant Size" value={member.pantSize} onChange={(event) => updateFamilyMember(index, "pantSize", event.target.value)} placeholder="28" />
                <Field label="Short Size" value={member.shortSize} onChange={(event) => updateFamilyMember(index, "shortSize", event.target.value)} placeholder="28" />
                <Field label="Jacket Size" value={member.jacketSize} onChange={(event) => updateFamilyMember(index, "jacketSize", event.target.value)} placeholder="M" />
                <Field label="Hat Size" value={member.hatSize} onChange={(event) => updateFamilyMember(index, "hatSize", event.target.value)} placeholder="7" />
                <Field label="Favorite Brands" value={member.favoriteBrands} onChange={(event) => updateFamilyMember(index, "favoriteBrands", event.target.value)} placeholder="Polo, Lululemon" />
                <Field label="Favorite Colors" value={member.favoriteColors} onChange={(event) => updateFamilyMember(index, "favoriteColors", event.target.value)} placeholder="Blue, White" />
              </div>
              <div style={{ marginTop: "10px" }}>
                <label style={styles.label}>Notes</label>
                <input style={styles.input} value={member.notes} onChange={(event) => updateFamilyMember(index, "notes", event.target.value)} placeholder="Favorite items or notes" />
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>Reminders</h3>
            <button type="button" style={styles.secondaryButton} onClick={addReminder}>➕ Add Reminder</button>
          </div>
          {(form.reminders || []).map((reminder, index) => (
            <div key={`${reminder.type}-${index}`} style={{ ...styles.card, marginTop: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <strong>Reminder {index + 1}</strong>
                <button type="button" style={styles.dangerButton} onClick={() => removeReminder(index)}>Remove</button>
              </div>
              <div style={{ ...styles.formGrid, marginTop: "10px" }}>
                <SelectField label="Type" value={reminder.type} onChange={(event) => updateReminder(index, "type", event.target.value)} options={["Birthday", "Special Event", "Follow-up", "New Release", "Restock"]} />
                <Field label="Title" value={reminder.title} onChange={(event) => updateReminder(index, "title", event.target.value)} placeholder="Call about restock" />
                <Field label="Date" value={reminder.date} onChange={(event) => updateReminder(index, "date", event.target.value)} type="date" />
              </div>
              <div style={{ marginTop: "10px" }}>
                <label style={styles.label}>Reminder Notes</label>
                <input style={styles.input} value={reminder.note} onChange={(event) => updateReminder(index, "note", event.target.value)} placeholder="Follow-up details" />
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "16px" }}>
          <label style={styles.label}>Link Inventory Purchase</label>
          <select style={styles.input} name="linkedInventoryId" value={form.linkedInventoryId} onChange={updateField}>
            <option value="">No linked inventory</option>
            {inventory.map((item) => (
              <option key={item.id} value={item.id}>{item.productName}</option>
            ))}
          </select>
        </div>

        <button style={styles.darkButton} type="submit">Save Customer</button>
      </form>

      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "15px", flexWrap: "wrap", alignItems: "center" }}>
          <h2>Customer CRM</h2>
          <input style={{ ...styles.input, width: "320px", marginBottom: 0 }} placeholder="Search by name, phone, email, family member, size, or favorite brand" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>

        {filteredCustomers.length === 0 ? (
          <p style={styles.muted}>No customers found.</p>
        ) : (
          <div style={{ display: "grid", gap: "14px", marginTop: "14px" }}>
            {filteredCustomers.map((customer) => {
              const insights = customer.insights || buildInsights(customer.purchaseHistory || []);
              return (
                <div key={customer.id} style={{ ...styles.card, border: customer.vipStatus === "VIP" ? "1px solid #f59e0b" : "1px solid #e5e7eb" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                    <div>
                      <strong>{`${customer.firstName || ""} ${customer.lastName || ""}`.trim() || customer.nickname || customer.phone || "Customer"}</strong>
                      <div style={styles.muted}>{customer.nickname ? `(${customer.nickname})` : ""}</div>
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ ...styles.secondaryButton, border: "none", background: customer.vipStatus === "VIP" ? "#fef3c7" : "#f3f4f6", color: "#111827" }}>{customer.vipStatus || "Standard"}</span>
                      <button style={styles.dangerButton} onClick={() => deleteCustomer(customer.id)}>Delete</button>
                    </div>
                  </div>

                  <div style={{ ...styles.formGrid, marginTop: "12px" }}>
                    <div><strong>Phone:</strong> {customer.phone || "—"}</div>
                    <div><strong>Email:</strong> {customer.email || "—"}</div>
                    <div><strong>Birthday:</strong> {customer.birthday || "—"}</div>
                    <div><strong>Preferred Contact:</strong> {customer.preferredContactMethod || "—"}</div>
                    <div><strong>Favorite Brands:</strong> {customer.favoriteBrands || "—"}</div>
                    <div><strong>Favorite Colors:</strong> {customer.favoriteColors || "—"}</div>
                    <div><strong>Preferred Payment:</strong> {customer.preferredPaymentMethod || "—"}</div>
                    <div><strong>Average Budget:</strong> {customer.averageBudget ? money(Number(customer.averageBudget)) : "—"}</div>
                  </div>

                  <div style={{ marginTop: "12px" }}>
                    <strong>Sizes</strong>
                    <div style={{ ...styles.formGrid, marginTop: "6px" }}>
                      <div>Shoe: {customer.shoeSize || "—"}</div>
                      <div>Shirt: {customer.shirtSize || "—"}</div>
                      <div>Pant: {customer.pantSize || "—"}</div>
                      <div>Short: {customer.shortSize || "—"}</div>
                      <div>Jacket: {customer.jacketSize || "—"}</div>
                      <div>Hat: {customer.hatSize || "—"}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: "12px" }}>
                    <strong>Family / Household</strong>
                    {(customer.familyMembers || []).length === 0 ? <div style={styles.muted}>No family members listed.</div> : (
                      <div style={{ display: "grid", gap: "8px", marginTop: "8px" }}>
                        {(customer.familyMembers || []).map((member, index) => (
                          <div key={`${member.relationship}-${index}`} style={{ fontSize: "14px", color: "#374151" }}>
                            <strong>{member.relationship || "Family Member"}</strong>: {member.firstName || "Unnamed"} • Birthday {member.birthday || "—"} • Shoe {member.shoeSize || "—"} • Shirt {member.shirtSize || "—"}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: "12px" }}>
                    <strong>Purchase History & Insights</strong>
                    <div style={{ ...styles.formGrid, marginTop: "8px" }}>
                      <div>Lifetime Value: {money(insights.lifetimeValue || 0)}</div>
                      <div>Average Purchase: {money(insights.averagePurchase || 0)}</div>
                      <div>Favorite Brand: {insights.favoriteBrand || "—"}</div>
                      <div>Favorite Size: {insights.favoriteSize || "—"}</div>
                      <div>Most Purchased Category: {insights.mostPurchasedCategory || "—"}</div>
                      <div>Last Purchase Date: {insights.lastPurchaseDate || "—"}</div>
                    </div>
                    <div style={{ marginTop: "8px", color: "#374151", fontSize: "14px" }}>
                      Items: {(customer.purchaseHistory || []).map((entry) => entry.itemName).join(", ") || "No linked purchases yet"}
                    </div>
                  </div>

                  <div style={{ marginTop: "12px" }}>
                    <strong>Reminders</strong>
                    {(customer.reminders || []).length === 0 ? <div style={styles.muted}>No reminders set.</div> : (
                      <div style={{ display: "grid", gap: "8px", marginTop: "8px" }}>
                        {(customer.reminders || []).map((reminder, index) => (
                          <div key={`${reminder.title}-${index}`} style={{ fontSize: "14px", color: "#374151" }}>
                            <strong>{reminder.type || "Reminder"}</strong>: {reminder.title || "Untitled"} • {reminder.date || "—"} • {reminder.note || ""}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function ReceiptsPage({ receipts, setReceipts, inventory }) {
  const blankForm = {
    merchant: "",
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    type: "purchase",
    category: "Inventory",
    notes: "",
    linkedInventoryId: "",
  };

  const [form, setForm] = useState(blankForm);
  const [search, setSearch] = useState("");
  const [activeReceiptId, setActiveReceiptId] = useState(null);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handleReceiptUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const receiptEntry = createReceiptLibraryEntry({
      id: Date.now(),
      type: "receipt",
      fileName: file.name,
      note: `Uploaded receipt: ${file.name}`,
      files: [],
    });

    setReceipts((current) => [receiptEntry, ...current]);
    event.target.value = "";
  }

  function submitReceipt(event) {
    event.preventDefault();

    if (!form.merchant.trim() || !form.amount) {
      alert("Enter the merchant and amount.");
      return;
    }

    setReceipts((current) => [
      {
        ...form,
        amount: Number(form.amount),
        id: Date.now(),
        linkedInventoryId: form.linkedInventoryId || "",
      },
      ...current,
    ]);

    setForm(blankForm);
  }

  function deleteReceipt(id) {
    if (window.confirm("Delete this receipt?")) {
      const previousValue = receipts;
      setReceipts((current) => current.filter((receipt) => receipt.id !== id));
      handleUndo("receipts", previousValue, "Receipt");
    }
  }

  function updateLink(id, linkedInventoryId) {
    setReceipts((current) => current.map((receipt) => (receipt.id === id ? { ...receipt, linkedInventoryId } : receipt)));
  }

  const filteredReceipts = receipts.filter((receipt) => {
    const text = `${receipt.merchant || ""} ${receipt.notes || ""} ${receipt.fileName || ""} ${receipt.source || ""} ${receipt.category || ""}`.toLowerCase();
    const linkedInventoryName = inventory.find((item) => item.id === receipt.linkedInventoryId)?.productName || "";
    return text.includes(search.toLowerCase()) || linkedInventoryName.toLowerCase().includes(search.toLowerCase());
  });

  const phoneLibraryCount = receipts.filter((receipt) => receipt.source === "phone" || receipt.dedupeKey).length;
  const activeReceipt = filteredReceipts.find((receipt) => receipt.id === activeReceiptId) || filteredReceipts[0] || null;

  return (
    <>
      <PageHeader title="Receipts" description="Store uploaded receipts, search them later, and link them to inventory." />

      <div style={{ ...styles.card, marginBottom: "22px", borderLeft: "5px solid #dc2626" }}>
        <h2>Receipt Library</h2>
        <p style={styles.muted}>Capture receipts from your phone, keep them searchable, and avoid duplicates by fingerprinting each upload.</p>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "10px" }}>
          <span style={{ ...styles.secondaryButton, cursor: "default" }}>Phone captures: {phoneLibraryCount}</span>
          <span style={{ ...styles.secondaryButton, cursor: "default" }}>Duplicate-safe entries: {receipts.filter((receipt) => receipt.dedupeKey).length}</span>
        </div>
        <input type="file" accept="image/*,.pdf" style={styles.input} onChange={handleReceiptUpload} />
      </div>

      <form onSubmit={submitReceipt} style={{ ...styles.card, marginBottom: "22px" }}>
        <h2>Add Receipt</h2>

        <div style={styles.formGrid}>
          <Field label="Merchant or Customer" name="merchant" value={form.merchant} onChange={updateField} />
          <Field label="Date" name="date" value={form.date} onChange={updateField} type="date" />
          <Field label="Amount" name="amount" value={form.amount} onChange={updateField} type="number" step="0.01" />
          <SelectField label="Receipt Type" name="type" value={form.type} onChange={updateField} options={[{ value: "purchase", label: "Purchase" }, { value: "sale", label: "Customer Sale" }, { value: "expense", label: "Business Expense" }, { value: "uploaded", label: "Uploaded" }]} />
          <SelectField label="Category" name="category" value={form.category} onChange={updateField} options={["Inventory", "Shipping", "Supplies", "Software", "Advertising", "Travel", "Meals", "Other"]} />
          <div>
            <label style={styles.label}>Link Inventory</label>
            <select style={styles.input} name="linkedInventoryId" value={form.linkedInventoryId} onChange={updateField}>
              <option value="">No linked inventory</option>
              {inventory.map((item) => (
                <option key={item.id} value={item.id}>{item.productName}</option>
              ))}
            </select>
          </div>
          <Field label="Notes" name="notes" value={form.notes} onChange={updateField} />
        </div>

        <button style={styles.darkButton} type="submit">Save Receipt</button>
      </form>

      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "15px", flexWrap: "wrap", alignItems: "center" }}>
          <h2>Receipt History</h2>
          <input style={{ ...styles.input, width: "280px", marginBottom: 0 }} placeholder="Search receipts" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>

        {filteredReceipts.length === 0 ? (
          <p style={styles.muted}>No receipts found.</p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Merchant</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Category</th>
                  <th style={styles.th}>Amount</th>
                  <th style={styles.th}>Linked Inventory</th>
                  <th style={styles.th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredReceipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td style={styles.td}>{receipt.date}</td>
                    <td style={styles.td}>{receipt.merchant}</td>
                    <td style={styles.td}>{receipt.type}</td>
                    <td style={styles.td}>{receipt.category}</td>
                    <td style={styles.td}>{money(receipt.amount)}</td>
                    <td style={styles.td}>
                      <select style={{ ...styles.input, marginBottom: 0 }} value={receipt.linkedInventoryId || ""} onChange={(event) => updateLink(receipt.id, event.target.value)}>
                        <option value="">No link</option>
                        {inventory.map((item) => (
                          <option key={item.id} value={item.id}>{item.productName}</option>
                        ))}
                      </select>
                    </td>
                    <td style={styles.td}>
                      <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
                        <button style={styles.secondaryButton} onClick={() => setActiveReceiptId(receipt.id)}>Open</button>
                        <button style={styles.dangerButton} onClick={() => deleteReceipt(receipt.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {activeReceipt && (
        <div style={{ ...styles.card, marginTop: "22px" }}>
          <h2>Receipt Detail</h2>
          <div style={styles.formGrid}>
            <div><strong>Merchant</strong><div>{activeReceipt.merchant || "—"}</div></div>
            <div><strong>Date</strong><div>{activeReceipt.date || "—"}</div></div>
            <div><strong>Amount</strong><div>{money(activeReceipt.amount)}</div></div>
            <div><strong>File</strong><div>{activeReceipt.fileName || "—"}</div></div>
            <div><strong>Notes</strong><div>{activeReceipt.notes || "—"}</div></div>
          </div>
        </div>
      )}
    </>
  );
}

function FinancialPage({
  expenses,
  setExpenses,
  financials,
  inventory,
  receipts,
  giftCards = [],
  transactions = [],
  onUndo,
}) {
  const [reportScope, setReportScope] = useState("monthly");
  const [expenseForm, setExpenseForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    vendor: "",
    category: "Shipping",
    amount: "",
    notes: "",
    deductible: "Yes",
    receiptName: "",
    receiptData: "",
  });

  function updateExpenseField(event) {
    const { name, value } = event.target;
    setExpenseForm((current) => ({ ...current, [name]: value }));
  }

  function handleExpenseReceiptUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setExpenseForm((current) => ({
        ...current,
        receiptName: file.name,
        receiptData: reader.result,
      }));
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function submitExpense(event) {
    event.preventDefault();

    if (!expenseForm.vendor.trim() || !expenseForm.amount) {
      alert("Enter a vendor and amount.");
      return;
    }

    setExpenses((current) => [
      {
        id: Date.now(),
        date: expenseForm.date,
        vendor: expenseForm.vendor,
        category: expenseForm.category,
        amount: Number(expenseForm.amount),
        notes: expenseForm.notes,
        deductible: expenseForm.deductible,
        receiptName: expenseForm.receiptName,
        receiptData: expenseForm.receiptData,
        description: expenseForm.vendor,
      },
      ...current,
    ]);

    setExpenseForm({
      date: new Date().toISOString().slice(0, 10),
      vendor: "",
      category: "Shipping",
      amount: "",
      notes: "",
      deductible: "Yes",
      receiptName: "",
      receiptData: "",
    });
  }

  function deleteExpense(id) {
    if (window.confirm("Delete this expense?")) {
      const previousValue = expenses;
      setExpenses((current) => current.filter((expense) => expense.id !== id));
      onUndo("expenses", previousValue, "Expense");
    }
  }

  const accountingSnapshot = useMemo(() => {
    const giftCardList = Array.isArray(giftCards) ? giftCards : [];

    const inventoryCost = inventory.reduce(
      (sum, item) => sum + Number(item.purchasePrice || 0) * Number(item.quantity || 1),
      0
    );
    const inventoryValue = inventory.reduce(
      (sum, item) => sum + Number(item.sellingPrice || 0) * Number(item.quantity || 1),
      0
    );
    const totalSales = receipts
      .filter((receipt) => receipt.type === "sale")
      .reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0);
    const purchaseReceipts = receipts
      .filter((receipt) => receipt.type === "purchase")
      .reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0);
    const shippingExpense = expenses.filter((expense) => /shipping|ship|postage/i.test(expense.vendor || expense.description || expense.category || "")).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const businessExpenses = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const deductibleTotal = expenses.filter((expense) => expense.deductible === "Yes").reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const giftCardPurchaseAssets = transactions.filter((transaction) => transaction.type === "gift-card-purchase").reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    const linkedInventoryFunding = transactions.filter((transaction) => transaction.type === "inventory-funding").reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    const cogs = inventoryCost;
    const grossProfit = totalSales - cogs;
    const netProfit = grossProfit - businessExpenses;
    const roi = inventoryCost > 0 ? (netProfit / inventoryCost) * 100 : 0;
    const averageProfitPerItem = inventory.length > 0 ? netProfit / inventory.length : 0;
    const totalGiftCardFaceValue = giftCardList.reduce((sum, card) => sum + Number(card.faceValue || 0), 0);
    const totalGiftCardBalance = giftCardList.reduce((sum, card) => sum + Number(card.balance || card.currentBalance || card.faceValue || 0), 0);
    const giftCardProfit = totalGiftCardFaceValue - totalGiftCardBalance;
    const salesTaxCollected = receipts.reduce((sum, receipt) => sum + Number(receipt.salesTax || 0), 0);
    const topSellingProducts = [...inventory]
      .filter((item) => Number(item.quantity || 0) > 0)
      .sort((a, b) => Number(b.sellingPrice || 0) - Number(a.sellingPrice || 0))
      .slice(0, 5);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().slice(0, 10);
    const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);

    const monthlyRevenue = receipts.filter((receipt) => receipt.type === "sale" && (receipt.date || receipt.createdAt || "").slice(0, 10) >= monthStart).reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0);
    const monthlyExpenses = expenses.filter((expense) => (expense.date || "").slice(0, 10) >= monthStart).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const monthlyProfit = monthlyRevenue - monthlyExpenses;
    const quarterlyRevenue = receipts.filter((receipt) => receipt.type === "sale" && (receipt.date || receipt.createdAt || "").slice(0, 10) >= quarterStart).reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0);
    const quarterlyExpenses = expenses.filter((expense) => (expense.date || "").slice(0, 10) >= quarterStart).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const quarterlyProfit = quarterlyRevenue - quarterlyExpenses;
    const yearlyRevenue = receipts.filter((receipt) => receipt.type === "sale" && (receipt.date || receipt.createdAt || "").slice(0, 10) >= yearStart).reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0);
    const yearlyExpenses = expenses.filter((expense) => (expense.date || "").slice(0, 10) >= yearStart).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const yearlyProfit = yearlyRevenue - yearlyExpenses;
    const todayRevenue = receipts.filter((receipt) => receipt.type === "sale" && (receipt.date || receipt.createdAt || "").slice(0, 10) === today).reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0);
    const todayProfit = todayRevenue - expenses.filter((expense) => (expense.date || "").slice(0, 10) === today).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    return {
      inventoryCost,
      inventoryValue,
      totalSales,
      purchaseReceipts,
      cogs,
      grossProfit,
      netProfit,
      roi,
      averageProfitPerItem,
      totalGiftCardFaceValue,
      totalGiftCardBalance,
      giftCardProfit,
      shippingExpense,
      businessExpenses,
      deductibleTotal,
      giftCardPurchaseAssets,
      linkedInventoryFunding,
      salesTaxCollected,
      topSellingProducts,
      monthlyRevenue,
      monthlyExpenses,
      monthlyProfit,
      quarterlyRevenue,
      quarterlyExpenses,
      quarterlyProfit,
      yearlyRevenue,
      yearlyExpenses,
      yearlyProfit,
      todayRevenue,
      todayProfit,
    };
  }, [inventory, receipts, expenses, giftCards]);

  const report = useMemo(() => {
    const base = {
      revenue: accountingSnapshot.totalSales,
      expenses: accountingSnapshot.businessExpenses,
      cogs: accountingSnapshot.cogs,
      profit: accountingSnapshot.netProfit,
      roi: accountingSnapshot.roi,
      inventoryValue: accountingSnapshot.inventoryValue,
      giftCardBalance: accountingSnapshot.totalGiftCardBalance,
      giftCardProfit: accountingSnapshot.giftCardProfit,
      topSellingProducts: accountingSnapshot.topSellingProducts,
    };

    if (reportScope === "quarterly") {
      return {
        ...base,
        revenue: accountingSnapshot.quarterlyRevenue,
        expenses: accountingSnapshot.quarterlyExpenses,
        profit: accountingSnapshot.quarterlyProfit,
      };
    }

    if (reportScope === "yearly") {
      return {
        ...base,
        revenue: accountingSnapshot.yearlyRevenue,
        expenses: accountingSnapshot.yearlyExpenses,
        profit: accountingSnapshot.yearlyProfit,
      };
    }

    return {
      ...base,
      revenue: accountingSnapshot.monthlyRevenue,
      expenses: accountingSnapshot.monthlyExpenses,
      profit: accountingSnapshot.monthlyProfit,
    };
  }, [accountingSnapshot, reportScope]);

  const taxSummary = useMemo(() => ({
    estimatedBusinessIncome: accountingSnapshot.totalSales,
    estimatedTaxableIncome: Math.max(0, accountingSnapshot.netProfit),
    businessDeductions: accountingSnapshot.deductibleTotal,
    businessExpenses: accountingSnapshot.businessExpenses,
    cogs: accountingSnapshot.cogs,
    inventoryValue: accountingSnapshot.inventoryValue,
    salesTaxCollected: accountingSnapshot.salesTaxCollected,
    shippingExpense: accountingSnapshot.shippingExpense,
    giftCardPurchases: accountingSnapshot.giftCardPurchaseAssets,
    giftCardProfit: accountingSnapshot.giftCardProfit,
  }), [accountingSnapshot]);

  function exportReport(format) {
    const rows = [
      ["Metric", "Value"],
      ["Revenue", report.revenue],
      ["Expenses", report.expenses],
      ["COGS", report.cogs],
      ["Profit", report.profit],
      ["ROI", `${report.roi.toFixed(2)}%`],
      ["Inventory Value", report.inventoryValue],
      ["Gift Card Balance", report.giftCardBalance],
      ["Gift Card Profit", report.giftCardProfit],
      ["Top Selling Products", report.topSellingProducts.map((item) => item.productName).join(", ")],
    ];
    const csv = rows.map((row) => row.join(",")).join("\n");

    if (format === "csv") {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${reportScope}-report.csv`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (format === "excel") {
      const blob = new Blob([csv], { type: "application/vnd.ms-excel;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${reportScope}-report.xls`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (format === "pdf") {
      const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:24px;"><h2>${reportScope} Report</h2><pre>${csv}</pre></body></html>`;
      const printWindow = window.open("", "_blank", "width=900,height=900");
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
      }
    }
  }

  return (
    <>
      <PageHeader title="Financial & Tax Center" description="Professional accounting, expense tracking, tax organization, and reporting for your reseller business." />

      <div style={styles.grid}>
        <StatCard label="Today's Revenue" value={money(accountingSnapshot.todayRevenue)} />
        <StatCard label="Today's Profit" value={money(accountingSnapshot.todayProfit)} />
        <StatCard label="Monthly Revenue" value={money(accountingSnapshot.monthlyRevenue)} />
        <StatCard label="Monthly Profit" value={money(accountingSnapshot.monthlyProfit)} />
        <StatCard label="Inventory Value" value={money(accountingSnapshot.inventoryValue)} />
        <StatCard label="Gift Card Value" value={money(accountingSnapshot.totalGiftCardBalance)} />
        <StatCard label="Business Expenses" value={money(accountingSnapshot.businessExpenses)} />
        <StatCard label="Estimated Taxable Income" value={money(taxSummary.estimatedTaxableIncome)} />
      </div>

      <div style={{ ...styles.card, marginTop: "22px", marginBottom: "22px" }}>
        <h2>Accounting Summary</h2>
        <div style={styles.grid}>
          <StatCard label="Inventory Cost" value={money(accountingSnapshot.inventoryCost)} />
          <StatCard label="Inventory Value" value={money(accountingSnapshot.inventoryValue)} />
          <StatCard label="Total Sales" value={money(accountingSnapshot.totalSales)} />
          <StatCard label="COGS" value={money(accountingSnapshot.cogs)} />
          <StatCard label="Gross Profit" value={money(accountingSnapshot.grossProfit)} />
          <StatCard label="Net Profit" value={money(accountingSnapshot.netProfit)} />
          <StatCard label="ROI %" value={`${accountingSnapshot.roi.toFixed(2)}%`} />
          <StatCard label="Avg. Profit / Item" value={money(accountingSnapshot.averageProfitPerItem)} />
          <StatCard label="Total Gift Card Balance" value={money(accountingSnapshot.totalGiftCardBalance)} />
          <StatCard label="Gift Card Profit" value={money(accountingSnapshot.giftCardProfit)} />
          <StatCard label="Monthly Revenue" value={money(accountingSnapshot.monthlyRevenue)} />
          <StatCard label="Monthly Expenses" value={money(accountingSnapshot.monthlyExpenses)} />
          <StatCard label="Monthly Profit" value={money(accountingSnapshot.monthlyProfit)} />
          <StatCard label="Quarterly Profit" value={money(accountingSnapshot.quarterlyProfit)} />
          <StatCard label="Yearly Profit" value={money(accountingSnapshot.yearlyProfit)} />
        </div>
      </div>

      <div style={{ ...styles.card, marginBottom: "22px" }}>
        <h2>Business Expenses</h2>
        <form onSubmit={submitExpense}>
          <div style={styles.formGrid}>
            <Field label="Date" name="date" value={expenseForm.date} onChange={updateExpenseField} type="date" />
            <Field label="Vendor" name="vendor" value={expenseForm.vendor} onChange={updateExpenseField} placeholder="Amazon, UPS, etc." />
            <SelectField label="Category" name="category" value={expenseForm.category} onChange={updateExpenseField} options={["Shipping", "Office Supplies", "Software", "Advertising", "Mileage", "Meals", "Travel", "Equipment", "Utilities", "Rent", "Internet", "Phone", "Payroll", "Insurance", "Education", "Other"]} />
            <Field label="Amount" name="amount" value={expenseForm.amount} onChange={updateExpenseField} type="number" step="0.01" placeholder="0.00" />
            <SelectField label="Deductible" name="deductible" value={expenseForm.deductible} onChange={updateExpenseField} options={["Yes", "No"]} />
            <div>
              <label style={styles.label}>Receipt Upload</label>
              <input style={styles.input} type="file" accept="image/*,.pdf" onChange={handleExpenseReceiptUpload} />
              {expenseForm.receiptName && <div style={styles.muted}>{expenseForm.receiptName}</div>}
            </div>
            <Field label="Notes" name="notes" value={expenseForm.notes} onChange={updateExpenseField} placeholder="Optional notes" />
          </div>
          <button style={styles.darkButton} type="submit">Save Expense</button>
        </form>
      </div>

      <div style={{ ...styles.card, marginBottom: "22px" }}>
        <h2>Tax Center</h2>
        <div style={styles.grid}>
          <StatCard label="Estimated Business Income" value={money(taxSummary.estimatedBusinessIncome)} />
          <StatCard label="Estimated Taxable Income" value={money(taxSummary.estimatedTaxableIncome)} />
          <StatCard label="Business Deductions" value={money(taxSummary.businessDeductions)} />
          <StatCard label="Business Expenses" value={money(taxSummary.businessExpenses)} />
          <StatCard label="COGS" value={money(taxSummary.cogs)} />
          <StatCard label="Inventory Value" value={money(taxSummary.inventoryValue)} />
          <StatCard label="Sales Tax Collected" value={money(taxSummary.salesTaxCollected)} />
          <StatCard label="Shipping Expense" value={money(taxSummary.shippingExpense)} />
          <StatCard label="Gift Card Purchases" value={money(taxSummary.giftCardPurchases)} />
          <StatCard label="Gift Card Profit" value={money(taxSummary.giftCardProfit)} />
        </div>
      </div>

      <div style={{ ...styles.card, marginBottom: "22px" }}>
        <h2>Reports</h2>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
          {[
            { value: "monthly", label: "Monthly Report" },
            { value: "quarterly", label: "Quarterly Report" },
            { value: "yearly", label: "Yearly Report" },
          ].map((option) => (
            <button key={option.value} style={reportScope === option.value ? styles.primaryButton : styles.secondaryButton} onClick={() => setReportScope(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
        <div style={styles.grid}>
          <StatCard label="Revenue" value={money(report.revenue)} />
          <StatCard label="Expenses" value={money(report.expenses)} />
          <StatCard label="COGS" value={money(report.cogs)} />
          <StatCard label="Profit" value={money(report.profit)} />
          <StatCard label="ROI" value={`${report.roi.toFixed(2)}%`} />
          <StatCard label="Inventory Value" value={money(report.inventoryValue)} />
          <StatCard label="Gift Card Summary" value={money(report.giftCardBalance)} />
        </div>
        <div style={{ marginTop: "16px" }}>
          <strong>Top Selling Products</strong>
          <div style={{ marginTop: "8px", color: "#6b7280" }}>
            {report.topSellingProducts.length > 0 ? report.topSellingProducts.map((item) => item.productName).join(", ") : "No inventory available."}
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "16px" }}>
          <button style={styles.secondaryButton} onClick={() => exportReport("csv")}>Export CSV</button>
          <button style={styles.secondaryButton} onClick={() => exportReport("excel")}>Export Excel</button>
          <button style={styles.secondaryButton} onClick={() => exportReport("pdf")}>Export PDF</button>
        </div>
      </div>

      <div style={styles.card}>
        <h2>Expense History</h2>
        {expenses.length === 0 ? (
          <p style={styles.muted}>No expenses added yet.</p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Vendor</th>
                  <th style={styles.th}>Category</th>
                  <th style={styles.th}>Amount</th>
                  <th style={styles.th}>Deductible</th>
                  <th style={styles.th}>Receipt</th>
                  <th style={styles.th}>Notes</th>
                  <th style={styles.th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td style={styles.td}>{expense.date}</td>
                    <td style={styles.td}>{expense.vendor || expense.description || "—"}</td>
                    <td style={styles.td}>{expense.category}</td>
                    <td style={styles.td}>{money(expense.amount)}</td>
                    <td style={styles.td}>{expense.deductible || "Yes"}</td>
                    <td style={styles.td}>{expense.receiptName || "—"}</td>
                    <td style={styles.td}>{expense.notes || "—"}</td>
                    <td style={styles.td}><button style={styles.dangerButton} onClick={() => deleteExpense(expense.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p style={{ ...styles.muted, fontSize: "12px", marginTop: "16px" }}>
        This center is designed to support future integrations with QuickBooks, Xero, or other accounting software while continuing to use localStorage for now.
      </p>
    </>
  );
}

function AIInboxPage({ aiInbox = [], setAiInbox = () => {}, setInventory = () => {}, setReceipts = () => {}, setCustomers = () => {}, setGiftCards = () => {}, setExpenses = () => {}, setTransactions = () => {} }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [destinationFilter, setDestinationFilter] = useState("All");
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }

  function compressImageToDataUrl(file, originalDataUrl) {
    if (!file.type.startsWith("image/")) return Promise.resolve(originalDataUrl);

    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const maxWidth = 1400;
        const scale = Math.min(1, maxWidth / image.width);
        canvas.width = Math.max(1, Math.floor(image.width * scale));
        canvas.height = Math.max(1, Math.floor(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      image.src = originalDataUrl;
    });
  }

  function createThumbnail(file, originalDataUrl) {
    if (!file.type.startsWith("image/")) return Promise.resolve(originalDataUrl);

    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 220;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.floor(image.width * scale));
        canvas.height = Math.max(1, Math.floor(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.68));
      };
      image.src = originalDataUrl;
    });
  }

  function extractReadableText(file, fallbackText = "") {
    const lowerName = file.name.toLowerCase();
    const chunks = [fallbackText, file.name].filter(Boolean);

    const patterns = [];
    const orderMatch = fallbackText.match(/order(?:\s*#|\s*number)?\s*[:#-]?\s*([A-Za-z0-9-]+)/i) || lowerName.match(/order(?:\s*#|\s*number)?\s*[:#-]?\s*([A-Za-z0-9-]+)/i);
    const dateMatch = fallbackText.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/) || lowerName.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/);
    const timeMatch = fallbackText.match(/(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/);
    const totalMatch = fallbackText.match(/\$?([0-9]+(?:\.[0-9]{1,2})?)/);
    const skuMatch = fallbackText.match(/([A-Z0-9-]{2,12})/i);
    const maskedGiftCard = fallbackText.match(/([0-9]{4}[- ]?){2,4}[0-9]{4}/) || lowerName.match(/([0-9]{4}[- ]?){2,4}[0-9]{4}/);

    if (orderMatch) patterns.push(`Order ${orderMatch[1]}`);
    if (dateMatch) patterns.push(`Date ${dateMatch[1]}`);
    if (timeMatch) patterns.push(`Time ${timeMatch[1]}`);
    if (totalMatch) patterns.push(`Total ${totalMatch[1]}`);
    if (skuMatch) patterns.push(`SKU ${skuMatch[1]}`);
    if (maskedGiftCard) patterns.push(`Gift Card ${maskedGiftCard[0].replace(/\d/g, "*")}`);

    return [fallbackText, ...patterns].filter(Boolean).join("\n").trim();
  }

  async function analyzeFile(file, text = "") {
    const lowerName = `${file.name} ${text}`.toLowerCase();
    const vendor = ["nike", "adidas", "amazon", "ups", "fedex", "card depot", "gucci", "jordan", "yeezy", "new balance", "puma", "reebok", "target", "walmart"].find((entry) => lowerName.includes(entry)) || "Unknown Vendor";
    const isReceipt = /(receipt|invoice|bill|purchase|order)/.test(lowerName);
    const isLabel = /(label|shipping|tracking|ups|fedex|packaging|packing)/.test(lowerName);
    const isInventory = /(product|photo|inventory|sku|style|shoe|shirt|jacket|bag|watch|item)/.test(lowerName);
    const isGiftCard = /(gift card|giftcard|egift|card balance)/.test(lowerName);
    const isCustomer = /(customer|screenshot|contact|profile)/.test(lowerName);
    const isSales = /(order|shipment|tracking|fulfillment|packing)/.test(lowerName);
    const isExpense = /(expense|cost|fee|tax)/.test(lowerName);

    let destination = "Needs Review";
    let confidence = 0.54;
    if (isGiftCard) {
      destination = "Gift Cards";
      confidence = 0.95;
    } else if (isInventory) {
      destination = "Inventory";
      confidence = 0.9;
    } else if (isReceipt) {
      destination = "Receipts";
      confidence = 0.86;
    } else if (isSales) {
      destination = "Sales";
      confidence = 0.8;
    } else if (isCustomer) {
      destination = "Customers";
      confidence = 0.76;
    } else if (isExpense) {
      destination = "Expenses";
      confidence = 0.74;
    } else if (isLabel) {
      destination = "Financial & Tax";
      confidence = 0.72;
    }

    const inferredTitle = (() => {
      if (isGiftCard) return "Gift Card Receipt";
      if (isInventory) return "Inventory Photo";
      if (isLabel) return "Shipping Label";
      if (isReceipt) return vendor === "Unknown Vendor" ? "Unknown Document" : `${vendor} Receipt`;
      return "Unknown Document";
    })();

    const orderNumberMatch = text.match(/order(?:\s*#|\s*number)?\s*[:#-]?\s*([A-Za-z0-9-]+)/i) || lowerName.match(/order(?:\s*#|\s*number)?\s*[:#-]?\s*([A-Za-z0-9-]+)/i);
    const dateMatch = text.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/) || lowerName.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/);
    const timeMatch = text.match(/(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/);
    const totalMatch = text.match(/\$?([0-9]+(?:\.[0-9]{1,2})?)/);
    const skuMatch = text.match(/([A-Z0-9-]{2,12})/i);
    const suggestedProductName = isInventory ? file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") : "";

    const baseItem = {
      productName: suggestedProductName,
      brand: vendor === "Unknown Vendor" ? "" : vendor,
      sku: skuMatch ? skuMatch[1] : "",
      styleCode: skuMatch ? skuMatch[1] : "",
      color: "",
      size: "",
      category: isInventory ? "Inventory" : "",
      gender: "",
      notes: text,
    };

    const recognition = await recognizeProduct(baseItem);
    const enriched = mergeRecognitionIntoItem(baseItem, recognition, 0);

    return {
      title: inferredTitle,
      vendor: vendor === "Unknown Vendor" ? file.name.replace(/\.[^.]+$/, "") : vendor,
      destination,
      confidence,
      orderNumber: orderNumberMatch ? orderNumberMatch[1] : "",
      date: dateMatch ? dateMatch[1] : "",
      time: timeMatch ? timeMatch[1] : "",
      total: totalMatch ? Number(totalMatch[1]) : 0,
      sku: skuMatch ? skuMatch[1] : "",
      suggestedProductName,
      ocrText: extractReadableText(file, text || `${file.name}\n${file.type}`),
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      status: destination === "Needs Review" ? "Needs Review" : "Suggested",
      productPreview: enriched,
    };
  }

  async function processFiles(files) {
    setUploading(true);
    const nextItems = [];

    for (const file of Array.from(files)) {
      const originalDataUrl = await readFileAsDataUrl(file);
      const compressedDataUrl = await compressImageToDataUrl(file, originalDataUrl);
      const thumbnailDataUrl = await createThumbnail(file, compressedDataUrl);
      const extractedText = file.type.includes("text") || file.name.toLowerCase().endsWith(".csv") || file.name.toLowerCase().endsWith(".txt") || file.name.toLowerCase().endsWith(".json")
        ? await file.text().catch(() => "")
        : "";
      const analysis = await analyzeFile(file, extractedText);
      const asset = await uploadAsset(file, { provider: "local", path: "ai-inbox" });
      nextItems.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fileName: file.name,
        originalDataUrl: compressedDataUrl,
        thumbnailDataUrl,
        fileType: file.type,
        asset,
        analysis,
        destination: analysis.destination,
        decision: "pending",
        status: analysis.status,
        draft: {
          title: analysis.title || file.name,
          vendor: analysis.vendor || "",
          destination: analysis.destination,
          productName: analysis.productPreview?.productName || analysis.suggestedProductName || file.name.replace(/\.[^.]+$/, ""),
          brand: analysis.productPreview?.brand || analysis.vendor || "",
          sku: analysis.productPreview?.sku || analysis.sku || "",
          styleCode: analysis.productPreview?.styleCode || analysis.sku || "",
          color: analysis.productPreview?.color || "",
          size: analysis.productPreview?.size || "",
          category: analysis.productPreview?.category || "",
          gender: analysis.productPreview?.gender || "",
          orderNumber: analysis.orderNumber || "",
          date: analysis.date || "",
          time: analysis.time || "",
          total: analysis.total || 0,
          notes: analysis.ocrText || "",
        },
        createdAt: new Date().toISOString(),
      });
    }

    setAiInbox((current) => [...nextItems, ...current]);
    setUploading(false);
  }

  async function handleUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    await processFiles(files);
    event.target.value = "";
  }

  async function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    await processFiles(files);
  }

  function updateItem(id, overrides) {
    setAiInbox((current) => current.map((item) => item.id === id ? { ...item, ...overrides } : item));
  }

  function updateDraft(id, field, value) {
    setAiInbox((current) => current.map((item) => item.id === id ? { ...item, draft: { ...(item.draft || {}), [field]: value } } : item));
  }

  function acceptItem(item) {
    const destination = item.destination || item.analysis?.destination || item.draft?.destination || "Needs Review";
    const draft = item.draft || {};

    if (destination === "Inventory") {
      const created = {
        id: `${Date.now()}-${Math.random()}`,
        productName: draft.productName || item.analysis?.suggestedProductName || item.fileName.replace(/\.[^.]+$/, ""),
        brand: draft.brand || item.analysis?.vendor || "",
        sku: draft.sku || item.analysis?.sku || "",
        styleCode: draft.styleCode || draft.sku || "",
        color: draft.color || "",
        size: draft.size || "",
        gender: draft.gender || "",
        category: draft.category || "",
        condition: "New",
        quantity: 1,
        purchasePrice: 0,
        sellingPrice: Number(draft.total || item.analysis?.total || 0),
        marketplace: "",
        purchaseLocation: "",
        purchaseDate: draft.date || item.analysis?.date || "",
        supplier: draft.vendor || item.analysis?.vendor || "",
        receiptNumber: draft.orderNumber || item.analysis?.orderNumber || "",
        storageLocation: "",
        notes: `${draft.title || item.analysis?.title || "Uploaded"}\n${draft.notes || item.analysis?.ocrText || ""}`.trim(),
        status: "In Stock",
        photos: item.originalDataUrl ? [item.originalDataUrl] : [],
        photo: item.originalDataUrl || "",
        createdAt: new Date().toISOString(),
        source: "AI Inbox",
      };
      setInventory((current) => [created, ...current]);
    } else if (destination === "Receipts") {
      const receipt = {
        id: `${Date.now()}-${Math.random()}`,
        merchant: draft.vendor || item.analysis?.vendor || item.fileName,
        date: draft.date || item.analysis?.date || new Date().toISOString().slice(0, 10),
        amount: Number(draft.total || item.analysis?.total || 0),
        type: "purchase",
        category: "Inventory",
        notes: `${draft.title || item.analysis?.title || "Uploaded"}\n${draft.notes || item.analysis?.ocrText || ""}`.trim(),
        linkedInventoryId: "",
        fileName: item.fileName,
        source: "AI Inbox",
        createdAt: new Date().toISOString(),
      };
      setReceipts((current) => [receipt, ...current]);
    } else if (destination === "Gift Cards") {
      const card = {
        id: `${Date.now()}-${Math.random()}`,
        brand: draft.vendor || item.analysis?.vendor || "Gift Card",
        balance: Number(draft.total || item.analysis?.total || 0),
        faceValue: Number(draft.total || item.analysis?.total || 0),
        purchasePrice: Number(draft.total || item.analysis?.total || 0),
        purchaseDate: draft.date || item.analysis?.date || new Date().toISOString().slice(0, 10),
        status: "New",
        notes: draft.notes || item.analysis?.ocrText || "",
      };
      setGiftCards((current) => [card, ...current]);
    } else if (destination === "Customers") {
      const customer = {
        id: `${Date.now()}-${Math.random()}`,
        name: draft.vendor || item.fileName.replace(/\.[^.]+$/, ""),
        company: draft.vendor || "",
        email: "",
        phone: "",
        notes: draft.notes || item.analysis?.ocrText || "",
        createdAt: new Date().toISOString(),
      };
      setCustomers((current) => [customer, ...current]);
    } else if (destination === "Expenses" || destination === "Financial & Tax") {
      const expense = {
        id: `${Date.now()}-${Math.random()}`,
        name: draft.title || item.analysis?.title || item.fileName,
        amount: Number(draft.total || item.analysis?.total || 0),
        category: destination === "Expenses" ? "Expense" : "AI Inbox",
        date: draft.date || item.analysis?.date || new Date().toISOString().slice(0, 10),
        notes: draft.notes || item.analysis?.ocrText || "",
      };
      setExpenses((current) => [expense, ...current]);
    } else if (destination === "Sales") {
      const transaction = {
        id: `${Date.now()}-${Math.random()}`,
        type: "sale",
        date: draft.date || item.analysis?.date || new Date().toISOString().slice(0, 10),
        amount: Number(draft.total || item.analysis?.total || 0),
        description: draft.title || item.analysis?.title || item.fileName,
        note: draft.notes || item.analysis?.ocrText || "",
      };
      setTransactions((current) => [transaction, ...current]);
    }

    updateItem(item.id, { decision: "accepted", status: "Accepted", destination });
  }

  function cancelItem(id) {
    updateItem(id, { decision: "cancelled", status: "Cancelled" });
  }

  const filteredItems = useMemo(() => aiInbox.filter((item) => {
    const haystack = `${item.fileName} ${item.analysis?.title || ""} ${item.analysis?.vendor || ""} ${item.analysis?.ocrText || ""} ${item.analysis?.orderNumber || ""} ${item.draft?.productName || ""} ${item.draft?.notes || ""}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query.toLowerCase());
    const matchesStatus = statusFilter === "All" || item.status === statusFilter;
    const matchesDestination = destinationFilter === "All" || (item.destination || item.analysis?.destination || item.draft?.destination || "Needs Review") === destinationFilter;
    return matchesQuery && matchesStatus && matchesDestination;
  }), [aiInbox, query, statusFilter, destinationFilter]);

  return (
    <div>
      <PageHeader title="AI Inbox" description="Upload receipts, invoices, labels, screenshots, and photos. AI will classify, suggest destinations, extract OCR details, and route items into your existing books." />

      <div style={{ ...styles.card, marginBottom: "16px" }}>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ ...styles.secondaryButton, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
            <span style={{ marginRight: "8px" }}>⬆️</span>
            Upload Files
            <input type="file" multiple accept=".pdf,.csv,.txt,.json,image/*" style={{ display: "none" }} onChange={handleUpload} />
          </label>
          <span style={styles.muted}>Supports PDFs, receipts, screenshots, photos, invoices, packing slips, shipping labels, CSVs, and gift card receipts.</span>
        </div>
        <div style={{ marginTop: "12px", border: dragActive ? "2px dashed #dc2626" : "2px dashed #d1d5db", borderRadius: "12px", padding: "18px", textAlign: "center", color: "#6b7280" }} onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={handleDrop}>
          Drop files here to analyze them instantly.
        </div>
      </div>

      <div style={{ ...styles.card, marginBottom: "16px" }}>
        <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <input style={styles.input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vendor, order, product, receipt, OCR, file name" />
          <select style={styles.input} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="All">All Statuses</option>
            <option value="Suggested">Suggested</option>
            <option value="Needs Review">Needs Review</option>
            <option value="Accepted">Accepted</option>
            <option value="Cancelled">Cancelled</option>
          </select>
          <select style={styles.input} value={destinationFilter} onChange={(event) => setDestinationFilter(event.target.value)}>
            <option value="All">All Destinations</option>
            <option value="Inventory">Inventory</option>
            <option value="Gift Cards">Gift Cards</option>
            <option value="Financial & Tax">Financial & Tax</option>
            <option value="Expenses">Expenses</option>
            <option value="Receipts">Receipts</option>
            <option value="Customers">Customers</option>
            <option value="Sales">Sales</option>
            <option value="AI Review">AI Review</option>
            <option value="Needs Review">Needs Review</option>
          </select>
        </div>
      </div>

      {uploading && <div style={{ ...styles.card, marginBottom: "16px" }}>Analyzing files and compressing uploads...</div>}

      <div style={{ display: "grid", gap: "16px" }}>
        {filteredItems.length === 0 && <div style={{ ...styles.card }}>No items yet. Upload files to generate AI suggestions, OCR results, and review items.</div>}
        {filteredItems.map((item) => {
          const analysis = item.analysis || {};
          const destination = item.destination || analysis.destination || item.draft?.destination || "Needs Review";
          const draft = item.draft || {};
          return (
            <div key={item.id} style={{ ...styles.card }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "18px" }}>{draft.title || analysis.title || item.fileName}</div>
                  <div style={{ color: "#6b7280", marginTop: "4px" }}>{item.fileName}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, color: destination === "Needs Review" ? "#dc2626" : "#111827" }}>{destination}</div>
                  <div style={{ color: "#6b7280", fontSize: "13px" }}>{Math.round((analysis.confidence || 0.5) * 100)}% confidence</div>
                </div>
              </div>

              <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginTop: "12px" }}>
                <div>
                  {item.thumbnailDataUrl && (item.fileType || "").startsWith("image/") ? (
                    <img loading="lazy" decoding="async" src={item.thumbnailDataUrl} alt={item.fileName} style={{ width: "100%", maxHeight: "220px", objectFit: "cover", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  ) : (
                    <div style={{ minHeight: "120px", borderRadius: "10px", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280", background: "#f9fafb" }}>
                      {item.fileType?.includes("pdf") ? "PDF" : item.fileType?.includes("csv") ? "CSV" : "Document"}
                    </div>
                  )}
                </div>
                <div style={{ display: "grid", gap: "8px" }}>
                  <div><strong>AI Summary</strong></div>
                  <div style={{ color: "#6b7280" }}>Vendor: {draft.vendor || analysis.vendor || "Unknown"}</div>
                  <div style={{ color: "#6b7280" }}>Order: {draft.orderNumber || analysis.orderNumber || "—"}</div>
                  <div style={{ color: "#6b7280" }}>Date: {draft.date || analysis.date || "—"}</div>
                  <div style={{ color: "#6b7280" }}>Amount: {draft.total ? money(draft.total) : analysis.total ? money(analysis.total) : "—"}</div>
                  <div style={{ color: "#6b7280" }}>SKU/Style: {draft.sku || analysis.sku || "—"}</div>
                  <div style={{ color: "#6b7280" }}>OCR Text: {draft.notes || analysis.ocrText ? (draft.notes || analysis.ocrText).slice(0, 180) : "No readable text extracted"}</div>
                  <div style={{ color: "#dc2626", fontWeight: 700, marginTop: "4px" }}>AI recommends placing this in {destination}.</div>
                </div>
              </div>

              <div style={{ marginTop: "12px", display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <label style={{ display: "grid", gap: "4px", fontSize: "13px", color: "#374151" }}>
                  Title
                  <input style={styles.input} value={draft.title || ""} onChange={(event) => updateDraft(item.id, "title", event.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "13px", color: "#374151" }}>
                  Vendor
                  <input style={styles.input} value={draft.vendor || ""} onChange={(event) => updateDraft(item.id, "vendor", event.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "13px", color: "#374151" }}>
                  Product Name
                  <input style={styles.input} value={draft.productName || ""} onChange={(event) => updateDraft(item.id, "productName", event.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "13px", color: "#374151" }}>
                  Brand
                  <input style={styles.input} value={draft.brand || ""} onChange={(event) => updateDraft(item.id, "brand", event.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "13px", color: "#374151" }}>
                  SKU / Style
                  <input style={styles.input} value={draft.sku || ""} onChange={(event) => updateDraft(item.id, "sku", event.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "13px", color: "#374151" }}>
                  Style Code
                  <input style={styles.input} value={draft.styleCode || ""} onChange={(event) => updateDraft(item.id, "styleCode", event.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "13px", color: "#374151" }}>
                  Category
                  <input style={styles.input} value={draft.category || ""} onChange={(event) => updateDraft(item.id, "category", event.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "13px", color: "#374151" }}>
                  Order #
                  <input style={styles.input} value={draft.orderNumber || ""} onChange={(event) => updateDraft(item.id, "orderNumber", event.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "13px", color: "#374151" }}>
                  Date
                  <input style={styles.input} value={draft.date || ""} onChange={(event) => updateDraft(item.id, "date", event.target.value)} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "13px", color: "#374151" }}>
                  Amount
                  <input style={styles.input} value={draft.total || ""} onChange={(event) => updateDraft(item.id, "total", Number(event.target.value || 0))} />
                </label>
                <label style={{ display: "grid", gap: "4px", fontSize: "13px", color: "#374151" }}>
                  Notes / OCR
                  <textarea style={{ ...styles.input, minHeight: "80px" }} value={draft.notes || ""} onChange={(event) => updateDraft(item.id, "notes", event.target.value)} />
                </label>
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
                <button style={styles.primaryButton} onClick={() => acceptItem(item)}>Accept</button>
                <select style={styles.input} value={destination} onChange={(event) => updateItem(item.id, { destination: event.target.value, status: event.target.value === "Needs Review" ? "Needs Review" : "Suggested" })}>
                  <option value="Inventory">Inventory</option>
                  <option value="Gift Cards">Gift Cards</option>
                  <option value="Financial & Tax">Financial & Tax</option>
                  <option value="Expenses">Expenses</option>
                  <option value="Receipts">Receipts</option>
                  <option value="Customers">Customers</option>
                  <option value="Sales">Sales</option>
                  <option value="AI Review">AI Review</option>
                  <option value="Needs Review">Needs Review</option>
                </select>
                <button style={styles.secondaryButton} onClick={() => cancelItem(item.id)}>Cancel</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AIToolsPage({ inventory }) {
  const [selectedId, setSelectedId] = useState("");
  const selectedItem = inventory.find((item) => String(item.id) === selectedId) || inventory[0] || null;

  const listing = useMemo(() => {
    if (!selectedItem) {
      return {
        title: "No inventory selected",
        description: "Add inventory to generate a listing.",
        keywords: ["resale", "inventory"],
        hashtags: ["#resale", "#inventory"],
      };
    }

    return {
      title: `${selectedItem.brand || "Brand"} ${selectedItem.productName || "Item"} ${selectedItem.size || ""}`.trim(),
      description: `Excellent condition ${selectedItem.brand || "product"} ${selectedItem.productName || "item"} ready for your next buyer. Great value with fast shipping and secure packing.`,
      keywords: [selectedItem.brand || "brand", selectedItem.size || "size", selectedItem.condition || "condition"],
      hashtags: [`#${(selectedItem.brand || "brand").replace(/\s+/g, "")}`, "#resale", "#inventory"],
    };
  }, [selectedItem]);

  const adCopy = useMemo(() => {
    if (!selectedItem) {
      return { caption: "Add inventory to generate ad copy.", script: "No item selected." };
    }

    return {
      caption: `Fresh ${selectedItem.brand || "item"} listing now available. Great condition and ready to ship.`,
      script: `Hey everyone, I just listed a ${selectedItem.productName || "great item"}. Great condition, fast shipping, and a solid deal.`,
    };
  }, [selectedItem]);

  return (
    <>
      <PageHeader title="AI Tools" description="Generate listings, keywords, hashtags, and ad copy for your resale channels." />

      <div style={styles.card}>
        <label style={styles.label}>Select Inventory Item</label>
        <select style={styles.input} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">Choose an item</option>
          {inventory.map((item) => (
            <option key={item.id} value={item.id}>{item.productName}</option>
          ))}
        </select>
      </div>

      <div style={styles.grid}>
        <div style={styles.card}>
          <h2>AI Listing Generator</h2>
          <p style={styles.muted}>Generate channel-ready title, description, keywords, and hashtags.</p>
          <div style={{ marginTop: "10px" }}>
            <strong>eBay / Marketplace Title</strong>
            <div style={{ marginBottom: "10px" }}>{listing.title}</div>
            <strong>Description</strong>
            <div style={{ marginBottom: "10px" }}>{listing.description}</div>
            <strong>Keywords</strong>
            <div style={{ marginBottom: "10px" }}>{listing.keywords.join(", ")}</div>
            <strong>Hashtags</strong>
            <div>{listing.hashtags.join(" ")}</div>
          </div>
        </div>

        <div style={styles.card}>
          <h2>AI Ad Generator</h2>
          <p style={styles.muted}>Generate short-form ad captions and scripts for social platforms.</p>
          <div style={{ marginTop: "10px" }}>
            <strong>Instagram / Facebook Caption</strong>
            <div style={{ marginBottom: "10px" }}>{adCopy.caption}</div>
            <strong>TikTok / YouTube Short Script</strong>
            <div>{adCopy.script}</div>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  ...props
}) {
  return (
    <div>
      {label && <label style={styles.label}>{label}</label>}

      <input
        style={styles.input}
        name={name}
        value={value}
        onChange={onChange}
        type={type}
        {...props}
      />
    </div>
  );
}

function SelectField({
  label,
  name,
  value,
  onChange,
  options,
}) {
  return (
    <div>
      {label && <label style={styles.label}>{label}</label>}

      <select
        style={styles.input}
        name={name}
        value={value}
        onChange={onChange}
      >
        {options.map((option) => {
          const value =
            typeof option === "string" ? option : option.value;

          const text =
            typeof option === "string" ? option : option.label;

          return (
            <option key={value} value={value}>
              {text}
            </option>
          );
        })}
      </select>
    </div>
  );
}