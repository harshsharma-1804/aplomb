import { usePageSave } from "../../../components/PageSave";
import { useState } from "react";
import { api } from "../../../api/client";
import type { Endpoint, SchemaField } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";
import { SchemaFieldTree } from "./SchemaFieldTree";
import { SchemaBodyPreview } from "./SchemaBodyPreview";

interface Props { appId: string; endpoint: Endpoint; onSaved: (ep: Endpoint) => void; }

export function RequestSchemaTab({ appId, endpoint, onSaved }: Props) {
  const { can } = useSession();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [schema, setSchema] = useState<SchemaField[]>(endpoint.request?.input_schema ?? []);
  const [contentType, setContentType] = useState<"application/json" | "application/x-www-form-urlencoded">(endpoint.request?.content_type ?? "application/json");
  const [validation, setValidation] = useState<"strict" | "permissive">(endpoint.request?.validation ?? "strict");
  const [maxBytes, setMaxBytes] = useState(String(endpoint.request?.max_body_bytes ?? 262144));

  usePageSave({schema,contentType,validation,maxBytes},save,{enabled:can("edit:endpoints") && !["GET","HEAD","DELETE"].includes(endpoint.method),disabled:saving});

  const isReadOnly = ["GET","HEAD","DELETE"].includes(endpoint.method);

  if (isReadOnly) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: C.muted, background: C.surface, borderRadius: C.radius, border: `1px solid ${C.border}` }}>
        Request body is not applicable for <strong>{endpoint.method}</strong> endpoints.
        <br /><small>Only POST, PUT, and PATCH endpoints can have a request schema.</small>
      </div>
    );
  }

  async function save() {
    setSaving(true); setError("");
    try {
      const ep = await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${endpoint._id}/input-schema`, schema);
      await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${endpoint._id}`, {
        request: { content_type: contentType, validation, max_body_bytes: Number(maxBytes), input_schema: schema },
      });
      onSaved({ ...ep, request: { content_type: contentType as any, validation: validation as any, max_body_bytes: Number(maxBytes), input_schema: schema } });
    } catch (e) { setError(String(e)); throw e; }
    finally { setSaving(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      <Card>
        <SectionHead title="Request Contract" />
        <div className="ui-card__body ui-formgrid">
          <Field label="Content-Type (frontend sends)">
            <select style={inputStyle} value={contentType} onChange={e => setContentType(e.target.value as "application/json" | "application/x-www-form-urlencoded")} disabled={!can("edit:endpoints")}>
              <option value="application/json">application/json</option>
              <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
            </select>
          </Field>
          <Field label="Validation">
            <select style={inputStyle} value={validation} onChange={e => setValidation(e.target.value as "strict" | "permissive")} disabled={!can("edit:endpoints")}>
              <option value="strict">strict — reject invalid bodies with 400</option>
              <option value="permissive">permissive — warn only</option>
            </select>
          </Field>
          <Field label="Max Body Bytes" hint="Default 262144 (256 KB)">
            <input type="number" style={inputStyle} value={maxBytes} onChange={e => setMaxBytes(e.target.value)} disabled={!can("edit:endpoints")} />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionHead title="Input Schema" action={can("edit:endpoints") ? <Btn size="sm" pageSave onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Schema"}</Btn> : undefined} />
        <div style={{ padding: 16 }}>
          <SchemaFieldTree fields={schema} onChange={setSchema} readOnly={!can("edit:endpoints")} />
        </div>
      </Card>
      <SchemaBodyPreview schema={schema} label="REQUEST BODY" />
    </div>
  );
}
