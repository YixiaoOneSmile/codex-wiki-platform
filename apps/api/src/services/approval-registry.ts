import { randomUUID } from "node:crypto";

type Decision = "accept" | "decline";
type PendingApproval = { runId: string; resolve: (decision: Decision) => void; timer: NodeJS.Timeout };
const pending = new Map<string, PendingApproval>();

export function waitForApproval(runId: string, timeoutMs = 5 * 60 * 1000) {
  const approvalId = randomUUID();
  let resolvePromise!: (decision: Decision) => void;
  const promise = new Promise<Decision>((resolve) => { resolvePromise = resolve; });
  const timer = setTimeout(() => { pending.delete(approvalId); resolvePromise("decline"); }, timeoutMs);
  timer.unref();
  pending.set(approvalId, { runId, resolve: resolvePromise, timer });
  return { approvalId, promise };
}

export function resolveApproval(runId: string, approvalId: string, decision: Decision): boolean {
  const item = pending.get(approvalId);
  if (!item || item.runId !== runId) return false;
  clearTimeout(item.timer); pending.delete(approvalId); item.resolve(decision); return true;
}
