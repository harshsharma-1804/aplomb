// Static design prototype for the "Midnight console" redesign.
// Renders mock screens with the real stylesheets in src/styles. No API calls.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bot, Boxes, Braces, Building2, Check, ChevronDown, ChevronRight,
  ChevronsLeft, ChevronsRight, CircleCheck, Clock, Copy, CornerDownLeft, Database, Download, Ellipsis, FileCode2,
  FolderPlus, GitCompareArrows, Globe, History, Info, KeyRound, Laptop, LayoutDashboard, Link2, Lock, LockOpen,
  Mail, Moon, Pencil, Play, Plus, Power, RefreshCw, RotateCw, Search, Server, Settings, ShieldCheck, Sparkles, Sun,
  Trash2, TriangleAlert, Upload, Users, Webhook, Workflow, X, Zap,
} from "lucide-react";

const params = new URLSearchParams(location.search);
const go = (h: string) => { location.hash = "/" + h; };
const readHash = () => location.hash.replace(/^#\/?/, "") || "apps";

function useHash() {
  const [h, setH] = useState(readHash);
  useEffect(() => {
    const f = () => setH(readHash());
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return h;
}

// ── Small pieces ─────────────────────────────────────────────────────────────
function Badge({ tone, dot, children }: { tone?: string; dot?: boolean; children: ReactNode }) {
  return <span className={`ui-badge${tone ? ` ui-badge--${tone}` : ""}`}>{dot && <i className="ui-dot" />}{children}</span>;
}
function Method({ m, lg }: { m: string; lg?: boolean }) {
  return <span className={`ui-method${lg ? " ui-method--lg" : ""}`} data-method={m}>{m}</span>;
}
function Card({ title, action, children, flush }: { title?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="ui-card">
      {title && <header className="ui-card__head"><span className="ui-card__title">{title}</span>{action}</header>}
      <div className={flush ? undefined : "ui-card__body"}>{children}</div>
    </section>
  );
}
function Code({ value, title }: { value: unknown; title?: string }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g,
    (_m, str, colon, lit, num, punc) =>
      str ? (colon ? `<span class="tok-key">${str}</span><span class="tok-punc">:</span>` : `<span class="tok-str">${str}</span>`)
        : lit ? `<span class="tok-lit">${lit}</span>`
        : num ? `<span class="tok-num">${num}</span>`
        : `<span class="tok-punc">${punc}</span>`,
  );
  return (
    <div className="ui-code">
      <div className="ui-code__bar"><span>{title ?? "JSON"}</span><button className="ui-iconbtn ui-iconbtn--sm" aria-label="Copy"><Copy /></button></div>
      <pre dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="ui-field"><span className="ui-label">{label}</span>{children}{hint && <span className="ui-hint">{hint}</span>}</label>;
}
function RowMenu({ items }: { items: { label: string; icon: ReactNode; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button className="ui-iconbtn" aria-label="Actions" onClick={e => { e.stopPropagation(); setOpen(o => !o); }}><Ellipsis /></button>
      {open && (
        <div className="ui-menu" style={{ right: 0, top: 34 }}>
          {items.map(it => (
            <div key={it.label}>
              {it.danger && <div className="ui-menu__sep" />}
              <button className={`ui-menu__item${it.danger ? " ui-menu__item--danger" : ""}`} onClick={() => setOpen(false)}>{it.icon}{it.label}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────
const NAV = [
  { title: "Workspace", items: [
    { label: "Overview", icon: LayoutDashboard, soon: true },
    { label: "App Registry", icon: Boxes, to: "apps", match: ["apps", "endpoint"] },
    { label: "Bot Registry", icon: Bot, to: "bot", match: ["bot"] },
  ] },
  { title: "Manage", items: [
    { label: "Tenant Settings", icon: Settings, to: "settings", match: ["settings"] },
    { label: "Activity", icon: Activity, soon: true },
  ] },
];

function Shell({ screen, crumbs, theme, onTheme, onKbar, children }: {
  screen: string; crumbs: { label: string; to?: string }[]; theme: string; onTheme: () => void; onKbar: () => void; children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="ui-shell">
      <aside className={`ui-sidebar${collapsed ? " is-collapsed" : ""}`}>
        <div className="ui-brand">
          <span className="ui-brand__mark"><Zap /></span>
          <div className="ui-collapse-hide"><div className="ui-brand__name">Orchestrator</div><div className="ui-brand__sub">Default Organization</div></div>
        </div>
        {NAV.map(sec => (
          <div key={sec.title}>
            {collapsed ? <div className="ui-nav-rule" /> : <div className="ui-nav-title">{sec.title}</div>}
            <nav className="ui-nav">
              {sec.items.map(it => {
                const active = it.match?.includes(screen);
                return (
                  <button key={it.label} title={it.label} className={`ui-nav-item${active ? " is-active" : ""}${it.soon ? " is-disabled" : ""}`} onClick={() => it.to && go(it.to)}>
                    <it.icon /><span className="ui-collapse-hide">{it.label}</span>
                    {it.soon && <span className="ui-soon ui-collapse-hide">Soon</span>}
                  </button>
                );
              })}
            </nav>
          </div>
        ))}
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="ui-userchip ui-collapse-hide">
            <span className="ui-avatar">AD</span>
            <div className="ui-grow"><div style={{ fontSize: 12.5, fontWeight: 600 }}>admin</div><div className="ui-faint" style={{ fontSize: 11 }}>Admin</div></div>
          </div>
          <button className="ui-nav-item" onClick={() => setCollapsed(c => !c)} aria-label="Toggle sidebar">
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}<span className="ui-collapse-hide">Collapse</span>
          </button>
        </div>
      </aside>
      <main className="ui-main">
        <header className="ui-topbar">
          <nav className="ui-crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={c.label} className="ui-row">
                {i > 0 && <ChevronRight />}
                {c.to ? <a href={`#/${c.to}`}>{c.label}</a> : <strong>{c.label}</strong>}
              </span>
            ))}
          </nav>
          <div className="ui-grow" />
          <button className="ui-kbar-trigger" onClick={onKbar}><Search /><span className="ui-grow">Search or jump to…</span><kbd className="ui-kbd">⌘K</kbd></button>
          <button className="ui-iconbtn ui-iconbtn--bordered" onClick={onTheme} aria-label="Switch theme">{theme === "dark" ? <Moon /> : <Sun />}</button>
          <span className="ui-avatar">AD</span>
        </header>
        <div className="ui-content">{children}</div>
      </main>
    </div>
  );
}

// ── Screen: App registry ─────────────────────────────────────────────────────
const APPS = [
  ["AS", "Admin Studio Demo API", "/api/admin/demo/v1", "8 Sep 2026"],
  ["MP", "Member Portal Demo API", "/api/portal/demo/v1", "9 Sep 2026"],
  ["OT", "oauth-test", "/api/oauth/test", "29 Sep 2026"],
  ["JV", "Jyotish Vastu Karma Backend", "/api/jvk/v1", "1 Oct 2026"],
  ["PF", "proxy-frontend", "/app", "1 Oct 2026"],
];

function AppsScreen() {
  const [filter, setFilter] = useState("All");
  return (
    <div className="ui-page" key="apps">
      <div className="ui-pagehead">
        <div><h1>App Registry</h1><p>Each app is a versioned collection of endpoints with a unique base path.</p></div>
        <div className="ui-row"><button className="ui-btn"><Upload />Import</button><button className="ui-btn ui-btn--primary"><Plus />New app</button></div>
      </div>
      <div className="ui-row" style={{ marginBottom: 14 }}>
        <div className="ui-seg">
          {[["All", 5], ["Active", 5], ["Draft", 0], ["Deprecated", 0]].map(([l, n]) => (
            <button key={l} className={`ui-seg__item${filter === l ? " is-active" : ""}`} onClick={() => setFilter(String(l))}>{l}<span className="ui-count">{n}</span></button>
          ))}
        </div>
        <div className="ui-grow" />
        <div className="ui-search" style={{ width: 260 }}><Search /><input className="ui-input" placeholder="Filter by name or path" /></div>
        <button className="ui-iconbtn ui-iconbtn--bordered" aria-label="Refresh"><RefreshCw /></button>
      </div>
      <Card flush>
        <table className="ui-table">
          <thead><tr><th>App</th><th>Base path</th><th>Status</th><th>Created</th><th /></tr></thead>
          <tbody>
            {APPS.map(([ini, name, path, created]) => (
              <tr key={name} className="is-clickable" onClick={() => go("endpoint/mapping")}>
                <td><div className="ui-row" style={{ gap: 12 }}><span className="ui-tile">{ini}</span><span style={{ fontWeight: 600 }}>{name}</span></div></td>
                <td><span className="ui-path">{path}</span></td>
                <td><Badge tone="success" dot>Active</Badge></td>
                <td className="ui-muted ui-num">{created}</td>
                <td className="ui-cell-actions"><RowMenu items={[
                  { label: "Edit", icon: <Pencil /> }, { label: "Clone", icon: <Copy /> }, { label: "Delete", icon: <Trash2 />, danger: true },
                ]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ── Screen: Endpoint editor ──────────────────────────────────────────────────
const TREE: [string, number, [string, string][]][] = [
  ["Documents", 6, []],
  ["Member", 9, [
    ["DELETE", "Delete Member"], ["DELETE", "Delete Phone"], ["GET", "Get members"], ["GET", "Get Member"],
    ["GET", "List Benefit Periods"], ["GET", "Get Preferences"], ["POST", "Create a member"],
    ["PUT", "Update member data"], ["PUT", "Update Preferences"],
  ]],
  ["Payment", 8, []],
];
const STEPS: [string, string, string, string][] = [
  ["request", "Request", "7 fields · strict", "done"],
  ["response", "Response", "2 fields", "done"],
  ["upstream", "Upstream", "Script handler", "done"],
  ["sample", "Sample", "Captured", "done"],
  ["mapping", "Mapping", "6/6 mapped", "done"],
  ["test", "Test", "Run a request", "todo"],
];
const SAMPLE = { created: true, member: { id: "ABCD1234567890", name: { first_name: "John", last_name: "Doe", middle_name: "", prefix: "Mr", suffix: "I", full_name: "Mr John Doe I" }, gender: "male", birth_date: "2004-08-19", ethnicity: "unknown" } };
const BODY = { id: "string", name: { first: "string", last: "string", middle: "string", prefix: "string", suffix: "string", full: "string" }, gender: "string", birthDate: "string", email: "string", maritalStatus: "string", ethnicity: "string" };

function FRow({ name, type, open }: { name: string; type: string; open?: boolean }) {
  return (
    <div className="ui-frow">
      {open !== undefined && <ChevronDown size={14} className="ui-faint" />}
      <span className="ui-frow__name">{name}</span><span className="ui-type">{type}</span>
      <span className="ui-frow__actions">
        <button className="ui-iconbtn ui-iconbtn--sm" aria-label="Edit field"><Pencil /></button>
        <button className="ui-iconbtn ui-iconbtn--sm ui-iconbtn--danger" aria-label="Remove field"><X /></button>
      </span>
    </div>
  );
}

function StepRequest() {
  const [view, setView] = useState("preview");
  return (
    <div className="ui-stack">
      <Card title="Request contract">
        <div className="ui-formgrid">
          <Field label="Content-type (frontend sends)"><select className="ui-select"><option>application/json</option></select></Field>
          <Field label="Validation"><select className="ui-select"><option>strict — reject invalid bodies with 400</option></select></Field>
          <Field label="Max body bytes" hint="Default 262144 (256 KB)"><input className="ui-input ui-input--mono" defaultValue="262144" /></Field>
        </div>
      </Card>
      <Card title="Input schema" action={<button className="ui-btn ui-btn--primary ui-btn--sm">Save schema</button>}>
        <div className="ui-frows">
          <FRow name="id" type="string" />
          <FRow name="name" type="object" open />
          <div className="ui-frows__children">
            {["first", "last", "middle", "prefix", "suffix", "full"].map(n => <FRow key={n} name={n} type="string" />)}
            <button className="ui-addrow"><Plus />Add field to name</button>
          </div>
          {["gender", "birthDate", "email", "maritalStatus", "ethnicity"].map(n => <FRow key={n} name={n} type="string" />)}
          <button className="ui-addrow"><Plus />Add field</button>
        </div>
      </Card>
      <Card title="Request body" action={
        <div className="ui-seg">
          <button className={`ui-seg__item${view === "schema" ? " is-active" : ""}`} onClick={() => setView("schema")}>Schema definition</button>
          <button className={`ui-seg__item${view === "preview" ? " is-active" : ""}`} onClick={() => setView("preview")}>Body preview</button>
        </div>
      }>
        <p className="ui-hint" style={{ marginBottom: 10 }}>Example body synthesized from your schema. Values are placeholders showing the expected type.</p>
        <Code value={view === "preview" ? BODY : [{ id: "f17884408796171", field_path: "id", type: "string", nullable: false, description: "", sort_order: 0 }]} />
      </Card>
    </div>
  );
}

function StepResponse() {
  const [arr, setArr] = useState(false);
  return (
    <div className="ui-stack">
      <Card title="Response shape">
        <div className="ui-row" style={{ alignItems: "flex-start", gap: 12 }}>
          <button className="ui-toggle" role="switch" aria-checked={arr} onClick={() => setArr(a => !a)} aria-label="Upstream returns a root-level array" />
          <div>
            <div style={{ fontWeight: 600 }}>Upstream returns a root-level array</div>
            <p className="ui-muted" style={{ fontSize: 12.5, marginTop: 2 }}>Field mappings are applied to each item in the array individually, and the output is an array of objects.</p>
          </div>
        </div>
      </Card>
      <Card title="Output schema — what the frontend receives" action={<button className="ui-btn ui-btn--primary ui-btn--sm">Save schema</button>}>
        <div className="ui-frows">
          <FRow name="created" type="boolean" />
          <FRow name="member" type="object" open />
          <div className="ui-frows__children">
            <FRow name="id" type="string" />
            <FRow name="name" type="object" open />
            <div className="ui-frows__children"><FRow name="full" type="string" /><button className="ui-addrow"><Plus />Add field to member.name</button></div>
            {["gender", "birthDate", "email"].map(n => <FRow key={n} name={n} type="string" />)}
            <button className="ui-addrow"><Plus />Add field to member</button>
          </div>
          <button className="ui-addrow"><Plus />Add field</button>
        </div>
      </Card>
    </div>
  );
}

function StepUpstream() {
  const [mode, setMode] = useState("Full handler");
  const [prov, setProv] = useState("HTTP / REST");
  const provs: [string, ReactNode][] = [["HTTP / REST", <Globe />], ["GraphQL", <Webhook />], ["MongoDB", <Database />], ["PostgreSQL", <Database />], ["MySQL", <Database />]];
  return (
    <div className="ui-stack">
      <Card title="Script" action={<button className="ui-btn ui-btn--primary ui-btn--sm">Save</button>}>
        <Field label="Script mode" hint="Script replaces the upstream entirely. Upstream config below is ignored.">
          <div><div className="ui-seg">{["None", "Full handler", "Pre-hook", "Post-hook", "Pre + Post"].map(m => <button key={m} className={`ui-seg__item${mode === m ? " is-active" : ""}`} onClick={() => setMode(m)}>{m}</button>)}</div></div>
        </Field>
        <Field label="Script file" hint="Select a script file from this app's Scripts library."><select className="ui-select ui-input--mono"><option>addMember.js</option></select></Field>
        <div className="ui-callout ui-callout--warning"><TriangleAlert /><span>Full handler mode is active. The upstream configuration below is <strong>not used</strong>. Your script is solely responsible for fetching data and returning a response.</span></div>
      </Card>
      <Card title="Provider type" action={<button className="ui-btn ui-btn--primary ui-btn--sm">Save</button>}>
        <div className="ui-seg">{provs.map(([p, ic]) => <button key={p} className={`ui-seg__item${prov === p ? " is-active" : ""}`} onClick={() => setProv(p)}>{ic}{p}</button>)}</div>
        <p className="ui-hint" style={{ marginTop: 10 }}>Standard HTTP/REST. Configure a URL, method, auth, and headers below.</p>
      </Card>
      <Card title="Upstream connection">
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto 140px", gap: 10, alignItems: "end" }}>
          <Field label="Upstream URL" hint="Use {{KEY}} to reference app environment variables"><input className="ui-input ui-input--mono" placeholder="https://api.example.com/claims or {{BASE_URL}}/claims" /></Field>
          <div className="ui-field"><button className="ui-btn" aria-label="Insert variable"><Braces /></button><span className="ui-hint">&nbsp;</span></div>
          <Field label="Method" hint=" "><select className="ui-select"><option>GET</option></select></Field>
        </div>
      </Card>
    </div>
  );
}

function StepSample() {
  return (
    <Card title="Upstream sample response" action={<div className="ui-row"><button className="ui-btn ui-btn--sm"><Sparkles />Parse fields</button><button className="ui-btn ui-btn--primary ui-btn--sm">Save sample</button></div>}>
      <Code value={SAMPLE} title="Paste a real upstream response" />
    </Card>
  );
}

const MAPS: [string, string, string | null, number][] = [
  ["created", "boolean", "$.created", 0], ["member", "object", null, 0], ["member.id", "string", "$.member.id", 1],
  ["member.name", "object", null, 1], ["member.name.full", "string", "$.member.name.full_name", 2],
  ["member.gender", "string", "$.member.gender", 1], ["member.birthDate", "string", "$.member.birth_date", 1],
  ["member.email", "string", "$.member.email_address", 1],
];

function StepMapping() {
  return (
    <div className="ui-stack">
      <Card flush title={<span className="ui-row">Response mapping <Badge tone="success" dot>6 of 6 mapped</Badge></span>} action={<button className="ui-btn ui-btn--primary ui-btn--sm">Save mappings</button>}>
        <div className="ui-map__head"><span>Output field</span><span /><span>Type</span><span>Upstream path</span></div>
        {MAPS.map(([f, t, p, depth]) => (
          <div key={f} className={`ui-map__row${p ? "" : " is-parent"}`}>
            <span className="ui-row" style={{ paddingLeft: depth * 18 }}><span className="ui-frow__name">{f}</span><span className="ui-type">{t}</span></span>
            {p ? <ArrowLeft /> : <span />}
            {p ? <select className="ui-select ui-select--sm"><option>direct</option></select> : <span className="ui-faint" style={{ fontSize: 12 }}>object</span>}
            {p ? <input className="ui-input ui-input--sm ui-input--mono" defaultValue={p} /> : <span className="ui-faint" style={{ fontSize: 12 }}>Child fields are mapped individually below</span>}
          </div>
        ))}
      </Card>
      <Card title="Request body mapping — upstream ← your input">
        <div className="ui-callout"><Info /><span><strong>Direction is reversed here.</strong> Each row maps an upstream field to a source from your input. Configure these in the Upstream step under <code>body_mappings</code>.</span></div>
      </Card>
    </div>
  );
}

function StepTest() {
  const [tab, setTab] = useState("Transformed output");
  return (
    <div className="ui-stack">
      <Card title="Test request" action={<button className="ui-btn ui-btn--primary ui-btn--sm"><Play />Run test</button>}>
        <div className="ui-flow" style={{ marginBottom: 18 }}>
          <div className="ui-flow__node" style={{ flex: 1.5 }}>
            <div className="ui-flow__label"><Laptop />Your client calls</div>
            <div className="ui-row" style={{ alignItems: "flex-start" }}><Method m="POST" /><span className="ui-mono" style={{ overflowWrap: "anywhere" }}>localhost:5000/api/admin/demo/v1/members</span></div>
          </div>
          <div className="ui-flow__edge" />
          <div className="ui-flow__node is-hub">
            <div className="ui-flow__label"><Workflow />Orchestrator</div>
            <div className="ui-row ui-row--wrap"><Badge>Validate</Badge><Badge tone="accent">addMember.js</Badge><Badge>Map 6 fields</Badge></div>
          </div>
          <div className="ui-flow__edge" />
          <div className="ui-flow__node">
            <div className="ui-flow__label"><Server />Upstream</div>
            <span className="ui-muted" style={{ fontSize: 12.5 }}>Handled by the script in full handler mode</span>
          </div>
        </div>
        <div className="ui-formgrid">
          <div className="ui-field"><span className="ui-label">Query param overrides</span><button className="ui-addrow"><Plus />Add param</button></div>
          <div className="ui-field"><span className="ui-label">Test headers <span className="ui-faint" style={{ fontWeight: 400 }}>this run only</span></span><button className="ui-addrow"><Plus />Add header</button></div>
        </div>
        <Field label="Request body (application/json)"><textarea className="ui-textarea ui-textarea--mono" placeholder={'{"key": "value"}'} /></Field>
      </Card>
      <Card flush title={<span className="ui-row">Results <Badge tone="success" dot>HTTP 200</Badge></span>}>
        <div className="ui-tabs" style={{ padding: "0 8px" }}>
          {["Upstream request", "Raw result", "Transformed output", "Schema validation"].map(t => <button key={t} className={`ui-tab${tab === t ? " is-active" : ""}`} onClick={() => setTab(t)}>{t}</button>)}
        </div>
        <div className="ui-card__body">
          <Code title={tab} value={tab === "Raw result" ? SAMPLE : { created: true, member: { id: "ABCD1234567890", name: { full: "Mr John Doe I" }, gender: "male", birthDate: "2004-08-19", email: "john.doe@example.com" } }} />
        </div>
      </Card>
    </div>
  );
}

function EndpointScreen({ step }: { step: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ Member: true });
  const body = { request: <StepRequest />, response: <StepResponse />, upstream: <StepUpstream />, sample: <StepSample />, mapping: <StepMapping />, test: <StepTest /> }[step] ?? <StepMapping />;
  return (
    <div className="ui-page" key="endpoint">
      <div className="ui-pagehead" style={{ alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div className="ui-row ui-row--wrap" style={{ gap: 10 }}>
            <h1>Admin Studio Demo API</h1><Badge tone="success" dot>Active</Badge><Badge>dev</Badge><Badge tone="warning"><LockOpen />Auth off</Badge>
          </div>
          <div className="ui-row" style={{ marginTop: 8 }}>
            <span className="ui-path">/api/admin/demo/v1<Copy size={12} /></span>
            <span className="ui-faint" style={{ fontSize: 12 }}>Frontend calls this prefix + endpoint path</span>
          </div>
        </div>
        <div className="ui-row"><button className="ui-btn"><History />History</button><button className="ui-btn"><GitCompareArrows />Compare</button><button className="ui-btn"><Download />Export</button></div>
      </div>
      <div className="ui-tabs" style={{ marginBottom: 16 }}>
        <button className="ui-tab is-active"><Boxes />Endpoints<span className="ui-count">63</span></button>
        <button className="ui-tab"><Users />Users</button><button className="ui-tab"><Clock />Sessions</button>
        <button className="ui-tab"><FileCode2 />Scripts</button><button className="ui-tab"><Settings />Settings</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "284px minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <section className="ui-card" style={{ position: "sticky", top: 0 }}>
          <div className="ui-row" style={{ padding: "10px 10px 4px" }}>
            <div className="ui-search ui-grow"><Search /><input className="ui-input ui-input--sm" placeholder="Filter endpoints" /></div>
            <button className="ui-iconbtn ui-iconbtn--bordered" aria-label="New folder"><FolderPlus /></button>
            <button className="ui-btn ui-btn--primary ui-btn--sm" style={{ width: 30, padding: 0 }} aria-label="New endpoint"><Plus /></button>
          </div>
          <div className="ui-tree">
            {TREE.map(([folder, n, items]) => (
              <div key={folder}>
                <button className="ui-tree__group" onClick={() => setOpen(o => ({ ...o, [folder]: !o[folder] }))}>
                  {open[folder] ? <ChevronDown /> : <ChevronRight />}<span className="ui-grow">{folder}</span><span className="ui-count">{n}</span>
                </button>
                {open[folder] && items.length > 0 && (
                  <div className="ui-tree__children">
                    {items.map(([m, name]) => <button key={name} className={`ui-tree__item${name === "Create a member" ? " is-active" : ""}`}><Method m={m} /><span className="ui-truncate">{name}</span></button>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
        <div className="ui-stack">
          <div className="ui-row" style={{ gap: 12 }}>
            <Method m="POST" lg /><span style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>/members</span>
            <span className="ui-muted">Create a member</span><div className="ui-grow" />
            <button className="ui-iconbtn ui-iconbtn--bordered" aria-label="Edit endpoint"><Pencil /></button>
          </div>
          <div className="ui-stepper">
            {STEPS.map(([key, label, meta, state], i) => (
              <button key={key} className={`ui-step${step === key ? " is-current" : state === "done" ? " is-done" : ""}`} onClick={() => go(`endpoint/${key}`)}>
                <span className="ui-step__dot">{step !== key && state === "done" ? <Check /> : i + 1}</span>
                <span className="ui-step__text"><div className="ui-step__label">{label}</div><div className="ui-step__meta">{meta}</div></span>
              </button>
            ))}
          </div>
          <div key={step} className="ui-enter">{body}</div>
        </div>
      </div>
    </div>
  );
}

// ── Screen: Bot detail ───────────────────────────────────────────────────────
const AUDIT: [string, number, string][] = [
  ["api_portal_demo_v1_list_plan_benefits", 920, "10 Oct 2026, 10:44:18"], ["api_portal_demo_v1_get_member_policy", 991, "10 Oct 2026, 10:42:53"],
  ["api_portal_demo_v1_list_member_policies", 908, "10 Oct 2026, 10:41:29"], ["api_portal_demo_v1_get_member", 883, "10 Oct 2026, 10:41:03"],
  ["api_portal_demo_v1_get_member", 1033, "9 Oct 2026, 23:52:54"], ["api_portal_demo_v1_list_plan_benefits", 1152, "9 Oct 2026, 23:41:29"],
  ["api_portal_demo_v1_get_member_policy", 1128, "9 Oct 2026, 23:41:27"], ["api_portal_demo_v1_list_accumulators", 1256, "9 Oct 2026, 23:40:03"],
  ["api_portal_demo_v1_list_member_policies", 1122, "9 Oct 2026, 23:40:02"], ["api_portal_demo_v1_list_plan_benefits", 2847, "9 Oct 2026, 23:37:00"],
];
const RULES = [
  "Your scope to answer any question is within the applications you are assigned. Any question outside that scope should be politely rejected, mentioning a scope error.",
  "The authenticated member is {{member_id}}. Never ask the user for their member ID. Fetching data for any other member ID is impossible; do not attempt it.",
  "Dependents and other members listed inside this member's own policy records are part of the member's data. Show their details in full when asked.",
  "Answer in the same language and tone as the user's question. Format answers for a chat interface; do not output raw JSON unless the user asks for it.",
];

function BotScreen({ tab }: { tab: string }) {
  const tabs: [string, string][] = [["overview", "Overview"], ["behaviour", "Behaviour"], ["bindings", "Bindings"], ["limits", "Limits"], ["audit", "Audit"]];
  const [active, setActive] = useState(true);
  return (
    <div className="ui-page" key="bot">
      <div className="ui-pagehead" style={{ alignItems: "flex-start", marginBottom: 14 }}>
        <div className="ui-row" style={{ gap: 14 }}>
          <span className="ui-tile" style={{ width: 44, height: 44, borderRadius: 13 }}><Bot size={20} /></span>
          <div><div className="ui-row" style={{ gap: 10 }}><h1>member-portal-bot</h1>{active ? <Badge tone="success" dot>Active</Badge> : <Badge dot>Disabled</Badge>}</div><p>1 app · 1 provider · 9 rules</p></div>
        </div>
        <div className="ui-row">
          <button className={`ui-btn${active ? "" : " ui-btn--success"}`} onClick={() => setActive(a => !a)}><Power />{active ? "Disable" : "Enable"}</button>
          <button className="ui-btn"><Download />Export</button>
        </div>
      </div>
      <div className="ui-tabs" style={{ marginBottom: 16 }}>{tabs.map(([k, l]) => <button key={k} className={`ui-tab${tab === k ? " is-active" : ""}`} onClick={() => go(`bot/${k}`)}>{l}</button>)}</div>
      <div key={tab} className="ui-stack ui-enter">
        {tab === "overview" && <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
            {[["Apps assigned", "1", <Boxes />], ["Providers assigned", "1", <Sparkles />], ["Guardrail rules", <>9 <small>/ 20</small></>, <ShieldCheck />], ["Last used", <span style={{ fontSize: 17 }}>11 Oct, 19:12</span>, <Clock />]].map(([l, v, ic]) => (
              <div key={String(l)} className="ui-stat"><div className="ui-stat__label">{ic}{l}</div><div className="ui-stat__value">{v}</div></div>
            ))}
          </div>
          {!active && <div className="ui-callout ui-callout--warning"><TriangleAlert /><span>This bot is disabled. It cannot authenticate or call the AI agent and MCP endpoints until you enable it.</span></div>}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
            <Card title="Details">
              <dl className="ui-kv">
                <dt>Bot ID</dt><dd><span className="ui-path">aa97cbd3-0f8b-4296-a986-e7ea9bc8dc72<Copy size={12} /></span></dd>
                <dt>Created</dt><dd className="ui-num">8 Sep 2026, 15:59:38</dd>
                <dt>Last used</dt><dd className="ui-num">11 Oct 2026, 19:12:23</dd>
              </dl>
              <div className="ui-callout ui-callout--warning" style={{ marginTop: 16 }}><TriangleAlert /><span>The API key is shown once at registration. If it is lost, delete this bot and register a new one. Send it as the <code>X-Bot-Key</code> header.</span></div>
            </Card>
            <Card title="MCP client configuration">
              <Code title="Claude Desktop, Cursor, VS Code, LangChain" value={{ mcpServers: { orchestrator: { url: "http://localhost:3004/mcp", headers: { "X-Bot-Key": "<your-bot-key>" } } } }} />
            </Card>
          </div>
          <Card title="Danger zone">
            <div className="ui-row"><div className="ui-grow"><div style={{ fontWeight: 600 }}>Delete this bot</div><p className="ui-muted" style={{ fontSize: 12.5 }}>Permanently deletes the bot and revokes its key immediately. Cannot be undone.</p></div><button className="ui-btn ui-btn--danger"><Trash2 />Delete bot</button></div>
          </Card>
        </>}
        {tab === "behaviour" && <>
          <Card title="Custom persona / identity" action={<button className="ui-btn ui-btn--primary ui-btn--sm">Save</button>}>
            <Field label="Instructions / persona" hint="Replaces the default 'You are an API assistant…' opener. Leave blank to use the default."><textarea className="ui-textarea ui-textarea--mono" defaultValue="/no_think" /></Field>
          </Card>
          <Card title={<span className="ui-row">Guardrail rules <span className="ui-count">9 / 20</span></span>} action={<button className="ui-btn ui-btn--primary ui-btn--sm">Save</button>}>
            <div className="ui-callout ui-callout--neutral" style={{ marginBottom: 14 }}><Info /><span><strong>These are soft instructions</strong>, injected as the highest-priority section of the system prompt. For hard enforcement use the Limits tab.</span></div>
            <div className="ui-row" style={{ marginBottom: 14 }}><input className="ui-input" placeholder="Only answer questions about insurance policies and claims" /><button className="ui-btn"><Plus />Add</button></div>
            <div className="ui-frows">
              {RULES.map((r, i) => (
                <div key={i} className="ui-frow" style={{ height: "auto", padding: "10px 6px 10px 12px", alignItems: "flex-start" }}>
                  <span className="ui-count">{i + 1}</span><span className="ui-grow" style={{ lineHeight: 1.5 }}>{r}</span>
                  <span className="ui-row" style={{ gap: 2 }}><button className="ui-iconbtn ui-iconbtn--sm" aria-label="Move up"><ArrowUp /></button><button className="ui-iconbtn ui-iconbtn--sm" aria-label="Move down"><ArrowDown /></button><button className="ui-iconbtn ui-iconbtn--sm ui-iconbtn--danger" aria-label="Remove"><X /></button></span>
                </div>
              ))}
              <span className="ui-faint" style={{ fontSize: 12 }}>5 more rules</span>
            </div>
          </Card>
        </>}
        {tab === "bindings" && <>
          <div className="ui-callout ui-callout--neutral"><Lock /><span>Deny by default: a bot can only access apps explicitly assigned here. Read covers GET endpoints; write covers POST, PUT, PATCH and DELETE.</span></div>
          <Card flush title={<span className="ui-row">Allowed apps <span className="ui-count">1</span></span>} action={<select className="ui-select ui-select--sm" style={{ width: 200 }}><option>Add app…</option></select>}>
            <table className="ui-table">
              <thead><tr><th>App</th><th>Read</th><th>Write</th><th /></tr></thead>
              <tbody><tr><td><div style={{ fontWeight: 600 }}>Member Portal Demo API</div><span className="ui-mono ui-muted">/api/portal/demo/v1</span></td><td><input type="checkbox" defaultChecked /></td><td><input type="checkbox" defaultChecked /></td><td className="ui-cell-actions"><button className="ui-iconbtn ui-iconbtn--danger" aria-label="Remove"><X /></button></td></tr></tbody>
            </table>
          </Card>
          <Card flush title={<span className="ui-row">Allowed LLM providers <span className="ui-count">1</span></span>} action={<button className="ui-btn ui-btn--primary ui-btn--sm">Save</button>}>
            <table className="ui-table"><tbody><tr><td><div className="ui-row" style={{ gap: 12 }}><span className="ui-tile"><Sparkles /></span><div><div style={{ fontWeight: 600 }}>LiteLLM Claude Sonnet 4.6</div><span className="ui-mono ui-muted">claude-sonnet-4-6</span></div></div></td><td className="ui-cell-actions"><button className="ui-iconbtn ui-iconbtn--danger" aria-label="Remove"><X /></button></td></tr></tbody></table>
            <div className="ui-card__foot">The first active provider in this list is used. Deactivated providers are skipped.</div>
          </Card>
        </>}
        {tab === "limits" && <>
          <Card title="Performance limits" action={<button className="ui-btn ui-btn--primary ui-btn--sm">Save</button>}>
            <div className="ui-callout" style={{ marginBottom: 16 }}><Info /><span>Hard limits enforced by code. Leave blank to use the global default.</span></div>
            <div className="ui-formgrid">
              <Field label="Max tool calls per request" hint="LLM ↔ tool round-trips (default 6, max 20)"><input className="ui-input ui-num" defaultValue="10" /></Field>
              <Field label="Max history messages" hint="Most recent N messages sent to the LLM (max 100)"><input className="ui-input ui-num" defaultValue="50" /></Field>
              <Field label="LLM timeout (ms)" hint="Default 60000, range 5000–120000"><input className="ui-input ui-num" defaultValue="120000" /></Field>
              <Field label="Max response words" hint="Truncate longer responses (max 2000)"><input className="ui-input" placeholder="unlimited" /></Field>
              <Field label="Rate limit (req/min)" hint="Abuse protection, 0 = unlimited"><input className="ui-input ui-num" defaultValue="50" /></Field>
            </div>
          </Card>
        </>}
        {tab === "audit" && (
          <Card flush title="Tool call audit" action={<button className="ui-btn ui-btn--sm"><RefreshCw />Refresh</button>}>
            {AUDIT.map(([tool, ms, at], i) => (
              <div key={i} className="ui-log">
                <CircleCheck size={15} style={{ color: "var(--success)" }} />
                <span className="ui-mono ui-truncate">{tool}</span>
                <span className="ui-row"><span className="ui-bar"><i style={{ width: `${Math.min(100, ms / 30)}%` }} /></span><span className="ui-mono ui-muted" style={{ width: 56, textAlign: "right" }}>{ms} ms</span></span>
                <span className="ui-muted ui-num" style={{ fontSize: 12 }}>{at}</span>
                <ChevronDown size={15} className="ui-faint" />
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}

// ── Screen: Tenant settings ──────────────────────────────────────────────────
// The landing page is a grid of cards; each card opens a full-width detail page.
// Every "Add …" action opens a modal; no page uses an inline form.
type FieldSpec = { label: string; ph?: string; hint?: string; mono?: boolean; type?: "password" | "select"; options?: string[]; half?: boolean; value?: string };
type SettingsTab = { label: string; icon: typeof Lock; desc: string; noun?: string; add?: string; cols?: string[]; rows?: ReactNode[][]; rowActions?: ReactNode; foot?: string; fields?: FieldSpec[] };
const plural = (n: number, noun: string) => (n === 1 ? noun.replace(/s$/, "") : noun);

const cMono = (t: string) => <span className="ui-mono" style={{ fontWeight: 600 }}>{t}</span>;
const cMuted = (t: string) => (t ? <span className="ui-muted">{t}</span> : <span className="ui-faint">—</span>);
const cDate = (t: string) => <span className="ui-muted ui-num" style={{ whiteSpace: "nowrap" }}>{t}</span>;
const cVault = (t: string) => <span className="ui-row ui-muted" style={{ gap: 6 }}><Lock size={13} /><span className="ui-mono">{t}</span></span>;
const B_ACTIVE = <Badge tone="success" dot>Active</Badge>;
const B_EXACT = <Badge>exact</Badge>;
const B_LOCAL = <Badge>Local · no auth</Badge>;
const DEL = <button className="ui-iconbtn ui-iconbtn--danger" aria-label="Delete" style={{ verticalAlign: "middle" }}><Trash2 /></button>;
const quiet = (label: string, icon?: ReactNode) => <button className="ui-btn ui-btn--quiet ui-btn--sm">{icon}{label}</button>;
const VAULT = ["— none —", "litellm-api-key", "OPENAI_LLM_KEY", "gmail-smtp-pass", "okta-healthcare-oidc"];
const LLM = "https://llm.acceleratingdigital.com";
const OLLAMA = "http://host.docker.internal:11434/v1";

const SETTINGS: Record<string, SettingsTab> = {
  organization: { label: "Organization", icon: Building2, desc: "Your organization's name, slug and ID." },
  "host-allowlist": {
    label: "Host Allowlist", icon: Globe, desc: "Upstream hosts your endpoints are allowed to call.", noun: "hosts", add: "Add host", rowActions: DEL,
    cols: ["Hostname", "Type", "Description", "Added"],
    rows: [
      ["mock-server", "Seeded from UPSTREAM_HOST_ALLOWLIST env var", "8 Sep 2026"], ["localhost", "Seeded from UPSTREAM_HOST_ALLOWLIST env var", "8 Sep 2026"],
      ["host.docker.internal", "Seeded from UPSTREAM_HOST_ALLOWLIST env var", "8 Sep 2026"], ["xapi-mock.acceleratingdigital.com", "xAPI Insurance Portal Mock", "8 Sep 2026"],
      ["mongodb.com", "mongodb", "1 Oct 2026"], ["rvkqcxelwywykidlarte.supabase.co", "Supabase", "11 Oct 2026"],
    ].map(([h, d, at]) => [cMono(h), B_EXACT, cMuted(d), cDate(at)]),
    foot: "Wildcards are supported: *.typicode.com allows jsonplaceholder.typicode.com and every other subdomain.",
    fields: [
      { label: "Hostname", ph: "jsonplaceholder.typicode.com", hint: "An exact host, or a wildcard such as *.typicode.com", mono: true },
      { label: "Description (optional)", ph: "JSON Placeholder test API" },
    ],
  },
  "allowed-origins": {
    label: "Allowed Origins", icon: Link2, desc: "Browser origins that may call your runtime API endpoints via CORS.", noun: "origins", add: "Add origin", rowActions: DEL,
    cols: ["Origin", "Type", "Description", "Added"],
    rows: [
      ["http://localhost:3001", "8 Sep 2026"], ["https://necessitous-semisocialistically-tinisha.ngrok-free.dev", "9 Sep 2026"],
      ["http://localhost:4000", "10 Sep 2026"], ["http://localhost:3000", "29 Sep 2026"], ["http://localhost:8080", "9 Oct 2026"],
    ].map(([o, at]) => [cMono(o), B_EXACT, cMuted(""), cDate(at)]),
    foot: "The dashboard itself is always allowed for config routes. OIDC callbacks are server-to-server and are not affected by this list. Browser preflight requests are always answered without auth.",
    fields: [
      { label: "Origin", ph: "https://myapp.com", hint: "Full scheme and host, for example http://localhost:3000", mono: true },
      { label: "Description (optional)", ph: "Main customer portal" },
    ],
  },
  "identity-providers": {
    label: "Identity Providers", icon: KeyRound, desc: "OIDC providers whose tokens the runtime accepts.", noun: "providers", add: "Add provider", rowActions: <>{quiet("Edit", <Pencil />)}{DEL}</>,
    cols: ["Name", "Issuer", "Brokered login", "Provider ID", "Status"],
    rows: [["Google", "https://accounts.google.com", "80d49aff…"], ["Okta OIDC", "https://integrator-2835707.okta.com", "f0fe6e20…"]]
      .map(([n, iss, id]) => [<strong style={{ fontWeight: 600 }}>{n}</strong>, <span className="ui-mono ui-muted">{iss}</span>, <Badge>Configured</Badge>, <span className="ui-path">{id}<Copy size={12} /></span>, B_ACTIVE]),
    foot: "With a client ID and vault secret set, apps also get full redirect login.",
    fields: [
      { label: "Name", ph: "Google", half: true }, { label: "Audience", ph: "api://default", half: true, mono: true },
      { label: "Issuer URL", ph: "https://accounts.google.com", mono: true },
      { label: "JWKS URI", ph: "https://…/.well-known/jwks.json", hint: "Leave blank to auto-discover from /.well-known/openid-configuration", mono: true },
      { label: "Client ID", ph: "1234567890.apps.googleusercontent.com", half: true, mono: true }, { label: "Client secret (from vault)", type: "select", options: VAULT, half: true },
      { label: "Scopes", value: "openid email profile", hint: "Space-separated OIDC scopes", mono: true },
    ],
  },
  mail: {
    label: "Mail (SMTP)", icon: Mail, desc: "SMTP senders, and which sender handles each kind of email.", noun: "senders", add: "Add sender", rowActions: <>{quiet("Test")}{quiet("Edit", <Pencil />)}{DEL}</>,
    cols: ["Name", "Host", "From", "Status"],
    rows: [[<span className="ui-row"><strong style={{ fontWeight: 600 }}>Default</strong><Badge tone="accent">Routed</Badge></span>, cMono("smtp.gmail.com:587"), cMuted("notifications@example.com"), B_ACTIVE]],
    foot: "Passwords live in the Secrets vault. Only the reference is stored on the sender.",
    fields: [
      { label: "Name", ph: "Gmail notifications", half: true }, { label: "From name", ph: "Acme Portal", half: true },
      { label: "SMTP host", ph: "smtp.gmail.com", half: true, mono: true }, { label: "Port", value: "587", half: true, mono: true },
      { label: "Username", ph: "notifications@yourdomain.com", half: true }, { label: "Password (from vault)", type: "select", options: VAULT, half: true },
      { label: "From address", ph: "notifications@yourdomain.com" },
    ],
  },
  secrets: {
    label: "Secrets", icon: Lock, desc: "Upstream API keys and bearer tokens. Encrypted at rest and never returned in plaintext.", noun: "secrets", add: "Add secret", rowActions: <>{quiet("Rotate", <RotateCw />)}{DEL}</>,
    cols: ["Name", "Description", "Value", "Created", "Last rotated"],
    rows: [
      ["litellm-api-key", "Used by bots for LiteLLM in the chatbot", "8 Sep 2026"], ["OPENAI_LLM_KEY", "LLM key for AI providers", "8 Sep 2026"],
      ["gmail-smtp-pass", "Gmail SMTP app password", "28 Sep 2026"], ["googl-client-secret-carawinn", "", "29 Sep 2026"],
      ["okta-healthcare-test-key", "Used to test the Okta IdP", "6 Oct 2026"], ["okta-healthcare-oidc", "", "6 Oct 2026"],
      ["okta-jwks-key", "PEM for the JWKS public-private key", "9 Oct 2026"], ["jyotishvastu-supabase-pass", "", "11 Oct 2026"],
      ["SUPABASE_SERVICE_ROLE_KEY", "", "11 Oct 2026"], ["PUBLIC_SUPABASE_ANON_KEY", "", "11 Oct 2026"],
    ].map(([n, d, at]) => [<span className="ui-row"><KeyRound size={14} style={{ color: "var(--primary)" }} />{cMono(n)}</span>, cMuted(d), <span className="ui-faint" style={{ letterSpacing: 2 }}>••••••••</span>, cDate(at), <span className="ui-faint">Never</span>]),
    fields: [
      { label: "Name", ph: "mulesoft-api-key", mono: true }, { label: "Description", ph: "What this key is used for" },
      { label: "Secret value", type: "password", hint: "Write-only. It is never shown again after saving.", mono: true },
    ],
  },
  ai: {
    label: "AI & MCP", icon: Sparkles, desc: "OpenAI-compatible LLM providers available to your bots.", noun: "providers", add: "Add provider", rowActions: DEL,
    cols: ["Provider", "Base URL", "Model", "Auth", "Status"],
    rows: ([
      ["Litellm", LLM, "algolia/xlarge", "litellm-api-key"], ["FunctionGemma (built-in)", OLLAMA, "functiongemma", ""], ["Ollama-local", OLLAMA, "qwen3:4b", ""],
      ["LiteLLM", LLM, "algolia/large", "litellm-api-key"], ["LiteLLM Claude Sonnet 4.6", LLM, "claude-sonnet-4-6", "litellm-api-key"],
    ]).map(([n, url, model, vault]) => [<strong style={{ fontWeight: 600 }}>{n}</strong>, <span className="ui-mono ui-muted">{url}</span>, cMono(model), vault ? cVault(vault) : B_LOCAL, B_ACTIVE]),
    foot: "API keys are stored as vault references, never as plain text. Assign providers to bots in Bot Registry, Bindings.",
    fields: [
      { label: "Name", ph: "openai-prod", half: true }, { label: "Model", ph: "gpt-4o-mini", half: true, mono: true },
      { label: "Base URL", ph: "https://api.openai.com/v1", hint: "OpenAI-compatible root", mono: true },
      { label: "API key (from vault)", type: "select", options: ["Select a secret…", ...VAULT.slice(1), "No auth (local or open model)"], hint: "Keys are never entered as plain text. Rotate the secret and providers pick it up automatically." },
    ],
  },
  users: {
    label: "Users", icon: Users, desc: "People who can access this Config Dashboard.", noun: "admins", add: "Add admin", rowActions: quiet("Reset password"),
    cols: ["Username", "Email", "Role", "Status", "Last login"],
    rows: [[<span className="ui-row"><strong style={{ fontWeight: 600 }}>admin</strong><span className="ui-faint" style={{ fontSize: 12 }}>you</span></span>, cMuted("admin@localhost"), <Badge tone="accent">Admin</Badge>, B_ACTIVE, cDate("11 Oct 2026, 18:57")]],
    fields: [
      { label: "Username", half: true }, { label: "Email", half: true },
      { label: "Password", type: "password", hint: "Minimum 12 characters", half: true }, { label: "Role", type: "select", options: ["Viewer", "Sub admin", "Admin"], half: true },
    ],
  },
};

function SettingsScreen({ tab, adding }: { tab: string; adding: boolean }) {
  const t = SETTINGS[tab];
  if (!t) {
    return (
      <div className="ui-page" key="settings">
        <div className="ui-pagehead"><div><h1>Tenant Settings</h1><p>Manage your organization, allowed upstream hosts, identity providers, secrets, and users.</p></div></div>
        <div className="ui-cardgrid">
          {Object.entries(SETTINGS).map(([key, s], i) => (
            <button key={key} className="ui-navcard" style={{ "--i": i } as CSSProperties} onClick={() => go(`settings/${key}`)}>
              <span className="ui-tile"><s.icon /></span>
              <ArrowRight className="ui-navcard__arrow" size={16} />
              <span><span className="ui-navcard__title">{s.label}</span><span className="ui-navcard__desc">{s.desc}</span></span>
              <span className="ui-navcard__meta">{s.rows ? <><span className="ui-count">{s.rows.length}</span>{plural(s.rows.length, s.noun!)}</> : "Default Organization"}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  const close = () => go(`settings/${tab}`);
  return (
    <div className="ui-page" key={`settings-${tab}`}>
      <div className="ui-pagehead" style={{ alignItems: "flex-start" }}>
        <div className="ui-row" style={{ gap: 12, alignItems: "flex-start" }}>
          <button className="ui-iconbtn ui-iconbtn--bordered" style={{ marginTop: 1 }} aria-label="Back to Tenant Settings" onClick={() => go("settings")}><ArrowLeft /></button>
          <div><h1>{t.label}</h1><p>{t.desc}</p></div>
        </div>
        {t.add && <button className="ui-btn ui-btn--primary" onClick={() => go(`settings/${tab}/add`)}><Plus />{t.add}</button>}
      </div>
      {!t.rows ? (
        <Card title="Profile" action={<button className="ui-btn ui-btn--primary ui-btn--sm">Save</button>}>
          <div className="ui-formgrid">
            <Field label="Organization name" hint="Displayed in the dashboard header and response headers"><input className="ui-input" defaultValue="Default Organization" /></Field>
            <Field label="Slug" hint="Used in URLs and system references. Lowercase, no spaces."><input className="ui-input ui-input--mono" defaultValue="default" /></Field>
          </div>
          <dl className="ui-kv" style={{ marginTop: 6 }}><dt>Organization ID</dt><dd><span className="ui-path">75ac122d-bbe7-477a-9dee-e0e2071610b8<Copy size={12} /></span></dd><dt>Created</dt><dd className="ui-num">8 Sep 2026, 12:37:41</dd></dl>
        </Card>
      ) : (
        <Card flush title={<span className="ui-row"><span className="ui-count">{t.rows.length}</span>{plural(t.rows.length, t.noun!)}</span>} action={
          <div className="ui-row">
            <div className="ui-search" style={{ width: 240 }}><Search /><input className="ui-input ui-input--sm" placeholder={`Filter ${t.noun}`} /></div>
            <button className="ui-iconbtn ui-iconbtn--bordered" aria-label="Refresh"><RefreshCw /></button>
          </div>
        }>
          <table className="ui-table">
            <thead><tr>{t.cols!.map(c => <th key={c}>{c}</th>)}<th /></tr></thead>
            <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}<td className="ui-cell-actions">{t.rowActions}</td></tr>)}</tbody>
          </table>
          {t.foot && <div className="ui-card__foot">{t.foot}</div>}
        </Card>
      )}
      {adding && t.fields && (
        <div className="ui-overlay" onClick={e => { if (e.target === e.currentTarget) close(); }}>
          <form className="ui-modal" role="dialog" aria-label={t.add} onSubmit={e => { e.preventDefault(); close(); }}>
            <div className="ui-modal__head"><span className="ui-modal__title">{t.add}</span><button type="button" className="ui-iconbtn" aria-label="Close" onClick={close}><X /></button></div>
            <div className="ui-modal__body" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "0 14px" }}>
              {t.fields.map((f, i) => (
                <div key={f.label} style={{ gridColumn: f.half ? "auto" : "1 / -1" }}>
                  <Field label={f.label} hint={f.hint}>
                    {f.type === "select"
                      ? <select className="ui-select">{f.options!.map(o => <option key={o}>{o}</option>)}</select>
                      : <input className={`ui-input${f.mono ? " ui-input--mono" : ""}`} type={f.type === "password" ? "password" : "text"} placeholder={f.ph} defaultValue={f.value} autoFocus={i === 0} autoComplete="off" />}
                  </Field>
                </div>
              ))}
            </div>
            <div className="ui-modal__foot"><button type="button" className="ui-btn" onClick={close}>Cancel</button><button className="ui-btn ui-btn--primary">{t.add}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

// ── Screen: Login ────────────────────────────────────────────────────────────
function LoginScreen() {
  return (
    <div className="ui-login">
      <form className="ui-login__card" onSubmit={e => e.preventDefault()}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: 26 }}>
          <span className="ui-brand__mark" style={{ width: 46, height: 46, borderRadius: 14, marginBottom: 16 }}><Zap style={{ width: 22, height: 22 }} /></span>
          <h1 style={{ fontSize: 21, fontWeight: 650, letterSpacing: "-0.02em" }}>API Orchestrator</h1>
          <p className="ui-muted" style={{ marginTop: 4 }}>Config Dashboard. Sign in to continue.</p>
        </div>
        <Field label="Username"><input className="ui-input" style={{ height: 40 }} autoComplete="off" /></Field>
        <Field label="Password"><input className="ui-input" style={{ height: 40 }} type="password" autoComplete="off" /></Field>
        <button className="ui-btn ui-btn--primary ui-btn--block" style={{ marginTop: 6 }}>Sign in</button>
      </form>
    </div>
  );
}

// ── Screen: Component sheet ──────────────────────────────────────────────────
function ComponentsScreen() {
  const [on, setOn] = useState(true);
  return (
    <div className="ui-page" key="components">
      <div className="ui-pagehead"><div><h1>Components</h1><p>The building blocks every screen is assembled from.</p></div></div>
      <div className="proto-sheet">
        <Card title="Buttons">
          <div className="ui-row ui-row--wrap"><button className="ui-btn ui-btn--primary"><Plus />Primary</button><button className="ui-btn">Secondary</button><button className="ui-btn ui-btn--outline">Outline</button><button className="ui-btn ui-btn--quiet">Quiet</button><button className="ui-btn ui-btn--danger"><Trash2 />Danger</button></div>
          <div className="ui-row ui-row--wrap" style={{ marginTop: 12 }}><button className="ui-btn ui-btn--primary ui-btn--sm">Small</button><button className="ui-btn ui-btn--sm">Small</button><button className="ui-btn ui-btn--sm" disabled>Disabled</button><button className="ui-iconbtn ui-iconbtn--bordered" aria-label="Edit"><Pencil /></button><button className="ui-iconbtn" aria-label="More"><Ellipsis /></button></div>
        </Card>
        <Card title="Status and methods">
          <div className="ui-row ui-row--wrap"><Badge tone="success" dot>Active</Badge><Badge tone="warning" dot>Draft</Badge><Badge tone="danger" dot>Deprecated</Badge><Badge tone="accent">Admin</Badge><Badge>Viewer</Badge></div>
          <div className="ui-row ui-row--wrap" style={{ marginTop: 12 }}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map(m => <Method key={m} m={m} />)}<span className="ui-path">/api/portal/demo/v1</span></div>
        </Card>
        <Card title="Form controls">
          <div className="ui-formgrid"><Field label="Text input" hint="Helper text sits below the field"><input className="ui-input" placeholder="member-portal" /></Field><Field label="Select"><select className="ui-select"><option>application/json</option></select></Field></div>
          <div className="ui-row" style={{ gap: 16 }}><span className="ui-row"><button className="ui-toggle" role="switch" aria-checked={on} onClick={() => setOn(o => !o)} aria-label="Toggle" />Auth required</span><label className="ui-row"><input type="checkbox" defaultChecked />Read</label><label className="ui-row"><input type="checkbox" />Write</label></div>
        </Card>
        <Card title="Tabs and segmented control">
          <div className="ui-tabs" style={{ marginBottom: 14 }}><button className="ui-tab is-active">Overview</button><button className="ui-tab">Behaviour</button><button className="ui-tab">Audit<span className="ui-count">13</span></button></div>
          <div className="ui-seg"><button className="ui-seg__item">None</button><button className="ui-seg__item is-active">Full handler</button><button className="ui-seg__item">Pre-hook</button></div>
        </Card>
        <Card title="Callouts">
          <div className="ui-stack" style={{ gap: 8 }}>
            <div className="ui-callout"><Info /><span>API keys are stored as vault references, never as plain text.</span></div>
            <div className="ui-callout ui-callout--warning"><TriangleAlert /><span>This base path is already taken.</span></div>
            <div className="ui-callout ui-callout--danger"><TriangleAlert /><span>Upstream host is not on the allowlist.</span></div>
          </div>
        </Card>
        <Card title="Toasts, loading, menu">
          <div className="ui-stack" style={{ gap: 10 }}>
            <div className="ui-toast ui-toast--success ui-toast--static"><CircleCheck /><div><div style={{ fontWeight: 600 }}>Mappings saved</div><div className="ui-muted" style={{ fontSize: 12 }}>6 fields mapped for POST /members</div></div></div>
            <div className="ui-row"><span className="ui-spinner" /><div className="ui-skel ui-grow" style={{ height: 12 }} /><div className="ui-skel" style={{ width: 80, height: 12 }} /></div>
            <div className="ui-menu" style={{ position: "static", width: 200, animation: "none" }}><div className="ui-menu__label">Actions</div><button className="ui-menu__item"><Pencil />Edit</button><button className="ui-menu__item"><Copy />Clone</button><div className="ui-menu__sep" /><button className="ui-menu__item ui-menu__item--danger"><Trash2 />Delete</button></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Command palette ──────────────────────────────────────────────────────────
const KBAR: [string, [ReactNode, string, string, string][]][] = [
  ["Navigate", [[<Boxes />, "App Registry", "5 apps", "apps"], [<Bot />, "Bot Registry", "1 bot", "bot"], [<Settings />, "Tenant Settings", "", "settings"], [<Lock />, "Secrets", "Tenant Settings", "settings/secrets"]]],
  ["Apps", [[<Boxes />, "Admin Studio Demo API", "/api/admin/demo/v1", "endpoint/mapping"], [<Boxes />, "Member Portal Demo API", "/api/portal/demo/v1", "endpoint/mapping"]]],
  ["Endpoints", [[<Method m="POST" />, "Create a member", "/members", "endpoint/request"], [<Method m="GET" />, "Get members", "/members", "endpoint/test"]]],
];
function Kbar({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  return (
    <div className="ui-overlay ui-overlay--top" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ui-modal ui-kbar" role="dialog" aria-label="Command palette">
        <div className="ui-kbar__input"><Search /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search apps, endpoints, bots, settings…" /><kbd className="ui-kbd">esc</kbd></div>
        <div className="ui-kbar__list">
          {KBAR.map(([group, items]) => {
            const hits = items.filter(it => (it[1] + it[2]).toLowerCase().includes(q.toLowerCase()));
            if (!hits.length) return null;
            return <div key={group}><div className="ui-menu__label">{group}</div>{hits.map(([ic, l, hint, to]) => <button key={l} className="ui-menu__item" style={{ height: 38 }} onClick={() => { go(to); onClose(); }}>{ic}{l}<span className="ui-kbar__hint ui-mono">{hint}</span></button>)}</div>;
          })}
        </div>
        <div className="ui-kbar__foot"><span className="ui-row"><kbd className="ui-kbd">↑↓</kbd>Navigate</span><span className="ui-row"><CornerDownLeft size={12} />Open</span></div>
      </div>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────
const SCREENS: [string, string][] = [["login", "Login"], ["apps", "Apps"], ["endpoint/mapping", "Endpoint"], ["bot/overview", "Bot"], ["settings", "Settings"], ["components", "Components"]];

function Root() {
  const hash = useHash();
  const [screen, sub = "", sub2 = ""] = hash.split("/");
  const [theme, setTheme] = useState(params.get("theme") === "light" ? "light" : "dark");
  const [kbar, setKbar] = useState(params.has("kbar"));
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setKbar(k => !k); }
      if (e.key === "Escape") setKbar(false);
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, []);

  const crumbs = {
    apps: [{ label: "App Registry" }],
    endpoint: [{ label: "App Registry", to: "apps" }, { label: "Admin Studio Demo API" }],
    bot: [{ label: "Bot Registry", to: "bot" }, { label: "member-portal-bot" }],
    settings: SETTINGS[sub] ? [{ label: "Tenant Settings", to: "settings" }, { label: SETTINGS[sub].label }] : [{ label: "Tenant Settings" }],
    components: [{ label: "Components" }],
  }[screen] ?? [{ label: "App Registry" }];

  const body =
    screen === "endpoint" ? <EndpointScreen step={sub || "mapping"} />
    : screen === "bot" ? <BotScreen tab={sub || "overview"} />
    : screen === "settings" ? <SettingsScreen tab={sub} adding={sub2 === "add"} />
    : screen === "components" ? <ComponentsScreen />
    : <AppsScreen />;

  return (
    <>
      {screen === "login" ? <LoginScreen /> : (
        <Shell screen={screen} crumbs={crumbs} theme={theme} onTheme={() => setTheme(t => (t === "dark" ? "light" : "dark"))} onKbar={() => setKbar(true)}>{body}</Shell>
      )}
      {kbar && <Kbar onClose={() => setKbar(false)} />}
      {!params.has("bare") && (
        <div className="proto-bar">
          <span>Prototype</span>
          {SCREENS.map(([to, label]) => <button key={to} className={`ui-btn ui-btn--sm ${screen === to.split("/")[0] ? "ui-btn--outline" : "ui-btn--quiet"}`} onClick={() => go(to)}>{label}</button>)}
          <button className="ui-iconbtn" aria-label="Switch theme" onClick={() => setTheme(t => (t === "dark" ? "light" : "dark"))}>{theme === "dark" ? <Moon /> : <Sun />}</button>
        </div>
      )}
    </>
  );
}

// Reuse the root across hot reloads so React does not warn about a second createRoot.
const w = window as unknown as { __protoRoot?: ReturnType<typeof createRoot> };
(w.__protoRoot ??= createRoot(document.getElementById("root")!)).render(<Root />);
