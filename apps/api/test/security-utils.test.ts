import { describe, expect, it } from "vitest";
import { safeLogValue } from "../src/lib/redact.js";
import { canCreatePersonalWiki, canEditTeamWiki, canManageOrganization, type TenantContext } from "@cwp/shared";

const member: TenantContext = { userId: "u", orgId: "o", orgRole: "member", teamWikiRole: "user", personalWikiEnabled: false, mustChangePassword: false };
describe("security helpers", () => {
  it("redacts secrets recursively", () => {
    expect(safeLogValue({ authorization: "Bearer secret-token-value", nested: { apiKey: "test-api-key-placeholder", note: "safe" } })).toEqual({ authorization: "[REDACTED]", nested: { apiKey: "[REDACTED]", note: "safe" } });
  });
  it("keeps policy decisions explicit", () => {
    expect(canManageOrganization(member)).toBe(false);
    expect(canEditTeamWiki(member)).toBe(false);
    expect(canCreatePersonalWiki(member)).toBe(false);
    expect(canEditTeamWiki({ ...member, teamWikiRole: "editor" })).toBe(true);
    expect(canManageOrganization({ ...member, orgRole: "admin" })).toBe(true);
  });
});
