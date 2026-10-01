import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { AiBot, AiProvider, ListResult } from "../../api/types";
import { Card, SectionHead, Table, Btn, Badge, Field, inputStyle, Spinner, ErrorBanner, Confirm, C } from "../../components";
import { useSession } from "../../auth/SessionContext";
import { ImportBotModal } from "./ImportBotModal";

export function BotsPage() {
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
    catch (e) { alert(String(e)); }
  }

  const cols = [
    {
      key: "name", label: "Bot",
      render: (_: unknown, row: Record<string, unknown>) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{String(row["name"])}</div>
          <div style={{ fontSize: 11, color: C.muted }}>
            {(row["allowed_app_ids"] as string[])?.length ?? 0} apps ·{" "}
            {(row["allowed_provider_ids"] as string[])?.length ?? 0} providers ·{" "}
            {(row["rules"] as string[])?.length ?? 0} rules
          </div>
        </div>
      ),
    },
    { key: "is_active", label: "Status", render: (v: unknown) => <Badge text={v ? "active" : "disabled"} /> },
    {
      key: "last_used_at", label: "Last Used",
      render: (v: unknown) => v ? new Date(String(v)).toLocaleString() : <span style={{ color: C.muted }}>never</span>,
    },
    {
      key: "_id", label: "Actions",
      render: (_: unknown, row: Record<string, unknown>) => (
        <div style={{ display: "flex", gap: 6 }}>
          <Btn size="sm" variant="outline" onClick={e => { e.stopPropagation(); navigate(`/bots/${row["_id"]}`); }}>Configure</Btn>
          {can("manage:providers") && (
            <Btn size="sm" variant="danger" onClick={e => { e.stopPropagation(); setDeleteTarget(row as unknown as AiBot); }}>Delete</Btn>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexShrink: 0 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Bot Registry</h1>
          <p style={{ margin: "2px 0 0", color: C.muted, fontSize: 13 }}>
            Register and configure chatbot clients. Each bot gets a unique key, its own app bindings, rules, and LLM provider.
          </p>
        </div>
        {can("manage:providers") && (
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="outline" onClick={() => setShowImport(true)}>Import Bot ↑</Btn>
            <Btn onClick={() => setShowCreate(true)}>+ Register Bot</Btn>
          </div>
        )}
      </div>

      {showImport && (
        <ImportBotModal
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}

      {error && <ErrorBanner message={error} />}

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

      <Card style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <SectionHead
          title={`${bots.length} bot${bots.length !== 1 ? "s" : ""}`}
          action={<Btn size="sm" variant="ghost" onClick={load}>Refresh</Btn>}
        />
        {loading
          ? <Spinner />
          : <Table
              cols={cols as Parameters<typeof Table>[0]["cols"]}
              rows={bots as unknown as Record<string, unknown>[]}
              onRowClick={row => navigate(`/bots/${row["_id"]}`)}
            />
        }
      </Card>

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
    <div style={{ position: "fixed", inset: 0, background: C.overlay, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: C.surface, borderRadius: C.radius, width: 420, padding: 24, boxShadow: C.shadowModal, border: `1px solid ${C.border}` }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Register Bot</h2>
        {error && <ErrorBanner message={error} />}
        <form onSubmit={submit}>
          <Field label="Bot Name" hint="e.g. member-portal-bot, claims-assistant">
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} required autoFocus placeholder="my-chatbot" />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
            <Btn type="submit" disabled={saving}>{saving ? "Registering…" : "Register"}</Btn>
          </div>
        </form>
      </div>
    </div>
  );
}
