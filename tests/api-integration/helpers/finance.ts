import { randomUUID } from "node:crypto";
import type { User } from "better-auth/types";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import { uploadFinanceFile } from "../../../apps/api/src/project-finance/files/upload";
import type { FinanceState } from "../../../apps/api/src/project-finance/response";
import { mockAuthenticatedSession } from "./auth";
import { createProjectFixture } from "./fixtures";
import { makePdf } from "./pdf";

export type Actor = { user: User; role: string };
export type FinanceContext = Awaited<ReturnType<typeof setupFinance>>;

const { app } = createApp();

async function createUser(label: string) {
  const id = `user-${label}-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      email: `${id}@example.com`,
      emailVerified: true,
      name: `Finance ${label}`,
    })
    .returning();
  return user as User;
}

async function createWorkspace(name: string) {
  const [workspace] = await db
    .insert(schema.workspaceTable)
    .values({
      id: `workspace-${randomUUID()}`,
      name,
      slug: `ws-${randomUUID()}`,
      createdAt: new Date(),
    })
    .returning();
  if (!workspace) throw new Error("workspace");
  return workspace;
}

async function addMember(workspaceId: string, userId: string, role: string) {
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId,
    role,
    joinedAt: new Date(),
  });
}

/** Um workspace com owner/admin/member/viewer e um projeto, mais um usuário de OUTRO workspace com projeto próprio. */
export async function setupFinance() {
  const workspace = await createWorkspace("Financeiro");
  const actors = {
    owner: { user: await createUser("owner"), role: "owner" },
    admin: { user: await createUser("admin"), role: "admin" },
    member: { user: await createUser("member"), role: "member" },
    viewer: { user: await createUser("viewer"), role: "viewer" },
  } satisfies Record<string, Actor>;
  for (const actor of Object.values(actors)) {
    await addMember(workspace.id, actor.user.id, actor.role);
  }
  const { project } = await createProjectFixture({
    workspaceId: workspace.id,
    name: "Cultura e Informação para a Pessoa Idosa",
  });

  const otherWorkspace = await createWorkspace("Outro");
  const outsider: Actor = { user: await createUser("outsider"), role: "owner" };
  await addMember(otherWorkspace.id, outsider.user.id, "owner");
  const { project: otherProject } = await createProjectFixture({
    workspaceId: otherWorkspace.id,
  });

  return { workspace, project, actors, outsider, otherWorkspace, otherProject };
}

export type CallResult<T = unknown> = {
  status: number;
  body: T;
  text: string;
};

type SaveBody = {
  payments?: Array<{
    installmentId?: string;
    receiptAssetIds?: string[];
    invoiceAssetIds?: string[];
  }>;
};

/**
 * Todo pagamento leva comprovante e NF. Os testes que não tratam de arquivos
 * chamam /save sem eles: aqui cada pagamento sem arquivos recebe um par de
 * envios (feitos direto pelo controlador, no projeto da rota). Os testes de
 * arquivos passam os ids e nada é acrescentado.
 */
async function withAttachments(actor: Actor, path: string, body: unknown) {
  const projectId = path.split("/")[1];
  const payload = body as SaveBody;
  if (!projectId || !Array.isArray(payload?.payments)) return body;
  const [project] = await db
    .select({ workspaceId: schema.projectTable.workspaceId })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, projectId))
    .limit(1);
  if (!project) return body;
  const uploader = { userId: actor.user.id, workspaceId: project.workspaceId };
  const payments = [];
  for (const payment of payload.payments) {
    if (payment.receiptAssetIds?.length || payment.invoiceAssetIds?.length) {
      payments.push(payment);
      continue;
    }
    const receipt = await uploadFinanceFile({
      projectId,
      purpose: "receipt",
      filename: "comprovante.pdf",
      bytes: await makePdf(["Comprovante"]),
      actor: uploader,
    });
    const invoice = await uploadFinanceFile({
      projectId,
      purpose: "invoice",
      filename: "nota.pdf",
      bytes: await makePdf(["Nota fiscal"]),
      actor: uploader,
    });
    payments.push({
      ...payment,
      receiptAssetIds: [receipt.id],
      invoiceAssetIds: [invoice.id],
    });
  }
  return { ...payload, payments };
}

/** Envia bytes crus para a rota de arquivos (o corpo é o próprio arquivo). */
export async function uploadVia(
  actor: Actor,
  projectId: string,
  purpose: "project" | "receipt" | "invoice",
  filename: string,
  bytes: Uint8Array,
) {
  mockAuthenticatedSession(actor.user);
  const response = await app.request(
    `/api/project-finance/${projectId}/files?purpose=${purpose}&filename=${encodeURIComponent(filename)}`,
    {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes as BodyInit,
    },
  );
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // corpo que não é JSON
  }
  return {
    status: response.status,
    body: parsed as { id: string; code?: string; message?: string },
    text,
  };
}

/** Faz a requisição HTTP de verdade (rotas, permissões, validação). */
export async function call<T = FinanceState>(
  actor: Actor,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  rawBody?: unknown,
): Promise<CallResult<T>> {
  const body =
    method === "POST" && path.endsWith("/save")
      ? await withAttachments(actor, path, rawBody)
      : rawBody;
  mockAuthenticatedSession(actor.user);
  const response = await app.request(`/api/project-finance${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // respostas de erro em texto simples
  }
  return { status: response.status, body: parsed as T, text };
}

export async function getState(actor: Actor, projectId: string) {
  const result = await call(actor, "GET", `/${projectId}`);
  expect(result.status).toBe(200);
  return result.body;
}

export async function createLineVia(
  actor: Actor,
  projectId: string,
  input: {
    supplier: string;
    totalCents?: number;
    installmentsCount?: number;
    firstDueDate?: string;
    finalDueDate?: string;
    isFixedAmount?: boolean;
    tagId?: string | null;
  },
) {
  const result = await call(actor, "POST", `/${projectId}/lines`, input);
  expect(result.status, result.text).toBe(200);
  const line = result.body.lines.find(
    (item) => item.supplier === input.supplier,
  );
  if (!line) throw new Error("line not found in state");
  return { state: result.body, line };
}

export async function createTagVia(
  actor: Actor,
  projectId: string,
  input: { name: string; valueCents?: number; description?: string | null },
) {
  const result = await call(actor, "POST", `/${projectId}/tags`, input);
  expect(result.status, result.text).toBe(200);
  const tag = result.body.tags.find((item) => item.name === input.name);
  if (!tag) throw new Error("tag not found in state");
  return { state: result.body, tag };
}

export function reais(value: number) {
  return value * 100;
}
