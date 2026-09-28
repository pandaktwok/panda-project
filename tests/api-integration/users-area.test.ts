import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { defaultRolePayloads } from "../../packages/permissions/src";
import { resetTestDatabase } from "./helpers/database";

const origin = "http://localhost:5173";
const { app } = createApp();

async function post(
  path: string,
  body: unknown,
  cookie = "",
  extra: Record<string, string> = {},
) {
  return app.request(`/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: origin,
      Cookie: cookie,
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

async function signup(email: string, extra: Record<string, string> = {}) {
  const result = await post(
    "/sign-up/email",
    { name: email.split("@")[0], email, password: "long-password-for-tests" },
    "",
    extra,
  );
  expect(result.status, await result.clone().text()).toBe(200);
  const body = await result.json();
  const cookie = result.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  return { id: body.user.id as string, email, cookie };
}

async function addMember(workspaceId: string, userId: string, role: string) {
  const [row] = await db
    .insert(schema.workspaceUserTable)
    .values({ workspaceId, userId, role, joinedAt: new Date() })
    .returning();
  return row.id;
}

async function setup() {
  // DISABLE_REGISTRATION ligado (padrão do Panda): o primeiro cadastro é aceito.
  vi.stubEnv("DISABLE_REGISTRATION", "true");
  const owner = await signup("dono@example.com");
  const [workspace] = await db
    .insert(schema.workspaceTable)
    .values({
      id: "ws-users",
      name: "Workspace",
      slug: "ws-users",
      createdAt: new Date(),
    })
    .returning();
  const ownerMemberId = await addMember(workspace.id, owner.id, "owner");
  for (const name of ["viewer", "member", "admin"] as const) {
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: workspace.id,
      role: name,
      permission: JSON.stringify(defaultRolePayloads[name]),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  return { owner, workspace, ownerMemberId };
}

beforeEach(() => resetTestDatabase());
afterEach(() => vi.unstubAllEnvs());

describe("área Usuários: convite por link, sem SMTP, com cadastro fechado", () => {
  it("o primeiro cadastro vira administrador da instância", async () => {
    const { owner } = await setup();
    const [row] = await db
      .select({ role: schema.userTable.role })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, owner.id));
    expect(row.role).toBe("admin");
  });

  it("convite criado sem SMTP devolve o id; o convidado entra como Usuário", async () => {
    const { owner, workspace } = await setup();
    const invite = await post(
      "/organization/invite-member",
      {
        email: "novo@example.com",
        role: "member",
        organizationId: workspace.id,
      },
      owner.cookie,
    );
    expect(invite.status, await invite.clone().text()).toBe(200);
    const invitation = await invite.json();
    expect(invitation.id).toBeTruthy();

    // Cadastro aberto continua fechado; com o segredo do convite, entra.
    expect(
      (
        await post("/sign-up/email", {
          name: "Sem convite",
          email: "novo@example.com",
          password: "long-password-for-tests",
        })
      ).status,
    ).toBe(403);
    const invitee = await signup("novo@example.com", {
      "x-invitation-id": invitation.id,
    });
    const accept = await post(
      "/organization/accept-invitation",
      { invitationId: invitation.id },
      invitee.cookie,
    );
    expect(accept.status, await accept.clone().text()).toBe(200);
    const [member] = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, invitee.id));
    expect(member.role).toBe("member");
  });

  it("revogar o convite invalida o link", async () => {
    const { owner, workspace } = await setup();
    const invite = await post(
      "/organization/invite-member",
      { email: "x@example.com", role: "member", organizationId: workspace.id },
      owner.cookie,
    );
    const invitation = await invite.json();
    const cancel = await post(
      "/organization/cancel-invitation",
      { invitationId: invitation.id },
      owner.cookie,
    );
    expect(cancel.status).toBe(200);
    expect(
      (
        await post(
          "/sign-up/email",
          {
            name: "X",
            email: "x@example.com",
            password: "long-password-for-tests",
          },
          "",
          { "x-invitation-id": invitation.id },
        )
      ).status,
    ).toBe(403);
  });

  it("só existem os papéis Administrador e Usuário", async () => {
    const { owner, workspace } = await setup();
    for (const role of ["viewer", "owner", "auditor"]) {
      const result = await post(
        "/organization/invite-member",
        { email: `${role}@example.com`, role, organizationId: workspace.id },
        owner.cookie,
      );
      expect(result.status, role).toBe(400);
    }
    const ok = await post(
      "/organization/invite-member",
      { email: "adm@example.com", role: "admin", organizationId: workspace.id },
      owner.cookie,
    );
    expect(ok.status).toBe(200);
  });
});

describe("área Usuários: o dono (administrador principal) é fixo", () => {
  async function withAdminAndMember() {
    const base = await setup();
    // Só para montar o cenário: cadastro aberto por um instante.
    vi.stubEnv("DISABLE_REGISTRATION", "false");
    const admin = await signup("admin@example.com");
    const user = await signup("usuario@example.com");
    vi.stubEnv("DISABLE_REGISTRATION", "true");
    const adminMemberId = await addMember(base.workspace.id, admin.id, "admin");
    const userMemberId = await addMember(base.workspace.id, user.id, "member");
    return { ...base, admin, adminMemberId, user, userMemberId };
  }

  it("ninguém rebaixa, remove ou troca o dono (nem o próprio dono, nem outro administrador)", async () => {
    const ctx = await withAdminAndMember();
    for (const actor of [ctx.admin, ctx.owner]) {
      const demote = await post(
        "/organization/update-member-role",
        {
          memberId: ctx.ownerMemberId,
          role: "member",
          organizationId: ctx.workspace.id,
        },
        actor.cookie,
      );
      expect(demote.status, "rebaixar").toBe(403);
      expect(await demote.text()).toContain("administrador principal");

      const remove = await post(
        "/organization/remove-member",
        { memberIdOrEmail: ctx.owner.email, organizationId: ctx.workspace.id },
        actor.cookie,
      );
      expect(remove.status, "remover").toBe(403);
    }
    // Transferir a posse (promover outra pessoa a owner) também é recusado.
    const promote = await post(
      "/organization/update-member-role",
      {
        memberId: ctx.userMemberId,
        role: "owner",
        organizationId: ctx.workspace.id,
      },
      ctx.owner.cookie,
    );
    expect(promote.status).toBe(400);
    const [owner] = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.id, ctx.ownerMemberId));
    expect(owner.role).toBe("owner");
  });

  it("administrador troca Usuário <-> Administrador e remove usuários; papel viewer é recusado", async () => {
    const ctx = await withAdminAndMember();
    const promote = await post(
      "/organization/update-member-role",
      {
        memberId: ctx.userMemberId,
        role: "admin",
        organizationId: ctx.workspace.id,
      },
      ctx.owner.cookie,
    );
    expect(promote.status, await promote.clone().text()).toBe(200);
    const back = await post(
      "/organization/update-member-role",
      {
        memberId: ctx.userMemberId,
        role: "member",
        organizationId: ctx.workspace.id,
      },
      ctx.owner.cookie,
    );
    expect(back.status).toBe(200);
    const viewer = await post(
      "/organization/update-member-role",
      {
        memberId: ctx.userMemberId,
        role: "viewer",
        organizationId: ctx.workspace.id,
      },
      ctx.owner.cookie,
    );
    expect(viewer.status).toBe(400);
    const remove = await post(
      "/organization/remove-member",
      { memberIdOrEmail: ctx.user.email, organizationId: ctx.workspace.id },
      ctx.owner.cookie,
    );
    expect(remove.status, await remove.clone().text()).toBe(200);
  });

  it("um Usuário comum não altera papéis nem remove ninguém", async () => {
    const ctx = await withAdminAndMember();
    const result = await post(
      "/organization/update-member-role",
      {
        memberId: ctx.adminMemberId,
        role: "member",
        organizationId: ctx.workspace.id,
      },
      ctx.user.cookie,
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
    const remove = await post(
      "/organization/remove-member",
      { memberIdOrEmail: ctx.admin.email, organizationId: ctx.workspace.id },
      ctx.user.cookie,
    );
    expect(remove.status).toBeGreaterThanOrEqual(400);
  });
});
