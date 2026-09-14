import { useState, useEffect } from "react";
import type { App, AiBot, ExportEnvMode } from "../../api/types";
import { api } from "../../api/client";
import { Modal, Btn, C } from "../../components";

interface Props {
  app: App;
  onClose: () => void;
}

export function ExportAppModal({ app, onClose }: Props) {
  const [inclEndpoints, setInclEndpoints] = useState(true);
  const [inclScripts,   setInclScripts]   = useState(true);
  const [inclEnv,       setInclEnv]       = useState(true);
  const [inclBot,       setInclBot]       = useState(false);
  const [boundBot,      setBoundBot]      = useState<AiBot | null>(null);
  const [envMode,       setEnvMode]       = useState<ExportEnvMode>("keys");
  const [downloading,   setDownloading]   = useState(false);
  const [error,         setError]         = useState("");

  const hasEnv = (app.app_env ?? []).length > 0;

  useEffect(() => {
    let cancelled = false;
    api.get<{ results: AiBot[] }>("/__config/admin/ai/bots")
      .then(d => {
        if (cancelled) return;
        const bot = d.results.find(b => b.allowed_app_ids.includes(app._id));
        if (bot) {
          setBoundBot(bot);
          setInclBot(true);
        }
      })
      .catch(() => { /* non-fatal — checkbox simply not offered */ });
    return () => { cancelled = true; };
  }, [app._id]);

  async function handleExport() {
    setDownloading(true);
    setError("");
    try {
      const include: string[] = [];
      if (inclEndpoints) include.push("endpoints");
      if (inclScripts)   include.push("scripts");
      if (inclBot && boundBot) include.push("bots");

      const params = new URLSearchParams({
        include: include.join(","),
        env:     inclEnv ? envMode : "none",
      });

      const res = await fetch(`/__config/apps/${app._id}/export?${params}`, {
        credentials: "include",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `Export failed (${res.status})`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `${app.name}-export.json`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename!;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(false);
    }
  }

  const nothingSelected = !inclEndpoints && !inclScripts && !inclEnv && !(inclBot && boundBot);

  return (
    <Modal title={`Export "${app.name}"`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {error && (
          <div style={{ padding: "8px 12px", background: "#fef2f2", border: `1px solid #fca5a5`, borderRadius: C.radius, color: "#b91c1c", fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* ── What to include ─────────────────────────────────────────── */}
        <section>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
            What to include
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <CheckRow
              checked={inclEndpoints}
              onChange={setInclEndpoints}
              label="Endpoints"
              hint={`${app.name} — all endpoint configs, schemas, upstream settings, field mappings`}
            />
            <CheckRow
              checked={inclScripts}
              onChange={setInclScripts}
              label="Scripts"
              hint="All app scripts (source only — recompiled on import)"
            />
            {boundBot && (
              <CheckRow
                checked={inclBot}
                onChange={setInclBot}
                label={`AI bot — ${boundBot.name}`}
                hint="Bot definition, rules, limits + its AI providers (the bot gets a NEW key on import — keys can never be exported)"
              />
            )}
          </div>
        </section>

        {/* ── Environment variables ────────────────────────────────────── */}
        {hasEnv && (
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
              Environment variables
            </div>
            <CheckRow
              checked={inclEnv}
              onChange={setInclEnv}
              label="Include env vars"
              hint={`${app.app_env.length} variable${app.app_env.length !== 1 ? "s" : ""} configured`}
            />
            {inclEnv && (
              <div style={{ marginLeft: 28, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <RadioRow
                  selected={envMode === "keys"}
                  onSelect={() => setEnvMode("keys")}
                  label="Keys only"
                  hint="Variable names exported, values stripped (safest)"
                />
                <RadioRow
                  selected={envMode === "values"}
                  onSelect={() => setEnvMode("values")}
                  label="Keys + plain values"
                  hint="Plain text values included; secret refs always exported without values"
                />
              </div>
            )}
          </section>
        )}

        {/* ── Secret note ─────────────────────────────────────────────── */}
        <div style={{ padding: "8px 12px", background: "#f0fdf4", border: `1px solid #86efac`, borderRadius: C.radius, fontSize: 12, color: "#166534" }}>
          Secret values are never exported regardless of your selection. Secret references export as key names only — ensure the same secrets exist on the target instance. AI provider API keys follow the same rule: providers export by name, the import links them to a same-named secret.
        </div>

        {/* ── Format ──────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span style={{ color: C.muted, fontWeight: 600 }}>Format:</span>
          <span style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: C.radius, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>JSON</span>
        </div>

        {/* ── Actions ─────────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleExport} disabled={downloading || nothingSelected}>
            {downloading ? "Preparing…" : "Export ↓"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function CheckRow({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: C.primary, width: 15, height: 15, flexShrink: 0 }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{hint}</div>
      </div>
    </label>
  );
}

function RadioRow({ selected, onSelect, label, hint }: { selected: boolean; onSelect: () => void; label: string; hint: string }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
      <input
        type="radio"
        checked={selected}
        onChange={onSelect}
        style={{ marginTop: 2, accentColor: C.primary, width: 14, height: 14, flexShrink: 0 }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{hint}</div>
      </div>
    </label>
  );
}
