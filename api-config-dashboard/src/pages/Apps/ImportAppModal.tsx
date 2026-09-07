import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { AppExport, ImportResult } from "../../api/types";
import { Modal, Btn, Field, inputStyle, ErrorBanner, C } from "../../components";

interface Props {
  onClose: () => void;
  onImported: () => void;
}

type Step = "upload" | "options" | "result";

export function ImportAppModal({ onClose, onImported }: Props) {
  const [step,          setStep]          = useState<Step>("upload");
  const [parsed,        setParsed]        = useState<AppExport | null>(null);
  const [parseError,    setParseError]    = useState("");
  const [name,          setName]          = useState("");
  const [basePath,      setBasePath]      = useState("");
  const [conflict,      setConflict]      = useState(false);
  const [existingId,    setExistingId]    = useState("");
  const [overwrite,     setOverwrite]     = useState(false);
  const [checking,      setChecking]      = useState(false);
  const [importing,     setImporting]     = useState(false);
  const [importError,   setImportError]   = useState("");
  const [result,        setResult]        = useState<ImportResult | null>(null);
  const [dragOver,      setDragOver]      = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  function parseFile(file: File) {
    setParseError("");
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target?.result as string) as AppExport;
        if (!data.export_version || !data.app || !Array.isArray(data.endpoints)) {
          setParseError("Invalid export file — missing required fields (export_version, app, endpoints).");
          return;
        }
        if (data.export_version !== "1") {
          setParseError(`Unsupported export version "${data.export_version}" — only version 1 is supported.`);
          return;
        }
        setParsed(data);
        setName(data.app.name);
        setBasePath(data.app.base_path);
        setStep("upload");
      } catch {
        setParseError("Could not parse file — make sure it is a valid orchestrator export JSON.");
      }
    };
    reader.readAsText(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) parseFile(file);
  }

  const checkConflict = useCallback(async (path: string) => {
    if (!path) return;
    setChecking(true);
    try {
      const res = await api.get<{ count: number; results: { _id: string }[] }>(`/__config/apps?base_path=${encodeURIComponent(path)}`);
      if (res.results.length > 0) {
        setConflict(true);
        setExistingId(res.results[0]!._id);
      } else {
        setConflict(false);
        setExistingId("");
      }
    } catch { /* non-fatal */ }
    finally { setChecking(false); }
  }, []);

  async function handleImport() {
    if (!parsed) return;
    setImporting(true);
    setImportError("");
    try {
      const res = await api.post<ImportResult>("/__config/apps/import", {
        payload: parsed,
        options: { name, base_path: basePath, overwrite },
      });
      setResult(res);
      setStep("result");
      onImported();
    } catch (e: any) {
      const msg = String(e);
      if (msg.includes("DUPLICATE_BASE_PATH") || msg.includes("conflict")) {
        setConflict(true);
        setImportError("Base path conflict — enable overwrite or change the base path.");
      } else {
        setImportError(msg);
      }
    } finally {
      setImporting(false);
    }
  }

  // ── Step: upload + preview ────────────────────────────────────────────────
  if (step === "upload") {
    return (
      <Modal title="Import App" onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {parseError && <ErrorBanner message={parseError} />}

          {/* Drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragOver ? C.primary : C.border}`,
              borderRadius: C.radius,
              padding: "32px 20px",
              textAlign: "center",
              cursor: "pointer",
              background: dragOver ? "#f0f7ff" : C.bg,
              transition: "all 0.15s",
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
              {parsed ? "File loaded — drop a different file to replace" : "Drop export file here"}
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>or click to browse · .json only</div>
            <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleFileInput} />
          </div>

          {/* Preview card */}
          {parsed && (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: C.radius, overflow: "hidden" }}>
              <div style={{ background: "#f0f7ff", padding: "10px 14px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 13, color: C.primary }}>
                Export Preview
              </div>
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                <PreviewRow label="App name"   value={parsed.app.name} />
                <PreviewRow label="Base path"  value={parsed.app.base_path} code />
                <PreviewRow label="Endpoints"  value={`${parsed.endpoints.length}`} />
                <PreviewRow label="Scripts"    value={`${parsed.scripts.length}`} />
                {parsed.export_options?.include && (
                  <PreviewRow label="Included" value={parsed.export_options.include.join(", ")} />
                )}
                {(parsed.app.app_env?.length ?? 0) > 0 && (
                  <PreviewRow label="Env vars"  value={`${parsed.app.app_env.length} (env: ${parsed.export_options?.env ?? "keys"})`} />
                )}
                <PreviewRow label="Exported"   value={new Date(parsed.exported_at).toLocaleString()} />
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn disabled={!parsed} onClick={() => { setStep("options"); checkConflict(basePath); }}>
              Continue →
            </Btn>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Step: options ─────────────────────────────────────────────────────────
  if (step === "options") {
    return (
      <Modal title="Import Options" onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {importError && <ErrorBanner message={importError} />}

          <Field label="App Name">
            <input
              style={inputStyle}
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoFocus
            />
          </Field>

          <Field
            label="Base Path"
            hint={
              checking ? "Checking availability…"
              : conflict ? "⚠ An app with this base path already exists"
              : basePath ? "✓ Available"
              : ""
            }
          >
            <input
              style={{ ...inputStyle, borderColor: conflict ? C.danger : basePath && !checking ? C.success : C.border }}
              value={basePath}
              onChange={e => { setBasePath(e.target.value); setConflict(false); }}
              onBlur={() => checkConflict(basePath)}
              required
            />
          </Field>

          {/* Conflict resolution */}
          {conflict && (
            <div style={{ border: `1px solid ${C.danger}`, borderRadius: C.radius, overflow: "hidden" }}>
              <div style={{ background: "#fef2f2", padding: "10px 14px", borderBottom: `1px solid #fca5a5`, fontSize: 13, fontWeight: 600, color: "#b91c1c" }}>
                ⚠ Base path conflict
              </div>
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13, color: C.text }}>
                  An app already exists at <code style={{ background: C.bg, padding: "1px 5px", borderRadius: 3 }}>{basePath}</code>.
                  Choose how to proceed:
                </div>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                  <input
                    type="radio"
                    checked={!overwrite}
                    onChange={() => setOverwrite(false)}
                    style={{ marginTop: 2, accentColor: C.primary }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Change base path</div>
                    <div style={{ fontSize: 12, color: C.muted }}>Edit the base path above to use a different one</div>
                  </div>
                </label>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                  <input
                    type="radio"
                    checked={overwrite}
                    onChange={() => setOverwrite(true)}
                    style={{ marginTop: 2, accentColor: C.danger }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.danger }}>Overwrite existing app</div>
                    <div style={{ fontSize: 12, color: C.muted }}>Permanently deletes the existing app, all its endpoints and scripts, then imports fresh</div>
                  </div>
                </label>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={() => setStep("upload")}>← Back</Btn>
            <Btn
              onClick={handleImport}
              disabled={importing || !name || !basePath || (conflict && !overwrite)}
              style={overwrite ? { background: C.danger, color: "#fff" } : undefined}
            >
              {importing ? "Importing…" : overwrite ? "Overwrite & Import" : "Import"}
            </Btn>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Step: result ──────────────────────────────────────────────────────────
  return (
    <Modal title="Import Complete" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {result && (
          <>
            <div style={{ border: `1px solid #86efac`, borderRadius: C.radius, overflow: "hidden" }}>
              <div style={{ background: "#f0fdf4", padding: "10px 14px", borderBottom: `1px solid #86efac`, fontWeight: 700, fontSize: 13, color: "#166534" }}>
                ✓ Import successful
              </div>
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                <PreviewRow label="App"       value={result.app.name} />
                <PreviewRow label="Endpoints" value={`${result.endpoints_created} created`} />
                <PreviewRow label="Scripts"   value={`${result.scripts_created} created`} />
              </div>
            </div>

            {result.warnings.length > 0 && (
              <div style={{ border: `1px solid #fcd34d`, borderRadius: C.radius, overflow: "hidden" }}>
                <div style={{ background: "#fffbeb", padding: "8px 14px", borderBottom: `1px solid #fcd34d`, fontWeight: 700, fontSize: 13, color: "#92400e" }}>
                  ⚠ {result.warnings.length} warning{result.warnings.length !== 1 ? "s" : ""}
                </div>
                <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                  {result.warnings.map((w, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#78350f" }}>• {w}</div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Btn variant="ghost" onClick={onClose}>Close</Btn>
              <Btn onClick={() => { onClose(); navigate(`/apps/${result.app._id}`); }}>
                Open App →
              </Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function PreviewRow({ label, value, code }: { label: string; value: string; code?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <span style={{ color: C.muted, fontWeight: 600, minWidth: 80, fontSize: 12 }}>{label}</span>
      {code
        ? <code style={{ background: C.bg, padding: "1px 6px", borderRadius: 3, fontSize: 12 }}>{value}</code>
        : <span style={{ fontWeight: 500 }}>{value}</span>
      }
    </div>
  );
}
