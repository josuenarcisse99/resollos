import { memo } from "react";

const ImportWizard = memo(function ImportWizard({
  theme,
  wizardStep,
  setWizardStep,
  giftCardPasteText,
  setGiftCardPasteText,
  receiptPasteText,
  setReceiptPasteText,
  orderNotesText,
  setOrderNotesText,
  onReview,
  onCancel,
}) {
  return (
    <div style={{ borderRadius: "18px", padding: "16px", border: "1px solid #e5e7eb", background: theme === "dark" ? "rgba(17,24,39,0.95)" : "rgba(255,255,255,0.9)", marginBottom: "16px", boxShadow: "0 14px 46px rgba(0,0,0,0.12)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>Import Wizard</h3>
          <p style={{ margin: "6px 0 0", color: "#6b7280" }}>Copy, paste, review, and confirm your import in a single flow.</p>
        </div>
        <span style={{ color: "#6b7280", fontSize: "13px" }}>Copy • Paste • Review • Confirm</span>
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
        {[1, 2, 3, 4].map((step) => (
          <div key={step} style={{ padding: "8px 12px", borderRadius: "999px", background: wizardStep === step ? "#2563eb" : "#e5e7eb", color: wizardStep === step ? "#fff" : "#111827", fontWeight: 700 }}>
            Step {step}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gap: "12px", marginTop: "12px" }}>
        {wizardStep === 1 && (
          <div style={{ display: "grid", gap: "10px" }}>
            <label style={{ fontWeight: 700 }}>Paste gift cards or CSV data</label>
            <textarea value={giftCardPasteText} onChange={(event) => setGiftCardPasteText(event.target.value)} placeholder={'Brand,"Face Value, in $","Card Number",PIN\nNike,$60,6060101982350833707,452767\nNike,$60,6060102232350833644,028652'} style={{ minHeight: "190px", padding: "12px", borderRadius: "12px", border: "1px solid #e5e7eb", fontFamily: "monospace" }} aria-label="Paste gift card data" />
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setWizardStep(2)} style={{ padding: "10px 14px", borderRadius: "999px", border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>Next: Receipt</button>
            </div>
          </div>
        )}
        {wizardStep === 2 && (
          <div style={{ display: "grid", gap: "10px" }}>
            <label style={{ fontWeight: 700 }}>Paste receipt text</label>
            <textarea value={receiptPasteText} onChange={(event) => setReceiptPasteText(event.target.value)} placeholder="Supplier: CardDepot\nOrder Number: CD-1001\nPurchase Date: 2026-07-01\nInvoice: INV-1001\nSubtotal: $180\nTaxes: $12\nFees: $3\nDiscount: $5\nTotal Paid: $190\nCurrency: USD" style={{ minHeight: "180px", padding: "12px", borderRadius: "12px", border: "1px solid #e5e7eb", fontFamily: "monospace" }} aria-label="Paste receipt text" />
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setWizardStep(1)} style={{ padding: "10px 14px", borderRadius: "999px", border: "1px solid #d1d5db", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Back</button>
              <button type="button" onClick={() => setWizardStep(3)} style={{ padding: "10px 14px", borderRadius: "999px", border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>Next: Notes</button>
            </div>
          </div>
        )}
        {wizardStep === 3 && (
          <div style={{ display: "grid", gap: "10px" }}>
            <label style={{ fontWeight: 700 }}>Paste additional order details or notes</label>
            <textarea value={orderNotesText} onChange={(event) => setOrderNotesText(event.target.value)} placeholder="Website: https://example.com\nEmail: buyer@example.com\nTracking: 1Z999\nConfirmation: ABC123\nInternal Notes: Priority order" style={{ minHeight: "150px", padding: "12px", borderRadius: "12px", border: "1px solid #e5e7eb", fontFamily: "monospace" }} aria-label="Paste order notes" />
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setWizardStep(2)} style={{ padding: "10px 14px", borderRadius: "999px", border: "1px solid #d1d5db", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Back</button>
              <button type="button" onClick={() => { setWizardStep(4); onReview(); }} style={{ padding: "10px 14px", borderRadius: "999px", border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>Review & Confirm</button>
            </div>
          </div>
        )}
        {wizardStep === 4 && (
          <div style={{ display: "grid", gap: "10px" }}>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setWizardStep(3)} style={{ padding: "10px 14px", borderRadius: "999px", border: "1px solid #d1d5db", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Back</button>
              <button type="button" onClick={() => { setWizardStep(4); onReview(); }} style={{ padding: "10px 14px", borderRadius: "999px", border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>Review & Confirm</button>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button type="button" onClick={onCancel} style={{ padding: "10px 14px", borderRadius: "999px", border: "1px solid #d1d5db", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default ImportWizard;
