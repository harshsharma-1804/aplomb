import { Plus, Trash2 } from "lucide-react";
import { PageHeaderActions, notifyToast } from "../../../components/PageSave";
import { CollectionHead } from "../../../components/CollectionHead";
import { useState, useEffect } from "react";
import { api } from "../../../api/client";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, Spinner, Confirm, C, Modal, Table } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

interface CorsOriginEntry {
  id: string;
  origin: string;
  description: string;
  created_at: string;
}

export function AllowedOriginsTab() {
  const { can } = useSession();
  const [entries, setEntries] = useState<CorsOriginEntry[]>([]);
  const [query,setQuery]=useState("");
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
      await api.del(`/__config/admin/cors-origins/${entry.id}`);
      setDeleteTarget(null);
      load();
    } catch (e) { setError(String(e)); }
  }

  const isWildcard = origin.trim() === "*";
  const isValid = origin.trim() === "*" || /^https?:\/\/.+/.test(origin.trim());

  return <>
    {can("manage:users") && <PageHeaderActions><Btn onClick={()=>setShowAdd(true)}><Plus/>Add origin</Btn></PageHeaderActions>}
    {error && <ErrorBanner message={error}/>}
    <Card><CollectionHead count={entries.length} noun="origins" query={query} onQuery={setQuery} onRefresh={load}/>
      {loading ? <Spinner/> : <Table cols={[
        {key:"origin",label:"Origin",render:v=><strong className="ui-mono">{String(v)}</strong>},
        {key:"_type",label:"Type",render:(_,r)=><span className="ui-badge">{String(r.origin).includes("*") ? "Wildcard" : "Exact"}</span>},
        {key:"description",label:"Description",render:v=><span className="ui-muted">{String(v || "—")}</span>},
        {key:"created_at",label:"Added",render:v=><span className="ui-muted ui-num">{new Date(String(v)).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"})}</span>},
        {key:"_actions",label:"",render:(_,r)=>can("manage:users") && <button className="ui-iconbtn" aria-label={`Delete ${r.origin}`} onClick={()=>setDeleteTarget(r as unknown as typeof entries[number])}><Trash2/></button>}
      ]} rows={entries.filter(e=>`${e.origin} ${e.description}`.toLowerCase().includes(query.toLowerCase())) as unknown as Record<string,unknown>[]}/>}
      <div className="ui-card__foot">Browser origins allowed to call the runtime API. Server-to-server calls are unaffected.</div>
    </Card>
    {showAdd && <Modal title="Add origin" onClose={()=>!adding && setShowAdd(false)}>          <form onSubmit={addOrigin}>
            {addError && <ErrorBanner message={addError} />}
            <div className="app-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
              <Field
                label="Origin"
                hint={
                  isWildcard ? "⚠ Wildcard — allows ALL origins. Not recommended for production." :
                  isValid && origin ? "✓ Valid origin" :
                  "Full scheme + host, e.g. https://myapp.com or http://localhost:3000"
                }
              >
                <input
                  style={{ ...inputStyle, borderColor: isWildcard ? "var(--warning)" : isValid && origin ? C.success : C.border }}
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
            <div className="ui-modal__foot"><Btn variant="secondary" disabled={adding} onClick={()=>setShowAdd(false)}>Cancel</Btn>
              <Btn size="sm" type="submit" disabled={adding || !isValid}>{adding ? "Adding…" : "Add origin"}</Btn>
            </div>
          </form></Modal>}
    {deleteTarget && <Confirm danger message={`Remove "${deleteTarget.origin}"? Browser requests from this origin will be blocked.`} onConfirm={()=>deleteOrigin(deleteTarget)} onCancel={()=>setDeleteTarget(null)}/>}
  </>;
}
