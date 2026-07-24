import test from "node:test";
import assert from "node:assert/strict";
import { extractPurchaseMetadata, getSupplierName, normalizeStatus } from "./giftCardProcessing.js";

test("normalizes common supplier names and extracts purchase metadata", () => {
  assert.equal(getSupplierName("amazon"), "Amazon");
  assert.equal(getSupplierName("card depot"), "Card Depot");
  assert.equal(getSupplierName("best buy"), "Best Buy");

  const metadata = extractPurchaseMetadata("GCX-order-1001.pdf", `Supplier: GCX\nOrder Number: 1001\nPurchase Date: 2024-05-10\nCard Value: $150\nPurchase Price: $135\nFees: $5\nTaxes: $2\nDiscount: $10\nSavings: $8\nGift Card Quantity: 3\nCard Number: 1111222233334444\nPIN: 4242\nStatus: Verified`);

  assert.equal(metadata.supplier, "GCX");
  assert.equal(metadata.orderNumber, "1001");
  assert.equal(metadata.purchaseDate, "2024-05-10");
  assert.equal(metadata.cardValue, "$150");
  assert.equal(metadata.purchasePrice, "$135");
  assert.equal(metadata.fees, "$5");
  assert.equal(metadata.taxes, "$2");
  assert.equal(metadata.discount, "$10");
  assert.equal(metadata.savings, "$8");
  assert.equal(metadata.quantity, "3");
  assert.equal(metadata.cardNumber, "1111222233334444");
  assert.equal(metadata.pin, "4242");
  assert.equal(normalizeStatus("ready to use"), "Ready to Use");
});
