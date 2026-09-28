import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { resetFakeStorage } from "./helpers/fake-storage";
import {
  type Actor,
  createLineVia,
  type FinanceContext,
  getState,
  setupFinance,
  uploadVia,
} from "./helpers/finance";
import { createProjectFixture } from "./helpers/fixtures";
import { makePdf } from "./helpers/pdf";

vi.mock("../../apps/api/src/storage/s3", async (importOriginal) =>
  (await import("./helpers/fake-storage")).fakeS3(
    await importOriginal<Record<string, unknown>>(),
  ),
);

const { app } = createApp();

async function req(actor: Actor, method: string, path: string, body?: unknown) {
  mockAuthenticatedSession(actor.user);
  const response = await app.request(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    // texto simples
  }
  return { status: response.status, json: json as any, text };
}

async function setKeys(
  ctx: FinanceContext,
  actor: Actor,
  keys: { canView?: boolean; canPay?: boolean; canAttach?: boolean },
) {
  await db.insert(schema.projectMemberAccessTable).values({
    projectId: ctx.project.id,
    userId: actor.user.id,
    canView: keys.canView ?? true,
    canPay: keys.canPay ?? true,
    canAttach: keys.canAttach ?? true,
  });
}

describe("project access: hidden project (Ver desligado)", () => {
  let ctx: FinanceContext;
  let taskId: string;
  let otherProjectId: string;
  let otherTaskId: string;
  let member: Actor;

  beforeEach(async () => {
    await resetTestDatabase();
    resetFakeStorage();
    ctx = await setupFinance();
    member = ctx.actors.member;
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: ctx.project.id,
        title: "Tarefa secreta",
        number: 1,
        status: "to-do",
        userId: ctx.actors.admin.user.id,
      })
      .returning();
    taskId = task.id;
    const { project: other } = await createProjectFixture({
      workspaceId: ctx.workspace.id,
      name: "Projeto visível",
    });
    otherProjectId = other.id;
    const [otherTask] = await db
      .insert(schema.taskTable)
      .values({
        projectId: other.id,
        title: "Tarefa visível",
        number: 1,
        status: "to-do",
      })
      .returning();
    otherTaskId = otherTask.id;
    await setKeys(ctx, member, { canView: false });
  });

  it("some da lista de projetos (o outro projeto continua)", async () => {
    const asMember = await req(
      member,
      "GET",
      `/project?workspaceId=${ctx.workspace.id}`,
    );
    expect(asMember.status).toBe(200);
    const ids = asMember.json.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(ctx.project.id);
    expect(ids).toContain(otherProjectId);

    const asAdmin = await req(
      ctx.actors.admin,
      "GET",
      `/project?workspaceId=${ctx.workspace.id}`,
    );
    expect(asAdmin.json.map((p: { id: string }) => p.id)).toContain(
      ctx.project.id,
    );
  });

  it("reordenar não devolve nem aceita o projeto escondido", async () => {
    const admin = await req(
      ctx.actors.admin,
      "PUT",
      `/project/reorder?workspaceId=${ctx.workspace.id}`,
      { projects: [{ id: otherProjectId, position: 0 }] },
    );
    expect(admin.status).toBe(200);
    // membro comum não reordena (papel), mas o retorno não pode vazar: usa o dono com chave
    const asMember = await req(
      member,
      "PUT",
      `/project/reorder?workspaceId=${ctx.workspace.id}`,
      { projects: [{ id: ctx.project.id, position: 0 }] },
    );
    expect([403, 404]).toContain(asMember.status);
  });

  it("acesso direto ao projeto responde 404 (nunca 403)", async () => {
    expect(
      (await req(member, "GET", `/project/${ctx.project.id}`)).status,
    ).toBe(404);
    expect(
      (await req(ctx.actors.admin, "GET", `/project/${ctx.project.id}`)).status,
    ).toBe(200);
  });

  it("some da busca", async () => {
    const term = encodeURIComponent("Cultura");
    const asMember = await req(
      member,
      "GET",
      `/search?q=${term}&workspaceId=${ctx.workspace.id}`,
    );
    expect(asMember.status).toBe(200);
    expect(asMember.json.results).toEqual([]);
    const taskTerm = await req(
      member,
      "GET",
      `/search?q=${encodeURIComponent("secreta")}&workspaceId=${ctx.workspace.id}`,
    );
    expect(taskTerm.json.results).toEqual([]);
    const asAdmin = await req(
      ctx.actors.admin,
      "GET",
      `/search?q=${term}&workspaceId=${ctx.workspace.id}`,
    );
    expect(asAdmin.json.results.length).toBeGreaterThan(0);
  });

  it("tarefas: lista, detalhe, criação, escrita e exportação dão 404", async () => {
    const checks: Array<[string, string, unknown?]> = [
      ["GET", `/task/tasks/${ctx.project.id}`],
      ["GET", `/task/${taskId}`],
      [
        "POST",
        `/task/${ctx.project.id}`,
        { title: "x", status: "to-do", priority: "low" },
      ],
      ["PUT", `/task/status/${taskId}`, { status: "done" }],
      ["PUT", `/task/title/${taskId}`, { title: "novo" }],
      ["DELETE", `/task/${taskId}`],
      ["GET", `/task/export/${ctx.project.id}`],
      ["GET", `/task/${taskId}/description`],
      ["GET", `/task/description-matches/${ctx.project.id}?q=a`],
    ];
    for (const [method, path, body] of checks) {
      const result = await req(member, method, path, body);
      expect(result.status, `${method} ${path}`).toBe(404);
    }
    // o outro projeto segue normal
    expect((await req(member, "GET", `/task/${otherTaskId}`)).status).toBe(200);
  });

  it("mover tarefa para o projeto escondido dá 404", async () => {
    const result = await req(member, "PUT", `/task/move/${otherTaskId}`, {
      destinationProjectId: ctx.project.id,
    });
    expect(result.status).toBe(404);
  });

  it("colunas, fluxo, campos personalizados dão 404", async () => {
    for (const path of [
      `/column/${ctx.project.id}`,
      `/workflow-rule/${ctx.project.id}`,
      `/custom-field/project/${ctx.project.id}`,
      `/custom-field/project/${ctx.project.id}/values`,
      `/custom-field/task/${taskId}`,
    ]) {
      expect((await req(member, "GET", path)).status, path).toBe(404);
    }
  });

  it("comentários, atividade, tempo, links externos e rótulos da tarefa dão 404", async () => {
    const [comment] = await db
      .insert(schema.activityTable)
      .values({
        taskId,
        userId: ctx.actors.admin.user.id,
        type: "comment",
        content: "segredo",
      })
      .returning();
    const [entry] = await db
      .insert(schema.timeEntryTable)
      .values({
        taskId,
        userId: ctx.actors.admin.user.id,
        startTime: new Date(),
        duration: 60,
      })
      .returning();
    const [label] = await db
      .insert(schema.labelTable)
      .values({
        name: "rótulo-secreto",
        color: "#fff",
        taskId,
        workspaceId: ctx.workspace.id,
      })
      .returning();
    const checks: Array<[string, string, unknown?]> = [
      ["GET", `/comment/${taskId}`],
      ["POST", `/comment/${taskId}`, { comment: "oi" }],
      ["PUT", `/comment/${comment.id}`, { comment: "x" }],
      ["DELETE", `/comment/${comment.id}`],
      ["GET", `/activity/${taskId}`],
      ["POST", "/activity/create", { taskId, type: "comment", content: "x" }],
      ["GET", `/time-entry/task/${taskId}`],
      ["GET", `/time-entry/${entry.id}`],
      ["GET", `/external-link/task/${taskId}`],
      ["GET", `/label/task/${taskId}`],
      ["GET", `/label/${label.id}`],
      ["DELETE", `/label/${label.id}`],
    ];
    for (const [method, path, body] of checks) {
      const result = await req(member, method, path, body);
      expect(result.status, `${method} ${path}`).toBe(404);
    }
    // lista de rótulos do workspace não devolve a cópia da tarefa escondida
    const list = await req(
      member,
      "GET",
      `/label/workspace/${ctx.workspace.id}`,
    );
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.json)).not.toContain("rótulo-secreto");
    const adminList = await req(
      ctx.actors.admin,
      "GET",
      `/label/workspace/${ctx.workspace.id}`,
    );
    expect(JSON.stringify(adminList.json)).toContain("rótulo-secreto");
  });

  it("relações: some a ponta escondida e não dá para ligar ao projeto escondido", async () => {
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: otherTaskId,
      targetTaskId: taskId,
      relationType: "related",
    });
    const visible = await req(member, "GET", `/task-relation/${otherTaskId}`);
    expect(visible.status).toBe(200);
    expect(visible.json).toEqual([]);
    const adminView = await req(
      ctx.actors.admin,
      "GET",
      `/task-relation/${otherTaskId}`,
    );
    expect(adminView.json).toHaveLength(1);

    expect((await req(member, "GET", `/task-relation/${taskId}`)).status).toBe(
      404,
    );
    const create = await req(member, "POST", "/task-relation", {
      sourceTaskId: otherTaskId,
      targetTaskId: taskId,
      relationType: "blocks",
    });
    expect(create.status).toBe(404);
  });

  it("financeiro: estado, arquivos, ZIP, envio e ações dão 404", async () => {
    const paths: Array<[string, string]> = [
      ["GET", `/project-finance/${ctx.project.id}`],
      ["GET", `/project-finance/${ctx.project.id}/files`],
      ["GET", `/project-finance/${ctx.project.id}/files/parcels/1/zip`],
    ];
    for (const [method, path] of paths) {
      expect((await req(member, method, path)).status, path).toBe(404);
    }
    const upload = await uploadVia(
      member,
      ctx.project.id,
      "project",
      "x.pdf",
      await makePdf(["x"]),
    );
    expect(upload.status).toBe(404);
  });

  it("arquivo (asset) do projeto escondido dá 404 no download", async () => {
    const admin = ctx.actors.admin;
    const upload = await uploadVia(
      admin,
      ctx.project.id,
      "project",
      "contrato.pdf",
      await makePdf(["contrato"]),
    );
    expect(upload.status).toBe(200);
    const asMember = await req(member, "GET", `/asset/${upload.body.id}`);
    expect(asMember.status).toBe(404);
  });

  it("notificações: não lista nem marca as do projeto escondido", async () => {
    const [hidden] = await db
      .insert(schema.notificationTable)
      .values({
        userId: member.user.id,
        title: "escondida",
        type: "task_created",
        resourceId: taskId,
        resourceType: "task",
      })
      .returning();
    await db.insert(schema.notificationTable).values({
      userId: member.user.id,
      title: "visivel",
      type: "task_created",
      resourceId: otherTaskId,
      resourceType: "task",
    });
    await db.insert(schema.notificationTable).values({
      userId: member.user.id,
      title: "projeto-escondido",
      type: "project_final_stretch",
      resourceId: ctx.project.id,
      resourceType: "project",
    });
    const list = await req(member, "GET", "/notification");
    expect(list.status).toBe(200);
    const titles = list.json.map((n: { title: string }) => n.title);
    expect(titles).toEqual(["visivel"]);
    const mark = await req(member, "PATCH", `/notification/${hidden.id}/read`);
    expect(mark.status).toBeGreaterThanOrEqual(400);
  });

  it("dono e administrador não são afetados por nenhuma chave", async () => {
    for (const actor of [ctx.actors.owner, ctx.actors.admin]) {
      await db.insert(schema.projectMemberAccessTable).values({
        projectId: ctx.project.id,
        userId: actor.user.id,
        canView: false,
        canPay: false,
        canAttach: false,
      });
      expect(
        (await req(actor, "GET", `/project/${ctx.project.id}`)).status,
      ).toBe(200);
      expect((await req(actor, "GET", `/task/${taskId}`)).status).toBe(200);
      expect(
        (await req(actor, "GET", `/project-finance/${ctx.project.id}`)).status,
      ).toBe(200);
    }
    // e uma linha só de leitura (canView falso) não vale para o dono na lista
    const list = await req(
      ctx.actors.owner,
      "GET",
      `/project?workspaceId=${ctx.workspace.id}`,
    );
    expect(list.json.map((p: { id: string }) => p.id)).toContain(
      ctx.project.id,
    );
  });

  it("quem é de outro workspace continua sem ver (404 ou 403, sem vazar)", async () => {
    const result = await req(ctx.outsider, "GET", `/project/${ctx.project.id}`);
    expect([403, 404]).toContain(result.status);
  });
});

