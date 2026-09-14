import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { AiBot } from "../../api/types";
import { Badge, Btn, Spinner, ErrorBanner, C } from "../../components";
import { useSession } from "../../auth/SessionContext";
import { OverviewTab } from "./tabs/OverviewTab";
import { BehaviourTab } from "./tabs/BehaviourTab";
import { BindingsTab } from "./tabs/BindingsTab";
import { LimitsTab } from "./tabs/LimitsTab";
import { AuditTab } from "./tabs/AuditTab";

const TABS = [
  { key: "overview",  label: "Overview"  },
  { key: "rules",     label: "Behaviour" },
  { key: "bindings",  label: "Bindings"  },
  { key: "limits",    label: "Limits"    },
  { key: "audit",     label: "Audit"     },
] as const;

type TabKey = typeof TABS[number]["key"];

export function BotDetailPage() {
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const { can } = useSession();

  const [bot, setBot] = useState<AiBot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");
  const [exporting, setExporting] = useState(false);

  async function load() {
    if (!botId) return;
    setLoading(true); setError("");
    try {
      const d = await api.get<AiBot>(`/__config/admin/ai/bots/${botId}`);
      setBot(d);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  async function handleExport() {
    if (!bot) return;
    setExporting(true);
    try {
      const res = await fetch(`/__config/admin/ai/bots/${bot._id}/export`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `${bot.name}-bot-export.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename!;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => { load(); }, [botId]);

  if (loading) return <div style={{ padding: 40 }}><Spinner /></div>;
  if (error || !bot) return <div style={{ padding: 40 }}><ErrorBanner message={error || "Bot not found"} /></div>;

  const readonly = !can("manage:providers");

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, flexShrink: 0, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <button onClick={() => navigate("/bots")} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 13, padding: 0 }}>← Bots</button>
            <span style={{ color: C.border }}>|</span>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{bot.name}</h1>
            <Badge text={bot.is_active ? "active" : "disabled"} />
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            {bot.allowed_app_ids.length} app{bot.allowed_app_ids.length !== 1 ? "s" : ""} · {bot.allowed_provider_ids.length} provider{bot.allowed_provider_ids.length !== 1 ? "s" : ""} · {bot.rules.length} rule{bot.rules.length !== 1 ? "s" : ""}
          </div>
        </div>
        {can("manage:providers") && (
          <Btn size="sm" variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? "Preparing…" : "Export ↓"}
          </Btn>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: `2px solid ${C.border}`, marginBottom: 16, flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "8px 16px", background: "none", border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 600,
            color: tab === t.key ? C.primary : C.muted,
            borderBottom: tab === t.key ? `2px solid ${C.primary}` : "2px solid transparent",
            marginBottom: -2,
          }}>{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {tab === "overview"  && <OverviewTab  bot={bot} onUpdated={setBot} readonly={readonly} />}
        {tab === "rules"     && <BehaviourTab     bot={bot} onUpdated={setBot} readonly={readonly} />}
        {tab === "bindings"  && <BindingsTab  bot={bot} onUpdated={setBot} readonly={readonly} />}
        {tab === "limits"    && <LimitsTab    bot={bot} onUpdated={setBot} readonly={readonly} />}
        {tab === "audit"     && <AuditTab     bot={bot} />}
      </div>
    </div>
  );
}
