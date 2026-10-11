import { useGuardedAction } from "../../components/PageSave";
import { Bot, Download, Power } from "lucide-react";
import { useState, useEffect } from "react";
import { useParams, useLocation } from "react-router-dom";
import { api } from "../../api/client";
import type { AiBot } from "../../api/types";
import { Badge, Btn, Spinner, ErrorBanner, Tabs, C } from "../../components";
import { useBreadcrumb } from "../../components/BreadcrumbContext";
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
  const guard=useGuardedAction();
  const { botId } = useParams<{ botId: string }>();
  const location = useLocation();
  const { can } = useSession();

  const [bot, setBot] = useState<AiBot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");
  const [exporting, setExporting] = useState(false);
  const [toggling,setToggling]=useState(false);

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
  useBreadcrumb(location.pathname, bot ? [
    { label: "Bot Registry", to: "/bots" },
    { label: bot.name },
  ] : null);

  if (loading) return <div style={{ padding: 40 }}><Spinner /></div>;
  if (error || !bot) return <div style={{ padding: 40 }}><ErrorBanner message={error || "Bot not found"} /></div>;

  const readonly = !can("manage:providers");

  return (
    <div className="app-page" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div className="ui-pagehead" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, flexShrink: 0, flexWrap: "wrap", gap: 10 }}>
        <div className="app-bot-heading"><span className="ui-tile"><Bot /></span><div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{bot.name}</h1>
            <Badge text={bot.is_active ? "active" : "disabled"} />
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            {bot.allowed_app_ids.length} app{bot.allowed_app_ids.length !== 1 ? "s" : ""} · {bot.allowed_provider_ids.length} provider{bot.allowed_provider_ids.length !== 1 ? "s" : ""} · {bot.rules.length} rule{bot.rules.length !== 1 ? "s" : ""}
          </div>
        </div></div>
        <div className="ui-row app-bot-header-actions">{can("manage:providers") && (
          <div className="ui-row"><Btn variant={bot.is_active ? "secondary" : "success"} disabled={toggling} onClick={async()=>{setToggling(true);try{setBot(await api.put<AiBot>(`/__config/admin/ai/bots/${bot._id}`,{is_active:!bot.is_active}));}catch(e){setError(String(e));}finally{setToggling(false);}}}><Power />{bot.is_active ? "Disable" : "Enable"}</Btn><Btn variant="secondary" onClick={handleExport} disabled={exporting}>
            <Download />{exporting ? "Preparing…" : "Export"}
          </Btn></div>
        )}<div data-page-save-slot /></div>
      </div>

      <Tabs tabs={TABS.map(t => ({ ...t }))} active={tab} onChange={k => {if(k!==tab)guard(()=>setTab(k as TabKey));}} />

      {/* Content */}
      <div className="ui-page__body">
        {tab === "overview"  && <OverviewTab  bot={bot} onUpdated={setBot} readonly={readonly} />}
        {tab === "rules"     && <BehaviourTab     bot={bot} onUpdated={setBot} readonly={readonly} />}
        {tab === "bindings"  && <BindingsTab  bot={bot} onUpdated={setBot} readonly={readonly} />}
        {tab === "limits"    && <LimitsTab    bot={bot} onUpdated={setBot} readonly={readonly} />}
        {tab === "audit"     && <AuditTab     bot={bot} />}
      </div>
    </div>
  );
}
