import { BookOpen, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, FileText, LoaderCircle, LogOut, Menu, MessageSquarePlus, PanelLeftClose, Search, Send, Settings, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { KnowledgePanel } from "../components/KnowledgePanel";
import { SettingsPanel } from "../components/SettingsPanel";
import { ScheduledTasksPanel } from "../components/ScheduledTasksPanel";
import { api, type Conversation, type Me, type Message, type WikiSearchTrace, type WikiSource, streamMessage } from "../lib/api";

type View = "chat" | "knowledge" | "tasks" | "settings";

function WikiActivity({ trace, answered, onOpen }: { trace: WikiSearchTrace; answered: boolean; onOpen: (source: WikiSource) => void }) {
  const [expanded, setExpanded] = useState(!answered);
  useEffect(() => { if (answered) setExpanded(false); }, [answered]);
  const resultText = trace.sources.length ? `找到 ${trace.sources.length} 个相关页面` : "没有找到相关页面";
  return <div className="wiki-activity">
      <button className="wiki-activity-summary" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><span className="wiki-activity-icon">{answered ? <CheckCircle2 size={16} /> : <Search size={16} />}</span><span><strong>搜索知识库</strong><small>已检查 {trace.searchedPageCount} 个可访问页面，{resultText}</small></span><ChevronRight className={expanded ? "open" : ""} size={16} /></button>
      {expanded && <div className="wiki-activity-results">{trace.sources.length ? trace.sources.map((source) => <button key={`${source.scope}:${source.id}`} type="button" onClick={() => onOpen(source)}><FileText size={15} /><span><strong>{source.title}</strong><small>{source.excerpt || source.path}</small></span></button>) : <p>本轮没有向回答提供 Wiki 页面。</p>}</div>}
    </div>;
}

function WikiReferences({ sources, onOpen }: { sources: WikiSource[]; onOpen: (source: WikiSource) => void }) {
  if (!sources.length) return null;
  return <div className="wiki-sources"><span>参考资料</span><div>{sources.map((source) => <button key={`${source.scope}:${source.id}`} type="button" onClick={() => onOpen(source)}><FileText size={14} /><span>{source.title}</span><small>{source.scope === "team" ? "团队" : "个人"}</small></button>)}</div></div>;
}

function ScheduledTaskCard({ task, onOpen }: { task: NonNullable<Message["metadata"]>["scheduledTask"]; onOpen: (id: string) => void }) {
  if (!task) return null;
  return <button className="message-task-card" type="button" onClick={() => onOpen(task.id)}><span><CalendarClock size={17} /></span><span><strong>定时任务已创建</strong><small>{task.title} · {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(task.scheduledFor))}</small></span><ChevronRight size={16} /></button>;
}

