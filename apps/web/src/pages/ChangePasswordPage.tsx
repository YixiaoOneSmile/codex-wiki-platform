import { FormEvent, useState } from "react";
import { api } from "../lib/api";

export function ChangePasswordPage({ onSuccess, onLogout }: { onSuccess: () => Promise<void>; onLogout: () => Promise<void> | void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmation) return setError("两次输入的新密码不一致");
    setSaving(true); setError("");
    try {
      await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      await onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "密码修改失败");
    } finally { setSaving(false); }
  }

  return <main className="login-shell"><form className="login-card" onSubmit={submit}>
    <div className="brand-mark">AI</div><h1>设置你的新密码</h1><p>这是首次登录。修改临时密码后才能使用平台。</p>
    {error && <div className="form-error">{error}</div>}
    <label>临时密码<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
    <label>新密码<input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><small>至少 12 位，且不能与临时密码相同</small></label>
    <label>确认新密码<input type="password" autoComplete="new-password" minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>
    <button className="primary-button" disabled={saving}>{saving ? "正在保存…" : "保存并进入平台"}</button>
    <button type="button" className="link-button" onClick={() => void onLogout()}>退出登录</button>
  </form></main>;
}
