import { useEffect, useMemo, useRef, useState } from "react";
import { uploadAsset } from "../services/storage";
import { buildImportPlan, createDuplicateFingerprint, mergeDuplicateCards, attachCardsToPurchaseOrder } from "../services/giftCardImportEngine";
import { calculateReminderDate, getExpirationDate, getReminderStatus, maskCardNumber, maskPin, parseDate, parseNumber } from "../services/giftCardProcessing";

const STORAGE_KEY = "resellos-gift-cards";
const SUPPLIER_STORAGE_KEY = "resellos-gift-card-suppliers";
const PURCHASE_STORAGE_KEY = "resellos-gift-card-purchases";

const STATUS_ORDER = ["New", "Active", "Needs Review", "Partially Used", "Used", "Empty", "Archived"];
const STATUS_META = {
  New: { color: "#16a34a", background: "rgba(22, 163, 74, 0.14)", icon: "●", label: "New" },
  Active: { color: "#2563eb", background: "rgba(37, 99, 235, 0.14)", icon: "●", label: "Active" },
  "Needs Review": { color: "#d97706", background: "rgba(217, 119, 6, 0.14)", icon: "●", label: "Needs Review" },
  "Partially Used": { color: "#ea580c", background: "rgba(234, 88, 12, 0.14)", icon: "●", label: "Partially Used" },
  Used: { color: "#dc2626", background: "rgba(220, 38, 38, 0.14)", icon: "●", label: "Used" },
  Empty: { color: "#4b5563", background: "rgba(75, 85, 99, 0.14)", icon: "●", label: "Empty" },
  Archived: { color: "#9ca3af", background: "rgba(156, 163, 175, 0.14)", icon: "●", label: "Archived" },
};

function loadStored(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function saveStored(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage write failures
  }
}

function money(value, currency = "USD") {
  const amount = Number(value || 0);
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency,
  });
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  if (rows.length <= 1) return [];
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

function normalizeStatus(status, balance = 0) {
  const key = String(status || "").trim().toLowerCase();
  if (["new", "fresh", "created"].includes(key)) return "New";
  if (["active", "ready to use", "ready", "verified", "received", "available", "in stock"].includes(key)) return "Active";
  if (["needs review", "review", "uncertain", "needsreview"].includes(key)) return "Needs Review";
  if (["partially used", "partially", "partial", "partiallyused"].includes(key)) return "Partially Used";
  if (["used", "fully used", "redeemed", "consumed", "empty"].includes(key)) return balance > 0 ? "Partially Used" : "Used";
  if (["archive", "archived", "closed"].includes(key)) return "Archived";
  if (["refund", "refunded"].includes(key)) return "Archived";
  return "Active";
}

function buildStatusBadge(status) {
  const meta = STATUS_META[status] || STATUS_META.Active;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 10px", borderRadius: "999px", background: meta.background, color: meta.color, fontWeight: 700, fontSize: "12px" }}>{meta.icon} {meta.label}</span>;
}

function createCardFromMetadata(metadata = {}, context = {}) {
  const merchant = metadata.merchant || metadata.supplier || metadata.brand || context.merchant || "Unknown Merchant";
  const faceValue = Number(metadata.faceValue || metadata.originalBalance || metadata.balance || metadata.amount || 0);
  const balance = Number(metadata.balance || metadata.currentBalance || faceValue || 0);
  const purchasePrice = Number(metadata.purchasePrice || metadata.cost || metadata.price || 0);
  const purchaseDate = parseDate(metadata.purchaseDate || metadata.purchasedOn || "");
  const expirationDate = metadata.expirationDate || getExpirationDate(purchaseDate || new Date().toISOString().slice(0, 10));
  const confidenceScore = Number(metadata.confidenceScore || metadata.confidence || 0.85);
  const reviewRequired = Boolean(metadata.reviewRequired || confidenceScore < 0.9 || !metadata.cardNumber);
  const status = normalizeStatus(metadata.status || (reviewRequired ? "Needs Review" : "Active"), balance);

  return {
    id: context.id || createId("gift-card"),
    merchant,
    brand: metadata.brand || merchant,
    supplier: metadata.supplier || merchant,
    cardNumber: metadata.cardNumber || "",
    pin: metadata.pin || "",
    barcode: metadata.barcode || "",
    qrCode: metadata.qrCode || "",
    serialNumber: metadata.serialNumber || "",
    activationCode: metadata.activationCode || "",
    currentBalance: balance,
    originalBalance: faceValue || balance,
    faceValue: faceValue || balance,
    balance,
    purchasePrice,
    purchaseDate,
    expirationDate,
    currency: metadata.currency || context.currency || "USD",
    orderNumber: metadata.orderNumber || context.orderNumber || "",
    websiteSource: metadata.websiteSource || context.websiteSource || "",
    screenshotSource: context.screenshotSource || "",
    confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : 0.85,
    status,
    reviewRequired,
    notes: metadata.notes || context.notes || "",
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    merchantLogo: metadata.merchantLogo || context.merchantLogo || "",
    sourceType: context.sourceType || "manual",
    sourceName: context.sourceName || "Manual entry",
    sourceKey: context.sourceKey || createId("source"),
    createdAt: new Date().toISOString(),
    cardNumberMasked: maskCardNumber(metadata.cardNumber || ""),
    pinMasked: maskPin(metadata.pin || ""),
    reminderDays: 30,
    reminderDate: calculateReminderDate(purchaseDate || new Date().toISOString().slice(0, 10), 30),
    reminderStatus: getReminderStatus({ reminderDate: calculateReminderDate(purchaseDate || new Date().toISOString().slice(0, 10), 30) }),
    linkedOrder: metadata.linkedOrder || "",
    linkedReceipt: metadata.linkedReceipt || "",
    linkedInvoice: metadata.linkedInvoice || "",
    linkedInventory: metadata.linkedInventory || "",
    linkedExpenses: metadata.linkedExpenses || "",
    history: [{ label: "Imported", timestamp: new Date().toISOString(), detail: context.sourceName || "Imported" }],
  };
}

