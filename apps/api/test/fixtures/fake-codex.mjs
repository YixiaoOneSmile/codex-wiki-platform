#!/usr/bin/env node
import process from "node:process";
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
let turnStarted = false;
let approvalHandled = false;
let unsupportedHandled = false;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function completeWhenReady() {
  if (!turnStarted || !approvalHandled || !unsupportedHandled) return;
  send({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thread-test",
      turnId: "turn-test",
      itemId: "item-test",
      delta: "测试完成",
    },
  });
  send({
    method: "turn/completed",
    params: {
      threadId: "thread-test",
      turn: { id: "turn-test", status: "completed", error: null },
    },
  });
}

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "fake-codex/0.149.0" } });
    return;
  }
  if (message.method === "thread/start") {
    send({ id: message.id, result: { thread: { id: "thread-test" } } });
    send({
      id: "approval-test",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-test",
        turnId: "turn-test",
        itemId: "command-test",
        startedAtMs: Date.now(),
        command: "echo test",
        cwd: process.cwd(),
      },
    });
    return;
  }
  if (message.method === "turn/start") {
    turnStarted = true;
    send({
      id: message.id,
      result: { turn: { id: "turn-test", status: "inProgress", error: null } },
    });
    completeWhenReady();
    return;
  }
  if (message.id === "approval-test") {
    if (message.result?.decision !== "accept") process.exit(2);
    approvalHandled = true;
    send({ id: "unsupported-test", method: "item/permissions/requestApproval", params: {} });
    completeWhenReady();
    return;
  }
  if (message.id === "unsupported-test") {
    if (message.error?.code !== -32601) process.exit(3);
    unsupportedHandled = true;
    completeWhenReady();
  }
});
