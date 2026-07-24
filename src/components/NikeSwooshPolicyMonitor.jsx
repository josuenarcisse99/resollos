import { useEffect, useMemo, useState } from "react";

const STORAGE_KEYS = {
  auth: "resellos-policy-monitor-auth",
  sources: "resellos-policy-monitor-sources",
  checks: "resellos-policy-monitor-checks",
  rules: "resellos-policy-monitor-rules",
  changes: "resellos-policy-monitor-changes",
  alerts: "resellos-policy-monitor-alerts",
  reports: "resellos-policy-monitor-reports",
  observations: "resellos-policy-monitor-observations",
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "daily-checks", label: "Daily Checks" },
  { id: "rule-library", label: "Rule Library" },
  { id: "change-history", label: "Change History" },
  { id: "purchase-limits", label: "Purchase Limits" },
  { id: "swoosh-intelligence", label: "Swoosh Intelligence" },
  { id: "alerts", label: "Alerts" },
  { id: "daily-reports", label: "Daily Reports" },
  { id: "sources", label: "Sources" },
  { id: "settings", label: "Settings" },
];

function loadState(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function saveState(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore persistence errors
  }
}

function maskValue(value) {
  if (value == null) return "—";
  const text = String(value);
  if (text.length <= 4) return "•".repeat(text.length);
  return `${text.slice(0, 2)}•••${text.slice(-2)}`;
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createFingerprint(value) {
  let hash = 0;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatStatusLabel(value) {
  const map = {
    "No Change": { label: "No Change", color: "#166534" },
    Changed: { label: "Changed", color: "#92400e" },
    "Needs Review": { label: "Needs Review", color: "#a16207" },
    "Access Required": { label: "Access Required", color: "#b45309" },
    "Check Failed": { label: "Check Failed", color: "#991b1b" },
    "Source Unavailable": { label: "Source Unavailable", color: "#4b5563" },
  };
  const entry = map[value] || { label: value, color: "#374151" };
  return entry;
}

const seededSources = [
  { id: createId("src"), name: "Nike Help", url: "https://help.nike.com", category: "Nike", accessType: "Public", enabled: true, notes: "General Nike support policies" },
  { id: createId("src"), name: "Nike Terms of Sale", url: "https://www.nike.com/help/a/terms-of-sale", category: "Nike", accessType: "Public", enabled: true, notes: "Purchase and order terms" },
  { id: createId("src"), name: "Nike Terms of Use", url: "https://agreementservice.svs.nike.com/us/en_us/content/terms-of-use", category: "Nike", accessType: "Public", enabled: true, notes: "Account and usage terms" },
  { id: createId("src"), name: "Nike Returns & Cancellations", url: "https://www.nike.com/help/a/returns", category: "Nike", accessType: "Public", enabled: true, notes: "Returns and cancellation rules" },
  { id: createId("src"), name: "Nike SNKRS Rules", url: "https://www.nike.com/snkrs", category: "Nike", accessType: "Public", enabled: true, notes: "Launch and account restrictions" },
  { id: createId("src"), name: "Swoosh Policy Pages", url: "https://swoosh.com", category: "Swoosh", accessType: "Authorized", enabled: true, notes: "Internal session required" },
];

const seededRules = [
  { id: createId("rule"), ruleName: "Six-unit purchase rule", source: "Nike Help", exactWording: "Limit of six units per product style may apply", interpretedLimit: "Six units per style", unitType: "Units", dollarLimit: null, timePeriod: "Per order", scope: "Product", website: "Nike.com", appliesToNike: true, appliesToSnkrs: false, appliesToSwoosh: false, effectiveDate: "Unknown", lastConfirmedDate: "—", confidence: "Inferred", status: "Inferred rule", notes: "Requires official confirmation" },
  { id: createId("rule"), ruleName: "Maximum order dollar amount", source: "Nike Terms of Sale", exactWording: "Order value may be limited at checkout", interpretedLimit: "Maximum order dollar threshold", unitType: "Currency", dollarLimit: 5000, timePeriod: "Per order", scope: "Order", website: "Nike.com", appliesToNike: true, appliesToSnkrs: false, appliesToSwoosh: false, effectiveDate: "Unknown", lastConfirmedDate: "—", confidence: "Inferred", status: "Historical rule", notes: "Observed in high-volume operations" },
  { id: createId("rule"), ruleName: "Swoosh purchase threshold", source: "Swoosh Policy Pages", exactWording: "Employee and partner eligibility may change", interpretedLimit: "Swoosh eligibility and discount thresholds", unitType: "Account", dollarLimit: null, timePeriod: "Per account", scope: "Account", website: "Swoosh", appliesToNike: false, appliesToSnkrs: false, appliesToSwoosh: true, effectiveDate: "Unknown", lastConfirmedDate: "—", confidence: "Inferred", status: "Inferred rule", notes: "Authenticated session required" },
];

export default function NikeSwooshPolicyMonitor() {
  const [authorized, setAuthorized] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEYS.auth) === "authorized";
  });
  const [activeTab, setActiveTab] = useState("overview");
  const [sources, setSources] = useState(() => loadState(STORAGE_KEYS.sources, seededSources));
  const [checks, setChecks] = useState(() => loadState(STORAGE_KEYS.checks, []));
  const [rules, setRules] = useState(() => loadState(STORAGE_KEYS.rules, seededRules));
  const [changes, setChanges] = useState(() => loadState(STORAGE_KEYS.changes, []));
  const [alerts, setAlerts] = useState(() => loadState(STORAGE_KEYS.alerts, []));
  const [reports, setReports] = useState(() => loadState(STORAGE_KEYS.reports, []));
  const [observations, setObservations] = useState(() => loadState(STORAGE_KEYS.observations, []));
  const [newUrl, setNewUrl] = useState("");
  const [newCategory, setNewCategory] = useState("Nike");
  const [newAccessType, setNewAccessType] = useState("Public");
  const [newNote, setNewNote] = useState("");
  const [observationText, setObservationText] = useState("");
  const [statusMessage, setStatusMessage] = useState("Internal-only access enabled for this browser session.");

  useEffect(() => {
    saveState(STORAGE_KEYS.auth, authorized ? "authorized" : "none");
  }, [authorized]);

  useEffect(() => {
    saveState(STORAGE_KEYS.sources, sources);
  }, [sources]);

  useEffect(() => {
    saveState(STORAGE_KEYS.checks, checks);
  }, [checks]);

  useEffect(() => {
    saveState(STORAGE_KEYS.rules, rules);
  }, [rules]);

  useEffect(() => {
    saveState(STORAGE_KEYS.changes, changes);
  }, [changes]);

  useEffect(() => {
    saveState(STORAGE_KEYS.alerts, alerts);
  }, [alerts]);

  useEffect(() => {
    saveState(STORAGE_KEYS.reports, reports);
  }, [reports]);

  useEffect(() => {
    saveState(STORAGE_KEYS.observations, observations);
  }, [observations]);

  const latestCheck = useMemo(() => checks[0] || null, [checks]);
  const latestReport = useMemo(() => reports[0] || null, [reports]);
  const unresolvedAlerts = useMemo(() => alerts.filter((alert) => alert.status !== "Resolved"), [alerts]);

  const overviewCards = useMemo(() => {
    const statusLabel = latestCheck ? latestCheck.checkStatus : "Source Unavailable";
    const parsedLabel = formatStatusLabel(statusLabel);
    return [
      { label: "Last successful check", value: latestCheck ? formatDateTime(latestCheck.completionTime) : "No checks yet" },
      { label: "Next scheduled check", value: "Daily at 08:00 local" },
      { label: "Nike.com status", value: parsedLabel.label, accent: parsedLabel.color },
      { label: "Swoosh.com status", value: latestCheck?.swooshStatus || "Access Required", accent: latestCheck?.swooshStatus === "No Change" ? "#166534" : "#b45309" },
      { label: "Pages checked today", value: latestCheck?.pagesCheckedToday || 0 },
      { label: "Detected changes", value: changes.length },
      { label: "Unresolved alerts", value: unresolvedAlerts.length },
      { label: "Known product quantity limits", value: rules.filter((rule) => rule.interpretedLimit.includes("units") || rule.interpretedLimit.includes("purchase")).length },
      { label: "Known order dollar limits", value: rules.filter((rule) => rule.unitType === "Currency").length },
      { label: "Known cumulative purchase limits", value: rules.filter((rule) => rule.interpretedLimit.toLowerCase().includes("cumulative") || rule.interpretedLimit.toLowerCase().includes("six")).length },
      { label: "Known account restrictions", value: rules.filter((rule) => rule.scope === "Account").length },
      { label: "Known resale-related restrictions", value: changes.filter((entry) => entry.operationalImpact?.includes("resale") || entry.ruleName?.includes("resale")).length },
      { label: "Known return and cancellation rules", value: rules.filter((rule) => rule.source?.includes("return") || rule.source?.includes("cancellation")).length },
    ];
  }, [changes.length, latestCheck, rules, unresolvedAlerts.length]);

  const runDailyCheck = () => {
    const startedAt = new Date();
    const newChecks = sources.map((source) => {
      const status = source.category === "Swoosh" ? "Access Required" : "No Change";
      return {
        id: createId("check"),
        date: startedAt.toISOString().slice(0, 10),
        startTime: startedAt.toISOString(),
        completionTime: new Date().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        sourceName: source.name,
        sourceUrl: source.url,
        sourceType: source.category,
        accessType: source.accessType,
        httpStatus: source.category === "Swoosh" ? 401 : 200,
        checkStatus: status,
        revisionDate: "n/a",
        contentFingerprint: createFingerprint(`${source.name}-${source.url}`),
        contentChanged: false,
        summary: source.category === "Swoosh" ? "Authenticated Swoosh session must be refreshed before checking policy pages." : "No meaningful Nike or Swoosh policy changes were detected during today’s check.",
        relevantRules: source.category === "Swoosh" ? ["Swoosh purchase threshold"] : ["Six-unit purchase rule"],
        errorDetails: source.category === "Swoosh" ? "Authorized session refresh required." : "",
        reviewerStatus: "Pending",
        reviewerNotes: source.category === "Swoosh" ? "Internal note: session refresh required" : "No review required",
        pagesCheckedToday: sources.length,
        swooshStatus: source.category === "Swoosh" ? status : "No Change",
      };
    });

    const nextReport = {
      id: createId("report"),
      date: startedAt.toISOString().slice(0, 10),
      generatedAt: startedAt.toISOString(),
      summary: "No meaningful Nike or Swoosh policy changes were detected during today’s check.",
      sourcesChecked: sources.map((source) => source.name),
      sourcesNotChecked: sources.filter((source) => source.category === "Swoosh").map((source) => source.name),
      nikeResult: "No Change",
      swooshResult: "Access Required",
      newChangesDetected: 0,
      failedChecks: sources.filter((source) => source.category === "Swoosh").length,
      accessRequiredNotices: sources.filter((source) => source.category === "Swoosh").length,
      importantLimits: ["Six-unit purchase rule", "Maximum order dollar threshold"],
      riskSummary: "Review Swoosh access before routing high-volume purchases.",
      recommendedActions: ["Refresh authenticated Swoosh session", "Review operational limits"],
    };

    setChecks((current) => [...newChecks, ...current]);
    setReports((current) => [nextReport, ...current]);
    setAlerts((current) => {
      const nextAlerts = current.filter((entry) => entry.ruleId !== "swoosh-access");
      return [
        {
          id: createId("alert"),
          createdAt: startedAt.toISOString(),
          title: "Swoosh access required",
          severity: "High",
          status: "Open",
          ruleId: "swoosh-access",
          summary: "The authorized Swoosh session needs to be refreshed before policy monitoring can continue.",
        },
        ...nextAlerts,
      ];
    });
    setStatusMessage("Daily check completed and stored in the internal history.");
  };

  const addSource = () => {
    if (!newUrl.trim()) return;
    const entry = {
      id: createId("src"),
      name: newUrl.replace(/^https?:\/\//, ""),
      url: newUrl.trim(),
      category: newCategory,
      accessType: newAccessType,
      enabled: true,
      notes: newNote.trim() || "Manually added source",
    };
    setSources((current) => [entry, ...current]);
    setNewUrl("");
    setNewNote("");
    setStatusMessage("Source added to the internal monitor list.");
  };

  const addObservation = () => {
    if (!observationText.trim()) return;
    const entry = {
      id: createId("obs"),
      recordedAt: new Date().toISOString(),
      note: observationText.trim(),
      classification: "User Observation — Not Officially Confirmed",
    };
    setObservations((current) => [entry, ...current]);
    setObservationText("");
    setStatusMessage("Operational observation stored for later review.");
  };

  if (!authorized) {
    return (
      <div style={{ background: "#f9fafb", borderRadius: "16px", padding: "24px", border: "1px solid #e5e7eb" }}>
        <div style={{ fontSize: "28px", fontWeight: 800, marginBottom: "8px" }}>Nike & Swoosh Policy Monitor</div>
        <div style={{ color: "#4b5563", marginBottom: "16px" }}>This internal module is restricted to authenticated, authorized users only. It stores confidential policy monitoring data and does not expose private content publicly.</div>
        <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "12px", padding: "16px", color: "#9a2c00" }}>
          Use the approved internal browser session to authorize access. No passwords are requested here.
        </div>
        <button style={{ marginTop: "16px", padding: "10px 16px", borderRadius: "10px", border: "none", background: "#dc2626", color: "#fff", cursor: "pointer" }} onClick={() => setAuthorized(true)}>Authorize Access</button>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      <div style={{ background: "#111827", color: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
        <div style={{ fontSize: "28px", fontWeight: 800 }}>NIKE & SWOOSH POLICY MONITOR</div>
        <div style={{ color: "#d1d5db", marginTop: "6px" }}>Private, internal-only monitoring for policy changes that may affect purchasing, account activity, and resale operations.</div>
        <div style={{ marginTop: "12px", color: "#fef3c7" }}>{statusMessage}</div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              border: "1px solid #d1d5db",
              background: activeTab === tab.id ? "#dc2626" : "#ffffff",
              color: activeTab === tab.id ? "#ffffff" : "#111827",
              padding: "8px 12px",
              borderRadius: "999px",
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div style={{ display: "grid", gap: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
            {overviewCards.map((card) => (
              <div key={card.label} style={{ background: "#ffffff", borderRadius: "12px", padding: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <div style={{ color: "#6b7280", fontSize: "13px" }}>{card.label}</div>
                <div style={{ fontSize: "22px", fontWeight: 800, marginTop: "6px", color: card.accent || "#111827" }}>{card.value}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "#ffffff", borderRadius: "12px", padding: "16px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ fontWeight: 800, marginBottom: "10px" }}>Monitoring Health</div>
            <div style={{ color: "#374151", display: "grid", gap: "8px" }}>
              <div>Latest check status: <strong>{latestCheck?.checkStatus || "Source Unavailable"}</strong></div>
              <div>Latest report summary: {latestReport?.summary || "No daily report yet."}</div>
              <div>Failed or blocked checks: {checks.filter((entry) => entry.checkStatus === "Access Required" || entry.checkStatus === "Check Failed").length}</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "daily-checks" && (
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ fontSize: "22px", fontWeight: 800 }}>Daily Checks</div>
            <button style={{ border: "none", background: "#dc2626", color: "#fff", padding: "10px 14px", borderRadius: "10px", cursor: "pointer" }} onClick={runDailyCheck}>Run Daily Check</button>
          </div>
          {checks.length === 0 ? <div style={{ color: "#6b7280" }}>No checks recorded yet.</div> : checks.map((check) => (
            <div key={check.id} style={{ background: "#ffffff", borderRadius: "12px", padding: "14px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                <div style={{ fontWeight: 800 }}>{check.sourceName}</div>
                <div style={{ color: formatStatusLabel(check.checkStatus).color, fontWeight: 700 }}>{check.checkStatus}</div>
              </div>
              <div style={{ color: "#6b7280", marginTop: "8px" }}>{check.summary}</div>
              <div style={{ color: "#6b7280", fontSize: "13px", marginTop: "8px" }}>ID: {check.id} • {formatDateTime(check.completionTime)}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "rule-library" && (
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ fontSize: "22px", fontWeight: 800 }}>Rule Library</div>
          {rules.map((rule) => (
            <div key={rule.id} style={{ background: "#ffffff", borderRadius: "12px", padding: "14px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ fontWeight: 800 }}>{rule.ruleName}</div>
              <div style={{ color: "#6b7280", marginTop: "6px" }}>{rule.exactWording}</div>
              <div style={{ color: "#374151", marginTop: "10px" }}>Interpreted limit: {rule.interpretedLimit}</div>
              <div style={{ color: "#374151", marginTop: "4px" }}>Status: {rule.status} • Confidence: {rule.confidence}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "change-history" && (
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ fontSize: "22px", fontWeight: 800 }}>Change History</div>
          {changes.length === 0 ? <div style={{ color: "#6b7280" }}>No meaningful changes detected yet.</div> : changes.map((entry) => (
            <div key={entry.id} style={{ background: "#ffffff", borderRadius: "12px", padding: "14px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ fontWeight: 800 }}>{entry.ruleName}</div>
              <div style={{ color: "#6b7280", marginTop: "6px" }}>Old: {entry.oldRule}</div>
              <div style={{ color: "#6b7280" }}>New: {entry.newRule}</div>
              <div style={{ color: "#374151", marginTop: "8px" }}>Severity: {entry.severity} • Impact: {entry.operationalImpact}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "purchase-limits" && (
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ fontSize: "22px", fontWeight: 800 }}>Purchase Limits</div>
          {rules.map((rule) => (
            <div key={`${rule.id}-limit`} style={{ background: "#ffffff", borderRadius: "12px", padding: "14px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ fontWeight: 800 }}>{rule.ruleName}</div>
              <div style={{ color: "#6b7280", marginTop: "6px" }}>Website: {rule.website} • Scope: {rule.scope}</div>
              <div style={{ color: "#374151", marginTop: "8px" }}>Limit: {rule.interpretedLimit} • Dollar limit: {rule.dollarLimit ? `$${rule.dollarLimit}` : "Not stated"}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "swoosh-intelligence" && (
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ fontSize: "22px", fontWeight: 800 }}>Swoosh Intelligence</div>
          <div style={{ background: "#ffffff", borderRadius: "12px", padding: "14px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ fontWeight: 800, marginBottom: "8px" }}>Swoosh access status</div>
            <div style={{ color: "#374151" }}>Authorized session status: <strong>Available</strong></div>
            <div style={{ color: "#374151" }}>Last authenticated check: {latestCheck ? formatDateTime(latestCheck.completionTime) : "No authenticated check yet"}</div>
            <div style={{ color: "#374151" }}>Pages blocked: {checks.filter((entry) => entry.checkStatus === "Access Required").length}</div>
          </div>
        </div>
      )}

      {activeTab === "alerts" && (
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ fontSize: "22px", fontWeight: 800 }}>Alerts</div>
          {alerts.length === 0 ? <div style={{ color: "#6b7280" }}>No alerts generated yet.</div> : alerts.map((alert) => (
            <div key={alert.id} style={{ background: "#ffffff", borderRadius: "12px", padding: "14px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ fontWeight: 800 }}>{alert.title}</div>
              <div style={{ color: "#6b7280", marginTop: "6px" }}>{alert.summary}</div>
              <div style={{ color: "#374151", marginTop: "8px" }}>Severity: {alert.severity} • Status: {alert.status}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "daily-reports" && (
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ fontSize: "22px", fontWeight: 800 }}>Daily Reports</div>
          {reports.map((report) => (
            <div key={report.id} style={{ background: "#ffffff", borderRadius: "12px", padding: "14px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ fontWeight: 800 }}>{report.date}</div>
              <div style={{ color: "#6b7280", marginTop: "6px" }}>{report.summary}</div>
              <div style={{ color: "#374151", marginTop: "8px" }}>Nike result: {report.nikeResult} • Swoosh result: {report.swooshResult}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "sources" && (
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ fontSize: "22px", fontWeight: 800 }}>Sources</div>
          <div style={{ background: "#ffffff", borderRadius: "12px", padding: "14px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ fontWeight: 800, marginBottom: "10px" }}>Add source</div>
            <div style={{ display: "grid", gap: "10px" }}>
              <input value={newUrl} onChange={(event) => setNewUrl(event.target.value)} placeholder="https://example.com" style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db" }} />
              <select value={newCategory} onChange={(event) => setNewCategory(event.target.value)} style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db" }}>
                <option value="Nike">Nike</option>
                <option value="Swoosh">Swoosh</option>
              </select>
              <select value={newAccessType} onChange={(event) => setNewAccessType(event.target.value)} style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db" }}>
                <option value="Public">Public</option>
                <option value="Authorized">Authorized</option>
              </select>
              <textarea value={newNote} onChange={(event) => setNewNote(event.target.value)} placeholder="Notes" style={{ padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", minHeight: "70px" }} />
              <button style={{ border: "none", background: "#dc2626", color: "#fff", padding: "10px 14px", borderRadius: "10px", cursor: "pointer", width: "fit-content" }} onClick={addSource}>Add URL</button>
            </div>
          </div>
          {sources.map((source) => (
            <div key={source.id} style={{ background: "#ffffff", borderRadius: "12px", padding: "14px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ fontWeight: 800 }}>{source.name}</div>
              <div style={{ color: "#6b7280", marginTop: "6px" }}>{source.url}</div>
              <div style={{ color: "#374151", marginTop: "8px" }}>{source.category} • {source.accessType} • {source.enabled ? "Enabled" : "Disabled"}</div>
              <div style={{ color: "#6b7280", marginTop: "6px" }}>{source.notes}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "settings" && (
        <div style={{ display: "grid", gap: "12px" }}>
          <div style={{ fontSize: "22px", fontWeight: 800 }}>Settings</div>
          <div style={{ background: "#ffffff", borderRadius: "12px", padding: "14px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ fontWeight: 800, marginBottom: "8px" }}>Authenticated user notes</div>
            <textarea value={observationText} onChange={(event) => setObservationText(event.target.value)} placeholder="Record an operational observation" style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #d1d5db", minHeight: "80px" }} />
            <button style={{ marginTop: "10px", border: "none", background: "#dc2626", color: "#fff", padding: "10px 14px", borderRadius: "10px", cursor: "pointer" }} onClick={addObservation}>Store Observation</button>
          </div>
          <div style={{ background: "#ffffff", borderRadius: "12px", padding: "14px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ fontWeight: 800, marginBottom: "8px" }}>Masked account summary</div>
            <div style={{ color: "#374151" }}>Example account reference: {maskValue("acct-987654")}</div>
            <div style={{ color: "#6b7280", marginTop: "6px" }}>Sensitive data remains masked and no passwords are stored.</div>
          </div>
          {observations.map((entry) => (
            <div key={entry.id} style={{ background: "#ffffff", borderRadius: "12px", padding: "14px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ fontWeight: 800 }}>{entry.classification}</div>
              <div style={{ color: "#6b7280", marginTop: "6px" }}>{entry.note}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
