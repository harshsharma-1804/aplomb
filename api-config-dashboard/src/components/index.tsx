import React, { useState } from "react";

export const C = {
  bg: "var(--surface-muted)", canvas: "var(--canvas)", surface: "var(--surface)", surfaceMuted: "var(--surface-muted)",
  border: "var(--border)", borderStrong: "var(--input-border)",
  primary: "var(--primary)", primaryHover: "var(--primary-hover)", primaryText: "var(--primary-text)",
  danger: "var(--danger)", success: "var(--success)", warning: "var(--warning)",
  text: "var(--text)", muted: "var(--muted)",
  sidebar: "var(--sidebar)", sidebarHover: "var(--sidebar-hover)",
  sidebarText: "var(--sidebar-text)", sidebarTextMuted: "var(--sidebar-text-muted)",
  selection: "var(--selection)",
  dangerBg: "var(--danger-background)", successBg: "var(--success-background)", warningBg: "var(--warning-background)",
  codeBg: "var(--code-bg)", codeText: "var(--code-text)",
  overlay: "var(--overlay)", shadow: "var(--shadow)", shadowModal: "var(--shadow-modal)",
  radiusSm: "var(--radius-sm)", radius: "var(--radius)", radiusPanel: "var(--radius-panel)", radiusFeature: "var(--radius-feature)",
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
    primary: { background: C.primary, color: C.primaryText },
    danger:  { background: C.danger, color: C.primaryText },
    success: { background: C.success, color: C.primaryText },
    outline: { background: "transparent", color: C.primary, borderColor: C.primary },
    ghost:   { background: "transparent", color: C.muted, borderColor: C.border },
  };
  return <button style={{ ...base, ...vars[variant], ...style }} {...rest}>{children}</button>;
}

// ── Badge ─────────────────────────────────────────────────────────────────────
const statusColor: Record<string, [string, string]> = {
  active: [C.success, C.successBg], approved: [C.success, C.successBg],
  admin: [C.primary, C.selection], sub_admin: [C.primary, C.selection],
  denied: [C.danger, C.dangerBg], deprecated: [C.danger, C.dangerBg],
  pending: [C.warning, C.warningBg], draft: [C.warning, C.warningBg],
  inactive: [C.muted, C.surfaceMuted], viewer: [C.muted, C.surfaceMuted],
};
export function Badge({ text }: { text: string }) {
  const [color, bg] = statusColor[text.toLowerCase()] ?? [C.muted, C.surfaceMuted];
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600, color, background: bg, textTransform: "uppercase", letterSpacing: ".4px" }}>
      {text}
    </span>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: C.radiusPanel, boxShadow: C.shadow, ...style }}>{children}</div>;
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
          <tr style={{ background: C.surfaceMuted }}>
            {cols.map(c => <th key={c.key} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={cols.length} style={{ padding: "24px 12px", textAlign: "center", color: C.muted }}>No records</td></tr>
            : rows.map((row, i) => (
              <tr key={i} onClick={() => onRowClick?.(row)}
                style={{ borderBottom: `1px solid ${C.border}`, cursor: onRowClick ? "pointer" : undefined }}
                onMouseEnter={e => { if (onRowClick) (e.currentTarget as HTMLElement).style.background = C.selection; }}
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
    <div style={{ position: "fixed", inset: 0, background: C.overlay, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: C.surface, borderRadius: C.radiusPanel, boxShadow: C.shadowModal, width, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
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
export function Field({ label, children, hint }: { label: React.ReactNode; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "flex", alignItems: "center", fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</label>
      {children}
      {hint && <p style={{ margin: "3px 0 0", fontSize: 11, color: C.muted }}>{hint}</p>}
    </div>
  );
}

export const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", border: `1px solid ${C.borderStrong}`, borderRadius: C.radius,
  fontSize: 13, color: C.text, background: C.surface, boxSizing: "border-box",
};

// ── Toggle ────────────────────────────────────────────────────────────────────
export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 36, height: 20, borderRadius: 999, border: "none", cursor: disabled ? "default" : "pointer",
        background: checked ? C.primary : C.border, position: "relative", flexShrink: 0,
        transition: "background .15s", padding: 0, opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: checked ? 18 : 2, width: 16, height: 16, borderRadius: "50%",
        background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)", transition: "left .15s",
      }} />
    </button>
  );
}

// ── InfoTip ───────────────────────────────────────────────────────────────────
export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-flex", marginLeft: 6 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        role="note"
        aria-label={text}
        tabIndex={0}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          cursor: "help", width: 16, height: 16, borderRadius: 999, flexShrink: 0,
          border: `1px solid ${C.borderStrong}`, color: C.muted, background: "transparent",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700, fontStyle: "italic", fontFamily: "Georgia, serif",
          textTransform: "none", letterSpacing: 0,
        }}
      >i</span>
      {open && (
        <span style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: 0, width: 280, zIndex: 1100,
          padding: "9px 11px", background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: C.radius, boxShadow: C.shadowModal, fontSize: 12, fontWeight: 400,
          color: C.text, lineHeight: 1.5, textTransform: "none", letterSpacing: 0,
          whiteSpace: "normal",
        }}>{text}</span>
      )}
    </span>
  );
}

// ── Spinner / Error ───────────────────────────────────────────────────────────
export function Spinner() {
  return <div style={{ textAlign: "center", padding: "32px 0", color: C.muted, fontSize: 13 }}>Loading…</div>;
}

export function ErrorBanner({ message }: { message: string }) {
  return <div style={{ background: C.dangerBg, border: `1px solid ${C.danger}`, borderRadius: C.radius, padding: "10px 14px", color: C.danger, fontSize: 13, marginBottom: 12 }}>{message}</div>;
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
      {open && <pre style={{ marginTop: 8, padding: 12, background: C.codeBg, color: C.codeText, borderRadius: C.radius, fontSize: 11, overflowX: "auto", maxHeight: 320 }}>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}

// ── MethodBadge ───────────────────────────────────────────────────────────────
const methodColor: Record<string, [string, string]> = {
  GET: [C.success, C.successBg], POST: [C.primary, C.selection], PUT: [C.warning, C.warningBg],
  DELETE: [C.danger, C.dangerBg], PATCH: [C.primary, C.selection],
};
export function MethodBadge({ method }: { method: string }) {
  const [color, bg] = methodColor[method] ?? [C.muted, C.surfaceMuted];
  return <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: C.radiusSm, fontSize: 11, fontWeight: 700, color, background: bg, fontFamily: "monospace" }}>{method}</span>;
}
