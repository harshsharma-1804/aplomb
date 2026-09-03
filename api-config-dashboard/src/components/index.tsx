import React, { useState } from "react";

export const C = {
  bg: "#f8f9fa", surface: "#ffffff", border: "#dee2e6", borderStrong: "#adb5bd",
  primary: "#0d6efd", primaryHover: "#0b5ed7", danger: "#dc3545", success: "#198754",
  warning: "#ffc107", text: "#212529", muted: "#6c757d",
  radius: "6px", shadow: "0 1px 3px rgba(0,0,0,0.08)",
};

// ── Button ────────────────────────────────────────────────────────────────────
interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "danger" | "ghost" | "outline" | "success";
  size?: "sm" | "md";
}
export function Btn({ variant = "primary", size = "md", style, children, ...rest }: BtnProps) {
  const base: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid transparent",
    borderRadius: C.radius, cursor: "pointer", fontWeight: 500, lineHeight: 1, transition: "background .15s",
    padding: size === "sm" ? "5px 10px" : "8px 14px", fontSize: size === "sm" ? 12 : 13,
  };
  const vars: Record<string, React.CSSProperties> = {
    primary: { background: C.primary, color: "#fff" },
    danger:  { background: C.danger, color: "#fff" },
    success: { background: C.success, color: "#fff" },
    outline: { background: "transparent", color: C.primary, borderColor: C.primary },
    ghost:   { background: "transparent", color: C.muted, borderColor: C.border },
  };
  return <button style={{ ...base, ...vars[variant], ...style }} {...rest}>{children}</button>;
}

// ── Badge ─────────────────────────────────────────────────────────────────────
const statusColor: Record<string, string> = {
  active: C.success, approved: C.success, admin: C.primary,
  denied: C.danger, deprecated: C.danger, inactive: C.muted,
  pending: "#fd7e14", draft: C.muted, sub_admin: "#6610f2", viewer: C.muted,
};
export function Badge({ text }: { text: string }) {
  const color = statusColor[text.toLowerCase()] ?? C.muted;
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600, color, background: color + "22", textTransform: "uppercase", letterSpacing: ".4px" }}>
      {text}
    </span>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: C.radius, boxShadow: C.shadow, ...style }}>{children}</div>;
}

// ── SectionHead ───────────────────────────────────────────────────────────────
export function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
      {action}
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────
export function Table({ cols, rows, onRowClick }: {
  cols: { key: string; label: string; render?: (v: unknown, row: Record<string, unknown>) => React.ReactNode }[];
  rows: Record<string, unknown>[];
  onRowClick?: (row: Record<string, unknown>) => void;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: C.bg }}>
            {cols.map(c => <th key={c.key} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={cols.length} style={{ padding: "24px 12px", textAlign: "center", color: C.muted }}>No records</td></tr>
            : rows.map((row, i) => (
              <tr key={i} onClick={() => onRowClick?.(row)}
                style={{ borderBottom: `1px solid ${C.border}`, cursor: onRowClick ? "pointer" : undefined }}
                onMouseEnter={e => { if (onRowClick) (e.currentTarget as HTMLElement).style.background = C.bg; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ""; }}>
                {cols.map(c => (
                  <td key={c.key} style={{ padding: "8px 12px", color: C.text, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.render ? c.render(row[c.key], row) : String(row[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, width = 520 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: C.surface, borderRadius: C.radius, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", width, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: C.muted }}>×</button>
        </div>
        <div style={{ overflowY: "auto", padding: 16, flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

// ── Confirm ───────────────────────────────────────────────────────────────────
export function Confirm({ message, onConfirm, onCancel, danger = false }: { message: string; onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
  return (
    <Modal title="Confirm" onClose={onCancel}>
      <p style={{ fontSize: 13, marginBottom: 16 }}>{message}</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn variant={danger ? "danger" : "primary"} onClick={onConfirm}>Confirm</Btn>
      </div>
    </Modal>
  );
}

// ── Field ─────────────────────────────────────────────────────────────────────
export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</label>
      {children}
      {hint && <p style={{ margin: "3px 0 0", fontSize: 11, color: C.muted }}>{hint}</p>}
    </div>
  );
}

export const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: C.radius,
  fontSize: 13, color: C.text, background: C.surface, boxSizing: "border-box",
};

// ── Spinner / Error ───────────────────────────────────────────────────────────
export function Spinner() {
  return <div style={{ textAlign: "center", padding: "32px 0", color: C.muted, fontSize: 13 }}>Loading…</div>;
}

export function ErrorBanner({ message }: { message: string }) {
  return <div style={{ background: "#fff5f5", border: `1px solid ${C.danger}30`, borderRadius: C.radius, padding: "10px 14px", color: C.danger, fontSize: 13, marginBottom: 12 }}>{message}</div>;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div style={{ display: "flex", borderBottom: `2px solid ${C.border}`, marginBottom: 16, overflowX: "auto" }}>
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)} style={{
          padding: "8px 14px", background: "none", border: "none", cursor: "pointer",
          fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
          color: active === t.key ? C.primary : C.muted,
          borderBottom: active === t.key ? `2px solid ${C.primary}` : "2px solid transparent",
          marginBottom: -2,
        }}>{t.label}</button>
      ))}
    </div>
  );
}

// ── JsonViewer ────────────────────────────────────────────────────────────────
export function JsonViewer({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={() => setOpen(o => !o)} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: C.radius, cursor: "pointer", fontSize: 11, color: C.muted, padding: "3px 8px" }}>
        {open ? "Hide" : "Show"} raw JSON
      </button>
      {open && <pre style={{ marginTop: 8, padding: 12, background: "#1e1e1e", color: "#d4d4d4", borderRadius: C.radius, fontSize: 11, overflowX: "auto", maxHeight: 320 }}>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}

// ── MethodBadge ───────────────────────────────────────────────────────────────
const methodColor: Record<string, string> = { GET: "#198754", POST: "#0d6efd", PUT: "#fd7e14", DELETE: "#dc3545", PATCH: "#6610f2" };
export function MethodBadge({ method }: { method: string }) {
  const color = methodColor[method] ?? C.muted;
  return <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 700, color, background: color + "18", fontFamily: "monospace" }}>{method}</span>;
}
