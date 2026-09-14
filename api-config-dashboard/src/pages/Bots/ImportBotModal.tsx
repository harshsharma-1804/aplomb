import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { BotExport, BotImportResult } from "../../api/types";
import { Modal, Btn, ErrorBanner, C } from "../../components";

interface Props {
  onClose: () => void;
  onImported: () => void;
}

type Step = "upload" | "result";

export function ImportBotModal({ onClose, onImported }: Props) {
  const [step,        setStep]        = useState<Step>("upload");
  const [parsed,      setParsed]      = useState<BotExport | null>(null);
  const [parseError,  setParseError]  = useState("");
  const [importing,   setImporting]   = useState(false);
  const [importError, setImportError] = useState("");
  const [result,      setResult]      = useState<BotImportResult | null>(null);
  const [dragOver,    setDragOver]    = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  function parseFile(file: File) {
    setParseError("");
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target?.result as string) as BotExport;
        if (!data.export_version || !Array.isArray(data.bots)) {
          setParseError("Invalid export file — missing required fields (export_version, bots).");
          return;
        }
        if (data.export_version !== "1") {
          setParseError(`Unsupported export version "${data.export_version}" — only version 1 is supported.`);
          return;
        }
        if (data.kind && data.kind !== "bot") {
          setParseError(`This is a '${data.kind}' bundle, not a bot bundle — use the App Import instead.`);
          return;
        }
        setParsed(data);
      } catch {
        setParseError("Could not parse file — make sure it is a valid orchestrator bot export JSON.");
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

  async function handleImport() {
    if (!parsed) return;
    setImporting(true);
    setImportError("");
    try {
      const res = await api.post<BotImportResult>("/__config/admin/ai/bots/import", { payload: parsed });
      setResult(res);
      setStep("result");
      onImported();
    } catch (e: any) {
      setImportError(String(e));
    } finally {
      setImporting(false);
    }
  }

  // ── Step: upload + preview ────────────────────────────────────────────────
  if (step === "upload") {
    return (
      <Modal title="Import Bot" onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {parseError && <ErrorBanner message={parseError} />}

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
            <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
              {parsed ? "File loaded — drop a different file to replace" : "Drop bot export file here"}
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>or click to browse · .json only</div>
            <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleFileInput} />
          </div>

          {parsed && (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: C.radius, overflow: "hidden" }}>
              <div style={{ background: "#f0f7ff", padding: "10px 14px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 13, color: C.primary }}>
                Bot Export Preview
              </div>
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                <PreviewRow label="Bot(s)"    value={parsed.bots.map(b => b.name).join(", ")} />
                <PreviewRow label="Rules"     value={parsed.bots.map(b => `${b.name}: ${b.rules.length}`).join(", ")} />
                <PreviewRow label="Apps"      value={parsed.bots.flatMap(b => b.apps.map(a => a.base_path)).join(", ") || "none — bind after import"} />
                <PreviewRow label="Providers" value={parsed.ai_providers.map(p => `${p.name} (${p.model})`).join(", ") || "none"} />
                <PreviewRow label="Exported"  value={new Date(parsed.exported_at).toLocaleString()} />
              </div>
            </div>
          )}

          <div style={{ fontSize: 12, color: C.muted }}>
            App bindings resolve by base path — apps that don't exist here are skipped with a warning (import the app first, then bind). A NEW bot key is generated on import.
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn disabled={!parsed || parsed.bots.length === 0} onClick={handleImport}>
              {importing ? "Importing…" : "Import"}
            </Btn>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Step: result ──────────────────────────────────────────────────────────
  return (
    <Modal title="Bot Import Complete" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {result && (
          <>
            <div style={{ border: `1px solid #86efac`, borderRadius: C.radius, overflow: "hidden" }}>
              <div style={{ background: "#f0fdf4", padding: "10px 14px", borderBottom: `1px solid #86efac`, fontWeight: 700, fontSize: 13, color: "#166534" }}>
                ✓ {result.bots_created} bot{result.bots_created !== 1 ? "s" : ""} imported
              </div>
              <div style={{ padding: "12px 14px", fontSize: 13 }}>
                {result.bot_keys.map(bk => bk.name).join(", ")}
              </div>
            </div>

            {(result.bot_keys?.length ?? 0) > 0 && (
              <div style={{ border: `2px solid ${C.danger}`, borderRadius: C.radius, overflow: "hidden" }}>
                <div style={{ background: "#fef2f2", padding: "10px 14px", borderBottom: `1px solid #fca5a5`, fontWeight: 700, fontSize: 13, color: "#b91c1c" }}>
                  🔑 New bot key{result.bot_keys.length !== 1 ? "s" : ""} — copy now, shown only once
                </div>
                <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {result.bot_keys.map(bk => (
                    <div key={bk.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{bk.name}</div>
                        <code style={{ background: C.bg, border: `1px solid ${C.border}`, padding: "4px 8px", borderRadius: 4, fontSize: 12, wordBreak: "break-all", display: "block" }}>{bk.api_key}</code>
                      </div>
                      <Btn size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(bk.api_key); }}>Copy</Btn>
                    </div>
                  ))}
                  <div style={{ fontSize: 12, color: C.muted }}>
                    Bot keys are stored hashed and can never be exported — update the calling frontend's <code>X-Bot-Key</code> header to the new value.
                  </div>
                </div>
              </div>
            )}

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
              <Btn onClick={() => { onClose(); navigate("/bots"); }}>Done</Btn>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <span style={{ color: C.muted, fontWeight: 600, minWidth: 80, fontSize: 12 }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}