describe("project access: chaves de pagamento e anexo", () => {
  let ctx: FinanceContext;
  let member: Actor;

  beforeEach(async () => {
    await resetTestDatabase();
    resetFakeStorage();
    ctx = await setupFinance();
    member = ctx.actors.member;
    await createLineVia(ctx.actors.admin, ctx.project.id, {
      supplier: "Fornecedor A",
      totalCents: 100_000,
      installmentsCount: 4,
      firstDueDate: "2026-10-05",
    });
  });

  it("sem 'registrar pagamentos': vê o cronograma, a API recusa marcar, desfazer e enviar comprovante", async () => {
    await setKeys(ctx, member, { canPay: false });
    const state = await getState(member, ctx.project.id);
    expect(state.lines).toHaveLength(1);

    const installment = state.lines[0].installments[0];
    const save = await req(
      member,
      "POST",
      `/project-finance/${ctx.project.id}/save`,
      {
        version: state.version,
        payments: [
          {
            installmentId: installment.id,
            paidCents: 25_000,
            paidAt: "2026-09-24",
            receiptAssetIds: ["x"],
            invoiceAssetIds: ["y"],
          },
        ],
      },
    );
    expect(save.status).toBe(403);
    expect(save.text).toContain("registrar pagamentos");

    const receipt = await uploadVia(
      member,
      ctx.project.id,
      "receipt",
      "c.pdf",
      await makePdf(["c"]),
    );
    expect(receipt.status).toBe(403);

    const undo = await req(
      member,
      "POST",
      `/project-finance/installments/${installment.id}/undo`,
    );
    expect(undo.status).toBe(403);
  });

  it("sem 'anexar': a API recusa envio e remoção de anexo, mas o pagamento (com chave) segue", async () => {
    await setKeys(ctx, member, { canAttach: false });
    const upload = await uploadVia(
      member,
      ctx.project.id,
      "project",
      "planta.pdf",
      await makePdf(["planta"]),
    );
    expect(upload.status).toBe(403);
    expect(upload.text).toContain("anexar");

    const adminUpload = await uploadVia(
      ctx.actors.admin,
      ctx.project.id,
      "project",
      "planta.pdf",
      await makePdf(["planta"]),
    );
    const del = await req(
      member,
      "DELETE",
      `/project-finance/${ctx.project.id}/files/${adminUpload.body.id}`,
    );
    expect(del.status).toBe(403);
  });

  it("sem linha (padrão) o Usuário registra pagamento normalmente", async () => {
    const state = await getState(member, ctx.project.id);
    const installment = state.lines[0].installments[0];
    const save = await req(
      member,
      "POST",
      `/project-finance/${ctx.project.id}/save`,
      {
        version: state.version,
        payments: [
          {
            installmentId: installment.id,
            paidCents: 25_000,
            paidAt: "2026-09-24",
          },
        ],
      },
    );
    // sem arquivos a API recusa por validação (400/422), nunca por chave
    expect(save.status).not.toBe(403);
  });
});

