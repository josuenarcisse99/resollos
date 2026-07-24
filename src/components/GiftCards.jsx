import { useEffect, useMemo, useState } from "react";
import { uploadAsset } from "../services/storage";
import { calculateReminderDate, extractPurchaseMetadata, getExpirationDate, getReminderStatus, getSupplierName, maskCardNumber, maskPin, normalizeStatus, parseDate, parseNumber } from "../services/giftCardProcessing";

const STORAGE_KEY = "resellos-gift-cards";
const SUPPLIER_STORAGE_KEY = "resellos-gift-card-suppliers";
const PURCHASE_STORAGE_KEY = "resellos-gift-card-purchases";

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

function money(value) {
  return Number(value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
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

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}


function mergeSupplierProfile(existing, card) {
  const safeExisting = existing || {
    supplierName: card.supplier || "Unknown Supplier",
    website: "",
    supportEmail: "",
    purchaseHistory: [],
    totalOrders: 0,
    totalSpend: 0,
    averageDiscount: 0,
    averageSavings: 0,
    receipts: 0,
    invoices: 0,
    giftCardsPurchased: 0,
    refunds: 0,
    returns: 0,
    notes: "",
  };

  const next = {
    ...safeExisting,
    supplierName: card.supplier || safeExisting.supplierName || "Unknown Supplier",
    purchaseHistory: [...(safeExisting.purchaseHistory || []), { orderNumber: card.orderNumber || "", purchaseDate: card.purchaseDate || "", balance: Number(card.balance || 0), value: Number(card.faceValue || 0) }].slice(-12),
    totalOrders: safeExisting.totalOrders + 1,
    totalSpend: safeExisting.totalSpend + Number(card.purchasePrice || 0),
    averageDiscount: safeExisting.averageDiscount + Number(card.discount || 0),
    averageSavings: safeExisting.averageSavings + Number(card.savings || 0),
    receipts: safeExisting.receipts + (card.sourceType === "receipt" ? 1 : 0),
    invoices: safeExisting.invoices + (card.sourceType === "invoice" ? 1 : 0),
    giftCardsPurchased: safeExisting.giftCardsPurchased + 1,
    refunds: safeExisting.refunds + (normalizeStatus(card.status) === "Refunded" ? 1 : 0),
    returns: safeExisting.returns + (normalizeStatus(card.status) === "Refund Requested" ? 1 : 0),
    notes: safeExisting.notes || "",
  };

  next.averageDiscount = next.totalOrders ? next.averageDiscount / next.totalOrders : 0;
  next.averageSavings = next.totalOrders ? next.averageSavings / next.totalOrders : 0;
  return next;
}

const styles = {
  card: {
    background: "#ffffff",
    borderRadius: "12px",
    padding: "20px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
    marginBottom: "16px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "16px",
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
  muted: {
    color: "#6b7280",
  },
};

export default function GiftCards({ giftCards: controlledGiftCards, setGiftCards: setControlledGiftCards, onGiftCardPurchase, activeSection = null }) {
  const [localGiftCards, setLocalGiftCards] = useState(() => loadStored(STORAGE_KEY, []));
  const [supplierProfiles, setSupplierProfiles] = useState(() => loadStored(SUPPLIER_STORAGE_KEY, {}));
  const [purchaseCenterItems, setPurchaseCenterItems] = useState(() => loadStored(PURCHASE_STORAGE_KEY, []));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [visibleCount, setVisibleCount] = useState(10);
  const [activeTab, setActiveTab] = useState("dashboard");

  const giftCards = Array.isArray(controlledGiftCards) ? controlledGiftCards : localGiftCards;

  function commitGiftCards(valueOrUpdater) {
    if (typeof setControlledGiftCards === "function") {
      setControlledGiftCards(valueOrUpdater);
    } else {
      setLocalGiftCards(valueOrUpdater);
    }
  }

  useEffect(() => {
    saveStored(STORAGE_KEY, giftCards);
  }, [giftCards]);

  useEffect(() => {
    saveStored(SUPPLIER_STORAGE_KEY, supplierProfiles);
  }, [supplierProfiles]);

  useEffect(() => {
    saveStored(PURCHASE_STORAGE_KEY, purchaseCenterItems);
  }, [purchaseCenterItems]);

  const metrics = useMemo(() => {
    const totalFaceValue = giftCards.reduce((sum, card) => sum + Number(card.faceValue || 0), 0);
    const totalBalance = giftCards.reduce((sum, card) => sum + Number(card.balance || 0), 0);
    const totalEstimatedProfit = giftCards.reduce((sum, card) => sum + Number(card.balance || 0) - Number(card.purchasePrice || 0), 0);
    const readyToUse = giftCards.filter((card) => normalizeStatus(card.status) === "Ready to Use").length;
    const waitingVerification = giftCards.filter((card) => ["New", "Received", "Verified"].includes(normalizeStatus(card.status))).length;
    const expiringSoon = giftCards.filter((card) => {
      if (!card.expirationDate) return false;
      const expiry = new Date(card.expirationDate);
      const now = new Date();
      const days = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
      return days >= 0 && days <= 30 && normalizeStatus(card.status) !== "Refunded";
    }).length;
    const unusedCards = giftCards.filter((card) => Number(card.balance || 0) > 0 && !["Fully Used", "Refunded", "Expired"].includes(normalizeStatus(card.status))).length;
    const recentlyPurchased = giftCards.filter((card) => {
      if (!card.purchaseDate) return false;
      const purchase = new Date(card.purchaseDate);
      const now = new Date();
      const days = Math.ceil((now - purchase) / (1000 * 60 * 60 * 24));
      return days <= 7;
    }).length;

    return {
      totalCards: giftCards.length,
      totalFaceValue,
      totalBalance,
      totalEstimatedProfit,
      readyToUse,
      waitingVerification,
      expiringSoon,
      unusedCards,
      recentlyPurchased,
    };
  }, [giftCards]);

  const filteredCards = useMemo(() => {
    const searchTerm = search.toLowerCase().trim();
    return giftCards.filter((card) => {
      const haystack = [
        card.brand || card.supplier || "",
        card.supplier || "",
        card.cardNumber || "",
        card.orderNumber || "",
        card.status || "",
        card.purchaseDate || "",
        card.reminderStatus || "",
        card.balance || "",
        card.faceValue || "",
      ].join(" ").toLowerCase();
      const matchesSearch = !searchTerm || haystack.includes(searchTerm);
      const matchesFilter = filter === "All" || normalizeStatus(card.status) === filter;
      return matchesSearch && matchesFilter;
    });
  }, [giftCards, search, filter]);

  const visibleCards = filteredCards.slice(0, visibleCount);

  const reviewQueue = useMemo(() => {
    return giftCards.filter((card) => {
      const needsReview = !card.orderNumber || !card.purchaseDate || card.confidence === "low" || normalizeStatus(card.status) === "New" || normalizeStatus(card.status) === "Received";
      return needsReview && (card.sourceType || "manual");
    }).slice(0, 8);
  }, [giftCards]);

  const purchaseHistory = useMemo(() => {
    const items = [...(purchaseCenterItems.length ? purchaseCenterItems : giftCards)].slice(0, 8);
    return items.map((card) => ({
      ...card,
      displaySupplier: card.supplier || card.brand || "Unknown Supplier",
      displayStatus: normalizeStatus(card.status),
      displayAmount: Number(card.purchasePrice || card.faceValue || 0),
    }));
  }, [giftCards, purchaseCenterItems]);

  const supplierSummary = useMemo(() => Object.values(supplierProfiles).sort((a, b) => Number(b.totalSpend || 0) - Number(a.totalSpend || 0)).slice(0, 6), [supplierProfiles]);

  async function handleUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const processFiles = async () => {
      setUploading(true);
      setUploadStatus("Scanning uploads...");
      const created = [];
      const nextProfiles = { ...supplierProfiles };
      const seen = new Set(giftCards.map((card) => card.sourceKey).filter(Boolean));

      for (const file of files) {
        const sourceKey = `${file.name}-${file.size}-${file.lastModified}`;
        if (seen.has(sourceKey)) continue;
        seen.add(sourceKey);

        const asset = await uploadAsset(file, { provider: "local", path: "gift-card-uploads" });
        const isTextLike = file.type.includes("text") || [".csv", ".txt", ".eml"].some((ext) => file.name.toLowerCase().endsWith(ext));
        const rawText = isTextLike ? await file.text().catch(() => "") : "";
        const csvRows = isTextLike && file.name.toLowerCase().endsWith(".csv") ? parseCsv(rawText) : [];
        const combinedText = [rawText, csvRows.map((row) => Object.values(row).join(" ")).join(" "), file.name].filter(Boolean).join("\n");
        const metadata = extractPurchaseMetadata(file.name, combinedText);
        const supplier = getSupplierName(metadata.supplier);
        const cardValue = parseNumber(metadata.cardValue || metadata.faceValue || "");
        const purchasePrice = parseNumber(metadata.purchasePrice || cardValue);
        const faceValue = cardValue || purchasePrice || 0;
        const balance = parseNumber(metadata.cardValue || metadata.faceValue || faceValue);
        const purchaseDate = parseDate(metadata.purchaseDate || "");
        const quantity = parseNumber(metadata.quantity || "1");
        const discount = parseNumber(metadata.discount || metadata.savings || "");
        const savings = parseNumber(metadata.savings || metadata.discount || "");
        const taxes = parseNumber(metadata.taxes || "");
        const fees = parseNumber(metadata.fees || "");
        const cardNumber = metadata.cardNumber || "";
        const pin = metadata.pin || "";
        const orderNumber = metadata.orderNumber || "";
        const status = normalizeStatus(metadata.status || (balance > 0 ? "Received" : "Problem"));
        const confidence = !combinedText && !cardNumber && !purchasePrice && !cardValue ? "low" : (cardValue && purchasePrice && cardNumber ? "high" : "medium");
        const reminderDays = 30;
        const reminderDate = calculateReminderDate(purchaseDate, reminderDays);
        const expirationDate = getExpirationDate(purchaseDate);
        const reviewRequired = confidence === "low" || !purchaseDate || !supplier || !orderNumber || (!cardNumber && !faceValue);

        const cardData = {
          id: createId("gift-card"),
          brand: supplier,
          supplier,
          cardNumber,
          pin,
          faceValue,
          balance,
          purchasePrice,
          purchaseDate,
          status,
          notes: `${file.name} • ${confidence.toUpperCase()} confidence • ${reviewRequired ? "Needs review" : "Auto-reviewed"}`,
          discount,
          savings,
          taxes,
          fees,
          quantity,
          cardNumberMasked: maskCardNumber(cardNumber),
          pinMasked: maskPin(pin),
          reminderDays,
          reminderDate,
          reminderStatus: getReminderStatus({ reminderDate }),
          expirationDate,
          sourceType: file.name.toLowerCase().endsWith(".csv") ? "receipt" : file.type.includes("pdf") ? "invoice" : file.type.includes("image") ? "receipt" : "receipt",
          sourceName: file.name,
          sourceKey,
          asset,
          confidence,
          orderNumber,
          linkedOrder: orderNumber,
          linkedInventory: "",
          linkedExpenses: "",
          reviewRequired,
          accountingChain: "Cash → Gift Card Asset → Supplier Order → Inventory → Sale → Profit",
        };

        created.push(cardData);
        nextProfiles[supplier] = mergeSupplierProfile(nextProfiles[supplier], cardData);
      }

      if (created.length > 0) {
        const nextCards = [...created, ...giftCards];
        commitGiftCards(nextCards);
        setPurchaseCenterItems((current) => [...created, ...current]);
        setSupplierProfiles(nextProfiles);
        setUploadStatus(`Imported ${created.length} gift-card purchase${created.length === 1 ? "" : "s"}`);
      } else {
        setUploadStatus("No new gift card purchases were imported.");
      }

      setUploading(false);
      event.target.value = "";
    };

    processFiles();
  }

  function updateField(event) {
    const { name, value } = event.target;
    setEditForm((current) => ({ ...current, [name]: value }));
  }

  function startEdit(card) {
    setEditId(card.id);
    setEditForm({
      brand: card.brand || card.supplier || "",
      supplier: card.supplier || card.brand || "",
      cardNumber: card.cardNumber || "",
      pin: card.pin || "",
      faceValue: card.faceValue || "",
      balance: card.balance || "",
      purchasePrice: card.purchasePrice || "",
      purchaseDate: card.purchaseDate || "",
      expirationDate: card.expirationDate || "",
      status: normalizeStatus(card.status),
      reminderDays: card.reminderDays || 30,
      notes: card.notes || "",
      orderNumber: card.orderNumber || "",
      linkedOrder: card.linkedOrder || "",
      linkedReceipt: card.linkedReceipt || "",
      linkedInvoice: card.linkedInvoice || "",
      linkedInventory: card.linkedInventory || "",
      linkedExpenses: card.linkedExpenses || "",
    });
  }

  function saveEdit(event) {
    event.preventDefault();
    if (!editForm) return;

    commitGiftCards((current) =>
      current.map((card) =>
        card.id === editId
          ? {
              ...card,
              brand: editForm.brand || editForm.supplier || card.brand,
              supplier: editForm.supplier || editForm.brand || card.supplier,
              cardNumber: editForm.cardNumber,
              pin: editForm.pin,
              faceValue: Number(editForm.faceValue || 0),
              balance: Number(editForm.balance || 0),
              purchasePrice: Number(editForm.purchasePrice || 0),
              purchaseDate: editForm.purchaseDate,
              expirationDate: editForm.expirationDate,
              status: normalizeStatus(editForm.status),
              reminderDays: Number(editForm.reminderDays || 30),
              reminderDate: calculateReminderDate(editForm.purchaseDate, Number(editForm.reminderDays || 30)),
              reminderStatus: getReminderStatus({ reminderDate: calculateReminderDate(editForm.purchaseDate, Number(editForm.reminderDays || 30)) }),
              notes: editForm.notes,
              orderNumber: editForm.orderNumber,
              linkedOrder: editForm.linkedOrder,
              linkedReceipt: editForm.linkedReceipt,
              linkedInvoice: editForm.linkedInvoice,
              linkedInventory: editForm.linkedInventory,
              linkedExpenses: editForm.linkedExpenses,
              accountingChain: card.accountingChain || "Cash → Gift Card Asset → Nike Order → Inventory → Sale → Profit",
            }
          : card
      )
    );
    setEditId(null);
    setEditForm(null);
  }

  function cancelEdit() {
    setEditId(null);
    setEditForm(null);
  }

  function deleteGiftCard(id) {
    if (window.confirm("Delete this gift card entry?")) {
      commitGiftCards((current) => current.filter((card) => card.id !== id));
    }
  }

  function updateStatus(id, status) {
    commitGiftCards((current) =>
      current.map((card) => {
        if (card.id !== id) return card;
        const normalized = normalizeStatus(status);
        const nextBalance = ["Fully Used", "Refunded", "Expired"].includes(normalized) ? 0 : Number(card.balance || 0);
        const next = {
          ...card,
          status: normalized,
          balance: nextBalance,
          amountUsed: normalized === "Fully Used" ? Number(card.faceValue || 0) : Number(card.amountUsed || 0),
          remainingBalance: normalized === "Fully Used" ? 0 : Number(card.balance || 0),
          lastUsedDate: normalized === "Partially Used" || normalized === "Fully Used" ? new Date().toISOString().slice(0, 10) : card.lastUsedDate || "",
        };
        return next;
      })
    );
  }

  function submitGiftCard(event) {
    event.preventDefault();

    const form = event.target;
    const supplier = form.supplier.value.trim() || form.brand.value.trim();
    const brand = supplier || "Unknown Supplier";
    const cardNumber = form.cardNumber.value.trim();
    const pin = form.pin.value.trim();
    const faceValue = Number(form.faceValue.value || 0);
    const balance = Number(form.balance.value || faceValue);
    const purchasePrice = Number(form.purchasePrice.value || faceValue);
    const purchaseDate = form.purchaseDate.value || "";
    const expirationDate = form.expirationDate.value || getExpirationDate(purchaseDate);
    const status = normalizeStatus(form.status.value || "New");
    const selectedReminder = form.reminderDays.value || "30";
    const reminderDays = selectedReminder === "custom" ? Number(form.customReminderDays.value || 30) : Number(selectedReminder || 30);
    const reminderDate = calculateReminderDate(purchaseDate, reminderDays);
    const notes = form.notes.value.trim();

    if (!brand && !cardNumber) {
      alert("Enter a supplier or card number.");
      return;
    }

    const cardData = {
      id: createId("gift-card"),
      brand,
      supplier: brand,
      cardNumber,
      pin,
      faceValue,
      balance,
      purchasePrice,
      purchaseDate,
      expirationDate,
      status,
      notes,
      discount: Number(form.discount.value || 0),
      savings: Number(form.savings.value || 0),
      taxes: Number(form.taxes.value || 0),
      fees: Number(form.fees.value || 0),
      quantity: Number(form.quantity.value || 1),
      cardNumberMasked: maskCardNumber(cardNumber),
      pinMasked: maskPin(pin),
      reminderDays,
      reminderDate,
      reminderStatus: getReminderStatus({ reminderDate }),
      sourceType: "manual",
      sourceName: "Manual entry",
      sourceKey: `manual-${Date.now()}`,
      confidence: "high",
      orderNumber: form.orderNumber.value.trim(),
      linkedOrder: form.linkedOrder.value.trim(),
      linkedReceipt: form.linkedReceipt.value.trim(),
      linkedInvoice: form.linkedInvoice.value.trim(),
      linkedInventory: form.linkedInventory.value.trim(),
      linkedExpenses: form.linkedExpenses.value.trim(),
      accountingChain: "Cash → Gift Card Asset → Nike Order → Inventory → Sale → Profit",
    };

    if (typeof onGiftCardPurchase === "function") {
      onGiftCardPurchase(cardData);
    } else {
      commitGiftCards((current) => [cardData, ...current]);
    }

    const nextProfiles = { ...supplierProfiles };
    nextProfiles[brand] = mergeSupplierProfile(nextProfiles[brand], cardData);
    setSupplierProfiles(nextProfiles);
    setPurchaseCenterItems((current) => [cardData, ...current]);
    event.target.reset();
  }

  const section = activeSection || "main";
  const resolvedTab = section && ["dashboard","purchases","cards","suppliers","uploads","review","reports","settings"].includes(section) ? section : activeTab;
  const showPurchaseCenter = resolvedTab === "purchases" || resolvedTab === "dashboard" || resolvedTab === "uploads";
  const showSupplierProfiles = resolvedTab === "suppliers" || resolvedTab === "dashboard";
  const showReviewQueue = resolvedTab === "review" || resolvedTab === "dashboard";
  const showReports = resolvedTab === "reports" || resolvedTab === "dashboard";

  const tabOptions = [
    { id: "dashboard", label: "Dashboard" },
    { id: "purchases", label: "Purchases" },
    { id: "cards", label: "My Gift Cards" },
    { id: "suppliers", label: "Suppliers" },
    { id: "uploads", label: "Upload Receipts" },
    { id: "review", label: "Needs Review" },
    { id: "reports", label: "Reports" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ margin: 0, fontSize: "32px" }}>Gift Cards</h1>
        <p style={styles.muted}>Track gift-card purchasing, supplier profiles, reminders, and linked resale activity.</p>
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "18px" }}>
        {tabOptions.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); }}
            style={{
              ...styles.secondaryButton,
              background: resolvedTab === tab.id ? "#111111" : "#ffffff",
              color: resolvedTab === tab.id ? "#ffffff" : "#111827",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {resolvedTab === "dashboard" && (
        <div style={styles.grid}>
          <div style={styles.card}>
            <div style={{ color: "#6b7280", fontSize: "14px" }}>Cards Ready to Use</div>
            <div style={{ fontSize: "27px", fontWeight: 800, marginTop: "8px" }}>{metrics.readyToUse}</div>
          </div>
          <div style={styles.card}>
            <div style={{ color: "#6b7280", fontSize: "14px" }}>Waiting Verification</div>
            <div style={{ fontSize: "27px", fontWeight: 800, marginTop: "8px" }}>{metrics.waitingVerification}</div>
          </div>
          <div style={styles.card}>
            <div style={{ color: "#6b7280", fontSize: "14px" }}>Expiring Soon</div>
            <div style={{ fontSize: "27px", fontWeight: 800, marginTop: "8px" }}>{metrics.expiringSoon}</div>
          </div>
          <div style={styles.card}>
            <div style={{ color: "#6b7280", fontSize: "14px" }}>Unused Cards</div>
            <div style={{ fontSize: "27px", fontWeight: 800, marginTop: "8px" }}>{metrics.unusedCards}</div>
          </div>
          <div style={styles.card}>
            <div style={{ color: "#6b7280", fontSize: "14px" }}>Recently Purchased</div>
            <div style={{ fontSize: "27px", fontWeight: 800, marginTop: "8px" }}>{metrics.recentlyPurchased}</div>
          </div>
          <div style={styles.card}>
            <div style={{ color: "#6b7280", fontSize: "14px" }}>Total Gift Card Assets</div>
            <div style={{ fontSize: "27px", fontWeight: 800, marginTop: "8px" }}>{money(metrics.totalBalance)}</div>
          </div>
        </div>
      )}

      {showPurchaseCenter && (
        <div style={{ ...styles.card, marginTop: "22px" }}>
          <label style={{ ...styles.label, fontSize: "16px" }} htmlFor="card-import">📂 Upload receipts, invoices, screenshots, PDFs, or CSV files</label>
          <input id="card-import" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.csv,.txt,.eml,.doc,.docx" onChange={handleUpload} />
          {uploading && <div style={{ marginTop: "10px", color: "#dc2626" }}>Uploading and analyzing files...</div>}
          {uploadStatus && <div style={{ marginTop: "10px", color: "#6b7280" }}>{uploadStatus}</div>}
        </div>
      )}

      {showPurchaseCenter && (
        <form onSubmit={submitGiftCard} style={{ ...styles.card, marginTop: "22px" }}>
          <h2 style={{ marginTop: 0 }}>Gift Card Purchase Center</h2>
          <div style={styles.grid}>
            <div>
              <label style={styles.label}>Supplier</label>
              <input style={styles.input} name="supplier" placeholder="Card Depot" />
            </div>
            <div>
              <label style={styles.label}>Order Number</label>
              <input style={styles.input} name="orderNumber" placeholder="ORD-1021" />
            </div>
            <div>
              <label style={styles.label}>Card Number</label>
              <input style={styles.input} name="cardNumber" placeholder="1234567890123456" />
            </div>
            <div>
              <label style={styles.label}>PIN</label>
              <input style={styles.input} name="pin" placeholder="1234" />
            </div>
            <div>
              <label style={styles.label}>Card Value</label>
              <input style={styles.input} name="faceValue" type="number" step="0.01" placeholder="100" />
            </div>
            <div>
              <label style={styles.label}>Purchase Price</label>
              <input style={styles.input} name="purchasePrice" type="number" step="0.01" placeholder="90" />
            </div>
            <div>
              <label style={styles.label}>Current Balance</label>
              <input style={styles.input} name="balance" type="number" step="0.01" placeholder="100" />
            </div>
            <div>
              <label style={styles.label}>Purchase Date</label>
              <input style={styles.input} name="purchaseDate" type="date" />
            </div>
            <div>
              <label style={styles.label}>Expiration Date</label>
              <input style={styles.input} name="expirationDate" type="date" />
            </div>
            <div>
              <label style={styles.label}>Status</label>
              <select style={styles.input} name="status" defaultValue="New">
                <option value="New">New</option>
                <option value="Received">Received</option>
                <option value="Verified">Verified</option>
                <option value="Ready to Use">Ready to Use</option>
                <option value="Partially Used">Partially Used</option>
                <option value="Fully Used">Fully Used</option>
                <option value="Expired">Expired</option>
                <option value="Problem">Problem</option>
                <option value="Refund Requested">Refund Requested</option>
                <option value="Refunded">Refunded</option>
              </select>
            </div>
            <div>
              <label style={styles.label}>Reminder</label>
              <select style={styles.input} name="reminderDays" defaultValue="30">
                <option value="7">7 Days</option>
                <option value="30">30 Days</option>
                <option value="60">60 Days</option>
                <option value="90">90 Days</option>
                <option value="180">180 Days</option>
                <option value="365">365 Days</option>
                <option value="custom">Custom</option>
              </select>
              <input style={styles.input} name="customReminderDays" type="number" min="1" step="1" placeholder="Enter custom reminder days" />
            </div>
            <div>
              <label style={styles.label}>Discount</label>
              <input style={styles.input} name="discount" type="number" step="0.01" placeholder="0" />
            </div>
            <div>
              <label style={styles.label}>Savings</label>
              <input style={styles.input} name="savings" type="number" step="0.01" placeholder="0" />
            </div>
            <div>
              <label style={styles.label}>Taxes</label>
              <input style={styles.input} name="taxes" type="number" step="0.01" placeholder="0" />
            </div>
            <div>
              <label style={styles.label}>Fees</label>
              <input style={styles.input} name="fees" type="number" step="0.01" placeholder="0" />
            </div>
            <div>
              <label style={styles.label}>Quantity</label>
              <input style={styles.input} name="quantity" type="number" step="1" placeholder="1" />
            </div>
            <div>
              <label style={styles.label}>Linked Nike Order</label>
              <input style={styles.input} name="linkedOrder" placeholder="NIKE-1001" />
            </div>
            <div>
              <label style={styles.label}>Linked Receipt</label>
              <input style={styles.input} name="linkedReceipt" placeholder="RCPT-001" />
            </div>
            <div>
              <label style={styles.label}>Linked Invoice</label>
              <input style={styles.input} name="linkedInvoice" placeholder="INV-001" />
            </div>
            <div>
              <label style={styles.label}>Linked Inventory</label>
              <input style={styles.input} name="linkedInventory" placeholder="SKU-001" />
            </div>
            <div>
              <label style={styles.label}>Linked Expenses</label>
              <input style={styles.input} name="linkedExpenses" placeholder="EXP-001" />
            </div>
          </div>

          <label style={styles.label}>Notes</label>
          <input style={styles.input} name="notes" placeholder="Used for resale, verified by supplier" />

          <button type="submit" style={styles.primaryButton}>Save Gift Card</button>
        </form>
      )}

      {resolvedTab === "dashboard" && (
        <div style={{ ...styles.card, marginTop: "18px" }}>
          <h2 style={{ marginTop: 0 }}>Gift Card Dashboard</h2>
          <div style={styles.grid}>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px" }}>
              <div style={{ color: "#6b7280", fontSize: "13px" }}>Cards Ready</div>
              <div style={{ fontSize: "22px", fontWeight: 800, marginTop: "6px" }}>{metrics.readyToUse}</div>
            </div>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px" }}>
              <div style={{ color: "#6b7280", fontSize: "13px" }}>Assets</div>
              <div style={{ fontSize: "22px", fontWeight: 800, marginTop: "6px" }}>{money(metrics.totalBalance)}</div>
            </div>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px" }}>
              <div style={{ color: "#6b7280", fontSize: "13px" }}>Need Review</div>
              <div style={{ fontSize: "22px", fontWeight: 800, marginTop: "6px" }}>{reviewQueue.length}</div>
            </div>
          </div>
        </div>
      )}

      {resolvedTab === "cards" && (
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Your Gift Cards</h2>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <input
              style={{ ...styles.input, width: "260px", marginBottom: 0 }}
              placeholder="Search supplier, order, balance, status"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", margin: "14px 0" }}>
          {['All', 'New', 'Received', 'Verified', 'Ready to Use', 'Partially Used', 'Fully Used', 'Expired', 'Problem', 'Refund Requested', 'Refunded'].map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              style={{
                ...styles.secondaryButton,
                background: filter === status ? "#111111" : "#ffffff",
                color: filter === status ? "#ffffff" : "#111827",
              }}
            >
              {status}
            </button>
          ))}
        </div>

        {filteredCards.length === 0 ? (
          <p style={styles.muted}>No gift cards found.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "10px 0", borderBottom: "2px solid #e5e7eb" }}>Supplier</th>
                  <th style={{ textAlign: "left", padding: "10px 0", borderBottom: "2px solid #e5e7eb" }}>Order</th>
                  <th style={{ textAlign: "left", padding: "10px 0", borderBottom: "2px solid #e5e7eb" }}>Card</th>
                  <th style={{ textAlign: "left", padding: "10px 0", borderBottom: "2px solid #e5e7eb" }}>Value</th>
                  <th style={{ textAlign: "left", padding: "10px 0", borderBottom: "2px solid #e5e7eb" }}>Balance</th>
                  <th style={{ textAlign: "left", padding: "10px 0", borderBottom: "2px solid #e5e7eb" }}>Status</th>
                  <th style={{ textAlign: "left", padding: "10px 0", borderBottom: "2px solid #e5e7eb" }}>Reminder</th>
                  <th style={{ textAlign: "left", padding: "10px 0", borderBottom: "2px solid #e5e7eb" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleCards.map((card) => {
                  const isEditing = editId === card.id;
                  const status = normalizeStatus(card.status);
                  return (
                    <tr key={card.id}>
                      <td style={{ padding: "10px 0", borderBottom: "1px solid #e5e7eb" }}>
                        {isEditing ? (
                          <input style={styles.input} name="supplier" value={editForm?.supplier || ""} onChange={updateField} />
                        ) : (
                          <strong>{card.supplier || card.brand || "—"}</strong>
                        )}
                      </td>
                      <td style={{ padding: "10px 0", borderBottom: "1px solid #e5e7eb" }}>
                        {isEditing ? (
                          <input style={styles.input} name="orderNumber" value={editForm?.orderNumber || ""} onChange={updateField} />
                        ) : (
                          card.orderNumber || "—"
                        )}
                      </td>
                      <td style={{ padding: "10px 0", borderBottom: "1px solid #e5e7eb" }}>
                        {isEditing ? (
                          <input style={styles.input} name="cardNumber" value={editForm?.cardNumber || ""} onChange={updateField} />
                        ) : (
                          maskCardNumber(card.cardNumber)
                        )}
                      </td>
                      <td style={{ padding: "10px 0", borderBottom: "1px solid #e5e7eb" }}>
                        {isEditing ? (
                          <input style={styles.input} name="faceValue" type="number" step="0.01" value={editForm?.faceValue || ""} onChange={updateField} />
                        ) : (
                          money(card.faceValue)
                        )}
                      </td>
                      <td style={{ padding: "10px 0", borderBottom: "1px solid #e5e7eb" }}>
                        {isEditing ? (
                          <input style={styles.input} name="balance" type="number" step="0.01" value={editForm?.balance || ""} onChange={updateField} />
                        ) : (
                          money(card.balance)
                        )}
                      </td>
                      <td style={{ padding: "10px 0", borderBottom: "1px solid #e5e7eb" }}>
                        {isEditing ? (
                          <select style={styles.input} name="status" value={editForm?.status || "New"} onChange={updateField}>
                            <option value="New">New</option>
                            <option value="Received">Received</option>
                            <option value="Verified">Verified</option>
                            <option value="Ready to Use">Ready to Use</option>
                            <option value="Partially Used">Partially Used</option>
                            <option value="Fully Used">Fully Used</option>
                            <option value="Expired">Expired</option>
                            <option value="Problem">Problem</option>
                            <option value="Refund Requested">Refund Requested</option>
                            <option value="Refunded">Refunded</option>
                          </select>
                        ) : (
                          status
                        )}
                      </td>
                      <td style={{ padding: "10px 0", borderBottom: "1px solid #e5e7eb" }}>
                        {isEditing ? (
                          <input style={styles.input} name="reminderDays" type="number" value={editForm?.reminderDays || ""} onChange={updateField} />
                        ) : (
                          card.reminderStatus || "No reminder"
                        )}
                      </td>
                      <td style={{ padding: "10px 0", borderBottom: "1px solid #e5e7eb" }}>
                        {isEditing ? (
                          <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
                            <button style={styles.secondaryButton} onClick={saveEdit}>Save</button>
                            <button style={styles.secondaryButton} onClick={cancelEdit}>Cancel</button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
                            <button style={styles.secondaryButton} onClick={() => startEdit(card)}>Edit</button>
                            <button style={styles.dangerButton} onClick={() => deleteGiftCard(card.id)}>Delete</button>
                            <button style={styles.secondaryButton} onClick={() => updateStatus(card.id, "Partially Used")}>Mark Used</button>
                            <button style={styles.secondaryButton} onClick={() => updateStatus(card.id, "Ready to Use")}>Ready</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filteredCards.length > visibleCount && (
          <div style={{ marginTop: "12px" }}>
            <button style={styles.secondaryButton} onClick={() => setVisibleCount((count) => count + 10)}>Show more</button>
          </div>
        )}
      </div>
      )}

      {showReviewQueue && (
      <div style={{ ...styles.card, marginTop: "16px" }}>
        <h2 style={{ marginTop: 0 }}>Need Review Queue</h2>
        {reviewQueue.length === 0 ? (
          <div style={styles.muted}>No uploads currently need manual review.</div>
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {reviewQueue.map((card) => (
              <div key={card.id} style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800 }}>{card.supplier || card.brand || "Unknown Supplier"}</div>
                  <div style={{ color: "#6b7280", fontSize: "13px" }}>{card.orderNumber || "No order"} • {card.purchaseDate || "No date"}</div>
                </div>
                <div style={{ color: "#6b7280", fontSize: "13px", marginTop: "6px" }}>
                  Status: {normalizeStatus(card.status)} • Confidence: {card.confidence || "medium"} • Notes: {card.notes || "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {resolvedTab === "purchases" && (
      <div style={{ ...styles.card, marginTop: "16px" }}>
        <h2 style={{ marginTop: 0 }}>Purchase History</h2>
        <div style={{ display: "grid", gap: "10px" }}>
          {purchaseHistory.map((card) => (
            <div key={card.id} style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 800 }}>{card.displaySupplier}</div>
                <div style={{ color: "#6b7280", fontSize: "13px" }}>{money(card.displayAmount)} • {card.displayStatus}</div>
              </div>
              <div style={{ color: "#6b7280", fontSize: "13px", marginTop: "6px" }}>
                Order: {card.orderNumber || "—"} • Date: {card.purchaseDate || "—"} • Link: {card.linkedOrder || card.linkedReceipt || card.linkedInvoice || "—"}
              </div>
            </div>
          ))}
        </div>
      </div>
      )}

      {showSupplierProfiles && (
        <div style={{ ...styles.card, marginTop: "16px" }}>
          <h2 style={{ marginTop: 0 }}>Supplier Profiles</h2>
          <div style={{ display: "grid", gap: "10px" }}>
            {supplierSummary.length === 0 ? (
              <div style={styles.muted}>No supplier profiles yet.</div>
            ) : (
              supplierSummary.map((profile) => (
                <div key={profile.supplierName} style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800 }}>{profile.supplierName}</div>
                    <div style={{ color: "#6b7280", fontSize: "13px" }}>{profile.totalOrders} orders • {money(profile.totalSpend || 0)}</div>
                  </div>
                  <div style={{ color: "#6b7280", fontSize: "13px", marginTop: "6px" }}>
                    Website: {profile.website || "—"} • Support: {profile.supportEmail || "—"} • Avg discount: {money(profile.averageDiscount || 0)} • Avg savings: {money(profile.averageSavings || 0)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showSupplierProfiles && (
        <div style={{ ...styles.card, marginTop: "16px" }}>
          <h2 style={{ marginTop: 0 }}>Supplier Dashboard</h2>
          <div style={{ display: "grid", gap: "10px" }}>
            {supplierSummary.map((profile) => (
              <div key={profile.supplierName} style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800 }}>{profile.supplierName}</div>
                  <div style={{ color: "#6b7280", fontSize: "13px" }}>{profile.totalOrders} orders • {money(profile.totalSpend || 0)}</div>
                </div>
                <div style={{ color: "#6b7280", fontSize: "13px", marginTop: "6px" }}>
                  Website: {profile.website || "—"} • Support: {profile.supportEmail || "—"} • Avg discount: {money(profile.averageDiscount || 0)} • Avg savings: {money(profile.averageSavings || 0)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {resolvedTab === "reports" && (
        <div style={{ ...styles.card, marginTop: "16px" }}>
          <h2 style={{ marginTop: 0 }}>Gift Card Reports</h2>
          <div style={{ display: "grid", gap: "10px", color: "#4b5563" }}>
            <div>Total cards: {metrics.totalCards}</div>
            <div>Total face value: {money(metrics.totalFaceValue)}</div>
            <div>Current balance: {money(metrics.totalBalance)}</div>
            <div>Estimated profit: {money(metrics.totalEstimatedProfit)}</div>
            <div>Ready to use: {metrics.readyToUse}</div>
            <div>Need review: {reviewQueue.length}</div>
          </div>
        </div>
      )}

      {resolvedTab === "settings" && (
        <div style={{ ...styles.card, marginTop: "16px" }}>
          <h2 style={{ marginTop: 0 }}>Gift Card Settings</h2>
          <p style={styles.muted}>Reminder windows, supplier tracking, and upload-based review remain active in this unified workspace.</p>
        </div>
      )}
    </>
  );
}
