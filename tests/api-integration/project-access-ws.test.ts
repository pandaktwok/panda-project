import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serve } from "../../apps/api/node_modules/@hono/node-server";
import type { NodeWebSocket } from "../../apps/api/node_modules/@hono/node-ws";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { type FinanceContext, setupFinance } from "./helpers/finance";

type Socket = NodeWebSocket["wss"]["clients"] extends Set<infer S> ? S : never;
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const nodeWsRequire = createRequire(apiRequire.resolve("@hono/node-ws"));
const WebSocket: new (
  url: string,
  options: { headers: Record<string, string> },
) => Socket = nodeWsRequire("ws").WebSocket;

let server: ReturnType<typeof serve>;
let baseUrl: string;
let created: ReturnType<typeof createApp>;
let ctx: FinanceContext;
const sockets: Socket[] = [];

async function connect(projectId: string) {
  const socket = new WebSocket(`${baseUrl}/api/ws/${projectId}`, {
    headers: { origin: "http://localhost:5173" },
  });
  sockets.push(socket);
  socket.on("error", () => {});
  const status = await new Promise<number>((resolve) => {
    socket.once("open", () => resolve(101));
    socket.once(
      "unexpected-response",
      (_request: unknown, response: IncomingMessage) => {
        response.resume();
        resolve(response.statusCode ?? 0);
        socket.terminate();
      },
    );
  });
  return { socket, status };
}

beforeEach(async () => {
  await resetTestDatabase();
  ctx = await setupFinance();
  created = createApp();
  server = serve({ fetch: created.app.fetch, hostname: "127.0.0.1", port: 0 });
  created.injectWebSocket(server);
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  baseUrl = `ws://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("project access: eventos ao vivo", () => {
  it("usuário com acesso conecta; sem 'Ver' a conexão é recusada como projeto inexistente", async () => {
    mockAuthenticatedSession(ctx.actors.member.user);
    expect((await connect(ctx.project.id)).status).toBe(101);

    await db.insert(schema.projectMemberAccessTable).values({
      projectId: ctx.project.id,
      userId: ctx.actors.member.user.id,
      canView: false,
      canPay: false,
      canAttach: false,
    });
    const hidden = await connect(ctx.project.id);
    const missing = await connect("projeto-que-nao-existe");
    expect(hidden.status).toBe(401);
    expect(hidden.status).toBe(missing.status);

    // Administrador não é afetado pela linha.
    mockAuthenticatedSession(ctx.actors.admin.user);
    expect((await connect(ctx.project.id)).status).toBe(101);
  });

  it("desligar 'Ver' pela API derruba a conexão já aberta", async () => {
    mockAuthenticatedSession(ctx.actors.member.user);
    const { socket, status } = await connect(ctx.project.id);
    expect(status).toBe(101);
    const closed = once(socket, "close");

    mockAuthenticatedSession(ctx.actors.admin.user);
    const response = await created.app.request(
      `/api/project-access/${ctx.project.id}/${ctx.actors.member.user.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          canView: false,
          canPay: false,
          canAttach: false,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect((await closed)[0]).toBe(4404);
  });
});
