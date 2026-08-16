CREATE UNIQUE INDEX "agent_runs_one_active_conversation" ON "agent_runs" ("conversation_id") WHERE "status" in ('queued', 'running', 'awaiting_approval');
