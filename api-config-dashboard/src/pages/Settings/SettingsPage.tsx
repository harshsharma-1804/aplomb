import { Building2, Globe, Link, KeyRound, Mail, Lock, Bot, Users, Palette, Monitor, Moon, Sun, ArrowLeft, ArrowRight } from "lucide-react";
import { useTheme } from "../../theme/ThemeContext";
import { Card, SectionHead, Btn } from "../../components";

import { useNavigate, useParams } from "react-router-dom";
import { useSession } from "../../auth/SessionContext";
import { C } from "../../components";
import { useBreadcrumb } from "../../components/BreadcrumbContext";
import { OrganizationTab } from "./tabs/OrganizationTab";
import { HostAllowlistTab } from "./tabs/HostAllowlistTab";
import { IdentityProvidersTab } from "./tabs/IdentityProvidersTab";
import { SecretsTab } from "./tabs/SecretsTab";
import { UsersTab } from "./tabs/UsersTab";
import { AllowedOriginsTab } from "./tabs/AllowedOriginsTab";
import { AiTab } from "./tabs/AiTab";
import { MailTab } from "./tabs/MailTab";

const TABS = [
  { key: "appearance", label: "Appearance", icon: Palette, adminOnly: false },
  { key: "organization",       label: "Organization",        icon: Building2, adminOnly: false },
  { key: "host-allowlist",     label: "Host Allowlist",      icon: Globe, adminOnly: true  },
  { key: "allowed-origins",    label: "Allowed Origins",     icon: Link, adminOnly: true  },
  { key: "identity-providers", label: "Identity Providers",  icon: KeyRound, adminOnly: true  },
  { key: "mail",               label: "Mail (SMTP)",         icon: Mail, adminOnly: true  },
  { key: "secrets",            label: "Secrets",             icon: Lock, adminOnly: true  },
  { key: "ai",                 label: "AI & MCP",            icon: Bot, adminOnly: true  },
  { key: "users",              label: "Users",               icon: Users, adminOnly: true  },
];

const DESCRIPTIONS: Record<string,string> = {
  appearance:"Color palettes, light mode, dark mode, and your browser preferences.",
  organization:"Workspace name, slug, and organization identity.",
  "host-allowlist":"Trusted upstream hosts your endpoints can connect to.",
  "allowed-origins":"Web origins allowed to call the runtime API.",
  "identity-providers":"OIDC issuers and client credentials for sign-in.",
  mail:"SMTP senders, delivery routing, and phone verification.",
  secrets:"Encrypted credentials referenced by upstream services.",
  ai:"LLM providers, bot clients, and recent tool calls.",
  users:"Manage dashboard administrators and their access.",
};

export function SettingsPage() {
  const { can } = useSession();
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const visibleSection = TABS.find(t => t.key === tab && (!t.adminOnly || can("manage:users")));
  const activeTab = visibleSection?.key;
  useBreadcrumb(`/settings${activeTab ? `/${activeTab}` : ""}`, [
    { label: "Tenant Settings", to: "/settings" },
    ...(visibleSection ? [{ label: visibleSection.label }] : []),
  ]);

  const visibleTabs = TABS.filter(t => !t.adminOnly || can("manage:users"));

  return (
    <div className="app-page" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="ui-pagehead">
        <div className="ui-row" style={{alignItems:"flex-start",gap:12}}>
          {visibleSection && <button className="ui-iconbtn ui-iconbtn--bordered" aria-label="Back to tenant settings" onClick={() => navigate("/settings")}><ArrowLeft /></button>}
          <div><h1>{visibleSection?.label ?? "Tenant Settings"}</h1><p className="ui-muted">{activeTab ? DESCRIPTIONS[activeTab] : "Manage your organization, allowed upstream hosts, identity providers, secrets, and users."}</p></div>
        </div>
      </div>
      <div className="ui-page__body">{!activeTab ? <div className="ui-cardgrid app-settings-hub">{visibleTabs.map(t => <button type="button" key={t.key} className="ui-navcard" onClick={() => navigate(`/settings/${t.key}`)}><span className="ui-tile"><t.icon /></span><ArrowRight className="ui-navcard__arrow" size={16} /><span><span className="ui-navcard__title">{t.label}</span><span className="ui-navcard__desc">{DESCRIPTIONS[t.key]}</span></span></button>)}</div> :
      <div className="app-settings-detail">
        <div>
          {activeTab === "appearance" && <AppearanceTab />}
          {activeTab === "organization"       && <OrganizationTab />}
          {activeTab === "host-allowlist"     && <HostAllowlistTab />}
          {activeTab === "allowed-origins"    && <AllowedOriginsTab />}
          {activeTab === "identity-providers" && <IdentityProvidersTab />}
          {activeTab === "mail"               && <MailTab />}
          {activeTab === "secrets"            && <SecretsTab />}
          {activeTab === "ai"                 && <AiTab />}
          {activeTab === "users"              && <UsersTab />}
        </div>
      </div>}</div>
    </div>
  );
}