describe("project access: tela Acesso (API)", () => {
  let ctx: FinanceContext;

  beforeEach(async () => {
    await resetTestDatabase();
    resetFakeStorage();
    ctx = await setupFinance();
  });

  it("só administrador lista e edita", async () => {
    const base = `/project-access/${ctx.project.id}`;
    expect((await req(ctx.actors.member, "GET", base)).status).toBe(403);
    expect(
      (
        await req(
          ctx.actors.member,
          "PUT",
          `${base}/${ctx.actors.viewer.user.id}`,
          {
            canView: false,
            canPay: false,
            canAttach: false,
          },
        )
      ).status,
    ).toBe(403);

    const list = await req(ctx.actors.admin, "GET", base);
    expect(list.status).toBe(200);
    const byRole = Object.fromEntries(
      list.json.members.map((m: { role: string }) => [m.role, m]),
    );
    expect(byRole.owner.locked).toBe(true);
    expect(byRole.admin.locked).toBe(true);
    expect(byRole.member.locked).toBe(false);
    expect(byRole.member.canView).toBe(true);
  });

  it("Ver desligado desliga as outras duas; tudo ligado remove a linha; dono/admin não se restringem", async () => {
    const base = `/project-access/${ctx.project.id}`;
    const target = ctx.actors.member.user.id;
    const off = await req(ctx.actors.admin, "PUT", `${base}/${target}`, {
      canView: false,
      canPay: true,
      canAttach: true,
    });
    expect(off.status).toBe(200);
    expect(off.json).toMatchObject({
      canView: false,
      canPay: false,
      canAttach: false,
    });
    const [row] = await db
      .select()
      .from(schema.projectMemberAccessTable)
      .where(
        and(
          eq(schema.projectMemberAccessTable.projectId, ctx.project.id),
          eq(schema.projectMemberAccessTable.userId, target),
        ),
      );
    expect(row).toMatchObject({
      canView: false,
      canPay: false,
      canAttach: false,
    });

    const back = await req(ctx.actors.admin, "PUT", `${base}/${target}`, {
      canView: true,
      canPay: true,
      canAttach: true,
    });
    expect(back.status).toBe(200);
    expect(
      await db.select().from(schema.projectMemberAccessTable),
    ).toHaveLength(0);

    for (const locked of [ctx.actors.owner, ctx.actors.admin]) {
      const result = await req(
        ctx.actors.admin,
        "PUT",
        `${base}/${locked.user.id}`,
        { canView: false, canPay: false, canAttach: false },
      );
      expect(result.status).toBe(400);
    }
    const stranger = await req(
      ctx.actors.admin,
      "PUT",
      `${base}/${randomUUID()}`,
      { canView: false, canPay: false, canAttach: false },
    );
    expect(stranger.status).toBe(400);
  });

  it("administrador de outro workspace não edita este projeto", async () => {
    const result = await req(
      ctx.outsider,
      "PUT",
      `/project-access/${ctx.project.id}/${ctx.actors.member.user.id}`,
      { canView: false, canPay: false, canAttach: false },
    );
    expect([403, 404]).toContain(result.status);
  });
});
