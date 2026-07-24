function money(value) {
  return Number(value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default function ReportsPage({
  financials = {},
  expenses = [],
  receipts = [],
  inventory = [],
  giftCards = [],
  transactions = [],
  salesOrders = [],
  returns = [],
}) {
  const summaryCards = [
    { label: "Estimated Profit", value: money(financials.estimatedProfit || 0) },
    { label: "Operating Expenses", value: money(financials.businessExpenses || 0) },
    { label: "Gift Card Assets", value: money(financials.giftCardAssets || 0) },
    { label: "Inventory Assets", value: money(financials.inventoryAssets || 0) },
    { label: "Receipts", value: receipts.length },
    { label: "Transactions", value: transactions.length },
  ];

  const recentTransactions = [...transactions].slice(-6).reverse();

  return (
    <div>
      <div style={{ marginBottom: "18px" }}>
        <div style={{ fontSize: "28px", fontWeight: 800, marginBottom: "6px" }}>Reports</div>
        <div style={{ color: "#6b7280" }}>Review business performance, inventory health, and financial activity from one place.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px", marginBottom: "18px" }}>
        {summaryCards.map((card) => (
          <div key={card.label} style={{ background: "#ffffff", borderRadius: "12px", padding: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ color: "#6b7280", fontSize: "13px" }}>{card.label}</div>
            <div style={{ fontSize: "24px", fontWeight: 800, marginTop: "6px" }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: "16px" }}>
        <div style={{ background: "#ffffff", borderRadius: "12px", padding: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <div style={{ fontWeight: 800, marginBottom: "10px" }}>Snapshot</div>
          <div style={{ display: "grid", gap: "8px", color: "#4b5563" }}>
            <div>Inventory tracked: {inventory.length}</div>
            <div>Expenses logged: {expenses.length}</div>
            <div>Gift cards on hand: {giftCards.length}</div>
            <div>Sales orders: {salesOrders.length}</div>
            <div>Returns processed: {returns.length}</div>
          </div>
        </div>

        <div style={{ background: "#ffffff", borderRadius: "12px", padding: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <div style={{ fontWeight: 800, marginBottom: "10px" }}>Recent Transactions</div>
          <div style={{ display: "grid", gap: "10px" }}>
            {recentTransactions.length === 0 ? (
              <div style={{ color: "#6b7280" }}>No transactions yet.</div>
            ) : recentTransactions.map((transaction) => (
              <div key={transaction.id || transaction.createdAt || Math.random()} style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700 }}>{transaction.description || transaction.type || "Transaction"}</div>
                  <div>{money(transaction.amount || 0)}</div>
                </div>
                <div style={{ color: "#6b7280", fontSize: "13px", marginTop: "4px" }}>{transaction.date || transaction.createdAt || "—"}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
