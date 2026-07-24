function parseNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function maskCardNumber(value) {
  if (!value) return "—";
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "—";
  if (digits.length <= 4) return `****${digits}`;
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function maskPin(value) {
  if (!value) return "—";
  return "****";
}

function getSupplierName(value) {
  if (!value) return "Unknown Supplier";
  const normalized = String(value).trim();
  if (!normalized) return "Unknown Supplier";

  const canonicalMap = {
    amazon: "Amazon",
    carddepot: "Card Depot",
    "card depot": "Card Depot",
    bestbuy: "Best Buy",
    gcx: "GCX",
    raise: "Raise",
    target: "Target",
    costco: "Costco",
    "sams club": "Sam's Club",
    "sam's club": "Sam's Club",
    nike: "Nike",
    apple: "Apple",
    ebay: "eBay",
    stockx: "StockX",
    goat: "GOAT",
  };

  const key = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return canonicalMap[key] || normalized.replace(/\s+/g, " ");
}

function detectSupplier(fileName, text) {
  const haystack = `${fileName || ""}\n${text || ""}`.toLowerCase();
  const suppliers = [
    "Card Depot",
    "Raise",
    "GCX",
    "Amazon",
    "Target",
    "Best Buy",
    "Costco",
    "Sam's Club",
    "Sams Club",
    "Nike",
    "Apple",
    "eBay",
    "StockX",
    "GOAT",
  ];
  const match = suppliers.find((supplier) => haystack.includes(supplier.toLowerCase()));
  return match || "Unknown Supplier";
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const mapping = {
    new: "New",
    received: "Received",
    verified: "Verified",
    ready: "Ready to Use",
    readytouse: "Ready to Use",
    "ready to use": "Ready to Use",
    partiallyused: "Partially Used",
    partially: "Partially Used",
    used: "Partially Used",
    fullyused: "Fully Used",
    fullused: "Fully Used",
    empty: "Fully Used",
    sold: "Fully Used",
    expired: "Expired",
    problem: "Problem",
    refundrequested: "Refund Requested",
    refund: "Refunded",
    refunded: "Refunded",
    pending: "Verified",
  };
  return mapping[normalized] || value || "New";
}

function parseDate(value) {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function getExpirationDate(purchaseDate) {
  if (!purchaseDate) return "";
  const base = new Date(purchaseDate);
  if (Number.isNaN(base.getTime())) return "";
  base.setFullYear(base.getFullYear() + 1);
  return base.toISOString().slice(0, 10);
}

function calculateReminderDate(purchaseDate, reminderDays) {
  if (!purchaseDate) return "";
  const base = new Date(purchaseDate);
  if (Number.isNaN(base.getTime())) return "";
  base.setDate(base.getDate() + Number(reminderDays || 0));
  return base.toISOString().slice(0, 10);
}

function getReminderStatus(card) {
  if (!card?.reminderDate) return "No reminder";
  const now = new Date();
  const reminderDate = new Date(card.reminderDate);
  const diffDays = Math.ceil((reminderDate - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "Overdue";
  if (diffDays <= 7) return "Due soon";
  return `In ${diffDays} days`;
}

function extractPurchaseMetadata(fileName, text = "") {
  const haystack = `${fileName || ""}\n${text || ""}`;
  const supplier = detectSupplier(fileName, text);
  const orderNumber = haystack.match(/(?:order(?:\s*number)?|confirmation|invoice)[:#\s-]*([A-Za-z0-9]+)/i)?.[1] || "";
  const purchaseDate = haystack.match(/(?:purchase date|ordered on|date|purchased)[:\s]*([A-Za-z0-9,\/-]+)/i)?.[1] || "";
  const faceValueMatch = haystack.match(/(?:card value|face value|amount|total)[:\s]*(\$?)([0-9,\.]+)/i);
  const faceValue = faceValueMatch ? `${faceValueMatch[1] || ""}${faceValueMatch[2] || ""}` : "";
  const cardValueMatch = haystack.match(/(?:card value|value)[:\s]*(\$?)([0-9,\.]+)/i);
  const cardValue = cardValueMatch ? `${cardValueMatch[1] || ""}${cardValueMatch[2] || ""}` : faceValue;
  const purchasePriceMatch = haystack.match(/(?:purchase price|paid|cost)[:\s]*(\$?)([0-9,\.]+)/i);
  const purchasePrice = purchasePriceMatch ? `${purchasePriceMatch[1] || ""}${purchasePriceMatch[2] || ""}` : "";
  const savingsMatch = haystack.match(/(?:savings)[:\s]*(\$?)([0-9,\.]+)/i);
  const discountMatch = haystack.match(/(?:discount)[:\s]*(\$?)([0-9,\.]+)/i);
  const discount = discountMatch ? `${discountMatch[1] || ""}${discountMatch[2] || ""}` : "";
  const savings = savingsMatch ? `${savingsMatch[1] || ""}${savingsMatch[2] || ""}` : discount;
  const taxesMatch = haystack.match(/(?:tax|taxes)[:\s]*(\$?)([0-9,\.]+)/i);
  const taxes = taxesMatch ? `${taxesMatch[1] || ""}${taxesMatch[2] || ""}` : "";
  const feesMatch = haystack.match(/(?:fee|fees|service fee)[:\s]*(\$?)([0-9,\.]+)/i);
  const fees = feesMatch ? `${feesMatch[1] || ""}${feesMatch[2] || ""}` : "";
  const quantity = haystack.match(/(?:quantity|qty)[:\s]*([0-9]+)/i)?.[1] || "1";
  const cardNumber = haystack.match(/\b(?:card number|gift card number|card)[:\s]*([0-9Xx\-]{4,20})/i)?.[1] || haystack.match(/\b([0-9]{12,19})\b/)?.[1] || "";
  const pin = haystack.match(/(?:pin|code)[:\s]*([A-Za-z0-9\-]{2,10})/i)?.[1] || "";
  const status = /refunded|refund/i.test(haystack) ? "Refunded" : /expired/i.test(haystack) ? "Expired" : /problem/i.test(haystack) ? "Problem" : /verified/i.test(haystack) ? "Verified" : /ready to use|ready/i.test(haystack) ? "Ready to Use" : "Received";

  return {
    supplier: getSupplierName(supplier),
    orderNumber,
    purchaseDate,
    cardValue: cardValue || faceValue,
    purchasePrice,
    discount,
    savings,
    taxes,
    fees,
    quantity,
    cardNumber,
    pin,
    status,
  };
}

export {
  parseNumber,
  maskCardNumber,
  maskPin,
  getSupplierName,
  detectSupplier,
  normalizeStatus,
  parseDate,
  getExpirationDate,
  calculateReminderDate,
  getReminderStatus,
  extractPurchaseMetadata,
};

export default {
  parseNumber,
  maskCardNumber,
  maskPin,
  getSupplierName,
  detectSupplier,
  normalizeStatus,
  parseDate,
  getExpirationDate,
  calculateReminderDate,
  getReminderStatus,
  extractPurchaseMetadata,
};
