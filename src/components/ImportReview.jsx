import { memo } from "react";
import StatusBadge from "./StatusBadge";

const ImportReview = memo(function ImportReview({
  theme,
  pendingPasteImport,
  duplicateDecisions,
  setDuplicateDecisions,
  updatePendingReviewCard,
  updatePendingReviewField,
  multipleOrderDecision,
  setMultipleOrderDecision,
  onApprove,
  onCancel,
}) {
  if (!pendingPasteImport) return null;

  const money = (value, currency = "USD") => Number(value || 0).toLocaleString("en-US", { style: "currency", currency });

  return (
    <div style={{ borderRadius: "18px", padding: "16px", border: "1px solid #e5e7eb", background: theme === "dark" ? "rgba(17,24,39,0.95)" : "rgba(255,255,255,0.95)", marginBottom: "16px", boxShadow: "0 14px 46px rgba(0,0,0,0.12)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>Import Summary</h3>
          <p style={{ margin: "6px 0 0", color: "#6b7280" }}>Review the import before accepting it into inventory.</p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button type="button" onClick={onApprove} style={{ padding: "10px 14px", borderRadius: "999px", border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>Confirm Import</button>
          <button type="button" onClick={onCancel} style={{ padding: "10px 14px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px", marginTop: "12px" }}>
        {[
          { label: "Gift Cards Found", value: pendingPasteImport.analysis.cards.length, color: "#2563eb" },
          { label: "Purchase Orders Found", value: pendingPasteImport.purchaseOrder ? 1 : 0, color: "#7c3aed" },
          { label: "Receipts Found", value: pendingPasteImport.receiptDetails?.orderNumber ? 1 : 0, color: "#0f766e" },
          { label: "Total Face Value", value: money(pendingPasteImport.purchaseOrder?.totalFaceValue || pendingPasteImport.analysis.cards.reduce((sum, card) => sum + Number(card.faceValue || 0), 0)), color: "#16a34a" },
          { label: "Subtotal", value: money(pendingPasteImport.purchaseOrder?.subtotal || pendingPasteImport.receiptDetails?.subtotal || 0), color: "#d97706" },
          { label: "Discounts", value: money(pendingPasteImport.purchaseOrder?.discounts || pendingPasteImport.receiptDetails?.discounts?.reduce?.((sum, value) => sum + Number(value || 0), 0) || 0), color: "#dc2626" },
          { label: "Taxes", value: money(pendingPasteImport.purchaseOrder?.taxes || pendingPasteImport.receiptDetails?.taxes || 0), color: "#ea580c" },
          { label: "Fees", value: money(pendingPasteImport.purchaseOrder?.fees || pendingPasteImport.receiptDetails?.fees || 0), color: "#4b5563" },
          { label: "Total Paid", value: money(pendingPasteImport.purchaseOrder?.totalCost || pendingPasteImport.receiptDetails?.totalPaid || 0), color: "#14b8a6" },
          { label: "Estimated Profit", value: money((pendingPasteImport.purchaseOrder?.totalFaceValue || 0) - (pendingPasteImport.purchaseOrder?.purchaseCost || 0)), color: "#0891b2" },
          { label: "Duplicates Found", value: pendingPasteImport.analysis.duplicateCount || 0, color: "#d97706" },
          { label: "Cards To Import", value: Math.max(0, pendingPasteImport.analysis.cards.length - (pendingPasteImport.analysis.duplicateCount || 0)), color: "#2563eb" },
        ].map((item) => (
          <div key={item.label} style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "10px", background: theme === "dark" ? "rgba(15,23,42,0.9)" : "#ffffff" }}>
            <div style={{ fontSize: "12px", color: item.color, fontWeight: 700 }}>{item.label}</div>
            <div style={{ fontSize: "18px", fontWeight: 800, marginTop: "6px" }}>{item.value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gap: "12px", marginTop: "14px" }}>
        <div style={{ display: "grid", gap: "8px" }}>
          <strong>Duplicate Explanations</strong>
          {pendingPasteImport.analysis.duplicates.length === 0 ? <div style={{ color: "#6b7280" }}>No likely duplicates detected in the incoming batch.</div> : pendingPasteImport.analysis.duplicates.map((entry) => (
            <div key={`${entry.index}-${entry.existingCard?.id || "existing"}`} style={{ border: "1px solid #fde68a", borderRadius: "12px", padding: "10px", background: "rgba(254, 240, 138, 0.16)" }}>
              <div style={{ fontWeight: 700 }}>Duplicate detected</div>
              <div style={{ color: "#6b7280", marginTop: "4px" }}>Reason:</div>
              <ul style={{ margin: "6px 0 0 18px", color: "#374151" }}>
                {entry.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
              <div style={{ marginTop: "8px" }}>
                <div><strong>Existing card</strong></div>
                <div style={{ color: "#6b7280", fontSize: "13px" }}>Status: {entry.existingCard?.status || "Active"} • Imported: {entry.existingCard?.createdAt ? new Date(entry.existingCard.createdAt).toLocaleDateString() : "—"}</div>
                <div style={{ color: "#6b7280", fontSize: "13px" }}>Supplier: {entry.existingCard?.supplier || "—"}</div>
              </div>
              <div style={{ marginTop: "8px" }}>
                <div><strong>Incoming card</strong></div>
                <div style={{ color: "#6b7280", fontSize: "13px" }}>Supplier: {entry.card?.supplier || "—"} • Order: {entry.card?.orderNumber || "—"}</div>
              </div>
              <div style={{ marginTop: "8px", fontWeight: 700 }}>Recommended action: Skip Duplicate</div>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gap: "8px" }}>
          <strong>Import Cards</strong>
          <div style={{ display: "grid", gap: "8px" }}>
            {pendingPasteImport.analysis.cards.map((card, index) => {
              const decision = duplicateDecisions[index] || "skip";
              const isDuplicate = pendingPasteImport.analysis.duplicates.some((entry) => entry.index === index);
              const draftCard = (pendingPasteImport.reviewDraft?.cards || [])[index] || {};
              return (
                <div key={`${card.id}-${index}`} style={{ border: "1px solid #e5e7eb", borderRadius: "12px", padding: "10px", background: isDuplicate ? "rgba(245, 158, 11, 0.1)" : "transparent" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <div>
                      <strong>{draftCard.merchant || card.merchant || "Unknown merchant"}</strong>
                      <div style={{ color: "#6b7280", fontSize: "13px" }}>{card.cardNumber || "No card number"}{card.pin ? ` • ${card.pin}` : ""}</div>
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {isDuplicate ? <span aria-label="Duplicate card" style={{ color: "#d97706", fontWeight: 700 }}>⚠ Duplicate</span> : <span aria-label="New card" style={{ color: "#16a34a", fontWeight: 700 }}>✓ New</span>}
                      <select value={decision} onChange={(event) => setDuplicateDecisions((current) => ({ ...current, [index]: event.target.value }))} style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} aria-label={`Decision for card ${index + 1}`}>
                        <option value="skip">Skip</option>
                        <option value="replace">Replace Existing</option>
                        <option value="merge">Merge</option>
                        <option value="create">Keep Both</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "8px", marginTop: "8px" }}>
                    <input value={draftCard.merchant || ""} onChange={(event) => updatePendingReviewCard(index, "merchant", event.target.value)} placeholder="Merchant" style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} aria-label={`Merchant for card ${index + 1}`} />
                    <input value={draftCard.balance || ""} onChange={(event) => updatePendingReviewCard(index, "balance", Number(event.target.value || 0))} type="number" placeholder="Balance" style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} aria-label={`Balance for card ${index + 1}`} />
                    <input value={draftCard.faceValue || ""} onChange={(event) => updatePendingReviewCard(index, "faceValue", Number(event.target.value || 0))} type="number" placeholder="Face value" style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} aria-label={`Face value for card ${index + 1}`} />
                    <select value={draftCard.status || "New"} onChange={(event) => updatePendingReviewCard(index, "status", event.target.value)} style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} aria-label={`Status for card ${index + 1}`}>
                      {['New', 'Active', 'Needs Review', 'Partially Used', 'Used', 'Empty', 'Archived'].map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                    <textarea value={draftCard.notes || ""} onChange={(event) => updatePendingReviewCard(index, "notes", event.target.value)} placeholder="Notes" style={{ gridColumn: "1 / -1", padding: "8px 10px", borderRadius: "10px", border: "1px solid #e5e7eb", minHeight: "70px" }} aria-label={`Notes for card ${index + 1}`} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ display: "grid", gap: "8px" }}>
          <strong>Purchase Order Details</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "8px" }}>
            <input value={pendingPasteImport.reviewDraft?.supplier || ""} onChange={(event) => updatePendingReviewField("supplier", event.target.value)} placeholder="Supplier" style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} aria-label="Supplier" />
            <input value={pendingPasteImport.reviewDraft?.purchaseDate || ""} onChange={(event) => updatePendingReviewField("purchaseDate", event.target.value)} placeholder="Purchase date" style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} aria-label="Purchase date" />
            <input value={pendingPasteImport.reviewDraft?.orderNumber || ""} onChange={(event) => updatePendingReviewField("orderNumber", event.target.value)} placeholder="Order number" style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} aria-label="Order number" />
            <input value={pendingPasteImport.reviewDraft?.invoice || ""} onChange={(event) => updatePendingReviewField("invoice", event.target.value)} placeholder="Invoice" style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} aria-label="Invoice" />
            <input value={pendingPasteImport.reviewDraft?.taxes || ""} onChange={(event) => updatePendingReviewField("taxes", Number(event.target.value || 0))} type="number" placeholder="Taxes" style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} aria-label="Taxes" />
            <input value={pendingPasteImport.reviewDraft?.discounts || ""} onChange={(event) => updatePendingReviewField("discounts", Number(event.target.value || 0))} type="number" placeholder="Discounts" style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} aria-label="Discounts" />
            <input value={pendingPasteImport.reviewDraft?.fees || ""} onChange={(event) => updatePendingReviewField("fees", Number(event.target.value || 0))} type="number" placeholder="Fees" style={{ padding: "8px 10px", borderRadius: "10px", border: "1px solid #e5e7eb" }} aria-label="Fees" />
            <textarea value={pendingPasteImport.reviewDraft?.notes || ""} onChange={(event) => updatePendingReviewField("notes", event.target.value)} placeholder="Notes" style={{ gridColumn: "1 / -1", padding: "8px 10px", borderRadius: "10px", border: "1px solid #e5e7eb", minHeight: "70px" }} aria-label="Purchase order notes" />
          </div>
        </div>
        <div style={{ display: "grid", gap: "8px" }}>
          <strong>Multiple Order Review</strong>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}><input type="radio" checked={multipleOrderDecision === "merge"} onChange={() => setMultipleOrderDecision("merge")} /> Merge</label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}><input type="radio" checked={multipleOrderDecision === "split"} onChange={() => setMultipleOrderDecision("split")} /> Split</label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}><input type="radio" checked={multipleOrderDecision === "cancel"} onChange={() => setMultipleOrderDecision("cancel")} /> Cancel</label>
          </div>
          {pendingPasteImport.analysis.multipleOrdersDetected && <div style={{ color: "#d97706" }}>Multiple order references detected: {pendingPasteImport.analysis.detectedOrders.join(", ")}</div>}
        </div>
      </div>
    </div>
  );
});

export default ImportReview;
