import { useEffect, useState } from "react";

export default function Inventory() {
  const [showForm, setShowForm] = useState(false);

  const [inventory, setInventory] = useState(() => {
    const savedInventory = localStorage.getItem("resellos-inventory");

    return savedInventory ? JSON.parse(savedInventory) : [];
  });

  const [form, setForm] = useState({
    productName: "",
    brand: "",
    size: "",
    purchasePrice: "",
    sellingPrice: "",
  });

  useEffect(() => {
    localStorage.setItem(
      "resellos-inventory",
      JSON.stringify(inventory)
    );
  }, [inventory]);

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (!form.productName.trim()) {
      alert("Please enter a product name.");
      return;
    }

    const newItem = {
      id: Date.now(),
      productName: form.productName,
      brand: form.brand,
      size: form.size,
      purchasePrice: Number(form.purchasePrice || 0),
      sellingPrice: Number(form.sellingPrice || 0),
    };

    setInventory((currentInventory) => [
      ...currentInventory,
      newItem,
    ]);

    setForm({
      productName: "",
      brand: "",
      size: "",
      purchasePrice: "",
      sellingPrice: "",
    });

    setShowForm(false);
  }

  function deleteItem(id) {
    setInventory((currentInventory) =>
      currentInventory.filter((item) => item.id !== id)
    );
  }

  const totalCost = inventory.reduce(
    (total, item) => total + item.purchasePrice,
    0
  );

  const totalValue = inventory.reduce(
    (total, item) => total + item.sellingPrice,
    0
  );

  const potentialProfit = totalValue - totalCost;

  const inputStyle = {
    width: "100%",
    padding: "12px",
    marginBottom: "12px",
    border: "1px solid #ccd2dc",
    borderRadius: "8px",
    fontSize: "16px",
  };

  return (
    <div style={{ padding: "30px", width: "100%" }}>
      <h1 style={{ marginTop: 0 }}>Inventory</h1>

      <div
        style={{
          display: "flex",
          gap: "15px",
          flexWrap: "wrap",
          marginBottom: "25px",
        }}
      >
        <div
          style={{
            background: "white",
            padding: "18px",
            borderRadius: "10px",
            minWidth: "170px",
          }}
        >
          <strong>Total Items</strong>
          <h2>{inventory.length}</h2>
        </div>

        <div
          style={{
            background: "white",
            padding: "18px",
            borderRadius: "10px",
            minWidth: "170px",
          }}
        >
          <strong>Total Cost</strong>
          <h2>${totalCost.toFixed(2)}</h2>
        </div>

        <div
          style={{
            background: "white",
            padding: "18px",
            borderRadius: "10px",
            minWidth: "170px",
          }}
        >
          <strong>Potential Profit</strong>
          <h2>${potentialProfit.toFixed(2)}</h2>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowForm((current) => !current)}
        style={{
          background: "#d62828",
          color: "white",
          border: "none",
          padding: "12px 20px",
          borderRadius: "8px",
          cursor: "pointer",
          fontSize: "16px",
          marginBottom: "20px",
        }}
      >
        {showForm ? "Close Form" : "+ Add Inventory"}
      </button>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            background: "white",
            padding: "22px",
            borderRadius: "10px",
            marginBottom: "25px",
            maxWidth: "700px",
          }}
        >
          <h2>Add Inventory</h2>

          <input
            name="productName"
            value={form.productName}
            onChange={handleChange}
            type="text"
            placeholder="Product Name"
            style={inputStyle}
          />

          <input
            name="brand"
            value={form.brand}
            onChange={handleChange}
            type="text"
            placeholder="Brand"
            style={inputStyle}
          />

          <input
            name="size"
            value={form.size}
            onChange={handleChange}
            type="text"
            placeholder="Size"
            style={inputStyle}
          />

          <input
            name="purchasePrice"
            value={form.purchasePrice}
            onChange={handleChange}
            type="number"
            step="0.01"
            placeholder="Purchase Price"
            style={inputStyle}
          />

          <input
            name="sellingPrice"
            value={form.sellingPrice}
            onChange={handleChange}
            type="number"
            step="0.01"
            placeholder="Selling Price"
            style={inputStyle}
          />

          <button
            type="submit"
            style={{
              background: "#111",
              color: "white",
              border: "none",
              padding: "12px 20px",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "16px",
            }}
          >
            Save Inventory
          </button>
        </form>
      )}

      <div
        style={{
          background: "white",
          padding: "22px",
          borderRadius: "10px",
        }}
      >
        <h2>Your Inventory</h2>

        {inventory.length === 0 ? (
          <p>No inventory added yet.</p>
        ) : (
          inventory.map((item) => (
            <div
              key={item.id}
              style={{
                borderBottom: "1px solid #e2e5ea",
                padding: "15px 0",
              }}
            >
              <h3 style={{ margin: "0 0 8px" }}>
                {item.productName}
              </h3>

              <p style={{ margin: "4px 0" }}>
                Brand: {item.brand || "Not entered"}
              </p>

              <p style={{ margin: "4px 0" }}>
                Size: {item.size || "Not entered"}
              </p>

              <p style={{ margin: "4px 0" }}>
                Purchase Price: ${item.purchasePrice.toFixed(2)}
              </p>

              <p style={{ margin: "4px 0" }}>
                Selling Price: ${item.sellingPrice.toFixed(2)}
              </p>

              <p style={{ margin: "4px 0 12px" }}>
                Potential Profit: $
                {(
                  item.sellingPrice - item.purchasePrice
                ).toFixed(2)}
              </p>

              <button
                type="button"
                onClick={() => deleteItem(item.id)}
                style={{
                  background: "#555",
                  color: "white",
                  border: "none",
                  padding: "8px 14px",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}