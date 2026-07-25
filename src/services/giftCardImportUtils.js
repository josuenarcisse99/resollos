function normalizeToken(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function detectDelimiter(text = "") {
  const normalized = String(text || "");
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length <= 1) return null;

  const tabCount = lines.filter((line) => line.includes("\t")).length;
  const semicolonCount = lines.filter((line) => line.includes(";")).length;
  const commaCount = lines.filter((line) => line.includes(",")).length;

  if (tabCount > commaCount && tabCount >= semicolonCount) return "\t";
  if (semicolonCount > commaCount && semicolonCount >= tabCount) return ";";
  if (commaCount > 0) return ",";
  return null;
}

function splitDelimitedLine(line, delimiter) {
  const values = [];
  let currentValue = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(currentValue.trim());
      currentValue = "";
    } else {
      currentValue += char;
    }
  }

  values.push(currentValue.trim());
  return values;
}

function parseDelimitedRows(text = "") {
  const normalized = String(text || "");
  if (!normalized.trim()) return [];

  const delimiter = detectDelimiter(normalized);
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length <= 1) return [];

  const rows = lines.map((line) => {
    if (delimiter) {
      return splitDelimitedLine(line, delimiter);
    }
    return line.split(/\s{2,}|\t+/).filter(Boolean);
  });

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

