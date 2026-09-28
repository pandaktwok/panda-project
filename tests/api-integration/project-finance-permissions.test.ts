import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { backfillFinancePermission } from "../../apps/api/src/utils/seed-default-workspace-roles";
import { defaultRolePayloads } from "../../packages/permissions/src";
import { resetTestDatabase } from "./helpers/database";

const origin = "http://localhost:5173";
const { app } = createApp();

async function post(path: string, body: unknown, cookie = "") {
  return app.request(`/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: origin,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
}

async function signup(email: string) {
  const result = await post("/sign-up/email", {
    name: "Finance test",
    email,
    password: "long-password-for-tests",
  });
  expect(result.status).toBe(200);
  const body = await result.json();
  const cookie = result.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  return { id: body.user.id as string, cookie };
}

type Actor = { id: string; cookie: string };

async function setupWorkspace(options?: { legacyRoleRows?: boolean }) {
  const owner = await signup("owner@example.com");
  const admin = await signup("admin@example.com");
  const member = await signup("member@example.com");
  const viewer = await signup("viewer@example.com");

  const [workspace] = await db
    .insert(schema.workspaceTable)
    .values({
      id: "finance-workspace",
      name: "Workspace",
      slug: "finance",
      createdAt: new Date(),
    })
    .returning();

  const roles: Array<[Actor, string]> = [
    [owner, "owner"],
    [admin, "admin"],
    [member, "member"],
    [viewer, "viewer"],
  ];
  const memberIds: Record<string, string> = {};
  for (const [actor, role] of roles) {
    const [row] = await db
      .insert(schema.workspaceUserTable)
      .values({
        workspaceId: workspace.id,
        userId: actor.id,
        role,
        joinedAt: new Date(),
      })
      .returning();
    memberIds[role] = row.id;
  }

  for (const name of ["viewer", "member", "admin"] as const) {
    const payload: Record<string, string[]> = { ...defaultRolePayloads[name] };
    // Simula workspaces criados antes do módulo Financeiro: sem a chave finance.
    if (options?.legacyRoleRows) delete payload.finance;
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: workspace.id,
      role: name,
      permission: JSON.stringify(payload),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return { workspace, owner, admin, member, viewer, memberIds };
}

async function can(
  actor: Actor,
  workspaceId: string,
  action: "read" | "manage" | "pay" | "attach" | "undo",
) {
  const response = await post(
    "/organization/has-permission",
    { organizationId: workspaceId, permissions: { finance: [action] } },
    actor.cookie,
  );
  if (response.status !== 200) return false;
  return (await response.json()).success === true;
}

beforeEach(() => resetTestDatabase());

describe("permissões do financeiro por papel", () => {
  it("owner e admin fazem tudo; member lê, paga e anexa; viewer só lê", async () => {
    const ctx = await setupWorkspace();
    const actions = ["read", "manage", "pay", "attach", "undo"] as const;

    const expected = {
      owner: { read: true, manage: true, pay: true, attach: true, undo: true },
      admin: { read: true, manage: true, pay: true, attach: true, undo: true },
      member: {
        read: true,
        manage: false,
        pay: true,
        attach: true,
        undo: false,
      },
      viewer: {
        read: true,
        manage: false,
        pay: false,
        attach: false,
        undo: false,
      },
    } as const;

    for (const role of ["owner", "admin", "member", "viewer"] as const) {
      for (const action of actions) {
        expect(
          await can(ctx[role], ctx.workspace.id, action),
          `${role}:${action}`,
        ).toBe(expected[role][action]);
      }
    }
  });

  it("um usuário de fora do workspace não tem nenhuma permissão financeira", async () => {
    const ctx = await setupWorkspace();
    const outsider = await signup("outsider@example.com");
    expect(await can(outsider, ctx.workspace.id, "read")).toBe(false);
  });
});

describe("preenchimento do recurso finance em workspaces existentes", () => {
  async function financeOf(workspaceId: string, role: string) {
    const [row] = await db
      .select({ permission: schema.workspaceRoleTable.permission })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspaceId),
          eq(schema.workspaceRoleTable.role, role),
        ),
      );
    return JSON.parse(row.permission).finance as string[] | undefined;
  }

  it("dá finance às linhas padrão antigas, e uma segunda execução não muda nada", async () => {
    const ctx = await setupWorkspace({ legacyRoleRows: true });
    expect(await financeOf(ctx.workspace.id, "member")).toBeUndefined();
    expect(await can(ctx.member, ctx.workspace.id, "pay")).toBe(false);

    await backfillFinancePermission();
    expect(await financeOf(ctx.workspace.id, "viewer")).toEqual(["read"]);
    expect(await financeOf(ctx.workspace.id, "member")).toEqual([
      "read",
      "pay",
      "attach",
    ]);
    expect(await financeOf(ctx.workspace.id, "admin")).toEqual([
      "read",
      "manage",
      "pay",
      "attach",
      "undo",
    ]);
    expect(await can(ctx.member, ctx.workspace.id, "pay")).toBe(true);

    const before = await db.select().from(schema.workspaceRoleTable);
    await backfillFinancePermission();
    const after = await db.select().from(schema.workspaceRoleTable);
    expect(after).toEqual(before);
    expect(after).toHaveLength(3);
  });

  it("não sobrescreve o que o administrador personalizou nem outros recursos", async () => {
    const ctx = await setupWorkspace({ legacyRoleRows: true });
    // member personalizado: tirou "task:create" e já tinha um finance próprio.
    await db
      .update(schema.workspaceRoleTable)
      .set({
        permission: JSON.stringify({
          ...defaultRolePayloads.member,
          task: ["read"],
          finance: ["read"],
        }),
      })
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, ctx.workspace.id),
          eq(schema.workspaceRoleTable.role, "member"),
        ),
      );
    // viewer personalizado sem finance: continua sem task:create depois do passo.
    await db
      .update(schema.workspaceRoleTable)
      .set({
        permission: JSON.stringify({ project: ["read"], task: ["read"] }),
      })
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, ctx.workspace.id),
          eq(schema.workspaceRoleTable.role, "viewer"),
        ),
      );

    await backfillFinancePermission();

    expect(await financeOf(ctx.workspace.id, "member")).toEqual(["read"]);
    const [memberRow] = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, ctx.workspace.id),
          eq(schema.workspaceRoleTable.role, "member"),
        ),
      );
    expect(JSON.parse(memberRow.permission).task).toEqual(["read"]);

    const [viewerRow] = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, ctx.workspace.id),
          eq(schema.workspaceRoleTable.role, "viewer"),
        ),
      );
    const viewerPayload = JSON.parse(viewerRow.permission);
    expect(viewerPayload.task).toEqual(["read"]);
    expect(viewerPayload.project).toEqual(["read"]);
    expect(viewerPayload.finance).toEqual(["read"]);
  });

  it("papel personalizado criado por alguém não ganha finance automaticamente", async () => {
    const ctx = await setupWorkspace({ legacyRoleRows: true });
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: ctx.workspace.id,
      role: "financeiro-externo",
      permission: JSON.stringify({ project: ["read"] }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await backfillFinancePermission();
    expect(await financeOf(ctx.workspace.id, "financeiro-externo")).toBe(
      undefined,
    );
  });
});

describe("o dono do workspace não pode ser editado, rebaixado nem removido", () => {
  it("recusa trocar o papel do dono, inclusive pelo próprio dono e por admin", async () => {
    const ctx = await setupWorkspace();

    for (const actor of [ctx.owner, ctx.admin]) {
      const response = await post(
        "/organization/update-member-role",
        {
          organizationId: ctx.workspace.id,
          memberId: ctx.memberIds.owner,
          role: "admin",
        },
        actor.cookie,
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
    }

    const [ownerRow] = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.id, ctx.memberIds.owner));
    expect(ownerRow.role).toBe("owner");
  });

  it("recusa promover outra pessoa a dono (transferência de propriedade)", async () => {
    const ctx = await setupWorkspace();
    const response = await post(
      "/organization/update-member-role",
      {
        organizationId: ctx.workspace.id,
        memberId: ctx.memberIds.admin,
        role: "owner",
      },
      ctx.owner.cookie,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    const [adminRow] = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.id, ctx.memberIds.admin));
    expect(adminRow.role).toBe("admin");
  });

  it("recusa remover o dono, mesmo quando pedido por admin", async () => {
    const ctx = await setupWorkspace();
    for (const actor of [ctx.admin, ctx.owner]) {
      const response = await post(
        "/organization/remove-member",
        {
          organizationId: ctx.workspace.id,
          memberIdOrEmail: ctx.memberIds.owner,
        },
        actor.cookie,
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    const rows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.id, ctx.memberIds.owner));
    expect(rows).toHaveLength(1);
  });

  it("continua permitindo trocar o papel de admin para usuário e remover usuários", async () => {
    const ctx = await setupWorkspace();
    const change = await post(
      "/organization/update-member-role",
      {
        organizationId: ctx.workspace.id,
        memberId: ctx.memberIds.member,
        role: "admin",
      },
      ctx.owner.cookie,
    );
    expect(change.status).toBe(200);

    const remove = await post(
      "/organization/remove-member",
      {
        organizationId: ctx.workspace.id,
        memberIdOrEmail: ctx.memberIds.viewer,
      },
      ctx.owner.cookie,
    );
    expect(remove.status).toBe(200);
  });
});
