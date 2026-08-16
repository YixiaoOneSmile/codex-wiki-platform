import { describe, expect, it } from "vitest";
import { mergeToolCallDelta } from "../src/services/responses-adapter.js";

describe("Responses adapter tool-call streaming", () => {
  it("does not duplicate the function name from the first delta", () => {
    const call = mergeToolCallDelta(undefined, { index: 0, id: "call_1", function: { name: "exec_command", arguments: "{\"cmd\":" } });
    expect(call.name).toBe("exec_command");
    expect(call.arguments).toBe("{\"cmd\":");
  });

  it("joins later name and argument fragments exactly once", () => {
    let call = mergeToolCallDelta(undefined, { index: 0, function: { name: "exec_", arguments: "{" } });
    call = mergeToolCallDelta(call, { index: 0, function: { name: "command", arguments: "}" } });
    expect(call.name).toBe("exec_command");
    expect(call.arguments).toBe("{}");
  });
});
