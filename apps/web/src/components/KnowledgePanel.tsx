import { BookOpen, FilePlus2, Search, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type Me, uploadWikiFile } from "../lib/api";

type WikiPage = { id: string; path: string; title: string; markdown: string; version: number; updatedAt: string };

export function KnowledgePanel({ me, target }: { me: Me; target?: { scope: "team" | "personal"; pageId: string } | null }) {
  const activeOrg = me.organizations.find((org) => org.id === me.activeOrgId)!;
  const [scope, setScope] = useState<"team" | "personal">(target?.scope ?? "team");
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [selected, setSelected] = useState<WikiPage | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", path: "", markdown: "" });
  const [error, setError] = useState("");
  const canEdit = scope === "personal" ? activeOrg.personalWikiEnabled : activeOrg.role !== "member" || activeOrg.teamWikiRole === "editor";
  const load = useCallback(async (q = "") => {
    const result = await api<{ pages: WikiPage[] }>(`/api/wiki/${scope}/pages${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    setPages(result.pages);
    setSelected((current) => result.pages.find((page) => page.id === target?.pageId) ?? result.pages.find((page) => page.id === current?.id) ?? result.pages[0] ?? null);
  }, [scope, target?.pageId]);
  useEffect(() => { if (target?.scope && target.scope !== scope) setScope(target.scope); }, [scope, target?.scope]);
  useEffect(() => { void load().catch((cause) => setError(cause.message)); }, [load]);

  async function save() {
    setError("");
    try {
      if (selected) await api(`/api/wiki/${scope}/pages/${selected.id}`, { method: "PATCH", body: JSON.stringify({ title: draft.title, markdown: draft.markdown, changeSummary: "在知识库界面更新" }) });
      else await api(`/api/wiki/${scope}/pages`, { method: "POST", body: JSON.stringify(draft) });
      setEditing(false); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
  }
  function beginEdit(page: WikiPage | null) {
    setSelected(page); setDraft(page ? { title: page.title, path: page.path, markdown: page.markdown } : { title: "", path: "新页面.md", markdown: "" }); setEditing(true);
  }

  return <section className="panel-page">
    <header className="panel-header"><div><h1>知识库</h1><p>智能助手会直接搜索并阅读这些 Markdown 页面</p></div>{canEdit && <div className="header-actions"><label className="secondary-button file-button"><Upload size={17} />导入文档<input type="file" accept=".md,.txt,.pdf,.docx" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { await uploadWikiFile(scope, file); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败"); } finally { event.target.value = ""; } }} /></label><button className="secondary-button" onClick={() => beginEdit(null)}><FilePlus2 size={17} />新建页面</button></div>}</header>
    <div className="wiki-layout">
      <aside className="wiki-list">
        <div className="scope-tabs"><button className={scope === "team" ? "active" : ""} onClick={() => setScope("team")}>团队知识</button>{activeOrg.personalWikiEnabled && <button className={scope === "personal" ? "active" : ""} onClick={() => setScope("personal")}>个人知识</button>}</div>
        <form className="wiki-search" onSubmit={(e) => { e.preventDefault(); void load(query); }}><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题和正文" /></form>
        <div className="wiki-pages">{pages.map((page) => <button key={page.id} className={selected?.id === page.id ? "active" : ""} onClick={() => { setSelected(page); setEditing(false); }}><BookOpen size={15} /><span><strong>{page.title}</strong><small>{page.path}</small></span></button>)}{!pages.length && <div className="empty-small">还没有页面</div>}</div>
      </aside>
      <article className="wiki-document">
        {error && <div className="form-error">{error}</div>}
        {editing ? <div className="wiki-editor"><label>标题<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>{!selected && <label>路径<input value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value })} /></label>}<label>Markdown<textarea rows={18} value={draft.markdown} onChange={(e) => setDraft({ ...draft, markdown: e.target.value })} /></label><div><button className="secondary-button" onClick={() => setEditing(false)}>取消</button><button className="primary-small" onClick={() => void save()}>保存</button></div></div>
        : selected ? <><div className="document-title"><div><h2>{selected.title}</h2><span>{selected.path} · 第 {selected.version} 版</span></div>{canEdit && <button className="secondary-button" onClick={() => beginEdit(selected)}>编辑</button>}</div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.markdown}</ReactMarkdown></div></>
        : <div className="empty-document"><BookOpen size={28} /><h2>选择一个知识页面</h2><p>你也可以创建第一个 Markdown 页面。</p></div>}
      </article>
    </div>
  </section>;
}
