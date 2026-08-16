import { CalendarClock, CheckCircle2, Clock3, ExternalLink, History, LoaderCircle, Pause, Play, Plus, Sparkles, StopCircle, XCircle } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type ScheduledTaskSummary } from "../lib/api";

type RunSummary = { id: string; scheduledFor: string; status: "running" | "completed" | "failed"; errorMessage: string | null; startedAt: string; finishedAt: string | null };
type RunDetail = RunSummary & { resultMarkdown: string | null; resultMetadata: Record<string, unknown> };
type Task = ScheduledTaskSummary & {
  instruction: string; source: "manual" | "conversation"; resultMetadata: Record<string, unknown>; errorMessage: string | null;
  startedAt: string | null; finishedAt: string | null; lastRunAt: string | null; pausedAt: string | null; endedAt: string | null;
  createdAt: string; updatedAt: string; resultMarkdown?: string | null; runs?: RunSummary[];
};

const statusText: Record<Task["status"], string> = { scheduled: "等待执行", running: "正在抓取", paused: "已暂停", completed: "已完成", failed: "执行失败", cancelled: "已结束" };
const runStatusText: Record<RunSummary["status"], string> = { running: "执行中", completed: "成功", failed: "失败" };
const recurrenceNames: Record<Task["recurrenceType"], string> = { once: "仅一次", daily: "每天", weekly: "每周", monthly: "每月", interval: "自定义间隔" };
const weekdayNames = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function defaultTime() { const date = new Date(Date.now() + 60 * 60 * 1000); date.setSeconds(0, 0); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function recurrenceText(task: Pick<Task, "recurrenceType" | "recurrenceConfig">) { if (task.recurrenceType === "interval") return `每隔 ${task.recurrenceConfig.intervalMinutes ?? 1} 分钟`; if (task.recurrenceType === "weekly" && task.recurrenceConfig.weekdays?.[0] !== undefined) return `每周${weekdayNames[task.recurrenceConfig.weekdays[0]]?.replace("星期", "")}`; if (task.recurrenceType === "monthly" && task.recurrenceConfig.dayOfMonth) return `每月 ${task.recurrenceConfig.dayOfMonth} 号`; return recurrenceNames[task.recurrenceType]; }
function alignedFirstRun(value: string, type: Task["recurrenceType"], weekday: number, dayOfMonth: number) {
  const candidate = new Date(value);
  if (type === "weekly") {
    candidate.setDate(candidate.getDate() + (weekday - candidate.getDay() + 7) % 7);
    if (candidate.getTime() <= Date.now() + 5_000) candidate.setDate(candidate.getDate() + 7);
  } else if (type === "monthly") {
    candidate.setDate(1);
    const applyDay = () => { const last = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate(); candidate.setDate(Math.min(dayOfMonth, last)); };
    applyDay();
    if (candidate.getTime() <= Date.now() + 5_000) { candidate.setDate(1); candidate.setMonth(candidate.getMonth() + 1); applyDay(); }
  }
  return candidate;
}
function displayTaskError(message: string) {
  if (/(BrowserType\.launch|Target page, context or browser has been closed)/i.test(message)) return "该次执行时爬虫浏览器启动失败。运行环境现已修复，请重新创建任务。";
  if (/(anti-bot protection|PerimeterX block|Cloudflare.*block|Access Denied)/i.test(message)) return "目标网站启用了反自动化保护，当前无法直接抓取。请改用网站公开的 RSS、API 或其他获授权的数据来源。";
  return message;
}

export function ScheduledTasksPanel({ initialTaskId }: { initialTaskId?: string | null }) {
  const [tasks, setTasks] = useState<Task[]>([]); const [selected, setSelected] = useState<Task | null>(null); const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [mode, setMode] = useState<"natural" | "manual">("natural"); const [natural, setNatural] = useState("");
  const [draft, setDraft] = useState({ title: "", url: "", instruction: "抓取网页并保存为 Markdown", scheduledFor: defaultTime(), recurrenceType: "once" as Task["recurrenceType"], intervalValue: 6, intervalUnit: "hours" as "minutes" | "hours" | "days", weekday: 1, dayOfMonth: 1 });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => { const result = await api<{ tasks: Task[] }>("/api/scheduled-tasks"); setTasks(result.tasks); }, []);
  const openRun = useCallback(async (taskId: string, runId: string) => { const result = await api<{ run: RunDetail }>(`/api/scheduled-tasks/${taskId}/runs/${runId}`); setSelectedRun(result.run); }, []);
  const openTask = useCallback(async (id: string) => { const result = await api<{ task: Task; runs: RunSummary[] }>(`/api/scheduled-tasks/${id}`); const task = { ...result.task, runs: result.runs }; setSelected(task); setSelectedRun(null); if (result.runs[0]) await openRun(id, result.runs[0].id); }, [openRun]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (initialTaskId) void openTask(initialTaskId); }, [initialTaskId, openTask]);
  useEffect(() => { const timer = window.setInterval(() => { if (tasks.some((task) => task.status === "scheduled" || task.status === "running")) void load(); }, 15_000); return () => window.clearInterval(timer); }, [load, tasks]);
  const active = useMemo(() => tasks.filter((task) => task.status === "scheduled" || task.status === "running" || task.status === "paused"), [tasks]);
  const history = useMemo(() => tasks.filter((task) => !["scheduled", "running", "paused"].includes(task.status)), [tasks]);

  async function createNatural(event: FormEvent) {
    event.preventDefault(); if (!natural.trim()) return; setBusy(true); setError("");
    try { const result = await api<{ task: Task }>("/api/scheduled-tasks/natural-language", { method: "POST", body: JSON.stringify({ content: natural }) }); setNatural(""); await load(); await openTask(result.task.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "任务创建失败"); } finally { setBusy(false); }
  }
  async function createManual(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const factor = draft.intervalUnit === "days" ? 1_440 : draft.intervalUnit === "hours" ? 60 : 1;
    const recurrenceConfig = draft.recurrenceType === "interval" ? { intervalMinutes: draft.intervalValue * factor } : draft.recurrenceType === "weekly" ? { weekdays: [draft.weekday] } : draft.recurrenceType === "monthly" ? { dayOfMonth: draft.dayOfMonth } : {};
    const firstRun = alignedFirstRun(draft.scheduledFor, draft.recurrenceType, draft.weekday, draft.dayOfMonth);
    try {
      const result = await api<{ task: Task }>("/api/scheduled-tasks", { method: "POST", body: JSON.stringify({ title: draft.title, url: draft.url, instruction: draft.instruction, scheduledFor: firstRun.toISOString(), recurrenceType: draft.recurrenceType, recurrenceConfig, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      setDraft({ title: "", url: "", instruction: "抓取网页并保存为 Markdown", scheduledFor: defaultTime(), recurrenceType: "once", intervalValue: 6, intervalUnit: "hours", weekday: 1, dayOfMonth: 1 }); await load(); await openTask(result.task.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "任务创建失败"); } finally { setBusy(false); }
  }
  async function taskAction(action: "pause" | "resume" | "end") { if (!selected) return; setBusy(true); setError(""); try { await api(`/api/scheduled-tasks/${selected.id}/${action}`, { method: "POST" }); await load(); await openTask(selected.id); } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); } finally { setBusy(false); } }

  const TaskRow = ({ task }: { task: Task }) => <button className="task-row" onClick={() => void openTask(task.id)}>
    <span className={`task-status-icon ${task.status}`}>{task.status === "running" ? <LoaderCircle size={16} /> : task.status === "completed" ? <CheckCircle2 size={16} /> : task.status === "failed" || task.status === "cancelled" ? <XCircle size={16} /> : task.status === "paused" ? <Pause size={16} /> : <Clock3 size={16} />}</span>
    <span><strong>{task.title}</strong><small>{formatTime(task.scheduledFor)} · {statusText[task.status]} · {recurrenceText(task)}</small><em>{task.url}</em></span>
  </button>;

  const shownResult = selectedRun?.resultMarkdown ?? (!selectedRun ? selected?.resultMarkdown : null);
  const shownError = selectedRun?.errorMessage ?? (!selectedRun ? selected?.errorMessage : null);

  return <div className="panel-page tasks-page">
    <div className="panel-header"><div><h1>定时任务</h1><p>按计划或循环抓取网页，并保留每次执行结果。</p></div></div>
    <div className="tasks-layout">
      <section className="task-create-card">
        <div className="task-mode-tabs"><button className={mode === "natural" ? "active" : ""} onClick={() => setMode("natural")}><Sparkles size={15} />一句话创建</button><button className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}><Plus size={15} />手动设置</button></div>
        {mode === "natural" ? <form onSubmit={createNatural} className="natural-task-form"><label>告诉助手什么时候、多久执行一次<textarea rows={4} value={natural} onChange={(event) => setNatural(event.target.value)} placeholder="例如：每天上午 9 点抓取 https://example.com/news，并保存正文" required /></label><p>支持仅一次、每天、每周、每月和“每隔 N 小时”。</p><button className="primary-small" disabled={busy || !natural.trim()}>{busy ? "正在理解…" : "创建任务"}</button></form>
          : <form onSubmit={createManual} className="manual-task-form"><label>任务名称<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：抓取行业资讯" required /></label><label>网页地址<input type="url" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://example.com" required /></label><label>{draft.recurrenceType === "once" ? "执行时间" : "首次执行时间与时刻"}<input type="datetime-local" value={draft.scheduledFor} onChange={(event) => setDraft({ ...draft, scheduledFor: event.target.value })} required /></label><label>重复方式<select value={draft.recurrenceType} onChange={(event) => setDraft({ ...draft, recurrenceType: event.target.value as Task["recurrenceType"] })}><option value="once">仅执行一次</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="interval">自定义间隔</option></select></label>{draft.recurrenceType === "weekly" && <label>星期<select value={draft.weekday} onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}>{weekdayNames.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>}{draft.recurrenceType === "monthly" && <label>每月日期<input type="number" min={1} max={31} value={draft.dayOfMonth} onChange={(event) => setDraft({ ...draft, dayOfMonth: Number(event.target.value) })} required /></label>}{draft.recurrenceType === "interval" && <div className="task-interval-fields"><label>间隔<input type="number" min={1} max={1000} value={draft.intervalValue} onChange={(event) => setDraft({ ...draft, intervalValue: Number(event.target.value) })} required /></label><label>单位<select value={draft.intervalUnit} onChange={(event) => setDraft({ ...draft, intervalUnit: event.target.value as typeof draft.intervalUnit })}><option value="minutes">分钟</option><option value="hours">小时</option><option value="days">天</option></select></label></div>}<label>处理要求<textarea rows={3} value={draft.instruction} onChange={(event) => setDraft({ ...draft, instruction: event.target.value })} required /></label><button className="primary-small" disabled={busy}>{busy ? "正在创建…" : "创建任务"}</button></form>}
        {error && <div className="form-error" role="alert">{error}</div>}
      </section>
      <section className="task-list-card"><h2>任务 <span>{active.length}</span></h2><div className="task-list">{active.length ? active.map((task) => <TaskRow key={task.id} task={task} />) : <div className="tasks-empty"><CalendarClock size={28} /><p>还没有运行中的任务</p></div>}</div>{history.length > 0 && <><h2 className="task-history-title">已结束</h2><div className="task-list">{history.slice(0, 20).map((task) => <TaskRow key={task.id} task={task} />)}</div></>}</section>
    </div>
    {selected && <div className="task-detail-backdrop" onClick={() => setSelected(null)}><section className="task-detail" onClick={(event) => event.stopPropagation()}><header><div><span className={`task-status-chip ${selected.status}`}>{statusText[selected.status]}</span><h2>{selected.title}</h2><p>{recurrenceText(selected)} · 下次执行 {formatTime(selected.scheduledFor)} · 已运行 {selected.runCount} 次</p></div><button className="icon-button" aria-label="关闭任务详情" onClick={() => setSelected(null)}>×</button></header><div className="task-detail-meta"><a href={selected.url} target="_blank" rel="noreferrer">打开原网页 <ExternalLink size={14} /></a><p>{selected.instruction}</p></div>
      {selected.runs && selected.runs.length > 0 && <section className="task-runs"><h3><History size={15} />执行记录</h3><div>{selected.runs.map((run) => <button key={run.id} className={selectedRun?.id === run.id ? "active" : ""} onClick={() => void openRun(selected.id, run.id)}><span className={`run-dot ${run.status}`} /> <strong>{formatTime(run.startedAt)}</strong><small>{runStatusText[run.status]}</small></button>)}</div></section>}
      {shownError && <div className="form-error">{displayTaskError(shownError)}</div>}{shownResult ? <div className="task-result markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{shownResult}</ReactMarkdown></div> : <div className="task-result-empty">{selected.status === "running" ? "正在抓取网页，请稍候…" : selected.runCount === 0 ? "任务尚未执行。" : "这次执行没有可显示的结果。"}</div>}
      {["scheduled", "running", "paused"].includes(selected.status) && <footer>{selected.status === "paused" ? <button className="secondary-button" disabled={busy} onClick={() => void taskAction("resume")}><Play size={15} />恢复</button> : selected.status === "scheduled" ? <button className="secondary-button" disabled={busy} onClick={() => void taskAction("pause")}><Pause size={15} />暂停</button> : null}<button className="secondary-button danger" disabled={busy} onClick={() => void taskAction("end")}><StopCircle size={15} />结束任务</button></footer>}
    </section></div>}
  </div>;
}
