import { usePageSave } from "../../../components/PageSave";
import { useState } from "react";
import { api } from "../../../api/client";
import type { Endpoint, SchemaField } from "../../../api/types";
import { Card, SectionHead, Btn, ErrorBanner, C, Toggle } from "../../../components";
import { SchemaBodyPreview } from "./SchemaBodyPreview";
import { useSession } from "../../../auth/SessionContext";
import { SchemaFieldTree } from "./SchemaFieldTree";

interface Props { appId: string; endpoint: Endpoint; onSaved: (ep: Endpoint) => void; }

export function ResponseSchemaTab({ appId, endpoint, onSaved }: Props) {
  const { can } = useSession();
  const [schema, setSchema]         = useState<SchemaField[]>(endpoint.output_schema ?? []);
  const [arrayMode, setArrayMode]   = useState(Boolean(endpoint.output_array_mode));
  const [saving, setSaving]         = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [error, setError]           = useState("");

  usePageSave({schema,arrayMode},save,{enabled:can("edit:endpoints"),disabled:saving});

  async function save() {
    setSaving(true); setError("");
    try {
      let ep = await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${endpoint._id}/output-schema`, schema);
      if(arrayMode!==Boolean(endpoint.output_array_mode))ep=await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${endpoint._id}`,{output_array_mode:arrayMode});
      onSaved(ep);
    } catch (e) { setError(String(e)); throw e; }
    finally { setSaving(false); }
  }

  function toggleArrayMode(next:boolean){if(can("edit:endpoints"))setArrayMode(next);}

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      {/* ── Array mode toggle ── */}
      <Card>
        <SectionHead title="Response Shape" />
        <div style={{ padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div className="ui-row" style={{alignItems:"flex-start",gap:12}}>
            <Toggle checked={arrayMode} disabled={!can("edit:endpoints") || savingMode} onChange={toggleArrayMode} label="Upstream returns a root-level array" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Upstream returns a root-level array</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                When checked, field mappings are applied to <strong>each item</strong> in the array individually.
                The output will be an array of objects.
                Also fixes the Sample tab — paths will show as <code>$.id</code> instead of <code>$.0.id</code>.
              </div>
            </div>
          </div>
          {savingMode && <span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>Saving…</span>}
        </div>
        {arrayMode && (
          <div style={{ margin: "0 16px 12px 16px", padding: "8px 12px", background: "var(--selection)", borderRadius: C.radius, fontSize: 12, color: C.primary }}>
            ✓ Array mode active — schema fields below describe <strong>one item</strong>. The transformed output will be an array of mapped objects.
          </div>
        )}
      </Card>

      {/* ── Schema editor ── */}
      <Card>
        <SectionHead
          title="Output Schema — what the frontend receives"
          action={can("edit:endpoints") ? <Btn size="sm" pageSave onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Schema"}</Btn> : undefined}
        />
        <div style={{ padding: 16 }}>
          <SchemaFieldTree fields={schema} onChange={setSchema} readOnly={!can("edit:endpoints")} />
        </div>
      </Card>
      <SchemaBodyPreview schema={schema} label={arrayMode ? "RESPONSE BODY (array item shape)" : "RESPONSE BODY"} />
    </div>
  );
}
