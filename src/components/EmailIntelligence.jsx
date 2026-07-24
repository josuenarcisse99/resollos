import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEYS = {
  accounts: "resellos-email-intelligence-accounts",
  emails: "resellos-email-intelligence-emails",
  merchants: "resellos-email-intelligence-merchants",
};

const CATEGORY_LABELS = {
  purchaseReceipt: "Purchase Receipt",
  orderConfirmation: "Order Confirmation",
  shippingConfirmation: "Shipping Confirmation",
  deliveryConfirmation: "Delivery Confirmation",
  return: "Return",
  refund: "Refund",
  giftCardPurchase: "Gift Card Purchase",
  invoice: "Invoice",
  packingSlip: "Packing Slip",
  paymentConfirmation: "Payment Confirmation",
  subscription: "Subscription",
};

const CATEGORY_TARGETS = {
  purchaseReceipt: "receipts",
  orderConfirmation: "sales",
  shippingConfirmation: "sales",
  deliveryConfirmation: "sales",
  return: "returns",
  refund: "financials",
  giftCardPurchase: "gift-cards",
  invoice: "expenses",
  packingSlip: "inventory",
  paymentConfirmation: "financials",
  subscription: "expenses",
};

const KNOWLEDGE_BASE = [
  "Nike",
  "Card Depot",
  "Amazon",
  "eBay",
  "StockX",
  "GOAT",
  "UPS",
  "FedEx",
  "USPS",
];

const noop = () => {};

