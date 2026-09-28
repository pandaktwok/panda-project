import { and, eq, inArray } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { assertProjectVisible } from "../project-access";
import { validateWorkspaceAccess } from "./validate-workspace-access";

type WorkspaceIdSource =
  | { type: "query"; key: string }
  | { type: "body"; key: string }
  | { type: "param"; key: string }
  | {
      type: "lookup";
      resource:
        | "project"
        | "task"
        | "label"
        | "timeEntry"
        | "activity"
        | "comment"
        | "column"
        | "workflowRule"
        | "customField"
        | "projectTag"
        | "paymentLine"
        | "installment";
      idKey: string;
    }
  | {
      type: "lookupMany";
      resource: "task";
      idKey: string;
    };

type WorkspaceAccessMiddlewareConfig = {
  sources: WorkspaceIdSource[];
};

async function readJsonObjectBody(
  c: Context,
): Promise<Record<string, unknown>> {
  // Envio de arquivo (corpo binário): não é JSON e ler o corpo aqui o
  // consumiria antes do handler. O id do recurso vem da URL.
  if (
    c.req
      .header("content-type")
      ?.toLowerCase()
      .startsWith("application/octet-stream")
  ) {
    return {};
  }
  const raw = (await c.req.json().catch(() => ({}))) || {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

export function workspaceAccessMiddleware(
  config: WorkspaceAccessMiddlewareConfig,
) {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");

    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    let workspaceId: string | null = null;
    // Projetos que a rota toca (para a permissão por projeto, Fase 7A).
    const projectIds = new Set<string>();

    for (const source of config.sources) {
      if (source.type === "query") {
        workspaceId = c.req.query(source.key) || null;
      } else if (source.type === "body") {
        const body = await readJsonObjectBody(c);
        const bodyValue = body[source.key];
        workspaceId = typeof bodyValue === "string" ? bodyValue : null;
      } else if (source.type === "param") {
        workspaceId = c.req.param(source.key) || null;
      } else if (source.type === "lookup") {
        const body = await readJsonObjectBody(c);
        const bodyId = body[source.idKey];
        const idFromBody = typeof bodyId === "string" ? bodyId : null;
        // Only accept the id from the same place the handler will read it
        // (path param or JSON body). Accepting it from the query string let a
        // caller authorize against one resource (`?taskId=<mine>`) while the
        // handler acted on another (`{"taskId": "<someone else's>"}`).
        const id = c.req.param(source.idKey) || idFromBody;
        if (id) {
          const found = await lookupWorkspaceId(source.resource, id);
          workspaceId = found?.workspaceId ?? null;
          if (found?.projectId) projectIds.add(found.projectId);
        }
      } else if (source.type === "lookupMany") {
        const body = await readJsonObjectBody(c);
        const ids = body[source.idKey];
        if (Array.isArray(ids)) {
          const taskIds = ids.filter(
            (id): id is string => typeof id === "string",
          );
          if (taskIds.length > 0) {
            const tasks = await db
              .select({
                workspaceId: schema.projectTable.workspaceId,
                projectId: schema.projectTable.id,
              })
              .from(schema.taskTable)
              .innerJoin(
                schema.projectTable,
                eq(schema.taskTable.projectId, schema.projectTable.id),
              )
              .where(inArray(schema.taskTable.id, taskIds));
            const workspaceIds = [
              ...new Set(tasks.map((task) => task.workspaceId)),
            ];
            if (workspaceIds.length === 0) {
              throw new HTTPException(404, { message: "No tasks found" });
            }
            if (workspaceIds.length > 1) {
              throw new HTTPException(400, {
                message: "All tasks must belong to the same workspace",
              });
            }
            workspaceId = workspaceIds[0] ?? null;
            for (const task of tasks) projectIds.add(task.projectId);
          }
        }
      }

      if (workspaceId) {
        break;
      }
    }

    if (!workspaceId) {
      throw new HTTPException(400, {
        message: "Workspace ID could not be determined",
      });
    }

    const apiKey = c.get("apiKey");
    const apiKeyId = apiKey?.id;

    await validateWorkspaceAccess(userId, workspaceId, apiKeyId);

    // Projeto invisível para este usuário responde 404, como se não existisse.
    for (const projectId of projectIds) {
      await assertProjectVisible(userId, projectId);
    }

    c.set("workspaceId", workspaceId);

    return next();
  };
}

async function lookupWorkspaceId(
  resource:
    | "project"
    | "task"
    | "label"
    | "timeEntry"
    | "activity"
    | "comment"
    | "column"
    | "workflowRule"
    | "customField"
    | "projectTag"
    | "paymentLine"
    | "installment",
  id: string,
): Promise<{ workspaceId: string; projectId: string | null } | null> {
  try {
    switch (resource) {
      case "project": {
        const [project] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.projectTable.id,
          })
          .from(schema.projectTable)
          .where(eq(schema.projectTable.id, id))
          .limit(1);
        return project?.workspaceId
          ? {
              workspaceId: project.workspaceId,
              projectId: project.projectId ?? null,
            }
          : null;
      }

      case "task": {
        const [task] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.projectTable.id,
          })
          .from(schema.taskTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.taskTable.id, id))
          .limit(1);
        return task?.workspaceId
          ? { workspaceId: task.workspaceId, projectId: task.projectId ?? null }
          : null;
      }

      case "label": {
        const [label] = await db
          .select({
            workspaceId: schema.labelTable.workspaceId,
            taskId: schema.labelTable.taskId,
            taskWorkspaceId: schema.projectTable.workspaceId,
            projectId: schema.taskTable.projectId,
          })
          .from(schema.labelTable)
          .leftJoin(
            schema.taskTable,
            eq(schema.labelTable.taskId, schema.taskTable.id),
          )
          .leftJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.labelTable.id, id))
          .limit(1);
        // Older releases allowed inconsistent label/task references. Never use
        // such a row to authorize reads, mutations or external provider sync.
        if (label?.taskId && label.taskWorkspaceId !== label.workspaceId) {
          return null;
        }
        return label?.workspaceId
          ? {
              workspaceId: label.workspaceId,
              projectId: label.projectId ?? null,
            }
          : null;
      }

      case "timeEntry": {
        const [timeEntry] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.projectTable.id,
          })
          .from(schema.timeEntryTable)
          .innerJoin(
            schema.taskTable,
            eq(schema.timeEntryTable.taskId, schema.taskTable.id),
          )
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.timeEntryTable.id, id))
          .limit(1);
        return timeEntry?.workspaceId
          ? {
              workspaceId: timeEntry.workspaceId,
              projectId: timeEntry.projectId ?? null,
            }
          : null;
      }

      case "activity": {
        const [activity] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.projectTable.id,
          })
          .from(schema.activityTable)
          .innerJoin(
            schema.taskTable,
            eq(schema.activityTable.taskId, schema.taskTable.id),
          )
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.activityTable.id, id))
          .limit(1);
        return activity?.workspaceId
          ? {
              workspaceId: activity.workspaceId,
              projectId: activity.projectId ?? null,
            }
          : null;
      }

      case "comment": {
        const [comment] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.projectTable.id,
          })
          .from(schema.activityTable)
          .innerJoin(
            schema.taskTable,
            eq(schema.activityTable.taskId, schema.taskTable.id),
          )
          .innerJoin(
            schema.projectTable,
            eq(schema.taskTable.projectId, schema.projectTable.id),
          )
          .where(
            and(
              eq(schema.activityTable.id, id),
              eq(schema.activityTable.type, "comment"),
            ),
          )
          .limit(1);
        return comment?.workspaceId
          ? {
              workspaceId: comment.workspaceId,
              projectId: comment.projectId ?? null,
            }
          : null;
      }

      case "column": {
        const [column] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.projectTable.id,
          })
          .from(schema.columnTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.columnTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.columnTable.id, id))
          .limit(1);
        return column?.workspaceId
          ? {
              workspaceId: column.workspaceId,
              projectId: column.projectId ?? null,
            }
          : null;
      }

      case "workflowRule": {
        const [workflowRule] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.projectTable.id,
          })
          .from(schema.workflowRuleTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.workflowRuleTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.workflowRuleTable.id, id))
          .limit(1);
        return workflowRule?.workspaceId
          ? {
              workspaceId: workflowRule.workspaceId,
              projectId: workflowRule.projectId ?? null,
            }
          : null;
      }

      case "customField": {
        const [field] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.projectTable.id,
          })
          .from(schema.customFieldDefinitionTable)
          .innerJoin(
            schema.projectTable,
            eq(
              schema.customFieldDefinitionTable.projectId,
              schema.projectTable.id,
            ),
          )
          .where(eq(schema.customFieldDefinitionTable.id, id))
          .limit(1);
        return field?.workspaceId
          ? {
              workspaceId: field.workspaceId,
              projectId: field.projectId ?? null,
            }
          : null;
      }

      case "projectTag": {
        const [tag] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.projectTable.id,
          })
          .from(schema.projectTagTable)
          .innerJoin(
            schema.projectTable,
            eq(schema.projectTagTable.projectId, schema.projectTable.id),
          )
          .where(eq(schema.projectTagTable.id, id))
          .limit(1);
        return tag?.workspaceId
          ? { workspaceId: tag.workspaceId, projectId: tag.projectId ?? null }
          : null;
      }

      case "paymentLine": {
        const [line] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.projectTable.id,
          })
          .from(schema.projectPaymentLineTable)
          .innerJoin(
            schema.projectTable,
            eq(
              schema.projectPaymentLineTable.projectId,
              schema.projectTable.id,
            ),
          )
          .where(eq(schema.projectPaymentLineTable.id, id))
          .limit(1);
        return line?.workspaceId
          ? { workspaceId: line.workspaceId, projectId: line.projectId ?? null }
          : null;
      }

      case "installment": {
        const [installment] = await db
          .select({
            workspaceId: schema.projectTable.workspaceId,
            projectId: schema.projectTable.id,
          })
          .from(schema.projectInstallmentTable)
          .innerJoin(
            schema.projectPaymentLineTable,
            eq(
              schema.projectInstallmentTable.lineId,
              schema.projectPaymentLineTable.id,
            ),
          )
          .innerJoin(
            schema.projectTable,
            eq(
              schema.projectPaymentLineTable.projectId,
              schema.projectTable.id,
            ),
          )
          .where(eq(schema.projectInstallmentTable.id, id))
          .limit(1);
        return installment?.workspaceId
          ? {
              workspaceId: installment.workspaceId,
              projectId: installment.projectId ?? null,
            }
          : null;
      }

      default:
        return null;
    }
  } catch (error) {
    console.error(`Error looking up workspaceId for ${resource}:`, error);
    return null;
  }
}

