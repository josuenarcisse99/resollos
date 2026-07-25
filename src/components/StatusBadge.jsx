import { memo } from "react";

const STATUS_META = {
  New: { color: "#16a34a", background: "rgba(22, 163, 74, 0.14)", icon: "●", label: "New" },
  Active: { color: "#2563eb", background: "rgba(37, 99, 235, 0.14)", icon: "●", label: "Active" },
  "Needs Review": { color: "#d97706", background: "rgba(217, 119, 6, 0.14)", icon: "●", label: "Needs Review" },
  "Partially Used": { color: "#ea580c", background: "rgba(234, 88, 12, 0.14)", icon: "●", label: "Partially Used" },
  Used: { color: "#dc2626", background: "rgba(220, 38, 38, 0.14)", icon: "●", label: "Used" },
  Empty: { color: "#4b5563", background: "rgba(75, 85, 99, 0.14)", icon: "●", label: "Empty" },
  Archived: { color: "#9ca3af", background: "rgba(156, 163, 175, 0.14)", icon: "●", label: "Archived" },
};

const StatusBadge = memo(function StatusBadge({ status, compact = false }) {
  const meta = STATUS_META[status] || STATUS_META.Active;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: compact ? "4px" : "6px",
        padding: compact ? "5px 8px" : "6px 10px",
        borderRadius: "999px",
        background: meta.background,
        color: meta.color,
        fontWeight: 700,
        fontSize: compact ? "11px" : "12px",
        whiteSpace: "nowrap",
      }}
    >
      {meta.icon} {meta.label}
    </span>
  );
});

export default StatusBadge;
