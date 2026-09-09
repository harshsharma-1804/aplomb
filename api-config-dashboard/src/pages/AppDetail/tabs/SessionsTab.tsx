import { useState, useEffect, useCallback } from "react";
import { api } from "../../../api/client";
import type { AppSessionSummary, ListResult } from "../../../api/types";
import { Card, SectionHead, Btn, ErrorBanner, Confirm, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

/** Active app sessions (all devices, all users) — admin view with revoke. */
export function SessionsTab({ appId }: { appId: string }) {
  const { can } = useSession();
  const readonly = !can("manage:apps");
  const [sessions, setSessions] = useState<AppSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<AppSessionSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const d = await api.get<ListResult<AppSessionSummary>>(`/__config/apps/${appId}/sessions`);
      setSessions(d.results);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [appId]);

  useEffect(() => { load(); }, [load]);

  async function revoke(id: string) {
    try {
      await api.del(`/__config/apps/${appId}/sessions/${id}`);
      setRevokeTarget(null);
      load();
    } catch (e) { alert(String(e)); }
  }

  function relTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <Card>
      <SectionHead
        title={`Active Sessions (${sessions.length})`}
        action={<Btn size="sm" variant="ghost" onClick={load}>↻ Refresh</Btn>}
      />
      <div style={{ padding: "10px 16px", background: "#f0f7ff", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "#1e40af" }}>
        One row per device — a user can be signed in from their laptop, phone and tablet simultaneously.
        Revoking a device kills only that session; the others keep working.
      </div>
      <div style={{ padding: 16 }}>
        {error && <ErrorBanner message={error} />}
        {loading ? <span style={{ fontSize: 12, color: C.muted }}>Loading…</span> : sessions.length === 0 ? (
          <p style={{ fontSize: 12, color: C.muted }}>No active sessions right now.</p>
        ) : (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr 1fr 1fr auto", gap: "0 10px", padding: "4px 8px", marginBottom: 4 }}>
              {["USER", "DEVICE", "LAST IP", "LAST ACTIVE", "EXPIRES", ""].map(h => (
                <span key={h} style={{ fontSize: 10, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>{h}</span>
              ))}
            </div>
            {sessions.map(s => (
              <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr 1fr 1fr auto", gap: "0 10px", alignItems: "center", padding: "8px 8px", borderRadius: C.radius, border: `1px solid ${C.border}`, marginBottom: 4, background: C.surface }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.email || s.sub}</div>
                  <code style={{ fontSize: 11, color: C.muted }}>{s.sub}</code>
                </div>
                <span style={{ fontSize: 12 }}>{s.device_label}</span>
                <code style={{ fontSize: 11, color: C.muted }}>{s.last_seen_ip ?? "—"}</code>
                <span style={{ fontSize: 12, color: C.muted }} title={s.last_active_at}>{relTime(s.last_active_at)}</span>
                <span style={{ fontSize: 12, color: C.muted }} title={s.idle_expires_at}>
                  idle {relTime(s.idle_expires_at) === "just now" ? "—" : new Date(s.idle_expires_at).toLocaleTimeString()}
                </span>
                {!readonly && (
                  <Btn size="sm" variant="danger" onClick={() => setRevokeTarget(s)}>Revoke</Btn>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {revokeTarget && (
        <Confirm
          danger
          message={`Revoke the ${revokeTarget.device_label} session for ${revokeTarget.email || revokeTarget.sub}? That device will need to log in again.`}
          onConfirm={() => revoke(revokeTarget.id)}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </Card>
  );
}
