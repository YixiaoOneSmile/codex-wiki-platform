import { FormEvent, useState } from "react";
import { ArrowRight, BookOpen, ShieldCheck, Sparkles } from "lucide-react";
import { api, ApiClientError } from "../lib/api";

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); onSuccess(); }
    catch (cause) { setError(cause instanceof ApiClientError ? cause.message : "登录失败"); }
    finally { setBusy(false); }
  }

  return <main className="login-shell login-page">
    <div className="login-frame">
      <section className="login-intro" aria-label="平台介绍">
        <div className="login-brand"><span className="login-logo"><Sparkles size={21} strokeWidth={1.8} /></span><strong>智能知识工作台</strong></div>
        <div className="login-intro-copy">
          <span className="login-eyebrow">ORGANIZATION AI WORKSPACE</span>
          <h2>让团队知识，真正<br />参与每一次工作</h2>
          <p>在一个安全、清晰的空间里，与智能助手对话、调用团队知识并持续沉淀经验。</p>
          <div className="login-capabilities"><span><BookOpen size={17} />Wiki 知识协作</span><span><ShieldCheck size={17} />组织级权限隔离</span></div>
        </div>
        <p className="login-intro-footer"><span />为团队打造的智能工作入口</p>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-heading"><span>登录工作区</span><h1>欢迎回来</h1><p>使用你的工作邮箱继续</p></div>
          <div className="login-fields">
            <label>邮箱地址<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="name@company.com" required /></label>
            <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="输入你的密码" required /></label>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="primary-button login-submit" disabled={busy}><span>{busy ? "正在登录…" : "继续"}</span>{!busy && <ArrowRight size={17} />}</button>
          <p className="login-security"><ShieldCheck size={14} />你的会话和组织数据将受到安全保护</p>
        </form>
      </section>
    </div>
  </main>;
}
