import { useState } from "react";
import { api } from "../../../api/client";
import type { Endpoint, SchemaField } from "../../../api/types";
import { Card, SectionHead, Btn, ErrorBanner, JsonViewer } from "../../../components";
import { useSession } from "../../../auth/SessionContext";
import { SchemaFieldTree } from "./SchemaFieldTree";

interface Props { appId: string; endpoint: Endpoint; onSaved: (ep: Endpoint) => void; }

export function ResponseSchemaTab({ appId, endpoint, onSaved }: Props) {
  const { can } = useSession();
  const [schema, setSchema] = useState<SchemaField[]>(endpoint.output_schema ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true); setError("");
    try {
      const ep = await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${endpoint._id}/output-schema`, schema);
      onSaved(ep);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}
      <Card>
        <SectionHead title="Output Schema — what the frontend receives" action={can("edit:endpoints") ? <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Schema"}</Btn> : undefined} />
        <div style={{ padding: 16 }}>
          <SchemaFieldTree fields={schema} onChange={setSchema} readOnly={!can("edit:endpoints")} />
        </div>
        <div style={{ padding: "0 16px 12px" }}><JsonViewer data={schema} /></div>
      </Card>
    </div>
  );
}
