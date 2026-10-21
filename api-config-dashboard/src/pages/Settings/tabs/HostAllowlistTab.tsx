import { Plus, Trash2 } from "lucide-react";
import { PageHeaderActions, notifyToast } from "../../../components/PageSave";
import { CollectionHead } from "../../../components/CollectionHead";
import { useState, useEffect } from "react";
import { api } from "../../../api/client";
import type { HostAllowlistEntry, ListResult } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, Spinner, Confirm, C, Modal, Table } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

export function HostAllowlistTab() {
  const { can } = useSession();
  const [entries, setEntries] = useState<HostAllowlistEntry[]>([]);
  const [query,setQuery]=useState("");
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
    } catch (e) { setError(String(e)); }
  }

  const isWildcard = hostname.startsWith("*.");

  return <>
    {can("manage:users") && <PageHeaderActions><Btn onClick={()=>setShowAdd(true)}><Plus/>Add host</Btn></PageHeaderActions>}
    {error && <ErrorBanner message={error}/>}
    <Card><CollectionHead count={entries.length} noun="hosts" query={query} onQuery={setQuery} onRefresh={load}/>
      {loading ? <Spinner/> : <Table cols={[
        {key:"hostname",label:"Host",render:v=><strong className="ui-mono">{String(v)}</strong>},
        {key:"_type",label:"Type",render:(_,r)=><span className="ui-badge">{String(r.hostname).includes("*") ? "Wildcard" : "Exact"}</span>},
        {key:"description",label:"Description",render:v=><span className="ui-muted">{String(v || "—")}</span>},
        {key:"created_at",label:"Added",render:v=><span className="ui-muted ui-num">{new Date(String(v)).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"})}</span>},
        {key:"_actions",label:"",render:(_,r)=>can("manage:users") && <button className="ui-iconbtn" aria-label={`Delete ${r.hostname}`} onClick={()=>setDeleteTarget(r as unknown as typeof entries[number])}><Trash2/></button>}
      ]} rows={entries.filter(e=>`${e.hostname} ${e.description}`.toLowerCase().includes(query.toLowerCase())) as unknown as Record<string,unknown>[]}/>}
      <div className="ui-card__foot">An empty allowlist blocks all upstream requests. Only listed hosts are allowed.</div>
    </Card>
    {showAdd && <Modal title="Add host" onClose={()=>!adding && setShowAdd(false)}>          <form onSubmit={addHost}>
            {addError && <ErrorBanner message={addError} />}
            <div className="app-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
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
            <div className="ui-modal__foot"><Btn variant="secondary" disabled={adding} onClick={()=>setShowAdd(false)}>Cancel</Btn>
              <Btn size="sm" type="submit" disabled={adding}>{adding ? "Adding…" : "Add host"}</Btn>
            </div>
          </form></Modal>}
    {deleteTarget && <Confirm danger message={`Remove "${deleteTarget.hostname}"? Endpoints using this host will be blocked.`} onConfirm={()=>deleteHost(deleteTarget)} onCancel={()=>setDeleteTarget(null)}/>}
  </>;
}
