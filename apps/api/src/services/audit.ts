import { auditLogs, type Database } from "@cwp/database";

type AuditInput = {
  orgId?: string | null;
  actorUserId?: string | null;
  correlationId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  outcome: "success" | "denied" | "failure";
  details?: Record<string, unknown>;
};

export async function writeAudit(db: Database, input: AuditInput): Promise<void> {
  await db.insert(auditLogs).values({
    orgId: input.orgId ?? null,
    actorUserId: input.actorUserId ?? null,
    correlationId: input.correlationId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    outcome: input.outcome,
    details: input.details ?? {},
  });
}
