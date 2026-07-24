export default function Receipts() {
  return (
    <div style={{ padding: "30px" }}>
      <h2>Receipt Inbox</h2>

      <p>
        Upload receipts here. Soon, ReSellOS will automatically:
      </p>

      <ul>
        <li>📄 Read the receipt</li>
        <li>📦 Detect inventory purchases</li>
        <li>👤 Detect customer orders</li>
        <li>💰 Detect business expenses</li>
        <li>📊 Calculate taxes and totals</li>
        <li>🤖 Let you approve each item before saving</li>
      </ul>

      <div
        style={{
          marginTop: "25px",
          padding: "50px",
          border: "2px dashed #999",
          borderRadius: "10px",
          textAlign: "center",
          background: "#fafafa",
        }}
      >
        <h3>📤 Drag & Drop Receipt Here</h3>

        <p>or</p>

        <input type="file" />
      </div>
    </div>
  );
}