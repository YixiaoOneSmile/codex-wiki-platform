import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "./lib/api";
import { ChatPage } from "./pages/ChatPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { LoginPage } from "./pages/LoginPage";

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { try { setMe(await api<Me>("/api/me")); } catch { setMe(null); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <div className="page-loading">正在加载…</div>;
  if (!me) return <LoginPage onSuccess={() => void load()} />;
  const logout = async () => {
    try { await api("/api/auth/logout", { method: "POST" }); }
    finally { setMe(null); }
  };
  if (me.user.mustChangePassword) return <ChangePasswordPage onSuccess={load} onLogout={logout} />;
  return <ChatPage me={me} onMeChanged={async () => { await load(); }} onLogout={logout} />;
}