export function ChatPage({ me, onLogout, onMeChanged }: { me: Me; onLogout: () => Promise<void>; onMeChanged: () => Promise<void> }) {
  const [sidebar, setSidebar] = useState(() => !window.matchMedia("(max-width: 760px)").matches); const [view, setView] = useState<View>("chat");
  const [accountMenu, setAccountMenu] = useState(false);
  const [knowledgeTarget, setKnowledgeTarget] = useState<{ scope: "team" | "personal"; pageId: string } | null>(null);
  const [taskTarget, setTaskTarget] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(""); const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null); const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false); const [activity, setActivity] = useState(""); const [error, setError] = useState("");
  const [runId, setRunId] = useState<string | null>(null); const [approval, setApproval] = useState<{ approvalId: string; type: string; command?: string; reason: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null); const activeOrg = me.organizations.find((org) => org.id === me.activeOrgId)!;
  function closeSidebarOnNarrow() { if (window.matchMedia("(max-width: 760px)").matches) setSidebar(false); }
  async function loadConversations() { const result = await api<{ conversations: Conversation[] }>("/api/conversations"); setConversations(result.conversations); }
  useEffect(() => { void loadConversations(); }, []);
  useEffect(() => { const media = window.matchMedia("(max-width: 760px)"); const collapse = (event: MediaQueryListEvent) => { if (event.matches) setSidebar(false); }; media.addEventListener("change", collapse); return () => media.removeEventListener("change", collapse); }, []);
  useEffect(() => { void api("/api/events", { method: "POST", body: JSON.stringify({ name: "page.view", route: view }) }).catch(() => undefined); }, [view]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, activity]);
  async function openConversation(id: string) { const result = await api<{ messages: Message[] }>(`/api/conversations/${id}`); setActiveId(id); setMessages(result.messages); setView("chat"); closeSidebarOnNarrow(); }
  async function newConversation() { const result = await api<{ conversation: Conversation }>("/api/conversations", { method: "POST", body: JSON.stringify({ title: "新对话" }) }); setConversations((items) => [result.conversation, ...items]); setActiveId(result.conversation.id); setMessages([]); setView("chat"); closeSidebarOnNarrow(); }
  function openWikiSource(source: WikiSource) { setKnowledgeTarget({ scope: source.scope, pageId: source.id }); setView("knowledge"); }
  async function submit(event: FormEvent) {
    event.preventDefault(); const content = prompt.trim(); if (!content || streaming) return; setError(""); setPrompt("");
    let conversationId = activeId;
    if (!conversationId) { const created = await api<{ conversation: Conversation }>("/api/conversations", { method: "POST", body: JSON.stringify({ title: "新对话" }) }); conversationId = created.conversation.id; setActiveId(conversationId); setConversations((items) => [created.conversation, ...items]); }
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content, metadata: {}, createdAt: new Date().toISOString() };
    const assistantId = crypto.randomUUID(); setMessages((items) => [...items, userMessage, { id: assistantId, role: "assistant", content: "", metadata: {}, createdAt: new Date().toISOString() }]); setStreaming(true); setActivity("正在思考");
    void api("/api/events", { method: "POST", body: JSON.stringify({ name: "chat.send", route: "chat" }) }).catch(() => undefined);
    try {
      await streamMessage({ conversationId, content, onEvent: (name, data) => {
        if (name === "delta") setMessages((items) => items.map((message) => message.id === assistantId ? { ...message, content: message.content + data.delta } : message));
        if (name === "wiki_search") setMessages((items) => items.map((message) => message.id === assistantId ? { ...message, metadata: { ...message.metadata, wikiSearch: data } } : message));
        if (name === "scheduled_task") setMessages((items) => items.map((message) => message.id === assistantId ? { ...message, metadata: { ...message.metadata, scheduledTask: data } } : message));
        if (name === "run") setRunId(data.runId);
        if (name === "activity") setActivity(data.item?.type === "commandExecution" ? "正在处理文件" : data.item?.type === "reasoning" ? "正在分析" : "正在整理回答");
        if (name === "approval") setApproval(data);
        if (name === "approval_resolved") setApproval(null);
        if (name === "error") setError(data.message);
      } });
      await loadConversations();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "发送失败"); }
    finally { setStreaming(false); setActivity(""); }
  }
  const hasMessages = messages.length > 0;
  return <div className={`app-shell ${sidebar ? "" : "sidebar-hidden"}`} style={{ "--accent": activeOrg.accentColor } as React.CSSProperties}>
    <aside className="sidebar"><div className="sidebar-top"><div className="workspace-button"><span className="workspace-avatar">{activeOrg.displayName.slice(0, 1)}</span><select className="workspace-select" value={me.activeOrgId} onChange={async (e) => { await api("/api/auth/switch-organization", { method: "POST", body: JSON.stringify({ orgId: e.target.value }) }); await onMeChanged(); setActiveId(null); setMessages([]); }} aria-label="切换组织">{me.organizations.map((org) => <option key={org.id} value={org.id}>{org.displayName}</option>)}</select><ChevronDown size={15} /></div><button className="icon-button" aria-label="收起侧边栏" onClick={() => setSidebar(false)}><PanelLeftClose size={19} /></button></div>
      <button className="new-chat" onClick={() => void newConversation()}><MessageSquarePlus size={18} />新对话</button><nav><div className="nav-label">最近</div>{conversations.map((item) => <button key={item.id} className={`conversation ${view === "chat" && activeId === item.id ? "active" : ""}`} onClick={() => void openConversation(item.id)}>{item.title}</button>)}</nav>
      <div className="sidebar-bottom"><div className="account-menu">{accountMenu && <div className="account-menu-popover"><button className={view === "knowledge" ? "selected" : ""} onClick={() => { setView("knowledge"); setAccountMenu(false); closeSidebarOnNarrow(); }}><BookOpen size={18} />知识库</button><button className={view === "tasks" ? "selected" : ""} onClick={() => { setTaskTarget(null); setView("tasks"); setAccountMenu(false); closeSidebarOnNarrow(); }}><CalendarClock size={18} />定时任务</button>{(activeOrg.role === "owner" || activeOrg.role === "admin") && <button className={view === "settings" ? "selected" : ""} onClick={() => { setView("settings"); setAccountMenu(false); closeSidebarOnNarrow(); }}><Settings size={18} />组织设置</button>}<button onClick={() => { setAccountMenu(false); void onLogout(); }}><LogOut size={18} />退出登录</button></div>}<button className="user-row account-trigger" aria-label="打开用户菜单" aria-expanded={accountMenu} onClick={() => setAccountMenu((open) => !open)}><span className="user-avatar">{me.user.displayName.slice(0, 1)}</span><span className="user-details"><strong>{me.user.displayName}</strong><span>{me.user.email}</span></span><ChevronUp className={`account-chevron ${accountMenu ? "open" : ""}`} size={16} /></button></div></div>
    </aside>
    <main className="chat-main">{!sidebar && <button className="floating-menu icon-button" aria-label="展开侧边栏" onClick={() => setSidebar(true)}><Menu size={20} /></button>}
      {view === "knowledge" ? <KnowledgePanel me={me} target={knowledgeTarget} /> : view === "tasks" ? <ScheduledTasksPanel initialTaskId={taskTarget} /> : view === "settings" ? <SettingsPanel me={me} onChanged={onMeChanged} /> : <><header className="chat-header"><span>{activeOrg.displayName}</span></header><div className={`message-scroll ${hasMessages ? "has-messages" : ""}`} ref={scrollRef}>{!hasMessages ? <section className="welcome"><div className="sparkle"><Sparkles size={26} /></div><h1>有什么可以帮你？</h1><p>我可以结合团队知识，帮你查找信息、整理内容和完成工作。</p></section> : <div className="message-list">{messages.map((message) => <div className={`message ${message.role}`} key={message.id}>{message.role === "assistant" && <div className="assistant-avatar"><Sparkles size={15} /></div>}<div className="message-body">{message.role === "assistant" && message.metadata?.wikiSearch && <WikiActivity trace={message.metadata.wikiSearch} answered={Boolean(message.content)} onOpen={openWikiSource} />}{message.role === "assistant" && !message.content && streaming ? <span className="thinking"><LoaderCircle size={16} />{activity}</span> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>}{message.role === "assistant" && message.metadata?.scheduledTask && <ScheduledTaskCard task={message.metadata.scheduledTask} onOpen={(id) => { setTaskTarget(id); setView("tasks"); }} />}{message.role === "assistant" && message.content && message.metadata?.wikiSearch && <WikiReferences sources={message.metadata.wikiSearch.sources} onOpen={openWikiSource} />}</div></div>)}</div>}</div>{approval && runId && <div className="approval-card"><div><strong>{approval.type === "command" ? "允许执行这个操作吗？" : "允许修改文件吗？"}</strong><p>{approval.reason}</p>{approval.command && <code>{approval.command}</code>}</div><div><button className="secondary-button" onClick={async () => { await api(`/api/conversations/runs/${runId}/approvals/${approval.approvalId}`, { method: "POST", body: JSON.stringify({ decision: "decline" }) }); setApproval(null); }}>拒绝</button><button className="primary-small" onClick={async () => { await api(`/api/conversations/runs/${runId}/approvals/${approval.approvalId}`, { method: "POST", body: JSON.stringify({ decision: "accept" }) }); setApproval(null); }}>允许</button></div></div>}{error && <div className="chat-error">{error}</div>}<form className="composer" onSubmit={submit}><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="给智能助手发消息" rows={1} /><div className="composer-footer"><span>会参考你有权访问的知识</span><button aria-label="发送" disabled={!prompt.trim() || streaming}><Send size={17} /></button></div></form><p className="disclaimer">智能助手可能会犯错，请核对重要信息。</p></>}
    </main></div>;
}
