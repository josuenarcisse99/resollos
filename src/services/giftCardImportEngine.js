import { getSupplierName, parseDate, parseNumber } from "./giftCardProcessing";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createHash(value) {
  const normalized = String(value ?? "").toLowerCase();
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash << 5) - hash + normalized.charCodeAt(index);
    hash |= 0;
  }
  return String(Math.abs(hash));
}

function inferCurrency(text = "", fallback = "USD") {
  const haystack = text.toLowerCase();
  if (haystack.includes("eur") || haystack.includes("€")) return "EUR";
  if (haystack.includes("gbp") || haystack.includes("£")) return "GBP";
  if (haystack.includes("cad") || haystack.includes("c$")) return "CAD";
  if (haystack.includes("aud") || haystack.includes("a$")) return "AUD";
  return fallback;
}

function extractAmount(text, patterns = []) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const raw = match[1] || match[2] || "";
      return Number(String(raw).replace(/[^0-9.]/g, "")) || 0;
    }
  }
  return 0;
}

function emptyIfNoValue(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeStatus(status, balance = 0) {
  const key = String(status || "").trim().toLowerCase();
  if (["new", "fresh", "created"].includes(key)) return "New";
  if (["active", "ready", "ready to use", "verified", "received", "available", "in stock"].includes(key)) return "Active";
  if (["needs review", "review", "uncertain", "needsreview"].includes(key)) return "Needs Review";
  if (["partially used", "partially", "partial", "partiallyused"].includes(key)) return "Partially Used";
  if (["used", "fully used", "redeemed", "consumed", "empty"].includes(key)) return balance > 0 ? "Partially Used" : "Used";
  if (["archive", "archived", "closed"].includes(key)) return "Archived";
  return "New";
}

function findMerchant(text = "") {
  const haystack = text.toLowerCase();
  const merchants = [
    ["nike", "Nike"],
    ["card depot", "Card Depot"],
    ["carddepot", "Card Depot"],
    ["raise", "Raise"],
    ["gcx", "GCX"],
    ["amazon", "Amazon"],
    ["target", "Target"],
    ["best buy", "Best Buy"],
    ["costco", "Costco"],
    ["sams club", "Sam's Club"],
    ["apple", "Apple"],
    ["ebay", "eBay"],
    ["stockx", "StockX"],
    ["goat", "GOAT"],
  ];
  const match = merchants.find(([token]) => haystack.includes(token));
  return match ? match[1] : "";
}

function findCardNumber(text = "") {
  const match = text.match(/(?:card(?:\s+number)?|gift\s+card|card no)[:#\s-]*([0-9Xx-]{4,20})/i) || text.match(/\b([0-9]{12,19})\b/);
  return match?.[1] || "";
}

function findPin(text = "") {
  const match = text.match(/(?:pin|code)[:#\s-]*([A-Za-z0-9-]{2,10})/i);
  return match?.[1] || "";
}

function findBarcode(text = "") {
  const match = text.match(/barcode[:#\s-]*([A-Za-z0-9-]{3,30})/i);
  return match?.[1] || "";
}

function findBalance(text = "") {
  return extractAmount(text, [/balance[:\s$]*([0-9,.]+)/i, /remaining[:\s$]*([0-9,.]+)/i, /current balance[:\s$]*([0-9,.]+)/i]);
}

function findOriginalBalance(text = "") {
  return extractAmount(text, [/face value[:\s$]*([0-9,.]+)/i, /original balance[:\s$]*([0-9,.]+)/i, /amount[:\s$]*([0-9,.]+)/i]);
}

function findPurchasePrice(text = "") {
  return extractAmount(text, [/purchase price[:\s$]*([0-9,.]+)/i, /cost[:\s$]*([0-9,.]+)/i, /price[:\s$]*([0-9,.]+)/i]);
}

function findDate(text = "") {
  const match = text.match(/(?:purchase date|purchased on|date)[:\s]*([A-Za-z0-9,\/-]+)/i);
  return match?.[1] || "";
}

function parseCardDepotCsv(text = "") {
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

  if (rows.length <= 1) return [];
  const headers = rows[0].map((header) => normalizeText(header).toLowerCase().replace(/[^a-z0-9]+/g, ""));

  return rows.slice(1).map((row) => {
    const values = row.slice(0, headers.length);
    const item = {};
    headers.forEach((header, headerIndex) => {
      item[header] = values[headerIndex] ? values[headerIndex].trim() : "";
    });
    return item;
  });
}

function buildCardFromImport(importPayload = {}) {
  const { type, fileName, text, asset, sourceType, origin, metadata = {}, importGroupId, reviewRequired = false } = importPayload;
  const supplier = metadata.supplier || metadata.merchant || metadata.brand || "Unspecified Supplier";
  const merchant = metadata.merchant || metadata.brand || supplier || "Unspecified Supplier";
  const faceValue = Number(metadata.faceValue || metadata.originalBalance || metadata.balance || metadata.amount || 0);
  const balance = Number(metadata.balance || metadata.currentBalance || faceValue || 0);
  const purchasePrice = Number(metadata.purchasePrice || metadata.cost || metadata.price || 0) || faceValue || 0;
  const purchaseDate = parseDate(metadata.purchaseDate || metadata.purchasedOn || "");
  const confidenceScore = Number(metadata.confidenceScore || metadata.confidence || 0.92);
  const cardNumber = metadata.cardNumber || "";
  const pin = metadata.pin || "";
    const status = normalizeStatus(metadata.status || (reviewRequired || !cardNumber ? "Needs Review" : "New"), balance);

  return {
    id: createId("gift-card"),
    merchant,
    brand: metadata.brand || merchant,
    supplier: getSupplierName(supplier),
    cardNumber,
    pin,
    barcode: metadata.barcode || "",
    qrCode: metadata.qrCode || "",
    serialNumber: metadata.serialNumber || "",
    activationCode: metadata.activationCode || "",
    faceValue: faceValue || balance,
    originalBalance: faceValue || balance,
    balance,
    currentBalance: balance,
    purchasePrice,
    purchaseDate,
    expirationDate: metadata.expirationDate || "",
    currency: metadata.currency || inferCurrency(text, "USD"),
    orderNumber: metadata.orderNumber || "",
    websiteSource: metadata.websiteSource || "",
    screenshotSource: asset?.originalUrl || "",
    confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : 0.92,
    reviewRequired: Boolean(metadata.reviewRequired || reviewRequired || confidenceScore < 0.92 || !cardNumber),
    status,
    notes: metadata.notes || `Imported from ${fileName || origin || "upload"}`,
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    merchantLogo: metadata.merchantLogo || "",
    sourceType: metadata.sourceType || type || sourceType || "upload",
    sourceName: fileName || origin || "Imported",
    sourceKey: metadata.sourceKey || createId("source"),
    createdAt: new Date().toISOString(),
    linkedOrder: metadata.linkedOrder || "",
    linkedReceipt: metadata.linkedReceipt || "",
    linkedInvoice: metadata.linkedInvoice || "",
    linkedPurchaseOrder: metadata.linkedPurchaseOrder || "",
    csvHash: metadata.csvHash || "",
    imageHash: metadata.imageHash || "",
    importGroupId: importGroupId || metadata.importGroupId || "",
    history: [{ label: "Imported", timestamp: new Date().toISOString(), detail: fileName || "Imported" }],
  };
}

export function buildReceiptPurchaseOrder(importPayload = {}) {
  const { fileName, text, asset, sourceType, metadata = {}, importGroupId } = importPayload;
  const supplier = getSupplierName(metadata.supplier || metadata.merchant || metadata.brand || "Receipt Supplier");
  const orderId = metadata.orderId || metadata.orderNumber || "";
  const invoiceNumber = metadata.invoiceNumber || "";
  const purchaseDate = parseDate(metadata.purchaseDate || metadata.purchasedOn || "");
  const totalCost = Number(metadata.totalCost || metadata.totalPaid || metadata.total || 0);
  const paymentMethod = metadata.paymentMethod || "";
  const notes = metadata.notes || `Imported receipt ${fileName || "from upload"}`;

  return {
    id: createId("purchase-order"),
    supplier,
    orderId,
    purchaseDate,
    date: purchaseDate || new Date().toISOString().slice(0, 10),
    totalCost,
    paymentMethod,
    receipt: asset?.originalUrl || "",
    receiptFile: fileName || "",
    invoice: invoiceNumber,
    notes,
    attachedGiftCards: [],
    sourceType: sourceType || "receipt",
    sourceName: fileName || "Receipt",
    sourceKey: createId("receipt"),
    createdAt: new Date().toISOString(),
    confidenceScore: Number(metadata.confidenceScore || 0.9),
    importGroupId: importGroupId || metadata.importGroupId || "",
    currency: metadata.currency || inferCurrency(text, "USD"),
  };
}

export function detectImportType(file = {}, rawText = "", sourceType = "upload") {
  const name = normalizeText(file?.name || "").toLowerCase();
  const type = normalizeText(file?.type || "").toLowerCase();
  const haystack = `${name}\n${rawText}`.toLowerCase();

  if (name.endsWith(".csv") || /carddepot|gift card export|giftcards export/i.test(haystack)) {
    return "carddepot-csv";
  }

  if (type.includes("pdf") || name.endsWith(".pdf")) {
    return "receipt-pdf";
  }

  if (type.includes("image") || /\.(png|jpe?g|webp|gif)$/i.test(name)) {
    if (/receipt|invoice|purchase|order/i.test(haystack) || /receipt/i.test(name)) {
      return "receipt-screenshot";
    }
    if (/gift|card/i.test(haystack) || /gift|card/i.test(name)) {
      return "gift-card-photo";
    }
    return sourceType === "paste" ? "clipboard-image" : "gift-card-photo";
  }

  if (sourceType === "paste") {
    return "clipboard-image";
  }

  if (sourceType === "website") {
    return "website-url";
  }

  return "gift-card-photo";
}

function parseReceiptText(text = "", fileName = "") {
  const candidate = `${fileName}\n${text}`;
  const supplier = getSupplierName(candidate.match(/supplier[:\s]+([A-Za-z0-9 &.-]+)/i)?.[1] || candidate.match(/merchant[:\s]+([A-Za-z0-9 &.-]+)/i)?.[1] || "");
  const orderId = candidate.match(/order(?:\s*number|\s*id)?[:#\s-]*([A-Za-z0-9-]+)/i)?.[1] || "";
  const invoiceNumber = candidate.match(/invoice(?:\s*number)?[:#\s-]*([A-Za-z0-9-]+)/i)?.[1] || "";
  const receiptNumber = candidate.match(/receipt(?:\s*number)?[:#\s-]*([A-Za-z0-9-]+)/i)?.[1] || "";
  const purchaseDate = candidate.match(/(?:purchase date|purchased on|date)[:\s]*([A-Za-z0-9,\/-]+)/i)?.[1] || "";
  const totalCost = extractAmount(candidate, [/total(?:\s+paid)?[:\s$]*([0-9,.]+)/i, /amount due[:\s$]*([0-9,.]+)/i, /total[:\s$]*([0-9,.]+)/i]);
  const taxes = extractAmount(candidate, [/tax(?:es)?[:\s$]*([0-9,.]+)/i]);
  const fees = extractAmount(candidate, [/fees[:\s$]*([0-9,.]+)/i, /service fee[:\s$]*([0-9,.]+)/i]);
  const discount = extractAmount(candidate, [/discount[:\s$]*([0-9,.]+)/i]);
  const paymentMethod = candidate.match(/payment method[:\s]+([A-Za-z]+)/i)?.[1] || "";
  const currency = inferCurrency(candidate, "USD");
  return {
    supplier,
    orderId,
    invoiceNumber,
    receiptNumber,
    purchaseDate,
    totalCost,
    taxes,
    fees,
    discount,
    paymentMethod,
    currency,
    confidenceScore: 0.9,
  };
}

function extractOcrValues(text = "", fileName = "") {
  const candidate = `${fileName}\n${text}`;
  const merchant = findMerchant(candidate) || candidate.match(/merchant[:\s]+([A-Za-z0-9 &.-]+)/i)?.[1] || "";
  const cardNumber = findCardNumber(candidate);
  const pin = findPin(candidate);
  const balance = findBalance(candidate);
  const originalBalance = findOriginalBalance(candidate) || balance;
  const barcode = findBarcode(candidate);
  const qrCode = /qr/i.test(candidate) ? "QR detected" : "";
  const serialNumber = candidate.match(/serial(?:\s+number)?[:#\s-]*([A-Za-z0-9-]{3,20})/i)?.[1] || "";
  const expiration = candidate.match(/expir(?:y|ation)[:#\s-]*([A-Za-z0-9,\/-]+)/i)?.[1] || "";
  const currency = inferCurrency(candidate, "USD");
  const website = candidate.match(/website[:\s]+(https?:\/\/[^\s]+)/i)?.[1] || "";
  const purchaseDate = findDate(candidate);
  const purchasePrice = findPurchasePrice(candidate) || balance;

  return {
    merchant,
    brand: merchant,
    supplier: merchant || "Unspecified Supplier",
    cardNumber,
    pin,
    balance,
    originalBalance,
    purchasePrice,
    purchaseDate,
    barcode,
    qrCode,
    serialNumber,
    expiration,
    currency,
    website,
    confidenceScore: cardNumber || pin || balance ? 0.82 : 0.2,
  };
}

function hasMeaningfulCardValues(values = {}) {
  return Boolean(values.cardNumber || values.pin || values.balance || values.originalBalance || values.merchant || values.website);
}

export function buildImportPlan(file = {}, sourceType = "upload", rawText = "", asset = null, importGroupId = "") {
  const type = detectImportType(file, rawText, sourceType);
  const text = normalizeText(rawText);
  const fileName = normalizeText(file?.name || "");
  const errors = [];
  const warnings = [];

  if (type === "carddepot-csv") {
    const rows = parseCardDepotCsv(text);
    if (!rows.length) {
      return { type, cards: [], purchaseOrder: null, confidence: 0, reviewRequired: false, errors: ["CSV malformed or empty"], warnings, sourceName: fileName, asset };
    }

    const cards = rows.map((row) => {
      const merchant = emptyIfNoValue(row.brand || row.merchant || row.supplier || "Card Depot");
      const faceValue = parseNumber(row.facevalue || row.facevaluein || row.value || row.amount || 0);
      const balance = parseNumber(row.balance || row.currentbalance || row.facevalue || row.facevaluein || 0) || faceValue;
      const purchaseDate = emptyIfNoValue(row.purchasedate || row.purchaseDate || row.date || "");
      const cardNumber = emptyIfNoValue(row.cardnumber || row.cardNumber || row.cardno || "");
      const pin = emptyIfNoValue(row.pin || row.code || "");
      return buildCardFromImport({
        type,
        fileName,
        text,
        asset,
        sourceType,
        origin: fileName,
        importGroupId,
        metadata: {
          supplier: "CardDepot",
          merchant,
          brand: merchant,
          cardNumber,
          pin,
          faceValue,
          balance,
          originalBalance: faceValue,
          currentBalance: balance,
          purchaseDate,
          purchasePrice: faceValue,
          currency: inferCurrency(text, "USD"),
          confidenceScore: 1,
          reviewRequired: false,
          sourceType: "carddepot-csv",
          sourceKey: `${fileName}-${createHash(text)}`,
          csvHash: createHash(text),
          notes: `Imported from ${fileName}`,
        },
      });
    });

    const purchaseOrder = buildReceiptPurchaseOrder({
      fileName,
      text,
      asset,
      sourceType: "carddepot-csv",
      metadata: {
        supplier: "CardDepot",
        orderId: "",
        purchaseDate: "",
        totalCost: cards.reduce((sum, card) => sum + Number(card.faceValue || 0), 0),
        currency: inferCurrency(text, "USD"),
        confidenceScore: 1,
        notes: `CardDepot import ${fileName}`,
      },
      importGroupId,
    });

    return { type, cards, purchaseOrder, confidence: 1, reviewRequired: false, errors, warnings, sourceName: fileName, asset };
  }

  if (type === "receipt-pdf" || type === "receipt-screenshot") {
    const receiptMeta = parseReceiptText(text, fileName);
    const purchaseOrder = buildReceiptPurchaseOrder({
      fileName,
      text,
      asset,
      sourceType: type,
      metadata: { ...receiptMeta, notes: `Imported receipt ${fileName}` },
      importGroupId,
    });

    if (!receiptMeta.supplier && !receiptMeta.orderId && !receiptMeta.totalCost) {
      errors.push("Receipt unreadable or no purchase details detected.");
      return { type, cards: [], purchaseOrder: null, confidence: 0, reviewRequired: false, errors, warnings, sourceName: fileName, asset };
    }

    return { type, cards: [], purchaseOrder, confidence: receiptMeta.confidenceScore, reviewRequired: false, errors, warnings, sourceName: fileName, asset };
  }

  if (type === "gift-card-photo" || type === "gift-card-screenshot" || type === "clipboard-image" || type === "receipt-screenshot") {
    const ocrValues = extractOcrValues(text, fileName);
    if (!hasMeaningfulCardValues(ocrValues)) {
      errors.push("No gift card information detected. Please upload a clearer image or use CSV.");
      return { type, cards: [], purchaseOrder: null, confidence: 0, reviewRequired: true, errors, warnings, sourceName: fileName, asset };
    }

    const card = buildCardFromImport({
      type,
      fileName,
      text,
      asset,
      sourceType,
      origin: fileName,
      importGroupId,
      metadata: {
        ...ocrValues,
        confidenceScore: ocrValues.confidenceScore,
        reviewRequired: !ocrValues.cardNumber || !ocrValues.pin,
        sourceKey: `${fileName}-${createHash(text || fileName)}`,
        imageHash: createHash(text || fileName),
        notes: `Imported from ${fileName}`,
      },
      reviewRequired: !ocrValues.cardNumber || !ocrValues.pin,
    });

    return { type, cards: [card], purchaseOrder: null, confidence: ocrValues.confidenceScore, reviewRequired: Boolean(card.reviewRequired), errors, warnings, sourceName: fileName, asset };
  }

  if (type === "website-url") {
    const websiteMeta = extractOcrValues(text, fileName);
    if (!websiteMeta.cardNumber && !websiteMeta.pin && !websiteMeta.balance && !websiteMeta.merchant) {
      errors.push("Website requires authentication or public content was not available. Please upload HTML, PDF, or a screenshot instead.");
      return { type, cards: [], purchaseOrder: null, confidence: 0, reviewRequired: true, errors, warnings, sourceName: fileName, asset };
    }

    const card = buildCardFromImport({
      type,
      fileName,
      text,
      asset,
      sourceType: "website",
      origin: fileName,
      importGroupId,
      metadata: {
        ...websiteMeta,
        sourceType: "website",
        confidenceScore: 0.78,
        reviewRequired: true,
        notes: `Imported from website ${fileName}`,
      },
      reviewRequired: true,
    });

    return { type, cards: [card], purchaseOrder: null, confidence: 0.78, reviewRequired: true, errors, warnings, sourceName: fileName, asset };
  }

  errors.push("Unsupported format");
  return { type, cards: [], purchaseOrder: null, confidence: 0, reviewRequired: false, errors, warnings, sourceName: fileName, asset };
}

export function createDuplicateFingerprint(card = {}) {
  return [card.cardNumber, card.pin, card.barcode, card.qrCode, card.orderNumber, card.csvHash, card.imageHash].filter(Boolean).join("|").toLowerCase();
}

export function mergeDuplicateCards(existingCards = [], incomingCards = []) {
  const nextCards = [...existingCards];
  incomingCards.forEach((incoming) => {
    const duplicateIndex = nextCards.findIndex((existing) => {
      const left = createDuplicateFingerprint(existing);
      const right = createDuplicateFingerprint(incoming);
      if (!left || !right) return false;
      return left === right || left.includes(incoming.cardNumber || "") || right.includes(existing.cardNumber || "");
    });

    if (duplicateIndex >= 0) {
      const merged = {
        ...nextCards[duplicateIndex],
        ...incoming,
        id: nextCards[duplicateIndex].id,
        history: [...(nextCards[duplicateIndex].history || []), ...(incoming.history || [])],
        reviewRequired: false,
        confidenceScore: Math.max(nextCards[duplicateIndex].confidenceScore || 0, incoming.confidenceScore || 0),
      };
      nextCards[duplicateIndex] = merged;
    } else {
      nextCards.push(incoming);
    }
  });

  return nextCards;
}

export function attachCardsToPurchaseOrder(cards = [], purchaseOrder = {}) {
  if (!purchaseOrder?.id) return cards;
  return cards.map((card) => ({
    ...card,
    linkedPurchaseOrder: purchaseOrder.id,
    linkedOrder: purchaseOrder.orderId || purchaseOrder.id,
    linkedReceipt: purchaseOrder.receipt || "",
    linkedInvoice: purchaseOrder.invoice || "",
  }));
}
