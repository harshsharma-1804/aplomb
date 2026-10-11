import { usePageSave } from "../../../components/PageSave";
import { Sparkles } from "lucide-react";
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

  usePageSave({sample:raw},save,{enabled:can("edit:endpoints"),disabled:saving});

  function parse() {
    setParseError("");
    try {
      const obj = JSON.parse(raw);
      // If root is an array, use the first element for path extraction so
      // paths are relative to a single item ($.id, $.name) rather than the
      // array index ($.0.id, $.0.name). This matches how output_array_mode works.
      const target = Array.isArray(obj) ? (obj[0] ?? {}) : obj;
      setParsed(extractPaths(target));
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
    } catch (e) { setError(String(e)); throw e; }
    finally { setSaving(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}
      <Card>
        <SectionHead title="Sample response"
          action={
            <div style={{ display: "flex", gap: 8 }}>
              <Btn size="sm" variant="secondary" onClick={parse}><Sparkles size={16} /> Parse fields</Btn>
              {can("edit:endpoints") && <Btn size="sm" pageSave onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Sample"}</Btn>}
            </div>
          } />
        <div style={{ padding: 16 }}>
          {parseError && <ErrorBanner message={parseError}/>}
          <div className="ui-code"><div className="ui-code__bar"><span>Upstream sample · JSON</span></div>
            <textarea aria-label="Sample response JSON" value={raw} onChange={e => setRaw(e.target.value)} disabled={!can("edit:endpoints")}
              style={{width:"100%",minHeight:300,fontFamily:"var(--font-mono)",fontSize:13,padding:16,border:0,resize:"vertical",boxSizing:"border-box",background:"var(--code-bg)",color:"var(--code-text)"}}
              placeholder='Paste an upstream JSON response, then parse its fields.' />
          </div>
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