export const workspaceAccess = {
  fromQuery: (key = "workspaceId") =>
    workspaceAccessMiddleware({ sources: [{ type: "query", key }] }),

  fromBody: (key = "workspaceId") =>
    workspaceAccessMiddleware({ sources: [{ type: "body", key }] }),

  fromParam: (key = "workspaceId") =>
    workspaceAccessMiddleware({ sources: [{ type: "param", key }] }),

  fromProject: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "project", idKey }],
    }),

  fromTask: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "task", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromTaskId: (idKey = "taskId") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "task", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromTasks: (idKey = "taskIds") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookupMany", resource: "task", idKey }],
    }),

  fromLabel: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "label", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromTimeEntry: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "timeEntry", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromActivity: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "activity", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromComment: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "comment", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromColumn: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "column", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromWorkflowRule: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "workflowRule", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),

  fromCustomField: (idKey = "id") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "customField", idKey }],
    }),

  fromProjectTag: (idKey = "tagId") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "projectTag", idKey }],
    }),

  fromPaymentLine: (idKey = "lineId") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "paymentLine", idKey }],
    }),

  fromInstallment: (idKey = "installmentId") =>
    workspaceAccessMiddleware({
      sources: [{ type: "lookup", resource: "installment", idKey }],
    }),

  fromProjectId: (idKey = "projectId") =>
    workspaceAccessMiddleware({
      sources: [
        { type: "lookup", resource: "project", idKey },
        { type: "query", key: "workspaceId" },
      ],
    }),
};
