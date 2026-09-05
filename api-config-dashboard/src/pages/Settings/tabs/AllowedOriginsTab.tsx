import { useState, useEffect } from "react";
import { api } from "../../../api/client";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, Spinner, Confirm, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

interface CorsOriginEntry {
  _id: string;
  origin: string;
  description: string;
  created_at: string;
}

export function AllowedOriginsTab() {
  const { can } = useSession();
  const [entries, setEntries] = useState<CorsOriginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [origin, setOrigin] = useState("");
  const [description, setDescription] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CorsOriginEntry | null>(null);

  async function load() {
    setLoading(true);
    try {
      const d = await api.get<{ count: number; results: CorsOriginEntry[] }>("/__config/admin/cors-origins");
      setEntries(d.results);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function addOrigin(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true); setAddError("");
    try {
      await api.post("/__config/admin/cors-origins", { origin, description });
      setOrigin(""); setDescription(""); setShowAdd(false);
      load();
    } catch (err) { setAddError(String(err)); }
    finally { setAdding(false); }
  }

  async function deleteOrigin(entry: CorsOriginEntry) {
    try {
      await api.del(`/__config/admin/cors-origins/${entry._id}`);
      setDeleteTarget(null);
      load();
    } catch (e) { alert(String(e)); }
  }

  const isWildcard = origin.trim() === "*";
  const isValid = origin.trim() === "*" || /^https?:\/\/.+/.test(origin.trim());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      <Card>
        <SectionHead
          title={`Allowed Origins — Runtime API (${entries.length})`}
          action={can("manage:users") ? <Btn size="sm" onClick={() => setShowAdd(s => !s)}>{showAdd ? "Cancel" : "+ Add Origin"}</Btn> : undefined}
        />

        {/* Explainer */}
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, background: "#f0f7ff", fontSize: 12, color: "#1e40af" }}>
          <strong>What this controls:</strong> which browser origins (websites) are allowed to call your runtime API endpoints via CORS.
          Your dashboard (<code>localhost:5000</code>) is always allowed for config routes regardless of this list.
          Add <code>https://myapp.com</code> here so your frontend can call your orchestrator endpoints.
          Use <code>*</code> to allow all origins (not recommended for production).
        </div>

        {showAdd && (
          <form onSubmit={addOrigin} style={{ padding: 16, borderBottom: `1px solid ${C.border}`, background: "#f8f9fa" }}>
            {addError && <ErrorBanner message={addError} />}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
              <Field
                label="Origin"
                hint={
                  isWildcard ? "⚠ Wildcard — allows ALL origins. Not recommended for production." :
                  isValid && origin ? "✓ Valid origin" :
                  "Full scheme + host, e.g. https://myapp.com or http://localhost:3000"
                }
              >
                <input
                  style={{ ...inputStyle, borderColor: isWildcard ? "#fd7e14" : isValid && origin ? C.success : C.border }}
                  value={origin}
                  onChange={e => setOrigin(e.target.value.trim())}
                  placeholder="https://myapp.com"
                  autoFocus
                  required
                />
              </Field>
              <Field label="Description (optional)">
                <input style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} placeholder="Main customer portal" />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <Btn size="sm" type="submit" disabled={adding || !isValid}>{adding ? "Adding…" : "Add"}</Btn>
            </div>
          </form>
        )}

        <div style={{ padding: 16 }}>
          {loading ? <Spinner /> : entries.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: C.muted, fontSize: 13 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🔒</div>
              No origins configured. All cross-origin requests to runtime endpoints will be blocked by browsers.<br />
              <span style={{ fontSize: 12 }}>Server-to-server calls (no browser) are unaffected by CORS.</span>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.bg }}>
                  {["Origin", "Type", "Description", "Added", ""].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: C.muted, fontSize: 11, borderBottom: `1px solid ${C.border}`, textTransform: "uppercase", letterSpacing: ".4px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry._id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "10px 12px" }}>
                      <code style={{ fontSize: 13, color: entry.origin === "*" ? C.danger : C.primary, fontWeight: 600 }}>{entry.origin}</code>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 99, fontWeight: 600, background: entry.origin === "*" ? "#fff8e1" : "#f0fff4", color: entry.origin === "*" ? "#92400e" : "#276749" }}>
                        {entry.origin === "*" ? "wildcard (all)" : "exact"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", color: C.muted, fontSize: 12 }}>{entry.description || "—"}</td>
                    <td style={{ padding: "10px 12px", color: C.muted, fontSize: 12 }}>{new Date(entry.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: "10px 12px" }}>
                      {can("manage:users") && (
                        <button onClick={() => setDeleteTarget(entry)} style={{ background: "none", border: "none", cursor: "pointer", color: C.danger, fontSize: 16 }}>×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: "10px 16px", borderTop: `1px solid ${C.border}`, background: C.bg, fontSize: 12, color: C.muted }}>
          <strong>OIDC callbacks:</strong> OIDC providers POST tokens server-to-server — they are not browser CORS requests and are unaffected by this list. &nbsp;
          <strong>OPTIONS preflight:</strong> Browser preflight requests are always answered without requiring auth so your OIDC-protected endpoints work correctly.
        </div>
      </Card>

      {deleteTarget && (
        <Confirm
          danger
          message={`Remove origin "${deleteTarget.origin}"? Browser requests from this origin to runtime endpoints will be blocked.`}
          onConfirm={() => deleteOrigin(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
