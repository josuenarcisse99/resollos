import { memo } from "react";

const PurchaseOrderSummary = memo(function PurchaseOrderSummary({ theme, purchaseCenterItems, selectedPurchaseOrderId, onSelectPurchaseOrder, normalizedGiftCards }) {
  const money = (value, currency = "USD") => Number(value || 0).toLocaleString("en-US", { style: "currency", currency });

  return (
    <div style={{ borderRadius: "18px", padding: "16px", border: "1px solid #e5e7eb", background: theme === "dark" ? "rgba(17,24,39,0.95)" : "rgba(255,255,255,0.9)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>Purchase Orders</h3>
          <p style={{ margin: "6px 0 0", color: "#6b7280" }}>Review purchase orders, receipts, and their linked gift cards.</p>
        </div>
      </div>
      <div style={{ display: "grid", gap: "10px", marginTop: "12px" }}>
        {purchaseCenterItems.length === 0 && <div style={{ color: "#6b7280" }}>No purchase orders yet.</div>}
        {purchaseCenterItems.map((order) => {
          const linkedCards = normalizedGiftCards.filter((card) => card.linkedPurchaseOrder === order.id || card.purchaseOrderId === order.id || (card.linkedOrder || "") === (order.orderId || ""));
          const isSelected = selectedPurchaseOrderId === order.id;
          return (
            <div key={order.id} onClick={() => onSelectPurchaseOrder(order.id)} style={{ border: isSelected ? "2px solid #2563eb" : "1px solid #e5e7eb", borderRadius: "14px", padding: "12px", background: theme === "dark" ? "rgba(15,23,42,0.9)" : "#ffffff", cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <strong>{order.supplier || "Purchase Order"}</strong>
                <span style={{ color: "#6b7280", fontSize: "13px" }}>{order.orderId || "No order number"}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px", marginTop: "8px" }}>
                <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Purchase date</div><div>{order.purchaseDate || order.date || "—"}</div></div>
                <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Total paid</div><div>{money(order.totalCost || 0, order.currency || "USD")}</div></div>
                <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Cards</div><div>{linkedCards.length}</div></div>
                <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Invoice</div><div>{order.invoice || "—"}</div></div>
              </div>
              {isSelected && (
                <div style={{ marginTop: "10px", borderTop: "1px solid #e5e7eb", paddingTop: "10px" }}>
                  <div style={{ display: "grid", gap: "8px" }}>
                    <div><strong>Receipt</strong><div style={{ whiteSpace: "pre-wrap", marginTop: "4px", color: "#6b7280", fontSize: "13px" }}>{order.receipt || "No receipt text available."}</div></div>
                    <div><strong>Taxes / Fees / Discounts</strong><div style={{ marginTop: "4px", color: "#6b7280", fontSize: "13px" }}>{money(order.taxes || 0, order.currency || "USD")} taxes • {money(order.fees || 0, order.currency || "USD")} fees • {money(order.discounts || 0, order.currency || "USD")} discounts</div></div>
                    <div><strong>Linked gift cards</strong><div style={{ marginTop: "4px", display: "grid", gap: "6px" }}>{linkedCards.length === 0 ? <div style={{ color: "#6b7280" }}>No linked gift cards.</div> : linkedCards.map((card) => <div key={card.id} style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "8px" }}>{card.merchant} • {card.cardNumberMasked || card.cardNumber || "—"}</div>)}</div></div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default PurchaseOrderSummary;