const PALETTES = [
  {value:"current",name:"Midnight Console",description:"The current cyan and blue palette.",colors:["#f4f6fa","#ffffff","#0a0d14","#0891b2","#0284c7"],weights:[40,25,15,10,10]},
  {value:"coastal",name:"Coastal Linen",description:"Our original blue, white and warm beige design.",colors:["#f5f2eb","#ffffff","#17324d","#245fd3","#eaf1ff"],weights:[40,25,15,10,10]},
  {value:"monochrome",name:"Graphite",description:"White, charcoal and balanced gray shades.",colors:["#fafafa","#ffffff","#171717","#404040","#737373"],weights:[40,25,15,10,10]},
  {value:"orchid",name:"Orchid",description:"Soft orchid whites with deep plum accents.",colors:["#fcf5ff","#24102b","#3c2842","#2c272e","#6f6473","#efdcf5"],weights:[60,10,10,5,5,10]},
] as const;
function AppearanceTab() {
  const { choice, setChoice, palette, setPalette } = useTheme();
  return <div className="ui-stack"><Card><SectionHead title="Color palette"/><div className="app-appearance"><p className="ui-muted">Choose a palette. Your color and display preferences are saved on this browser.</p><div className="app-palette-grid">{PALETTES.map(item=><button key={item.value} type="button" className={`app-palette-tile ${palette===item.value ? "is-selected" : ""}`} aria-pressed={palette===item.value} aria-label={`${item.name} palette`} onClick={()=>setPalette(item.value)}>
    <span className="app-palette-preview" aria-hidden="true" style={{background:item.colors[0]}}><span className="app-palette-rail" style={{background:item.colors[2]}}/><span className="app-palette-preview-body"><span className="app-palette-preview-line" style={{background:item.colors[3]}}/><span className="app-palette-preview-card" style={{background:item.value==="orchid" ? item.colors[0] : item.colors[1]}}/><span className="app-palette-preview-action" style={{background:item.value==="orchid" ? item.colors[2] : item.colors[3]}}/></span></span>
    <span className="app-palette-title"><strong>{item.name}</strong>{item.value==="current" && <span className="ui-badge">Default</span>}{palette===item.value && <span className="app-palette-check" aria-label="Selected">✓</span>}</span><span className="ui-muted app-palette-description">{item.description}</span>
  </button>)}</div></div></Card><Card><SectionHead title="Display mode"/><div className="app-appearance"><div className="app-appearance-options">{([{value:"light",label:"Light",icon:Sun},{value:"dark",label:"Dark",icon:Moon},{value:"system",label:"System",icon:Monitor}] as const).map(item=><Btn key={item.value} variant={choice===item.value ? "primary" : "secondary"} aria-pressed={choice===item.value} onClick={()=>setChoice(item.value)}><item.icon/>{item.label}</Btn>)}</div></div></Card></div>;
}