function readStorage(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage write failures
  }
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function safeParseNumber(value) {
  const numeric = Number(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function extractPayloadBody(payload) {
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (node.body && typeof node.body.data === "string") {
      parts.push(atob(node.body.data.replace(/-/g, "+").replace(/_/g, "/")));
    }
    if (Array.isArray(node.parts)) {
      node.parts.forEach(walk);
    }
  };
  walk(payload);
  return parts.join("\n");
}

function deriveCategory(subject, body) {
  const haystack = `${subject}\n${body}`.toLowerCase();
  if (/gift card|giftcard/.test(haystack)) return "giftCardPurchase";
  if (/invoice|bill/.test(haystack)) return "invoice";
  if (/packing slip|packing-slip/.test(haystack)) return "packingSlip";
  if (/refund|returned|return/.test(haystack)) return "return";
  if (/shipping|shipped|tracking/.test(haystack)) return "shippingConfirmation";
  if (/delivered|delivery/.test(haystack)) return "deliveryConfirmation";
  if (/order confirmation|order confirmed|your order/.test(haystack)) return "orderConfirmation";
  if (/receipt|purchased/.test(haystack)) return "purchaseReceipt";
  if (/payment confirmed|payment received/.test(haystack)) return "paymentConfirmation";
  if (/subscription|renewal/.test(haystack)) return "subscription";
  return "purchaseReceipt";
}

function deriveMerchant(fromAddress, subject, body) {
  const haystack = `${fromAddress}\n${subject}\n${body}`.toLowerCase();
  const matched = KNOWLEDGE_BASE.find((merchant) => haystack.includes(merchant.toLowerCase()));
  if (matched) return matched;
  const domain = (fromAddress || "").split("@")[1] || "";
  return domain ? domain.replace(/\..*$/, "").replace(/-/g, " ").replace(/^./, (char) => char.toUpperCase()) : "Unknown Merchant";
}

function extractBits(subject, body, merchant) {
  const source = `${subject}\n${body}`;
  const orderNumber = source.match(/(order\s*#?|order\s*number)[:#\s]*([A-Za-z0-9-]+)/i)?.[2] || "";
  const trackingNumber = source.match(/(tracking\s*(number|no)?|tracking)[:#\s]*([A-Za-z0-9-]+)/i)?.[3] || "";
  const sku = source.match(/(sku|style|style code)[:#\s]*([A-Za-z0-9-]+)/i)?.[2] || "";
  const styleCode = source.match(/(style code|style)[:#\s]*([A-Za-z0-9-]+)/i)?.[2] || "";
  const taxMatch = source.match(/tax(?:es)?[:\s]*\$?([0-9,\.]+)/i)?.[1] || "";
  const shippingMatch = source.match(/shipping[:\s]*\$?([0-9,\.]+)/i)?.[1] || "";
  const totalMatch = source.match(/total[:\s]*\$?([0-9,\.]+)/i)?.[1] || source.match(/\$([0-9,\.]+)/)?.[1] || "";
  const paymentMethod = source.match(/(visa|mastercard|paypal|american express|amex|apple pay|klarna|gift card)/i)?.[0] || "";
  const dateMatch = source.match(/(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|[A-Z][a-z]{2,9} \d{1,2}, \d{4})/);
  const items = Array.from(source.matchAll(/([A-Za-z0-9][A-Za-z0-9\s\-]{2,40})/g))
    .map((match) => match[1].trim())
    .filter((entry) => entry.length > 3)
    .slice(0, 4);

  return {
    merchant,
    orderNumber,
    trackingNumber,
    items: items.filter((item) => !item.toLowerCase().includes("order") && !item.toLowerCase().includes("tracking")),
    sku: sku || styleCode,
    styleCode: styleCode || sku,
    taxes: taxMatch || "",
    shipping: shippingMatch || "",
    totals: totalMatch || "",
    paymentMethod,
    date: dateMatch ? dateMatch[0] : "",
    merchantInfo: merchant,
  };
}

function buildEmailRecord(account, message, body, subject, headers) {
  const category = deriveCategory(subject, body);
  const merchant = deriveMerchant(headers.from || "", subject, body);
  const bits = extractBits(subject, body, merchant);
  const suggestedTarget = CATEGORY_TARGETS[category] || "needs-review";

  return {
    id: message.id,
    accountEmail: account.email,
    accountName: account.accountName || account.email,
    merchant,
    category,
    categoryLabel: CATEGORY_LABELS[category] || "Purchase",
    subject: subject || "No subject",
    from: headers.from || "",
    body: body.slice(0, 800),
    orderNumber: bits.orderNumber,
    trackingNumber: bits.trackingNumber,
    itemsPurchased: bits.items,
    sku: bits.sku,
    styleCode: bits.styleCode,
    taxes: bits.taxes,
    shipping: bits.shipping,
    totals: bits.totals,
    paymentMethod: bits.paymentMethod,
    date: bits.date,
    merchantInfo: bits.merchantInfo,
    suggestedTarget,
    confidence: suggestedTarget === "needs-review" ? "medium" : "high",
    receivedAt: headers.date ? new Date(Number(headers.date)).toISOString() : new Date().toISOString(),
    status: "ready",
    createdAt: new Date().toISOString(),
  };
}

function mergeMerchantProfile(existing, record) {
  const merchantName = record.merchant || "Unknown Merchant";
  const safeExisting = existing || {
    merchantName,
    website: "",
    supportEmail: "",
    numberOfOrders: 0,
    firstPurchase: "",
    lastPurchase: "",
    lifetimeSpend: 0,
    orderHistory: [],
    receipts: 0,
    returns: 0,
    refunds: 0,
    favoriteCategories: [],
  };

  const next = {
    ...safeExisting,
    merchantName,
    website: safeExisting.website || "",
    supportEmail: safeExisting.supportEmail || "",
    numberOfOrders: safeExisting.numberOfOrders + 1,
    firstPurchase: safeExisting.firstPurchase || record.receivedAt,
    lastPurchase: record.receivedAt,
    lifetimeSpend: safeExisting.lifetimeSpend + safeParseNumber(record.totals),
    orderHistory: [record, ...(safeExisting.orderHistory || []).slice(0, 9)],
    receipts: safeExisting.receipts + (record.category === "purchaseReceipt" || record.category === "orderConfirmation" ? 1 : 0),
    returns: safeExisting.returns + (record.category === "return" ? 1 : 0),
    refunds: safeExisting.refunds + (record.category === "refund" ? 1 : 0),
    favoriteCategories: Array.from(new Set([...(safeExisting.favoriteCategories || []), record.categoryLabel]))
      .slice(0, 6),
  };

  return next;
}

export default function EmailIntelligence({ activeSection = null }) {
  const [accounts, setAccounts] = useState(() => readStorage(STORAGE_KEYS.accounts, []));
  const [emailItems, setEmailItems] = useState(() => readStorage(STORAGE_KEYS.emails, []));
  const [merchantProfiles, setMerchantProfiles] = useState(() => readStorage(STORAGE_KEYS.merchants, {}));
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState("all");
  const [isConnecting, setIsConnecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Ready to sync");
  const [lastError, setLastError] = useState("");
  const [oauthReady, setOauthReady] = useState(false);
  const [clientIdMissing, setClientIdMissing] = useState(!import.meta.env.VITE_GOOGLE_CLIENT_ID);

  const persistState = useCallback((nextAccounts, nextEmails, nextMerchants) => {
    writeStorage(STORAGE_KEYS.accounts, nextAccounts);
    writeStorage(STORAGE_KEYS.emails, nextEmails);
    writeStorage(STORAGE_KEYS.merchants, nextMerchants);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setOauthReady(true);
    document.body.appendChild(script);

    const apiScript = document.createElement("script");
    apiScript.src = "https://apis.google.com/js/api.js";
    apiScript.async = true;
    apiScript.defer = true;
    apiScript.onload = () => {
      if (window.gapi) {
        window.gapi.load("client", () => {
          window.gapi.client.load("https://gmail.googleapis.com/$discovery/rest?version=v1").then(() => setOauthReady(true));
        });
      }
    };
    document.body.appendChild(apiScript);

    return () => {
      script.remove();
      apiScript.remove();
    };
  }, []);

  const connectedAccounts = useMemo(() => accounts.filter((account) => account.connected), [accounts]);

  const filteredEmails = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return emailItems.filter((item) => {
      if (filter !== "all" && item.category !== filter) return false;
      if (!term) return true;
      const haystack = [item.merchant, item.subject, item.orderNumber, item.trackingNumber, item.sku, item.styleCode, item.accountEmail, item.categoryLabel, item.body].join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [emailItems, filter, searchTerm]);

  const dashboardMetrics = useMemo(() => {
    const newReceipts = emailItems.filter((item) => item.category === "purchaseReceipt").length;
    const needsReview = emailItems.filter((item) => item.suggestedTarget === "needs-review").length;
    const recentOrders = emailItems.filter((item) => item.category === "orderConfirmation").length;
    const recentRefunds = emailItems.filter((item) => item.category === "refund" || item.category === "return").length;
    return {
      newReceipts,
      needsReview,
      recentOrders,
      recentRefunds,
      merchantActivity: Object.keys(merchantProfiles).length,
      connectedAccounts: connectedAccounts.length,
    };
  }, [connectedAccounts.length, emailItems, merchantProfiles]);

  const syncAccount = useCallback(async (account, accessTokenOverride) => {
    if (!window.gapi?.client?.gmail?.users?.messages) return;
    const token = accessTokenOverride || account.accessToken;
    if (!token) return;

    setAccounts((current) => current.map((entry) => entry.id === account.id ? { ...entry, syncStatus: "Syncing" } : entry));
    setStatusMessage(`Syncing ${account.accountName || account.email}`);

    try {
      const response = await window.gapi.client.gmail.users.messages.list({
        userId: "me",
        labelIds: ["INBOX"],
        maxResults: 12,
      });
      const messages = response.result.messages || [];
      const seenIds = new Set(account.processedMessageIds || []);
      const nextItems = [];
      const nextMerchants = { ...merchantProfiles };

      for (const message of messages) {
        if (seenIds.has(message.id)) continue;
        const details = await window.gapi.client.gmail.users.messages.get({
          userId: "me",
          id: message.id,
          format: "full",
        });
        const payload = details.result.payload || {};
        const headers = Object.fromEntries((payload.headers || []).map((header) => [header.name.toLowerCase(), header.value]));
        const subject = headers.subject || "";
        const body = extractPayloadBody(payload);
        const record = buildEmailRecord(account, message, body, subject, headers);
        nextItems.push(record);
        seenIds.add(message.id);
        nextMerchants[record.merchant] = mergeMerchantProfile(nextMerchants[record.merchant], record);
      }

      const nextAccounts = accounts.map((entry) => entry.id === account.id ? {
        ...entry,
        connected: true,
        accessToken: token,
        lastSync: new Date().toISOString(),
        syncStatus: nextItems.length ? "Synced" : "Up to date",
        processedMessageIds: Array.from(seenIds).slice(-200),
      } : entry);

      const nextEmails = [...nextItems, ...emailItems.filter((item) => item.accountEmail !== account.email)];
      const nextMerchantProfiles = nextMerchants;
      setAccounts(nextAccounts);
      setEmailItems(nextEmails);
      setMerchantProfiles(nextMerchantProfiles);
      persistState(nextAccounts, nextEmails, nextMerchantProfiles);
      setStatusMessage(nextItems.length ? `Processed ${nextItems.length} new email${nextItems.length === 1 ? "" : "s"}` : "No new emails");
      setLastError("");
    } catch (error) {
      setAccounts((current) => current.map((entry) => entry.id === account.id ? { ...entry, syncStatus: "Sync error" } : entry));
      const message = error?.result?.error?.message || error?.message || "Unable to sync Gmail right now.";
      setLastError(message);
      setStatusMessage(message);
    }
  }, [accounts, emailItems, merchantProfiles, persistState]);

  const syncAllAccounts = useCallback(async () => {
    for (const account of connectedAccounts) {
      await syncAccount(account);
    }
  }, [connectedAccounts, syncAccount]);

  useEffect(() => {
    if (!oauthReady) return undefined;
    const intervalId = window.setInterval(() => {
      if (connectedAccounts.length) {
        syncAllAccounts();
      }
    }, 60000);
    return () => window.clearInterval(intervalId);
  }, [connectedAccounts, oauthReady, syncAllAccounts]);

  const handleConnect = async () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setLastError("Set VITE_GOOGLE_CLIENT_ID in your environment before connecting Gmail.");
      return;
    }

    if (!window.google?.accounts?.oauth2?.initTokenClient) {
      setLastError("Google OAuth is still loading. Please try again in a moment.");
      return;
    }

    setIsConnecting(true);
    setStatusMessage("Connecting to Google OAuth");

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email",
      callback: async (response) => {
        if (response.error) {
          setIsConnecting(false);
          setLastError(response.error);
          return;
        }

        try {
          const userInfoResponse = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${response.access_token}`);
          const userInfo = await userInfoResponse.json();
          const nextAccount = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            email: userInfo.email || "Unknown Gmail account",
            accountName: userInfo.name || userInfo.email || "New Gmail account",
            accessToken: response.access_token,
            connected: true,
            lastSync: "",
            syncStatus: "Connecting",
            processedMessageIds: [],
          };
          const nextAccounts = [nextAccount, ...accounts.filter((entry) => entry.email !== nextAccount.email)];
          setAccounts(nextAccounts);
          setStatusMessage(`Connected ${nextAccount.accountName}`);
          persistState(nextAccounts, emailItems, merchantProfiles);
          setIsConnecting(false);
          await syncAccount(nextAccount, response.access_token);
        } catch (error) {
          setIsConnecting(false);
          setLastError(error.message || "Unable to finish Google sign-in.");
        }
      },
    });

    tokenClient.requestAccessToken({ prompt: "consent" });
  };

  const handleDisconnect = (accountId) => {
    const nextAccounts = accounts.filter((account) => account.id !== accountId);
    setAccounts(nextAccounts);
    persistState(nextAccounts, emailItems, merchantProfiles);
    setStatusMessage("Disconnected Gmail account");
  };

  const handleReconnect = (account) => {
    setStatusMessage(`Reconnecting ${account.accountName || account.email}`);
    handleConnect();
  };

  const section = activeSection || "main";
  const showGmailIntegration = section === "gmail" || section === "main";

  return (
    <div>
      <div style={{ marginBottom: "18px" }}>
        <div style={{ fontSize: "28px", fontWeight: 800, marginBottom: "6px" }}>Email Intelligence Center</div>
        <div style={{ color: "#6b7280" }}>Securely connect Gmail accounts, sync purchases automatically, and organize every purchase email into the right workspace.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "14px", marginBottom: "16px" }}>
        <div style={{ background: "#ffffff", borderRadius: "12px", padding: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <div style={{ color: "#6b7280", fontSize: "13px" }}>New Receipts</div>
          <div style={{ fontSize: "24px", fontWeight: 800, marginTop: "6px" }}>{dashboardMetrics.newReceipts}</div>
        </div>
        <div style={{ background: "#ffffff", borderRadius: "12px", padding: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <div style={{ color: "#6b7280", fontSize: "13px" }}>Needs Review</div>
          <div style={{ fontSize: "24px", fontWeight: 800, marginTop: "6px" }}>{dashboardMetrics.needsReview}</div>
        </div>
        <div style={{ background: "#ffffff", borderRadius: "12px", padding: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <div style={{ color: "#6b7280", fontSize: "13px" }}>Recent Orders</div>
          <div style={{ fontSize: "24px", fontWeight: 800, marginTop: "6px" }}>{dashboardMetrics.recentOrders}</div>
        </div>
        <div style={{ background: "#ffffff", borderRadius: "12px", padding: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <div style={{ color: "#6b7280", fontSize: "13px" }}>Recent Refunds</div>
          <div style={{ fontSize: "24px", fontWeight: 800, marginTop: "6px" }}>{dashboardMetrics.recentRefunds}</div>
        </div>
      </div>

      {showGmailIntegration && (
        <div style={{ background: "#ffffff", borderRadius: "12px", padding: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800 }}>Connected Gmail Accounts</div>
              <div style={{ color: "#6b7280", fontSize: "14px" }}>{statusMessage}</div>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button style={{ border: "1px solid #d1d5db", background: "#ffffff", borderRadius: "8px", padding: "9px 14px", cursor: "pointer" }} onClick={handleConnect} disabled={isConnecting || !oauthReady}>{isConnecting ? "Connecting..." : "Connect"}</button>
              <button style={{ border: "1px solid #d1d5db", background: "#ffffff", borderRadius: "8px", padding: "9px 14px", cursor: "pointer" }} onClick={syncAllAccounts} disabled={!connectedAccounts.length}>Manual Sync</button>
            </div>
          </div>
          {clientIdMissing && <div style={{ marginTop: "10px", color: "#991b1b" }}>Set VITE_GOOGLE_CLIENT_ID to enable secure Google OAuth.</div>}
          {lastError && <div style={{ marginTop: "10px", color: "#991b1b" }}>{lastError}</div>}
        </div>
      )}

      {showGmailIntegration && (
        <div style={{ display: "grid", gap: "12px", marginBottom: "16px" }}>
          {accounts.length === 0 && <div style={{ background: "#ffffff", borderRadius: "12px", padding: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>No Gmail accounts connected yet. Use Connect to authorize with Google.</div>}
          {accounts.map((account) => (
            <div key={account.id} style={{ background: "#ffffff", borderRadius: "12px", padding: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 800 }}>{account.accountName || account.email}</div>
                  <div style={{ color: "#6b7280", fontSize: "14px" }}>{account.email}</div>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {account.connected ? (
                    <>
                      <span style={{ borderRadius: "999px", padding: "6px 10px", background: "#dcfce7", color: "#166534", fontSize: "13px", fontWeight: 700 }}>Connected</span>
                      <button style={{ border: "1px solid #d1d5db", background: "#ffffff", borderRadius: "8px", padding: "8px 12px", cursor: "pointer" }} onClick={() => syncAccount(account)}>Manual Sync</button>
                      <button style={{ border: "1px solid #d1d5db", background: "#ffffff", borderRadius: "8px", padding: "8px 12px", cursor: "pointer" }} onClick={() => handleReconnect(account)}>Reconnect</button>
                      <button style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", borderRadius: "8px", padding: "8px 12px", cursor: "pointer" }} onClick={() => handleDisconnect(account.id)}>Disconnect</button>
                    </>
                  ) : (
                    <button style={{ border: "1px solid #d1d5db", background: "#ffffff", borderRadius: "8px", padding: "8px 12px", cursor: "pointer" }} onClick={handleConnect}>Connect</button>
                  )}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginTop: "10px" }}>
                <div><strong>Last Sync</strong><div style={{ color: "#6b7280", fontSize: "13px" }}>{account.lastSync ? new Date(account.lastSync).toLocaleString() : "Awaiting first sync"}</div></div>
                <div><strong>Sync Status</strong><div style={{ color: "#6b7280", fontSize: "13px" }}>{account.syncStatus || "Pending"}</div></div>
                <div><strong>Account Name</strong><div style={{ color: "#6b7280", fontSize: "13px" }}>{account.accountName || account.email}</div></div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: "#ffffff", borderRadius: "12px", padding: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
          <div style={{ fontWeight: 800 }}>AI Email Analysis</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <input style={{ border: "1px solid #d1d5db", borderRadius: "8px", padding: "9px 12px", minWidth: "220px" }} value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search merchant, order, tracking, SKU, customer, receipt" />
            <select style={{ border: "1px solid #d1d5db", borderRadius: "8px", padding: "9px 12px" }} value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All Types</option>
              <option value="purchaseReceipt">Purchase Receipt</option>
              <option value="orderConfirmation">Order Confirmation</option>
              <option value="shippingConfirmation">Shipping Confirmation</option>
              <option value="deliveryConfirmation">Delivery Confirmation</option>
              <option value="return">Returns</option>
              <option value="refund">Refunds</option>
              <option value="giftCardPurchase">Gift Card Purchases</option>
              <option value="invoice">Invoices</option>
              <option value="packingSlip">Packing Slips</option>
              <option value="paymentConfirmation">Payment Confirmations</option>
              <option value="subscription">Subscriptions</option>
            </select>
          </div>
        </div>
        {filteredEmails.length === 0 && <div style={{ color: "#6b7280" }}>No matching purchase emails yet. Connect an account and run a manual sync.</div>}
        <div style={{ display: "grid", gap: "10px" }}>
          {filteredEmails.map((item) => (
            <div key={item.id} style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 800 }}>{item.merchant}</div>
                  <div style={{ color: "#6b7280", fontSize: "13px" }}>{item.subject}</div>
                </div>
                <div style={{ color: "#dc2626", fontWeight: 700 }}>{item.categoryLabel}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "8px", marginTop: "8px", fontSize: "13px", color: "#4b5563" }}>
                <div><strong>Order</strong><div>{item.orderNumber || "—"}</div></div>
                <div><strong>Tracking</strong><div>{item.trackingNumber || "—"}</div></div>
                <div><strong>SKU</strong><div>{item.sku || "—"}</div></div>
                <div><strong>Total</strong><div>{item.totals || "—"}</div></div>
                <div><strong>Target</strong><div>{item.suggestedTarget}</div></div>
                <div><strong>Account</strong><div>{item.accountEmail}</div></div>
              </div>
              <div style={{ marginTop: "8px", color: "#6b7280", fontSize: "13px" }}>OCR: {item.itemsPurchased.slice(0, 3).join(", ") || "No item details extracted yet"}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#ffffff", borderRadius: "12px", padding: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
        <div style={{ fontWeight: 800, marginBottom: "10px" }}>Purchasing Accounts</div>
        <div style={{ display: "grid", gap: "10px" }}>
          {Object.values(merchantProfiles).map((profile) => (
            <div key={profile.merchantName} style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 800 }}>{profile.merchantName}</div>
                <div style={{ color: "#6b7280", fontSize: "13px" }}>{profile.numberOfOrders} orders • ${Number(profile.lifetimeSpend || 0).toFixed(2)}</div>
              </div>
              <div style={{ color: "#6b7280", fontSize: "13px", marginTop: "6px" }}>
                Website: {profile.website || "—"} • Support: {profile.supportEmail || "—"} • First purchase: {profile.firstPurchase ? new Date(profile.firstPurchase).toLocaleDateString() : "—"} • Last purchase: {profile.lastPurchase ? new Date(profile.lastPurchase).toLocaleDateString() : "—"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
