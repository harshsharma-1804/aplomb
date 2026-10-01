import { useState } from "react";
import { useSession } from "../../auth/SessionContext";
import { C, ErrorBanner } from "../../components";

export function LoginPage() {
  const { login } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      await login(username, password);
    } catch (err) {
      setError(String(err).replace("Error: ", ""));
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.canvas, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui,sans-serif" }}>
      <div style={{ background: C.surface, borderRadius: C.radiusFeature, padding: "36px 40px", width: 380, maxWidth: "90vw", boxShadow: C.shadowModal, border: `1px solid ${C.border}` }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>⚡</div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text }}>API Orchestrator</h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: C.muted }}>Config Dashboard — sign in to continue</p>
        </div>

        {error && <ErrorBanner message={error} />}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".4px" }}>Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} required autoFocus
              style={{ width: "100%", padding: "10px 12px", border: `1px solid ${C.borderStrong}`, borderRadius: C.radius, fontSize: 14, color: C.text, background: C.surface, boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".4px" }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              style={{ width: "100%", padding: "10px 12px", border: `1px solid ${C.borderStrong}`, borderRadius: C.radius, fontSize: 14, color: C.text, background: C.surface, boxSizing: "border-box" }} />
          </div>
          <button type="submit" disabled={loading} style={{ width: "100%", padding: "11px 0", background: loading ? C.muted : C.primary, color: C.primaryText, border: "none", borderRadius: C.radius, fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
