import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../api/client";
import type { AiBot } from "../../../api/types";
import { Card, SectionHead, Btn, Confirm, ErrorBanner, C } from "../../../components";

interface Props { bot: AiBot; onUpdated: (b: AiBot) => void; readonly: boolean; }

export function OverviewTab({ bot, onUpdated, readonly }: Props) {
  const navigate = useNavigate();
  const [toggling, setToggling] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [error, setError] = useState("");

  async function toggleActive() {
    setToggling(true); setError("");
    try {
      const d = await api.put<AiBot>(`/__config/admin/ai/bots/${bot._id}`, { is_active: !bot.is_active });
      onUpdated(d);
    } catch (e) { setError(String(e)); }
    finally { setToggling(false); }
  }

  async function handleDelete() {
    try { await api.del(`/__config/admin/ai/bots/${bot._id}`); navigate("/bots"); }
    catch (e) { setError(String(e)); setDeleteConfirm(false); }
  }

  const mcpUrl = `${window.location.origin}/mcp`;
  const mcpConfig = JSON.stringify({ mcpServers: { orchestrator: { url: mcpUrl, headers: { "X-Bot-Key": "<your-bot-key>" } } } }, null, 2);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      {/* Status */}
      <Card>
        <SectionHead title="Bot Status" />
        <div style={{ padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{bot.is_active ? "Active" : "Disabled"}</div>
            <div style={{ fontSize: 12, color: C.muted }}>
              {bot.is_active
                ? "Bot can authenticate and call the AI agent and MCP endpoints."
                : "Bot is disabled. All requests with its key return 401."}
            </div>
          </div>
          {!readonly && (
            <Btn
              variant={bot.is_active ? "outline" : "primary"}
              onClick={toggleActive}
              disabled={toggling}
            >
              {toggling ? "Saving…" : bot.is_active ? "Disable" : "Enable"}
            </Btn>
          )}
        </div>
      </Card>

      {/* Details */}
      <Card>
        <SectionHead title="Details" />
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          <Row label="Bot ID"><code style={{ fontSize: 11, background: C.bg, padding: "1px 6px", borderRadius: 3 }}>{bot._id}</code></Row>
          <Row label="Created">{new Date(bot.created_at).toLocaleString()}</Row>
          <Row label="Last used">{bot.last_used_at ? new Date(bot.last_used_at).toLocaleString() : <span style={{ color: C.muted }}>Never</span>}</Row>
          <Row label="Apps assigned">{bot.allowed_app_ids.length}</Row>
          <Row label="Providers assigned">{bot.allowed_provider_ids.length}</Row>
          <Row label="Rules">{bot.rules.length}</Row>
        </div>
      </Card>

      {/* API Key */}
      <Card>
        <SectionHead title="API Key" />
        <div style={{ padding: 16, fontSize: 13 }}>
          <div style={{ marginBottom: 8, color: C.muted }}>
            The bot's API key is shown once at registration and is not retrievable. Send it as the <code>X-Bot-Key</code> header on every request.
          </div>
          <div style={{ padding: "8px 12px", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: C.radius, fontSize: 12, color: "#92400e" }}>
            ⚠ If the key is lost, delete this bot and register a new one — the key cannot be recovered or reset.
          </div>
        </div>
      </Card>

      {/* MCP info */}
      <Card>
        <SectionHead title="MCP Client Configuration" />
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>
            Add this bot to any MCP-compatible client (Claude Desktop, Cursor, VS Code Copilot, LangChain agents…):
          </div>
          <pre style={{
            background: "#1e1e2e", color: "#cdd6f4", borderRadius: C.radius,
            padding: "12px 16px", fontSize: 12, overflowX: "auto", margin: 0,
          }}>{mcpConfig}</pre>
          <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
            Replace <code>&lt;your-bot-key&gt;</code> with the key shown at registration.
            The MCP client discovers tools automatically based on this bot's assigned apps.
          </div>
        </div>
      </Card>

      {/* Danger zone */}
      {!readonly && (
        <Card style={{ border: `1px solid ${C.danger}30` }}>
          <SectionHead title="Danger Zone" />
          <div style={{ padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: C.danger }}>Delete this bot</div>
              <div style={{ fontSize: 12, color: C.muted }}>Permanently deletes the bot and revokes its key immediately. Cannot be undone.</div>
            </div>
            <Btn variant="danger" onClick={() => setDeleteConfirm(true)}>Delete Bot</Btn>
          </div>
        </Card>
      )}

      {deleteConfirm && (
        <Confirm
          message={`Delete bot "${bot.name}"? Its API key stops working immediately.`}
          danger
          onCancel={() => setDeleteConfirm(false)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <span style={{ color: C.muted, fontWeight: 600, minWidth: 120, fontSize: 12 }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}
