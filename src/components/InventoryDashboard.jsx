import { memo } from "react";
import StatusBadge from "./StatusBadge";

const InventoryDashboard = memo(function InventoryDashboard({ theme, metrics, onNavigateToCards, onStatusFilter }) {
  const money = (value, currency = "USD") => Number(value || 0).toLocaleString("en-US", { style: "currency", currency });

  return (
    <div style={{ display: "grid", gap: "12px", marginBottom: "16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
        {[
          { label: "Inventory Value", value: money(metrics.totalFaceValue), color: "#7c3aed", filter: null },
          { label: "Inventory Cost", value: money(metrics.totalPurchaseCost), color: "#0f766e", filter: null },
          { label: "Estimated Profit", value: money(metrics.estimatedProfit), color: "#14b8a6", filter: null },
          { label: "New Cards", value: metrics.byStatus.New, color: "#16a34a", filter: "New" },
          { label: "Active Cards", value: metrics.byStatus.Active, color: "#2563eb", filter: "Active" },
          { label: "Needs Review", value: metrics.byStatus["Needs Review"], color: "#d97706", filter: "Needs Review" },
          { label: "Used Cards", value: metrics.byStatus.Used, color: "#dc2626", filter: "Used" },
          { label: "Empty Cards", value: metrics.byStatus.Empty, color: "#4b5563", filter: "Empty" },
          { label: "Archived Cards", value: metrics.byStatus.Archived, color: "#9ca3af", filter: "Archived" },
        ].map((card) => (
          <button key={card.label} onClick={() => { if (card.filter) onStatusFilter(card.filter); else onStatusFilter("All"); onNavigateToCards(); }} style={{ textAlign: "left", padding: "14px", borderRadius: "16px", border: "1px solid #e5e7eb", background: theme === "dark" ? "rgba(15,23,42,0.95)" : "#fff", color: theme === "dark" ? "#f9fafb" : "#111827", cursor: "pointer" }}>
            <div style={{ fontSize: "12px", color: card.color, fontWeight: 700 }}>{card.label}</div>
            <div style={{ fontSize: "22px", fontWeight: 800, marginTop: "6px" }}>{card.value}</div>
          </button>
        ))}
      </div>
      <div style={{ borderRadius: "18px", padding: "16px", border: "1px solid #e5e7eb", background: theme === "dark" ? "rgba(17,24,39,0.95)" : "rgba(255,255,255,0.9)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <strong>Inventory health</strong>
          <StatusBadge status={metrics.totalCards > 0 ? "Active" : "New"} compact />
        </div>
        <div style={{ color: "#6b7280", marginTop: "8px" }}>Keep review queues short and import outcomes visible without leaving the current workspace.</div>
      </div>
    </div>
  );
});

export default InventoryDashboard;
