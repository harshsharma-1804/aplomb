import { useState, useEffect } from "react";
import { api } from "../../../api/client";
import type { HostAllowlistEntry, ListResult } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, Spinner, Confirm, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

export function HostAllowlistTab() {
  const { can } = useSession();
  const [entries, setEntries] = useState<HostAllowlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [hostname, setHostname] = useState("");
  const [description, setDescription] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<HostAllowlistEntry | null>(null);

  async function load() {
    setLoading(true);
    try {
      const d = await api.get<ListResult<HostAllowlistEntry>>("/__config/admin/host-allowlist");
      setEntries(d.results);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function addHost(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true); setAddError("");
    try {
      await api.post("/__config/admin/host-allowlist", { hostname, description });
      setHostname(""); setDescription(""); setShowAdd(false);
      load();
    } catch (err) { setAddError(String(err)); }
    finally { setAdding(false); }
  }

  async function deleteHost(entry: HostAllowlistEntry) {
    try {
      await api.del(`/__config/admin/host-allowlist/${entry._id}`);
      setDeleteTarget(null);
      load();
    } catch (e) { alert(String(e)); }
  }

  const isWildcard = hostname.startsWith("*.");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      <Card>
        <SectionHead
          title={`Allowed Upstream Hosts (${entries.length})`}
          action={can("manage:users") ? <Btn size="sm" onClick={() => setShowAdd(s => !s)}>{showAdd ? "Cancel" : "+ Add Host"}</Btn> : undefined}
        />

        {showAdd && (
          <form onSubmit={addHost} style={{ padding: 16, borderBottom: `1px solid ${C.border}`, background: "var(--surface-muted)" }}>
            {addError && <ErrorBanner message={addError} />}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
              <Field
                label="Hostname"
                hint={isWildcard ? "✓ Wildcard — matches all subdomains of " + hostname.slice(2) : hostname ? "Exact match only" : "e.g. jsonplaceholder.typicode.com or *.typicode.com"}
              >
                <input
                  style={{ ...inputStyle, borderColor: isWildcard ? "var(--warning)" : C.border }}
                  value={hostname}
                  onChange={e => setHostname(e.target.value.trim())}
                  placeholder="jsonplaceholder.typicode.com"
                  autoFocus
                  required
                />
              </Field>
              <Field label="Description (optional)">
                <input style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} placeholder="JSON Placeholder test API" />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <Btn size="sm" type="submit" disabled={adding}>{adding ? "Adding…" : "Add"}</Btn>
            </div>
          </form>
        )}

        <div style={{ padding: 16 }}>
          {loading ? <Spinner /> : entries.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: C.muted, fontSize: 13 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🌐</div>
              No hosts allowlisted yet. Add a host to allow your endpoints to call it.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.bg }}>
                  {["Hostname", "Type", "Description", "Added", ""].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: C.muted, fontSize: 11, borderBottom: `1px solid ${C.border}`, textTransform: "uppercase", letterSpacing: ".4px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry._id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "10px 12px" }}>
                      <code style={{ fontSize: 13, color: C.primary, fontWeight: 600 }}>{entry.hostname}</code>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 99, fontWeight: 600, background: entry.is_wildcard ? "var(--warning-background)" : "var(--selection)", color: entry.is_wildcard ? "var(--warning)" : "var(--primary)" }}>
                        {entry.is_wildcard ? "wildcard" : "exact"}
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
          <strong>Wildcard:</strong> <code>*.typicode.com</code> allows <code>jsonplaceholder.typicode.com</code> and all other subdomains. &nbsp;
          <strong>Env var:</strong> <code>UPSTREAM_HOST_ALLOWLIST</code> is deprecated — hosts added here replace it.
        </div>
      </Card>

      {deleteTarget && (
        <Confirm
          danger
          message={`Remove "${deleteTarget.hostname}" from the allowlist? Endpoints using this host will be blocked.`}
          onConfirm={() => deleteHost(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
