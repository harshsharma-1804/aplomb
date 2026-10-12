import { useState } from "react";
import { Zap, Sun, Moon } from "lucide-react";
import { useSession } from "../../auth/SessionContext";
import { Btn, ErrorBanner, Field } from "../../components";
import { useTheme } from "../../theme/ThemeContext";
export function LoginPage() {
  const {theme,setChoice}=useTheme();
  const { login }=useSession();
  const [username,setUsername]=useState(""),[password,setPassword]=useState(""),[loading,setLoading]=useState(false),[error,setError]=useState("");
  async function submit(e:React.FormEvent){e.preventDefault();setLoading(true);setError("");try{await login(username,password);}catch(e){setError(String(e).replace(/^Error: /,""));}finally{setLoading(false);}}
  return <main className="app-login">
    <section className="app-login-intro" aria-label="About Aplomb">
      <div className="ui-row app-login-brand"><span className="ui-brand__mark"><Zap /></span><div><strong>Aplomb</strong><p>API control plane</p></div></div>
      <div className="app-login-message"><h2>Every API journey, composed with confidence.</h2><p>Configure upstream services, schemas, mappings, and runtime logic in one secure workspace.</p></div>
      <p className="app-login-caption">Secure · Observable · Versioned</p>
      <div className="app-login-orb" aria-hidden="true" />
    </section>
    <section className="app-login-form" aria-label="Sign in">
      <button className="ui-iconbtn ui-iconbtn--bordered app-login-theme" aria-label="Switch theme" onClick={()=>setChoice(theme==="dark" ? "light" : "dark")}>{theme==="dark" ? <Moon/> : <Sun/>}</button>
      <form className="app-login-box" onSubmit={submit}>
        <div className="app-login-mobile-brand ui-row"><span className="ui-brand__mark"><Zap /></span><strong>Aplomb</strong></div>
        <p className="app-login-eyebrow">Welcome back</p><h1>Sign in to your workspace</h1><p className="ui-muted app-login-description">Use your organization credentials to continue.</p>
        {error && <ErrorBanner message={error} />}
        <Field label="Username"><input className="ui-input" value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" autoFocus required disabled={loading} /></Field>
        <Field label="Password"><input className="ui-input" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required disabled={loading} /></Field>
        <Btn type="submit" className="ui-btn--block" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</Btn>
        <p className="ui-hint app-login-footer">Aplomb · Config Dashboard</p>
      </form>
    </section>
  </main>;
}
