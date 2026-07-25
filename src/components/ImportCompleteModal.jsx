import { memo } from "react";

const ImportCompleteModal = memo(function ImportCompleteModal({ theme, importConfirmation, onViewPurchaseOrder, onViewImportedCards, onUndoImport, onClose }) {
  if (!importConfirmation) return null;

  const money = (value, currency = "USD") => Number(value || 0).toLocaleString("en-US", { style: "currency", currency });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.48)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: "16px" }} role="dialog" aria-modal="true" aria-label="Import complete">
      <div style={{ width: "100%", maxWidth: "520px", borderRadius: "20px", padding: "16px", background: theme === "dark" ? "#0f172a" : "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "28px", fontWeight: 800 }}>Import Complete</div>
          <div style={{ marginTop: "8px", color: "#6b7280" }}>✓ {importConfirmation.importedCards} Gift Cards Imported</div>
          <div style={{ marginTop: "6px", color: "#6b7280" }}>✓ {importConfirmation.purchaseOrdersCreated} Purchase Orders Created</div>
          <div style={{ marginTop: "6px", color: "#6b7280" }}>✓ {importConfirmation.duplicatesSkipped} Duplicates Skipped</div>
          <div style={{ marginTop: "8px", fontWeight: 700 }}>Total Face Value: {money(importConfirmation.totalFaceValue)}</div>
          <div style={{ marginTop: "6px", fontWeight: 700 }}>Total Paid: {money(importConfirmation.totalPaid)}</div>
          <div style={{ marginTop: "6px", fontWeight: 700 }}>Estimated Profit: {money(importConfirmation.estimatedProfit)}</div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center", marginTop: "14px" }}>
          <button type="button" onClick={onViewPurchaseOrder} style={{ padding: "10px 14px", borderRadius: "999px", border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>View Purchase Order</button>
          <button type="button" onClick={onViewImportedCards} style={{ padding: "10px 14px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>View Imported Cards</button>
          <button type="button" onClick={onUndoImport} style={{ padding: "10px 14px", borderRadius: "999px", border: "1px solid #e5e7eb", background: "#fee2e2", color: "#991b1b", cursor: "pointer" }}>Undo Import</button>
          <button type="button" onClick={onClose} style={{ padding: "10px 14px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Done</button>
        </div>
      </div>
    </div>
  );
});

export default ImportCompleteModal;