function parseNumber(value) {
  const raw = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function detectCurrency(text = "") {
  const haystack = String(text || "").toLowerCase();
  if (haystack.includes("eur") || haystack.includes("€")) return "EUR";
  if (haystack.includes("gbp") || haystack.includes("£")) return "GBP";
  if (haystack.includes("cad") || haystack.includes("c$")) return "CAD";
  if (haystack.includes("aud") || haystack.includes("a$")) return "AUD";
  return "USD";
}

function parseReceiptDetails(text = "") {
  const rawText = String(text || "");
  const supplier = rawText.match(/supplier[:\s]+([A-Za-z0-9 &.-]+)/i)?.[1] || rawText.match(/merchant[:\s]+([A-Za-z0-9 &.-]+)/i)?.[1] || "";
  const orderNumber = rawText.match(/order(?:\s*number|\s*id)?[:#\s-]*([A-Za-z0-9-]+)/i)?.[1] || "";
  const purchaseDate = rawText.match(/(?:purchase date|purchased on|date)[:\s]*([A-Za-z0-9,\/-]+)/i)?.[1] || "";
  const invoiceNumber = rawText.match(/invoice(?:\s*number)?[:#\s-]*([A-Za-z0-9-]+)/i)?.[1] || "";
  const receiptNumber = rawText.match(/receipt(?:\s*number)?[:#\s-]*([A-Za-z0-9-]+)/i)?.[1] || "";
  const subtotal = extractAmountValue(rawText, [/subtotal[:\s$]*([0-9,.]+)/i, /sub(?:-)?total[:\s$]*([0-9,.]+)/i]);
  const totalPaid = extractAmountValue(rawText, [/total(?:\s+paid)?[:\s$]*([0-9,.]+)/i, /amount due[:\s$]*([0-9,.]+)/i, /total[:\s$]*([0-9,.]+)/i]);
  const taxes = extractAmountValue(rawText, [/tax(?:es)?[:\s$]*([0-9,.]+)/i]);
  const fees = extractAmountValue(rawText, [/fees[:\s$]*([0-9,.]+)/i, /service fee[:\s$]*([0-9,.]+)/i]);
  const shipping = extractAmountValue(rawText, [/shipping[:\s$]*([0-9,.]+)/i]);
  const paymentMethod = rawText.match(/payment(?:\s*method)?[:\s]+([A-Za-z0-9 &.-]+)/i)?.[1] || "";
  const discountMatches = [...rawText.matchAll(/discount(?:\s*(?:1|2|3|4|5))?[:\s$]*([0-9,.]+)/gi)].map((match) => Number(String(match[1]).replace(/[^0-9.]/g, "")) || 0);
  const discounts = discountMatches.length ? discountMatches : [extractAmountValue(rawText, [/discount[:\s$]*([0-9,.]+)/i])];
  const currency = detectCurrency(rawText);

  return {
    supplier,
    orderNumber,
    purchaseDate: parseDate(purchaseDate),
    invoiceNumber,
    receiptNumber,
    subtotal,
    discount1: discounts[0] || 0,
    discount2: discounts[1] || 0,
    additionalDiscounts: discounts.slice(2),
    totalPaid,
    taxes,
    fees,
    shipping,
    currency,
    paymentMethod,
    discounts,
  };
}

function extractAmountValue(text = "", patterns = []) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) {
      const raw = match[1] || match[2] || "";
      return Number(String(raw).replace(/[^0-9.]/g, "")) || 0;
    }
  }
  return 0;
}

function parseGiftCardRows(text = "") {
  const rows = parseDelimitedRows(text || "");
  const cards = rows
    .map((row) => ({
      merchant: row.merchant || row.brand || row.supplier || "Card Depot",
      brand: row.brand || row.merchant || row.supplier || "Card Depot",
      supplier: /carddepot|card depot/i.test(text) ? "CardDepot" : row.supplier || row.merchant || row.brand || "CardDepot",
      cardNumber: row.cardnumber || row.cardnumbervalue || row.cardno || row.card || "",
      pin: row.pin || row.code || row.pincode || "",
      faceValue: parseNumber(row.facevalue || row.facevaluein || row.value || row.amount || row["face value"] || 0),
      balance: parseNumber(row.balance || row.currentbalance || row.facevalue || row.facevaluein || row.value || 0) || parseNumber(row.facevalue || row.facevaluein || row.value || row.amount || 0),
      purchasePrice: parseNumber(row.purchaseprice || row.cost || row.price || row.facevalue || row.facevaluein || row.value || 0),
      purchaseDate: parseDate(row.purchasedate || row.purchasedon || row.date || ""),
      currency: detectCurrency(text),
      orderNumber: row.ordernumber || row.orderid || row.order || "",
    }))
    .filter((row) => row.cardNumber || row.pin || row.faceValue || row.merchant || row.brand);

  return {
    cards,
    unparsedRowsCount: Math.max(0, rows.length - cards.length),
  };
}

function parseOrderNotes(text = "") {
  const rawText = String(text || "");
  const website = rawText.match(/https?:\/\/[^\s]+/i)?.[0] || rawText.match(/website[:\s]+([^\n]+)/i)?.[1] || "";
  const email = rawText.match(/email[:\s]+([^\n]+)/i)?.[1] || "";
  const tracking = rawText.match(/tracking[:\s]+([^\n]+)/i)?.[1] || "";
  const internalNotes = rawText
    .split(/\n/)
    .filter((line) => line.trim())
    .filter((line) => !/website|email|tracking/i.test(line))
    .join("\n")
    .trim();
  return { website, email, tracking, internalNotes };
}

function buildFingerprint(card = {}) {
  const fields = [
    card.cardNumber,
    card.pin,
    card.barcode,
    card.qrCode,
    card.orderNumber,
    card.invoiceNumber,
    card.receipt,
    card.supplier,
    card.purchaseDate,
    card.merchant,
    card.brand,
  ];
  return fields.map((field) => normalizeText(field)).join("|");
}

function hasDuplicateSignature(candidate, existing) {
  if (!candidate || !existing) return false;
  const candidateFingerprint = buildFingerprint(candidate);
  const existingFingerprint = buildFingerprint(existing);
  if (candidateFingerprint && existingFingerprint && candidateFingerprint === existingFingerprint) return true;

  const compareFields = ["cardNumber", "pin", "barcode", "qrCode", "orderNumber", "invoiceNumber", "supplier", "purchaseDate"];
  return compareFields.some((field) => {
    const first = normalizeText(candidate[field]);
    const second = normalizeText(existing[field]);
    return Boolean(first && second && first === second);
  });
}

function analyzeImportPlan(plan = {}, existingCards = []) {
  const cards = Array.isArray(plan?.cards) ? plan.cards : [];
  const duplicates = [];
  const existingByFingerprint = new Map();

  const candidateCards = cards.map((card, index) => {
    const existingMatch = existingCards.find((entry) => hasDuplicateSignature(card, entry));
    if (existingMatch) {
      duplicates.push({
        index,
        card,
        existingCard: existingMatch,
        reasons: [
          card.cardNumber && existingMatch.cardNumber && normalizeToken(card.cardNumber) === normalizeToken(existingMatch.cardNumber) ? "full card number matches an existing card" : null,
          card.pin && existingMatch.pin && normalizeToken(card.pin) === normalizeToken(existingMatch.pin) ? "PIN matches an existing card" : null,
          card.orderNumber && existingMatch.orderNumber && normalizeToken(card.orderNumber) === normalizeToken(existingMatch.orderNumber) ? "order number matches" : null,
          card.invoiceNumber && existingMatch.invoiceNumber && normalizeToken(card.invoiceNumber) === normalizeToken(existingMatch.invoiceNumber) ? "invoice number matches" : null,
          card.receipt && existingMatch.receipt && normalizeToken(card.receipt) === normalizeToken(existingMatch.receipt) ? "receipt text matches" : null,
        ].filter(Boolean),
      });
    }
    return card;
  });

  const orderNumbers = [];
  const receiptText = String(plan?.receiptText || plan?.receiptDetails?.orderNumber || "");
  const notesText = String(plan?.orderNotes || "");
  const orderPattern = /order(?:\s*number|\s*id)?[:#\s-]*([A-Za-z0-9-]+)/gi;
  const invoicePattern = /invoice(?:\s*number)?[:#\s-]*([A-Za-z0-9-]+)/gi;
  const receiptPattern = /receipt(?:\s*number)?[:#\s-]*([A-Za-z0-9-]+)/gi;
  [...receiptText.matchAll(orderPattern)].forEach((match) => {
    if (match[1]) orderNumbers.push(match[1]);
  });
  [...receiptText.matchAll(invoicePattern)].forEach((match) => {
    if (match[1] && !orderNumbers.includes(match[1])) orderNumbers.push(match[1]);
  });
  [...receiptText.matchAll(receiptPattern)].forEach((match) => {
    if (match[1] && !orderNumbers.includes(match[1])) orderNumbers.push(match[1]);
  });
  [...notesText.matchAll(orderPattern)].forEach((match) => {
    if (match[1] && !orderNumbers.includes(match[1])) orderNumbers.push(match[1]);
  });

  const uniqueOrders = Array.from(new Set(orderNumbers.filter(Boolean)));
  const receiptCount = Math.max(1, uniqueOrders.length || 1);
  return {
    cards: candidateCards,
    duplicates,
    duplicateCount: duplicates.length,
    multipleOrdersDetected: uniqueOrders.length > 1 || receiptCount > 1,
    detectedOrders: uniqueOrders,
    receiptCount,
    unparsedRowsCount: plan?.unparsedRowsCount || 0,
    needsConfirmation: duplicates.length > 0 || uniqueOrders.length > 1 || receiptCount > 1,
  };
}

export {
  analyzeImportPlan,
  buildFingerprint,
  detectCurrency,
  hasDuplicateSignature,
  parseDelimitedRows,
  parseGiftCardRows,
  parseOrderNotes,
  parseReceiptDetails,
};

export default {
  analyzeImportPlan,
  buildFingerprint,
  detectCurrency,
  hasDuplicateSignature,
  parseDelimitedRows,
  parseGiftCardRows,
  parseOrderNotes,
  parseReceiptDetails,
};
