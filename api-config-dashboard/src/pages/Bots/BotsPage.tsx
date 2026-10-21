import { Bot, Plus, Search, Upload, RefreshCw, Pencil, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { AiBot, AiProvider, ListResult } from "../../api/types";
import { Card, SectionHead, Table, Btn, Badge, Field, inputStyle, Spinner, ErrorBanner, Confirm, Stat, Modal, C, RowMenu } from "../../components";
import { useSession } from "../../auth/SessionContext";
import { ImportBotModal } from "./ImportBotModal";

export function BotsPage() {
  const [statusFilter,setStatusFilter]=useState("all");
  const [query, setQuery] = useState("");
  const [bots, setBots] = useState<AiBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AiBot | null>(null);
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);
  const navigate = useNavigate();
  const { can } = useSession();

  async function load() {
    setLoading(true); setError("");
    try {
      const d = await api.get<{ count: number; results: AiBot[] }>("/__config/admin/ai/bots");
      setBots(d.results);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(bot: AiBot) {
    try { await api.del(`/__config/admin/ai/bots/${bot._id}`); setDeleteTarget(null); load(); }
    catch (e) { /* The API client reports the failure through the shared toast. */ }
  }

  const cols = [
    {
      key: "name", label: "Bot",
      render: (_: unknown, row: Record<string, unknown>) => (
        <div className="app-app-name"><span className="ui-tile"><Bot size={17} /></span><div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{String(row["name"])}</div>
          <div style={{ fontSize: 11, color: C.muted }}>
            {(row["allowed_app_ids"] as string[])?.length ?? 0} apps ·{" "}
            {(row["allowed_provider_ids"] as string[])?.length ?? 0} providers ·{" "}
            {(row["rules"] as string[])?.length ?? 0} rules
          </div>
        </div></div>
      ),
    },
    { key: "is_active", label: "Status", render: (v: unknown) => <Badge text={v ? "active" : "disabled"} /> },
    {
      key: "last_used_at", label: "Last Used",
      render: (v: unknown) => v ? new Date(String(v)).toLocaleString() : <span style={{ color: C.muted }}>never</span>,
    },
    {
      key: "_id", label: "",
      render: (_: unknown, row: Record<string, unknown>) => (
        <RowMenu items={[{label:"Configure",icon:<Pencil/>,onClick:()=>navigate(`/bots/${row._id}`)},...(can("manage:providers") ? [{label:"Delete",icon:<Trash2/>,danger:true,onClick:()=>setDeleteTarget(row as unknown as AiBot)}] : [])]}/>

      ),
    },
  ];

  return (
    <div className="app-page" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="ui-pagehead" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexShrink: 0 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Bot Registry</h1>
          <p style={{ margin: "2px 0 0", color: C.muted, fontSize: 13 }}>
            Register and configure chatbot clients. Each bot gets a unique key, its own app bindings, rules, and LLM provider.
          </p>
        </div>
        {can("manage:providers") && (
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="secondary" onClick={() => setShowImport(true)}><Upload />Import</Btn>
            <Btn onClick={() => setShowCreate(true)}><Plus />New Bot</Btn>
          </div>
        )}
      </div>

      {showImport && (
        <ImportBotModal
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}

      <div className="ui-page__body">{error && <ErrorBanner message={error} />}

      {newKey && (
        <div style={{ marginBottom: 16, padding: 14, border: "1px solid var(--success)", background: "var(--success-background)", borderRadius: C.radius }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--success)", marginBottom: 6 }}>
            ✓ Bot "{newKey.name}" registered — copy the key now, it will not be shown again
          </div>
          <code style={{ display: "block", padding: "8px 10px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, wordBreak: "break-all" }}>
            {newKey.key}
          </code>
          <div style={{ marginTop: 8, textAlign: "right" }}>
            <Btn size="sm" variant="ghost" onClick={() => setNewKey(null)}>Done — I saved it</Btn>
          </div>
        </div>
      )}

      <div className="ui-row app-apps-toolbar" style={{marginBottom:20}}><div className="ui-seg">{["all","active","disabled"].map(t=><button type="button" key={t} className={`ui-seg__item ${statusFilter===t ? "is-active" : ""}`} aria-pressed={statusFilter===t} onClick={()=>setStatusFilter(t)}><span style={{textTransform:"capitalize"}}>{t}</span><span className="ui-count">{t==="all" ? bots.length : bots.filter(b=>t==="active" ? b.is_active : !b.is_active).length}</span></button>)}</div><div className="ui-grow"/><div className="ui-search" style={{width:260}}><Search/><input className="ui-input" aria-label="Search bots" placeholder="Filter by name" value={query} onChange={e=>setQuery(e.target.value)}/></div><button className="ui-iconbtn ui-iconbtn--bordered" aria-label="Refresh bots" onClick={load}><RefreshCw/></button></div>
      <Card>
        {loading
          ? <Spinner />
          : <Table
              cols={cols as Parameters<typeof Table>[0]["cols"]}
              rows={bots.filter(b => (statusFilter==="all" || (statusFilter==="active" ? b.is_active : !b.is_active)) && b.name.toLowerCase().includes(query.toLowerCase())) as unknown as Record<string, unknown>[]}
              onRowClick={row => navigate(`/bots/${row["_id"]}`)}
            />
        }
      </Card>

      </div>
      {showCreate && (
        <RegisterBotModal
          onClose={() => setShowCreate(false)}
          onCreated={(name, key) => { setShowCreate(false); setNewKey({ name, key }); load(); }}
        />
      )}

      {deleteTarget && (
        <Confirm
          message={`Delete bot "${deleteTarget.name}"? Its API key stops working immediately.`}
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget)}
        />
      )}
    </div>
  );
}

function RegisterBotModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string, key: string) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      const d = await api.post<AiBot & { api_key: string }>("/__config/admin/ai/bots", { name });
      onCreated(d.name, d.api_key);
    } catch (err) { setError(String(err)); setSaving(false); }
  }

  return (
    <Modal title="New Bot" onClose={onClose} width={460}>
        {error && <ErrorBanner message={error} />}
        <form onSubmit={submit}>
          <Field label="Bot Name" hint="e.g. member-portal-bot, claims-assistant">
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} required autoFocus placeholder="my-chatbot" />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
            <Btn type="submit" disabled={saving}>{saving ? "Creating…" : "Create bot"}</Btn>
          </div>
        </form>
    </Modal>
  );
}
