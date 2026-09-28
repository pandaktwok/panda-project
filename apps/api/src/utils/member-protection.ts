// Panda Project (Fase 7A): regras da área "Usuários", aplicadas na API e não só
// na tela. O dono (papel "owner") é fixo: não pode ser rebaixado, removido nem
// trocado, e só existem dois papéis atribuíveis: Administrador e Usuário.

import { APIError } from "better-auth/api";
import { and, eq, or } from "drizzle-orm";
import db, { schema } from "../database";

export const ASSIGNABLE_MEMBER_ROLES = ["admin", "member"] as const;

const OWNER_LOCKED_MESSAGE =
  "O administrador principal não pode ser alterado nem removido.";

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function rolesOf(value: unknown): string[] {
  if (typeof value === "string") return value.split(",").map((r) => r.trim());
  if (Array.isArray(value)) {
    return value.filter((r): r is string => typeof r === "string");
  }
  return [];
}

export function assertAssignableRole(value: unknown) {
  const roles = rolesOf(value);
  if (
    roles.length === 0 ||
    roles.some(
      (role) => !(ASSIGNABLE_MEMBER_ROLES as readonly string[]).includes(role),
    )
  ) {
    throw new APIError("BAD_REQUEST", {
      message: "Escolha o papel Administrador ou Usuário.",
    });
  }
}

async function findMember(memberIdOrEmail: string, organizationId?: string) {
  const [row] = await db
    .select({
      id: schema.workspaceUserTable.id,
      role: schema.workspaceUserTable.role,
    })
    .from(schema.workspaceUserTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.workspaceUserTable.userId),
    )
    .where(
      and(
        or(
          eq(schema.workspaceUserTable.id, memberIdOrEmail),
          eq(schema.userTable.email, memberIdOrEmail),
        ),
        organizationId
          ? eq(schema.workspaceUserTable.workspaceId, organizationId)
          : undefined,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Roda antes das rotas de organização do Better Auth. */
export async function enforceMemberRules(
  path: string,
  body: Record<string, unknown> | undefined,
) {
  if (path === "/organization/invite-member") {
    assertAssignableRole(body?.role);
    return;
  }

  if (path === "/organization/update-member-role") {
    const memberId = firstString(body?.memberId);
    if (memberId) {
      const member = await findMember(
        memberId,
        firstString(body?.organizationId) ?? undefined,
      );
      if (member && rolesOf(member.role).includes("owner")) {
        throw new APIError("FORBIDDEN", { message: OWNER_LOCKED_MESSAGE });
      }
    }
    assertAssignableRole(body?.role);
    return;
  }

  if (path === "/organization/remove-member") {
    const target = firstString(body?.memberIdOrEmail);
    if (target) {
      const member = await findMember(
        target,
        firstString(body?.organizationId) ?? undefined,
      );
      if (member && rolesOf(member.role).includes("owner")) {
        throw new APIError("FORBIDDEN", { message: OWNER_LOCKED_MESSAGE });
      }
    }
  }
}
