import { memo } from "react";
import StatusBadge from "./StatusBadge";

const GiftCardTable = memo(function GiftCardTable({ theme, cards, onOpenDetail, onRevealSensitive, revealedCardIds, onReview, onToggleSelection, selectedCardIds }) {
  const money = (value, currency = "USD") => Number(value || 0).toLocaleString("en-US", { style: "currency", currency });

  return (
    <div style={{ display: "grid", gap: "10px", marginTop: "12px" }}>
      {cards.map((card) => {
        const isSelected = selectedCardIds.includes(card.id);
        return (
          <div key={card.id} onClick={() => onOpenDetail(card)} style={{ border: isSelected ? "2px solid #2563eb" : "1px solid #e5e7eb", borderRadius: "14px", padding: "12px", background: theme === "dark" ? "rgba(15,23,42,0.9)" : "#ffffff", cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input type="checkbox" checked={isSelected} onChange={() => onToggleSelection(card.id)} onClick={(event) => event.stopPropagation()} aria-label={`Select ${card.merchant}`} />
                <strong>{card.merchant}</strong>
              </div>
              <StatusBadge status={card.status} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px", marginTop: "8px" }}>
              <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Card</div><div>{card.cardNumber ? (revealedCardIds.includes(card.id) ? card.cardNumber : card.cardNumberMasked) : "—"}</div></div>
              <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Balance</div><div>{money(card.balance || 0, card.currency)}</div></div>
              <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Purchase</div><div>{money(card.purchasePrice || 0, card.currency)}</div></div>
              <div><div style={{ fontSize: "12px", color: "#6b7280" }}>Source</div><div>{card.sourceName}</div></div>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
              <button type="button" onClick={(event) => { event.stopPropagation(); onRevealSensitive(card.id); }} style={{ padding: "8px 10px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>{revealedCardIds.includes(card.id) ? "Hide" : "Reveal"}</button>
              <button type="button" onClick={(event) => { event.stopPropagation(); onReview(card.id); }} style={{ padding: "8px 10px", borderRadius: "999px", border: "1px solid #e5e7eb", background: theme === "dark" ? "#111827" : "#ffffff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>Review</button>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
              {(card.tags || []).slice(0, 3).map((tag) => <span key={tag} style={{ background: "rgba(37,99,235,0.08)", color: "#2563eb", padding: "4px 8px", borderRadius: "999px", fontSize: "12px" }}>{tag}</span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
});

export default GiftCardTable;