export default function GiftCards({ giftCards: controlledGiftCards, setGiftCards: setControlledGiftCards, onGiftCardPurchase, activeSection = null }) {
  const [localGiftCards, setLocalGiftCards] = useState(() => loadStored(STORAGE_KEY, []));
  const [supplierProfiles, setSupplierProfiles] = useState(() => loadStored(SUPPLIER_STORAGE_KEY, {}));
  const [purchaseCenterItems, setPurchaseCenterItems] = useState(() => loadStored(PURCHASE_STORAGE_KEY, []));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [merchantFilter, setMerchantFilter] = useState("All");
  const [brandFilter, setBrandFilter] = useState("All");
  const [websiteFilter, setWebsiteFilter] = useState("All");
  const [currencyFilter, setCurrencyFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [tagFilter, setTagFilter] = useState("All");
  const [selectedCardIds, setSelectedCardIds] = useState([]);
  const [detailCardId, setDetailCardId] = useState(null);
  const [reviewingId, setReviewingId] = useState(null);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [importQueue, setImportQueue] = useState([]);
  const [importReviewItems, setImportReviewItems] = useState([]);
  const [showImportReview, setShowImportReview] = useState(false);
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showSensitiveInfo, setShowSensitiveInfo] = useState(false);
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState("dark");
  const [visibleCount, setVisibleCount] = useState(24);
  const [editDraft, setEditDraft] = useState(null);
  const [importAccept, setImportAccept] = useState(".pdf,.png,.jpg,.jpeg,.webp,.gif,.csv,.txt");
  const fileInputRef = useRef(null);

  const giftCards = Array.isArray(controlledGiftCards) ? controlledGiftCards : localGiftCards;

  function commitGiftCards(valueOrUpdater) {
    if (typeof setControlledGiftCards === "function") {
      setControlledGiftCards(valueOrUpdater);
    } else {
      setLocalGiftCards(valueOrUpdater);
    }
  }

  const normalizedGiftCards = useMemo(() => {
    return (Array.isArray(giftCards) ? giftCards : []).map((card, index) => {
      const status = normalizeStatus(card.status || card.cardStatus || card.state || (card.balance <= 0 ? "Used" : "Active"), Number(card.balance || card.currentBalance || card.originalBalance || 0));
      return {
        ...card,
        merchant: card.merchant || card.brand || card.supplier || "Unknown Merchant",
        supplier: card.supplier || card.merchant || card.brand || "Unknown Merchant",
        brand: card.brand || card.merchant || card.supplier || "Unknown Merchant",
        cardNumber: card.cardNumber || "",
        pin: card.pin || "",
        barcode: card.barcode || "",
        qrCode: card.qrCode || "",
        serialNumber: card.serialNumber || "",
        activationCode: card.activationCode || "",
        faceValue: Number(card.faceValue || card.originalBalance || card.balance || 0),
        originalBalance: Number(card.originalBalance || card.faceValue || card.balance || 0),
        balance: Number(card.balance || card.currentBalance || card.faceValue || 0),
        currentBalance: Number(card.currentBalance || card.balance || card.faceValue || 0),
        purchasePrice: Number(card.purchasePrice || card.cost || 0),
        purchaseDate: card.purchaseDate || card.purchasedOn || "",
        expirationDate: card.expirationDate || "",
        currency: card.currency || "USD",
        orderNumber: card.orderNumber || "",
        websiteSource: card.websiteSource || "",
        screenshotSource: card.screenshotSource || "",
        confidenceScore: Number(card.confidenceScore || card.confidence || 0.85),
        status,
        reviewRequired: Boolean(card.reviewRequired || Number(card.confidenceScore || card.confidence || 0.85) < 0.9 || !card.cardNumber),
        tags: Array.isArray(card.tags) ? card.tags : [],
        merchantLogo: card.merchantLogo || card.logo || "",
        history: Array.isArray(card.history) ? card.history : [{ label: "Imported", timestamp: card.createdAt || new Date().toISOString(), detail: card.sourceName || "Imported" }],
        sourceName: card.sourceName || "Manual entry",
        sourceType: card.sourceType || "manual",
        createdAt: card.createdAt || new Date().toISOString(),
        cardNumberMasked: card.cardNumberMasked || maskCardNumber(card.cardNumber || ""),
        pinMasked: card.pinMasked || maskPin(card.pin || ""),
      };
    });
  }, [giftCards]);

  useEffect(() => {
    saveStored(STORAGE_KEY, normalizedGiftCards);
  }, [normalizedGiftCards]);

  useEffect(() => {
    saveStored(SUPPLIER_STORAGE_KEY, supplierProfiles);
  }, [supplierProfiles]);

  useEffect(() => {
    saveStored(PURCHASE_STORAGE_KEY, purchaseCenterItems);
  }, [purchaseCenterItems]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const metrics = useMemo(() => {
    const totalFaceValue = normalizedGiftCards.reduce((sum, card) => sum + Number(card.faceValue || 0), 0);
    const totalPurchaseCost = normalizedGiftCards.reduce((sum, card) => sum + Number(card.purchasePrice || 0), 0);
    const totalBalance = normalizedGiftCards.reduce((sum, card) => sum + Number(card.balance || 0), 0);
    const estimatedProfit = totalBalance - totalPurchaseCost;
    const byStatus = STATUS_ORDER.reduce((acc, status) => ({ ...acc, [status]: 0 }), {});
    normalizedGiftCards.forEach((card) => {
      byStatus[card.status] = (byStatus[card.status] || 0) + 1;
    });
    return {
      totalCards: normalizedGiftCards.length,
      totalFaceValue,
      totalPurchaseCost,
      totalBalance,
      estimatedProfit,
      byStatus,
    };
  }, [normalizedGiftCards]);

  const filteredCards = useMemo(() => {
    const term = search.toLowerCase().trim();
    return normalizedGiftCards.filter((card) => {
      const haystack = [
        card.merchant,
        card.brand,
        card.cardNumber,
        card.pin,
        card.barcode,
        card.orderNumber,
        card.websiteSource,
        card.notes,
        ...(card.tags || []),
        String(card.balance || ""),
        String(card.faceValue || ""),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !term || haystack.includes(term);
      const matchesStatus = statusFilter === "All" || card.status === statusFilter;
      const matchesMerchant = merchantFilter === "All" || card.merchant === merchantFilter;
      const matchesBrand = brandFilter === "All" || card.brand === brandFilter;
      const matchesWebsite = websiteFilter === "All" || card.websiteSource === websiteFilter;
      const matchesCurrency = currencyFilter === "All" || card.currency === currencyFilter;
      const matchesSource = sourceFilter === "All" || card.sourceType === sourceFilter;
      const matchesTag = tagFilter === "All" || (card.tags || []).includes(tagFilter);
      return matchesSearch && matchesStatus && matchesMerchant && matchesBrand && matchesWebsite && matchesCurrency && matchesSource && matchesTag;
    });
  }, [normalizedGiftCards, search, statusFilter, merchantFilter, brandFilter, websiteFilter, currencyFilter, sourceFilter, tagFilter]);

  const visibleCards = filteredCards.slice(0, visibleCount);
  const reviewQueue = useMemo(() => normalizedGiftCards.filter((card) => card.reviewRequired || card.status === "Needs Review").slice(0, 8), [normalizedGiftCards]);

  const merchantOptions = useMemo(() => ["All", ...Array.from(new Set(normalizedGiftCards.map((card) => card.merchant).filter(Boolean)))], [normalizedGiftCards]);
  const brandOptions = useMemo(() => ["All", ...Array.from(new Set(normalizedGiftCards.map((card) => card.brand).filter(Boolean)))], [normalizedGiftCards]);
  const websiteOptions = useMemo(() => ["All", ...Array.from(new Set(normalizedGiftCards.map((card) => card.websiteSource).filter(Boolean)))], [normalizedGiftCards]);
  const currencyOptions = useMemo(() => ["All", ...Array.from(new Set(normalizedGiftCards.map((card) => card.currency).filter(Boolean)))], [normalizedGiftCards]);
  const sourceOptions = useMemo(() => ["All", ...Array.from(new Set(normalizedGiftCards.map((card) => card.sourceType).filter(Boolean)))], [normalizedGiftCards]);
  const tagOptions = useMemo(() => ["All", ...Array.from(new Set(normalizedGiftCards.flatMap((card) => card.tags || []).filter(Boolean)))], [normalizedGiftCards]);
  const selectedCard = normalizedGiftCards.find((card) => card.id === detailCardId) || null;

  const section = activeSection || "main";
  const resolvedTab = section && ["dashboard", "cards", "imports", "analytics", "settings"].includes(section) ? section : activeTab;

  const showPurchaseCenter = resolvedTab === "imports" || resolvedTab === "dashboard";
  const showReviewQueue = resolvedTab === "dashboard" || resolvedTab === "cards";

  const tabOptions = [
    { id: "dashboard", label: "Dashboard" },
    { id: "cards", label: "Inventory" },
    { id: "imports", label: "Import" },
    { id: "analytics", label: "Analytics" },
    { id: "settings", label: "Settings" },
  ];

  function showToast(message) {
    setToast(message);
  }

  function applyImportedPlan(plan = {}) {
    const cards = Array.isArray(plan?.cards) ? plan.cards : [];
    const purchaseOrder = plan?.purchaseOrder || null;
    const linkedCards = purchaseOrder ? attachCardsToPurchaseOrder(cards, purchaseOrder) : cards;

    if (linkedCards.length) {
      commitGiftCards((current) => mergeDuplicateCards(Array.isArray(current) ? current : [], linkedCards));
    }

    if (purchaseOrder) {
      setPurchaseCenterItems((current) => {
        const existing = Array.isArray(current) ? current : [];
        return existing.some((entry) => entry.id === purchaseOrder.id) ? existing : [...existing, purchaseOrder];
      });
    }
  }

  function updateCard(id, updates) {
    commitGiftCards((current) => current.map((card) => (card.id === id ? { ...card, ...updates } : card)));
  }

  function deleteGiftCard(id) {
    if (!window.confirm("Delete this card?")) return;
    commitGiftCards((current) => current.filter((card) => card.id !== id));
    setSelectedCardIds((current) => current.filter((entry) => entry !== id));
    if (detailCardId === id) setDetailCardId(null);
    showToast("Card deleted");
  }

  function updateStatus(id, status) {
    updateCard(id, { status: normalizeStatus(status, Number(normalizedGiftCards.find((card) => card.id === id)?.balance || 0)) });
    showToast(`${status} applied`);
  }

  function toggleSelection(id) {
    setSelectedCardIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  }

  function bulkAction(action) {
    if (!selectedCardIds.length) return;
    const selected = selectedCardIds.filter((id) => normalizedGiftCards.some((card) => card.id === id));
    if (!selected.length) return;
    if (action === "delete") {
      if (!window.confirm(`Delete ${selected.length} selected cards?`)) return;
      commitGiftCards((current) => current.filter((card) => !selected.includes(card.id)));
      setSelectedCardIds([]);
      showToast(`Deleted ${selected.length} cards`);
      return;
    }
    if (action === "archive") {
      commitGiftCards((current) => current.map((card) => (selected.includes(card.id) ? { ...card, status: "Archived" } : card)));
      setSelectedCardIds([]);
      showToast(`Archived ${selected.length} cards`);
      return;
    }
    if (action === "mark-used") {
      commitGiftCards((current) => current.map((card) => (selected.includes(card.id) ? { ...card, status: "Used", balance: 0 } : card)));
      setSelectedCardIds([]);
      showToast(`Marked ${selected.length} cards as Used`);
      return;
    }
    if (action === "mark-active") {
      commitGiftCards((current) => current.map((card) => (selected.includes(card.id) ? { ...card, status: "Active" } : card)));
      setSelectedCardIds([]);
      showToast(`Marked ${selected.length} cards as Active`);
      return;
    }
    if (action === "export") {
      const rows = selected.map((id) => normalizedGiftCards.find((card) => card.id === id)).filter(Boolean);
      const csv = ["merchant,cardNumber,balance,purchasePrice,status"].concat(rows.map((card) => `${card.merchant},${card.cardNumber},${card.balance},${card.purchasePrice},${card.status}`)).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "gift-cards.csv";
      link.click();
      URL.revokeObjectURL(url);
      showToast(`Exported ${rows.length} cards`);
    }
  }

  async function processFile(file, sourceType = "upload") {
    const sourceKey = `${file.name}-${file.size}-${file.lastModified}`;
    const asset = await uploadAsset(file, { provider: "local", path: "gift-card-uploads" });
    const isTextLike = file.type.includes("text") || [".csv", ".txt", ".eml"].some((ext) => file.name.toLowerCase().endsWith(ext));
    const rawText = isTextLike ? await file.text().catch(() => "") : "";
    const importGroupId = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const plan = buildImportPlan(file, sourceType, rawText, asset, importGroupId);
    const cards = (plan.cards || []).map((card) => ({
      ...card,
      sourceKey,
      sourceName: file.name,
      sourceType: card.sourceType || sourceType,
    }));

    return {
      ...plan,
      cards,
      sourceName: file.name,
    };
  }

  async function handleImportFiles(files = [], sourceType = "upload") {
    if (!files.length) return;
    setShowImportMenu(false);
    const queueItems = files.map((file) => ({ id: `${file.name}-${file.size}`, name: file.name, status: "Processing..." }));
    setImportQueue(queueItems);

    const reviewItems = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setImportQueue((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, status: "Processing..." } : entry));
      const plan = await processFile(file, sourceType);
      reviewItems.push({
        id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        plan,
        cardCount: plan.cards?.length || 0,
        hasPurchaseOrder: Boolean(plan.purchaseOrder),
      });
      setImportQueue((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, status: plan.cards?.length ? `${plan.cards.length} cards ready` : "Receipt ready" } : entry));
    }

    setImportReviewItems((current) => [...current, ...reviewItems]);
    setShowImportReview(true);
    setSelectedCardIds([]);
    showToast(`${reviewItems.length} import batch${reviewItems.length > 1 ? "es" : ""} ready for review`);
    setImportQueue([]);
  }

  function acceptReviewItem(itemId) {
    const reviewItem = importReviewItems.find((entry) => entry.id === itemId);
    if (!reviewItem) return;
    const draft = reviewDrafts[itemId];
    const nextPlan = draft ? {
      ...reviewItem.plan,
      purchaseOrder: reviewItem.plan.purchaseOrder ? {
        ...reviewItem.plan.purchaseOrder,
        supplier: draft.supplier || reviewItem.plan.purchaseOrder.supplier,
        orderId: draft.orderId || reviewItem.plan.purchaseOrder.orderId,
        notes: draft.notes || reviewItem.plan.purchaseOrder.notes,
      } : null,
    } : reviewItem.plan;
    applyImportedPlan(nextPlan);
    setImportReviewItems((current) => current.filter((entry) => entry.id !== itemId));
    setReviewDrafts((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
    showToast(nextPlan?.cards?.length ? `Imported ${nextPlan.cards.length} cards` : "Purchase order saved");
  }

  function skipReviewItem(itemId) {
    setImportReviewItems((current) => current.filter((entry) => entry.id !== itemId));
    showToast("Import skipped");
  }

  function editReviewItem(itemId) {
    const currentDraft = reviewDrafts[itemId];
    if (currentDraft) {
      const reviewItem = importReviewItems.find((entry) => entry.id === itemId);
      if (!reviewItem) return;
      const nextPlan = {
        ...reviewItem.plan,
        purchaseOrder: reviewItem.plan.purchaseOrder ? {
          ...reviewItem.plan.purchaseOrder,
          supplier: currentDraft.supplier || reviewItem.plan.purchaseOrder.supplier,
          orderId: currentDraft.orderId || reviewItem.plan.purchaseOrder.orderId,
          notes: currentDraft.notes || reviewItem.plan.purchaseOrder.notes,
        } : null,
      };
      setImportReviewItems((current) => current.map((entry) => (entry.id === itemId ? { ...entry, plan: nextPlan } : entry)));
      setReviewDrafts((current) => ({ ...current, [itemId]: undefined }));
      showToast("Review draft saved");
      return;
    }
    const reviewItem = importReviewItems.find((entry) => entry.id === itemId);
    if (!reviewItem) return;
    setReviewDrafts((current) => ({
      ...current,
      [itemId]: {
        supplier: reviewItem.plan?.purchaseOrder?.supplier || reviewItem.plan?.cards?.[0]?.supplier || "",
        orderId: reviewItem.plan?.purchaseOrder?.orderId || reviewItem.plan?.cards?.[0]?.orderNumber || "",
        notes: reviewItem.plan?.purchaseOrder?.notes || reviewItem.plan?.cards?.[0]?.notes || "",
      },
    }));
  }

  function updateReviewDraft(itemId, field, value) {
    setReviewDrafts((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] || {}),
        [field]: value,
      },
    }));
  }

  async function handleUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    await handleImportFiles(files, "upload");
    event.target.value = "";
  }

  async function importFromUrl() {
    const rawUrl = window.prompt("Paste a website URL to import gift card details");
    if (!rawUrl) return;
    try {
      const parsed = new URL(rawUrl);
      const hostname = parsed.hostname.replace("www.", "");
      const html = await fetch(parsed.toString()).then((response) => response.text()).catch(() => "");
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
      const plan = buildImportPlan({ name: `${hostname}.html`, type: "text/html" }, "website", html, { originalUrl: parsed.toString(), name: parsed.toString() }, `${hostname}-${Date.now()}`);
      const cards = (plan.cards || []).map((card) => ({ ...card, sourceName: parsed.toString(), sourceType: "website" }));
      if (cards.length) {
        applyImportedPlan({ ...plan, cards });
        showToast(`Website details imported for ${cards[0].merchant || hostname}`);
      } else {
        showToast("No card details were detected from that URL");
      }
    } catch {
      showToast("Please provide a valid URL");
    }
  }

  function handlePaste(event) {
    const files = Array.from(event.clipboardData?.items || []).map((item) => item.getAsFile()).filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    handleImportFiles(files, "paste");
  }

  function saveDetailChanges(event) {
    event.preventDefault();
    if (!selectedCard) return;
    const form = event.target;
    const next = {
      merchant: form.merchant.value || selectedCard.merchant,
      brand: form.brand.value || selectedCard.brand,
      cardNumber: form.cardNumber.value || selectedCard.cardNumber,
      pin: form.pin.value || selectedCard.pin,
      barcode: form.barcode.value || selectedCard.barcode,
      qrCode: form.qrCode.value || selectedCard.qrCode,
      serialNumber: form.serialNumber.value || selectedCard.serialNumber,
      activationCode: form.activationCode.value || selectedCard.activationCode,
      balance: Number(form.balance.value || selectedCard.balance || 0),
      faceValue: Number(form.faceValue.value || selectedCard.faceValue || 0),
      purchasePrice: Number(form.purchasePrice.value || selectedCard.purchasePrice || 0),
      purchaseDate: form.purchaseDate.value || selectedCard.purchaseDate || "",
      expirationDate: form.expirationDate.value || selectedCard.expirationDate || "",
      currency: form.currency.value || selectedCard.currency || "USD",
      orderNumber: form.orderNumber.value || selectedCard.orderNumber || "",
      websiteSource: form.websiteSource.value || selectedCard.websiteSource || "",
      notes: form.notes.value || selectedCard.notes || "",
      tags: (form.tags.value || "").split(",").map((tag) => tag.trim()).filter(Boolean),
      status: normalizeStatus(form.status.value || selectedCard.status, Number(form.balance.value || selectedCard.balance || 0)),
      reviewRequired: form.reviewRequired.checked,
    };
    updateCard(selectedCard.id, next);
    showToast("Card updated");
  }

  function openDetailCard(card) {
    setDetailCardId(card.id);
    setEditDraft(card);
  }

  function copyValue(value) {
    if (!value) return;
    navigator.clipboard?.writeText(value).catch(() => {});
    showToast("Copied");
  }

  function revealSensitive() {
    const entered = window.prompt("Confirm your secure passphrase to reveal sensitive details");
    if (entered) {
      setShowSensitiveInfo(true);
      showToast("Sensitive data unlocked");
    }
  }

  return (
    <div onPaste={handlePaste} style={{ minHeight: "100%", paddingBottom: "28px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "20px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "30px" }}>Gift Card Command Center</h1>
          <p style={{ margin: "6px 0 0", color: "#6b7280" }}>AI-assisted inventory, OCR review, import automation, and mobile-first operations in one premium workspace.</p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))} style={{ padding: "10px 12px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>
            {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
          <button onClick={() => setShowImportMenu((current) => !current)} style={{ padding: "12px 16px", borderRadius: "999px", border: "none", background: "linear-gradient(135deg, #2563eb, #14b8a6)", color: "#fff", fontWeight: 800, cursor: "pointer" }}>➕ Import Gift Cards</button>
        </div>
      </div>

      {showImportMenu && (
        <div style={{ border: "1px solid rgba(255,255,255,0.14)", background: theme === "dark" ? "rgba(17,24,39,0.95)" : "rgba(255,255,255,0.9)", borderRadius: "18px", padding: "14px", marginBottom: "16px", boxShadow: "0 10px 40px rgba(0,0,0,0.12)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px" }}>
            <button onClick={() => { setImportAccept("image/*;capture=camera"); fileInputRef.current?.click(); }} style={{ padding: "12px", borderRadius: "12px", border: "1px solid #d1d5db", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>📷 Take Photo</button>
            <button onClick={() => { setImportAccept("image/*"); fileInputRef.current?.click(); }} style={{ padding: "12px", borderRadius: "12px", border: "1px solid #d1d5db", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>🖼 Upload Screenshot(s)</button>
            <button onClick={() => { setImportAccept(".pdf"); fileInputRef.current?.click(); }} style={{ padding: "12px", borderRadius: "12px", border: "1px solid #d1d5db", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>📄 Upload PDF</button>
            <button onClick={() => importFromUrl()} style={{ padding: "12px", borderRadius: "12px", border: "1px solid #d1d5db", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>🌐 Import From Website URL</button>
            <button onClick={() => setShowImportMenu(false)} style={{ padding: "12px", borderRadius: "12px", border: "1px solid #d1d5db", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>📋 Paste Image</button>
            <button onClick={() => { setImportAccept(".csv,text/csv"); fileInputRef.current?.click(); }} style={{ padding: "12px", borderRadius: "12px", border: "1px solid #d1d5db", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>📊 Upload CSV</button>
          </div>
          <input ref={fileInputRef} type="file" accept={importAccept} multiple hidden onChange={handleUpload} />
        </div>
      )}

      {importQueue.length > 0 && (
        <div style={{ marginBottom: "16px", borderRadius: "16px", padding: "14px", background: theme === "dark" ? "rgba(15,23,42,0.95)" : "rgba(255,255,255,0.95)", border: "1px solid #e5e7eb" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <strong>Upload queue</strong>
            <span>{importQueue.filter((item) => item.status === "Completed").length} / {importQueue.length} completed</span>
          </div>
          {importQueue.map((item, index) => (
            <div key={item.id} style={{ marginTop: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "14px" }}>
                <span>{item.name}</span>
                <span>{item.status}</span>
              </div>
              <div style={{ height: "8px", borderRadius: "999px", background: "#e5e7eb", overflow: "hidden", marginTop: "6px" }}>
                <div style={{ width: `${Math.max(10, ((index + 1) / importQueue.length) * 100)}%`, height: "100%", background: "linear-gradient(90deg, #2563eb, #14b8a6)" }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {importReviewItems.length > 0 && (
        <div style={{ marginBottom: "16px", borderRadius: "16px", padding: "14px", background: theme === "dark" ? "rgba(15,23,42,0.95)" : "rgba(255,255,255,0.95)", border: "1px solid #e5e7eb" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <strong>Import review</strong>
            <span>{importReviewItems.length} pending</span>
          </div>
          <div style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
            {importReviewItems.map((item) => {
              const draft = reviewDrafts[item.id] || null;
              const purchaseOrder = item.plan?.purchaseOrder;
              return (
                <div key={item.id} style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                    <div>
                      <strong>{item.name}</strong>
                      <div style={{ color: "#6b7280", fontSize: "13px", marginTop: "4px" }}>{item.cardCount} card{item.cardCount === 1 ? "" : "s"} • {purchaseOrder ? "Purchase order" : "Review needed"}</div>
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button onClick={() => acceptReviewItem(item.id)} style={{ padding: "8px 10px", borderRadius: "999px", border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>Accept</button>
                      <button onClick={() => editReviewItem(item.id)} style={{ padding: "8px 10px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>{draft ? "Save" : "Edit"}</button>
                      <button onClick={() => skipReviewItem(item.id)} style={{ padding: "8px 10px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Skip</button>
                    </div>
                  </div>
                  {draft && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px", marginTop: "10px" }}>
                      <input value={draft.supplier || ""} onChange={(event) => updateReviewDraft(item.id, "supplier", event.target.value)} placeholder="Supplier" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                      <input value={draft.orderId || ""} onChange={(event) => updateReviewDraft(item.id, "orderId", event.target.value)} placeholder="Order ID" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                      <textarea value={draft.notes || ""} onChange={(event) => updateReviewDraft(item.id, "notes", event.target.value)} placeholder="Notes" style={{ gridColumn: "1 / -1", padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb", minHeight: "70px" }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "18px" }}>
        {tabOptions.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ padding: "10px 14px", borderRadius: "999px", border: resolvedTab === tab.id ? "none" : "1px solid #e5e7eb", background: resolvedTab === tab.id ? "#111827" : theme === "dark" ? "#0f172a" : "#ffffff", color: resolvedTab === tab.id ? "#fff" : theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>{tab.label}</button>
        ))}
      </div>

      {resolvedTab === "dashboard" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "16px" }}>
          {[
            { label: "New Cards", value: metrics.byStatus.New, color: "#16a34a", filter: "New" },
            { label: "Active Cards", value: metrics.byStatus.Active, color: "#2563eb", filter: "Active" },
            { label: "Partial Cards", value: metrics.byStatus["Partially Used"], color: "#ea580c", filter: "Partially Used" },
            { label: "Used Cards", value: metrics.byStatus.Used, color: "#dc2626", filter: "Used" },
            { label: "Empty Cards", value: metrics.byStatus.Empty, color: "#4b5563", filter: "Empty" },
            { label: "Total Face Value", value: money(metrics.totalFaceValue), color: "#7c3aed", filter: null },
            { label: "Total Purchase Cost", value: money(metrics.totalPurchaseCost), color: "#0f766e", filter: null },
            { label: "Estimated Profit", value: money(metrics.estimatedProfit), color: "#14b8a6", filter: null },
          ].map((card) => (
            <button key={card.label} onClick={() => { if (card.filter) setStatusFilter(card.filter); else setStatusFilter("All"); setActiveTab("cards"); }} style={{ textAlign: "left", padding: "14px", borderRadius: "16px", border: "1px solid #e5e7eb", background: theme === "dark" ? "rgba(15,23,42,0.95)" : "#fff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>
              <div style={{ fontSize: "12px", color: card.color, fontWeight: 700 }}>{card.label}</div>
              <div style={{ fontSize: "22px", fontWeight: 800, marginTop: "6px" }}>{card.value}</div>
            </button>
          ))}
        </div>
      )}

      {showPurchaseCenter && (
        <div style={{ borderRadius: "18px", padding: "16px", border: "1px solid #e5e7eb", background: theme === "dark" ? "rgba(17,24,39,0.95)" : "rgba(255,255,255,0.9)", marginBottom: "16px" }}>
          <h3 style={{ marginTop: 0 }}>Import workflow</h3>
          <div style={{ display: "grid", gap: "10px" }}>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button onClick={() => { setImportAccept("image/*;capture=camera"); fileInputRef.current?.click(); }} style={{ padding: "11px 14px", borderRadius: "999px", border: "none", background: "linear-gradient(135deg, #2563eb, #14b8a6)", color: "#fff", cursor: "pointer" }}>📷 Camera</button>
              <button onClick={() => { setImportAccept(".pdf"); fileInputRef.current?.click(); }} style={{ padding: "11px 14px", borderRadius: "999px", border: "1px solid #d1d5db", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>📄 PDF</button>
              <button onClick={() => { setImportAccept(".csv,text/csv"); fileInputRef.current?.click(); }} style={{ padding: "11px 14px", borderRadius: "999px", border: "1px solid #d1d5db", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>📊 CSV</button>
              <button onClick={importFromUrl} style={{ padding: "11px 14px", borderRadius: "999px", border: "1px solid #d1d5db", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>🌐 Website</button>
            </div>
            <p style={{ margin: 0, color: "#6b7280" }}>Batch import hundreds of cards at once. OCR confidence below 90% is flagged for review, and duplicates are detected automatically.</p>
          </div>
        </div>
      )}

      {showReviewQueue && (
        <div style={{ borderRadius: "18px", padding: "16px", border: "1px solid #e5e7eb", background: theme === "dark" ? "rgba(17,24,39,0.95)" : "rgba(255,255,255,0.9)", marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>OCR Review Queue</h3>
            <span style={{ color: "#d97706", fontWeight: 700 }}>{reviewQueue.length} needs attention</span>
          </div>
          <div style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
            {reviewQueue.map((card) => (
              <div key={card.id} style={{ padding: "12px", borderRadius: "12px", border: "1px solid #fde68a", background: "rgba(254, 240, 138, 0.2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <strong>{card.merchant}</strong>
                  {buildStatusBadge(card.status)}
                </div>
                <div style={{ color: "#6b7280", marginTop: "6px", fontSize: "14px" }}>Confidence {Math.round((card.confidenceScore || 0.85) * 100)}% • {card.orderNumber || "No order number"}</div>
                <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                  <button onClick={() => updateStatus(card.id, "Active")} style={{ padding: "8px 10px", borderRadius: "999px", border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>Accept</button>
                  <button onClick={() => updateStatus(card.id, "Needs Review")} style={{ padding: "8px 10px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Edit</button>
                  <button onClick={() => updateStatus(card.id, "Archived")} style={{ padding: "8px 10px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Skip</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {resolvedTab === "cards" && (
        <div style={{ borderRadius: "18px", padding: "16px", border: "1px solid #e5e7eb", background: theme === "dark" ? "rgba(17,24,39,0.95)" : "rgba(255,255,255,0.9)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div>
              <h3 style={{ margin: 0 }}>Inventory</h3>
              <p style={{ margin: "6px 0 0", color: "#6b7280" }}>{filteredCards.length} cards • Search, filter, and bulk-manage your inventory instantly.</p>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search merchant, card, balance, notes, tags" style={{ padding: "10px 12px", borderRadius: "999px", border: "1px solid #e5e7eb", minWidth: "260px" }} />
              <button onClick={() => bulkAction("export")} style={{ padding: "10px 12px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Export</button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px", marginTop: "12px" }}>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
              <option value="All">All statuses</option>
              {STATUS_ORDER.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <select value={merchantFilter} onChange={(event) => setMerchantFilter(event.target.value)} style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
              <option value="All">All merchants</option>
              {merchantOptions.map((merchant) => <option key={merchant} value={merchant}>{merchant}</option>)}
            </select>
            <select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)} style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
              <option value="All">All brands</option>
              {brandOptions.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
            </select>
            <select value={websiteFilter} onChange={(event) => setWebsiteFilter(event.target.value)} style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
              <option value="All">All websites</option>
              {websiteOptions.map((website) => <option key={website} value={website}>{website}</option>)}
            </select>
            <select value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)} style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
              <option value="All">All currencies</option>
              {currencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
            </select>
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
              <option value="All">All sources</option>
              {sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
            <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
              <option value="All">All tags</option>
              {tagOptions.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
            <button onClick={() => bulkAction("mark-active")} style={{ padding: "9px 12px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Mark Active</button>
            <button onClick={() => bulkAction("mark-used")} style={{ padding: "9px 12px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Mark Used</button>
            <button onClick={() => bulkAction("archive")} style={{ padding: "9px 12px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Archive</button>
            <button onClick={() => bulkAction("delete")} style={{ padding: "9px 12px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Delete</button>
          </div>

          <div style={{ display: "grid", gap: "10px", marginTop: "12px" }}>
            {visibleCards.map((card) => {
              const isSelected = selectedCardIds.includes(card.id);
              return (
                <div key={card.id} onClick={() => openDetailCard(card)} style={{ border: isSelected ? "2px solid #2563eb" : "1px solid #e5e7eb", borderRadius: "14px", padding: "12px", background: theme === "dark" ? "rgba(15,23,42,0.9)" : "#ffffff", cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelection(card.id)} onClick={(event) => event.stopPropagation()} />
                      <strong>{card.merchant}</strong>
                    </div>
                    {buildStatusBadge(card.status)}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px", marginTop: "8px" }}>
                    <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Card</div><div>{card.cardNumber ? card.cardNumberMasked : "—"}</div></div>
                    <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Balance</div><div>{money(card.balance || 0, card.currency)}</div></div>
                    <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Purchase</div><div>{money(card.purchasePrice || 0, card.currency)}</div></div>
                    <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Source</div><div>{card.sourceName}</div></div>
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
                    {(card.tags || []).slice(0, 3).map((tag) => <span key={tag} style={{ background: "rgba(37,99,235,0.08)", color: "#2563eb", padding: "4px 8px", borderRadius: "999px", fontSize: "12px" }}>{tag}</span>)}
                  </div>
                </div>
              );
            })}
          </div>

          {filteredCards.length > visibleCount && (
            <button onClick={() => setVisibleCount((current) => current + 12)} style={{ marginTop: "12px", padding: "10px 14px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Show more</button>
          )}
        </div>
      )}

      {resolvedTab === "analytics" && (
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ borderRadius: "18px", padding: "16px", border: "1px solid #e5e7eb", background: theme === "dark" ? "rgba(17,24,39,0.95)" : "rgba(255,255,255,0.9)" }}>
            <h3 style={{ marginTop: 0 }}>Inventory value</h3>
            <div style={{ display: "grid", gap: "8px" }}>
              {STATUS_ORDER.map((status) => (
                <div key={status} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                  <span>{status}</span>
                  <div style={{ flex: 1, height: "8px", borderRadius: "999px", background: "#e5e7eb", overflow: "hidden" }}>
                    <div style={{ width: `${Math.max(6, (metrics.byStatus[status] / Math.max(1, metrics.totalCards)) * 100)}%`, height: "100%", background: STATUS_META[status]?.color || "#2563eb" }} />
                  </div>
                  <strong>{metrics.byStatus[status]}</strong>
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderRadius: "18px", padding: "16px", border: "1px solid #e5e7eb", background: theme === "dark" ? "rgba(17,24,39,0.95)" : "rgba(255,255,255,0.9)" }}>
            <h3 style={{ marginTop: 0 }}>Most active merchants</h3>
            {merchantOptions.slice(1).map((merchant) => (
              <div key={merchant} style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
                <span>{merchant}</span>
                <strong>{normalizedGiftCards.filter((card) => card.merchant === merchant).length}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {resolvedTab === "settings" && (
        <div style={{ borderRadius: "18px", padding: "16px", border: "1px solid #e5e7eb", background: theme === "dark" ? "rgba(17,24,39,0.95)" : "rgba(255,255,255,0.9)" }}>
          <h3 style={{ marginTop: 0 }}>Security & automation</h3>
          <p style={{ marginTop: 0, color: "#6b7280" }}>PINs and sensitive values stay masked until you explicitly unlock them. OCR confidence below 90% is auto-flagged and queued for review.</p>
          <button onClick={revealSensitive} style={{ padding: "10px 14px", borderRadius: "999px", border: "none", background: "#111827", color: "#fff", cursor: "pointer" }}>Unlock sensitive data</button>
        </div>
      )}

      {selectedCard && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.48)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 40, padding: "12px" }}>
          <div style={{ width: "100%", maxWidth: "720px", borderRadius: "20px", padding: "16px", background: theme === "dark" ? "#0f172a" : "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: "24px", fontWeight: 800 }}>{selectedCard.merchant}</div>
                <div style={{ color: "#6b7280" }}>{selectedCard.websiteSource || selectedCard.sourceName}</div>
              </div>
              {buildStatusBadge(selectedCard.status)}
            </div>
            <div style={{ display: "grid", gap: "10px", marginTop: "12px" }}>
              {selectedCard.merchantLogo ? <img src={selectedCard.merchantLogo} alt={selectedCard.merchant} style={{ width: "80px", height: "80px", objectFit: "contain", borderRadius: "12px" }} /> : null}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px" }}>
                <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Card number</div><div>{showSensitiveInfo ? selectedCard.cardNumber || "—" : selectedCard.cardNumberMasked || "—"}</div></div>
                <div><div style={{ fontSize: "12px", color: "#6b7280" }}>PIN</div><div>{showSensitiveInfo ? selectedCard.pin || "—" : selectedCard.pinMasked || "—"}</div></div>
                <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Current balance</div><div>{money(selectedCard.balance || 0, selectedCard.currency)}</div></div>
                <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Purchase price</div><div>{money(selectedCard.purchasePrice || 0, selectedCard.currency)}</div></div>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
                <button onClick={() => copyValue(selectedCard.cardNumber)} style={{ padding: "9px 12px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Copy card number</button>
                <button onClick={() => copyValue(selectedCard.pin)} style={{ padding: "9px 12px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Copy PIN</button>
                <button onClick={() => window.open(selectedCard.websiteSource || "https://www.google.com", "_blank", "noopener,noreferrer")} style={{ padding: "9px 12px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Open website</button>
                <button onClick={() => updateStatus(selectedCard.id, "Used")} style={{ padding: "9px 12px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Mark Used</button>
                <button onClick={() => deleteGiftCard(selectedCard.id)} style={{ padding: "9px 12px", borderRadius: "999px", border: "1px solid #e5e7eb", background: "#fee2e2", color: "#991b1b", cursor: "pointer" }}>Delete</button>
              </div>
              <form onSubmit={saveDetailChanges} style={{ marginTop: "12px", display: "grid", gap: "8px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px" }}>
                  <input name="merchant" defaultValue={selectedCard.merchant} placeholder="Merchant" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="brand" defaultValue={selectedCard.brand} placeholder="Brand" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="cardNumber" defaultValue={selectedCard.cardNumber} placeholder="Card number" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="pin" defaultValue={selectedCard.pin} placeholder="PIN" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="barcode" defaultValue={selectedCard.barcode} placeholder="Barcode" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="qrCode" defaultValue={selectedCard.qrCode} placeholder="QR code" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="serialNumber" defaultValue={selectedCard.serialNumber} placeholder="Serial number" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="activationCode" defaultValue={selectedCard.activationCode} placeholder="Activation code" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="balance" type="number" defaultValue={selectedCard.balance} placeholder="Balance" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="faceValue" type="number" defaultValue={selectedCard.faceValue} placeholder="Original balance" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="purchasePrice" type="number" defaultValue={selectedCard.purchasePrice} placeholder="Purchase price" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="purchaseDate" type="date" defaultValue={selectedCard.purchaseDate} style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="expirationDate" type="date" defaultValue={selectedCard.expirationDate} style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="currency" defaultValue={selectedCard.currency} placeholder="Currency" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="orderNumber" defaultValue={selectedCard.orderNumber} placeholder="Order number" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="websiteSource" defaultValue={selectedCard.websiteSource} placeholder="Website" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <input name="tags" defaultValue={(selectedCard.tags || []).join(", ")} placeholder="Tags" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} />
                  <select name="status" defaultValue={selectedCard.status} style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
                    {STATUS_ORDER.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <input name="reviewRequired" type="checkbox" defaultChecked={selectedCard.reviewRequired} />
                    Needs review
                  </label>
                </div>
                <textarea name="notes" defaultValue={selectedCard.notes} placeholder="Notes" style={{ padding: "9px 10px", borderRadius: "10px", border: "1px solid #e5e7eb", minHeight: "90px" }} />
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button type="submit" style={{ padding: "10px 14px", borderRadius: "999px", border: "none", background: "#111827", color: "#fff", cursor: "pointer" }}>Save</button>
                  <button type="button" onClick={() => setDetailCardId(null)} style={{ padding: "10px 14px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Close</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position: "fixed", bottom: "16px", right: "16px", background: "#111827", color: "#fff", padding: "10px 14px", borderRadius: "999px", zIndex: 50 }}>{toast}</div>}
    </div>
  );
}
