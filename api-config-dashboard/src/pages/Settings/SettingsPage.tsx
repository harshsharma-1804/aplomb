import { useState } from "react";
import { useSession } from "../../auth/SessionContext";
import { C } from "../../components";
import { OrganizationTab } from "./tabs/OrganizationTab";
import { HostAllowlistTab } from "./tabs/HostAllowlistTab";
import { IdentityProvidersTab } from "./tabs/IdentityProvidersTab";
import { SecretsTab } from "./tabs/SecretsTab";
import { UsersTab } from "./tabs/UsersTab";

const TABS = [
  { key: "organization",       label: "Organization",        icon: "🏢", adminOnly: false },
  { key: "host-allowlist",     label: "Host Allowlist",      icon: "🌐", adminOnly: true  },
  { key: "identity-providers", label: "Identity Providers",  icon: "🔑", adminOnly: true  },
  { key: "secrets",            label: "Secrets",             icon: "🔒", adminOnly: true  },
  { key: "users",              label: "Users",               icon: "👤", adminOnly: true  },
];

export function SettingsPage() {
  const { can } = useSession();
  const [activeTab, setActiveTab] = useState("organization");

  const visibleTabs = TABS.filter(t => !t.adminOnly || can("manage:users"));

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Tenant Settings</h1>
        <p style={{ margin: "2px 0 0", color: C.muted, fontSize: 13 }}>
          Manage your organization, allowed upstream hosts, identity providers, secrets, and users.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20, alignItems: "start" }}>
        {/* Left panel — tabs */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: C.radius, overflow: "hidden" }}>
          {visibleTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "11px 16px",
                background: activeTab === tab.key ? C.primary + "10" : "none",
                border: "none", borderLeft: `3px solid ${activeTab === tab.key ? C.primary : "transparent"}`,
                borderBottom: `1px solid ${C.border}`,
                cursor: "pointer", textAlign: "left",
                color: activeTab === tab.key ? C.primary : C.text,
                fontWeight: activeTab === tab.key ? 600 : 400,
                fontSize: 13,
              }}
            >
              <span style={{ fontSize: 16 }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Right panel — content */}
        <div>
          {activeTab === "organization"       && <OrganizationTab />}
          {activeTab === "host-allowlist"     && <HostAllowlistTab />}
          {activeTab === "identity-providers" && <IdentityProvidersTab />}
          {activeTab === "secrets"            && <SecretsTab />}
          {activeTab === "users"              && <UsersTab />}
        </div>
      </div>
    </div>
  );
}
