import { useState } from "react";
import { api } from "../../../api/client";
import type { Endpoint } from "../../../api/types";
import { Card, SectionHead, Btn, Field, ErrorBanner, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

interface Props { appId: string; endpoint: Endpoint; onSaved: (ep: Endpoint) => void; }

interface FieldNode { path: string; children?: FieldNode[]; }

function extractPaths(obj: unknown, prefix = ""): FieldNode[] {
  if (typeof obj !== "object" || obj === null) return [];
  const nodes: FieldNode[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const children = typeof v === "object" && v !== null && !Array.isArray(v) ? extractPaths(v, path) : Array.isArray(v) && v.length > 0 && typeof v[0] === "object" ? extractPaths(v[0] as object, `${path}[]`) : undefined;
    nodes.push({ path: `$.${path}`, children });
  }
  return nodes;
}

function FieldNode({ node, onSelect }: { node: FieldNode; onSelect: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginLeft: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "2px 0" }}>
        {node.children && node.children.length > 0 && (
          <button onClick={() => setOpen(o => !o)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: C.muted, padding: 0, width: 14 }}>{open ? "▼" : "▶"}</button>
        )}
        {(!node.children || node.children.length === 0) && <span style={{ width: 14 }} />}
        <code onClick={() => onSelect(node.path)} style={{ fontSize: 11, color: C.primary, cursor: "pointer", background: C.bg, padding: "1px 5px", borderRadius: 3 }} title="Click to copy">{node.path}</code>
      </div>
      {open && node.children?.map((child, i) => <FieldNode key={i} node={child} onSelect={onSelect} />)}
    </div>
  );
}

export function SampleTab({ appId, endpoint, onSaved }: Props) {
  const { can } = useSession();
  const [raw, setRaw] = useState(endpoint.sample_response ? JSON.stringify(endpoint.sample_response.json, null, 2) : "");
  const [parsed, setParsed] = useState<FieldNode[]>([]);
  const [parseError, setParseError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  function parse() {
    setParseError("");
    try {
      const obj = JSON.parse(raw);
      setParsed(extractPaths(obj));
    } catch (e) { setParseError("Invalid JSON — " + String(e)); }
  }

  function copyPath(path: string) {
    navigator.clipboard.writeText(path).catch(() => {});
    setCopied(path);
    setTimeout(() => setCopied(""), 2000);
  }

  async function save() {
    setSaving(true); setError("");
    try {
      const json = JSON.parse(raw);
      const ep = await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${endpoint._id}/sample`, { json, captured_at: new Date().toISOString() });
      onSaved(ep);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}
      <Card>
        <SectionHead title="Paste Upstream Sample Response"
          action={
            <div style={{ display: "flex", gap: 8 }}>
              <Btn size="sm" variant="ghost" onClick={parse}>Parse Fields</Btn>
              {can("edit:endpoints") && <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Sample"}</Btn>}
            </div>
          } />
        <div style={{ padding: 16 }}>
          {parseError && <div style={{ fontSize: 12, color: C.danger, marginBottom: 8 }}>{parseError}</div>}
          <textarea value={raw} onChange={e => setRaw(e.target.value)} disabled={!can("edit:endpoints")}
            style={{ width: "100%", height: 220, fontFamily: "monospace", fontSize: 12, padding: 10, border: `1px solid ${C.border}`, borderRadius: C.radius, resize: "vertical", boxSizing: "border-box", background: "var(--paste-editor-bg)", color: C.codeText }}
            placeholder='Paste JSON response from upstream here, then click "Parse Fields"' />
        </div>
      </Card>

      {parsed.length > 0 && (
        <Card>
          <SectionHead title="Parsed Fields — click any path to copy" />
          <div style={{ padding: 16, maxHeight: 320, overflowY: "auto" }}>
            {copied && <div style={{ fontSize: 11, color: C.success, marginBottom: 8 }}>Copied: {copied}</div>}
            {parsed.map((node, i) => <FieldNode key={i} node={node} onSelect={copyPath} />)}
          </div>
        </Card>
      )}
    </div>
  );
}
