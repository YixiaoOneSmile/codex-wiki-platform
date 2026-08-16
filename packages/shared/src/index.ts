export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const TEAM_WIKI_ROLES = ["editor", "user"] as const;
export type TeamWikiRole = (typeof TEAM_WIKI_ROLES)[number];

export type TenantContext = {
  userId: string;
  isSuperAdmin: boolean;
  orgId: string;
  orgRole: OrgRole;
  teamWikiRole: TeamWikiRole;
  personalWikiEnabled: boolean;
  mustChangePassword: boolean;
};

export type ApiError = {
  error: { code: string; message: string; correlationId: string };
};

export type WikiScope = "team" | "personal";

export function canManageOrganization(ctx: TenantContext): boolean {
  return ctx.orgRole === "owner" || ctx.orgRole === "admin";
}

export function canEditTeamWiki(ctx: TenantContext): boolean {
  return canManageOrganization(ctx) || ctx.teamWikiRole === "editor";
}

export function canCreatePersonalWiki(ctx: TenantContext): boolean {
  return ctx.personalWikiEnabled;
}
