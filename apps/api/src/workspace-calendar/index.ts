import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import getWorkspaceCalendarFinanceInstallments from "./controllers/get-finance-installments";
import getWorkspaceCalendarTasks from "./controllers/get-tasks";
import {
  workspaceCalendarInstallmentsSchema,
  workspaceCalendarTasksSchema,
} from "./response";
import { workspaceCalendarQuery } from "./schema";

const listCalendarTasksRoute = createRoute({
  method: "get",
  operationId: "listWorkspaceCalendarTasks",
  path: "/tasks",
  tags: ["Workspace calendar"],
  summary: "List workspace calendar tasks",
  description:
    "Tasks with a start or due date across every non-archived project in " +
    "the workspace, for the global calendar (Visão geral > Calendário).",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: workspaceCalendarQuery },
  responses: {
    200: jsonResponse("Workspace calendar tasks", workspaceCalendarTasksSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
  },
});

const listCalendarInstallmentsRoute = createRoute({
  method: "get",
  operationId: "listWorkspaceCalendarFinanceInstallments",
  path: "/finance-installments",
  tags: ["Workspace calendar"],
  summary: "List workspace calendar finance installments",
  description:
    "Finance installments (parcelas) across every non-archived project in " +
    "the workspace, for the global calendar (Visão geral > Calendário).",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: workspaceCalendarQuery },
  responses: {
    200: jsonResponse(
      "Workspace calendar finance installments",
      workspaceCalendarInstallmentsSchema,
    ),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
  },
});

const workspaceCalendar = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listCalendarTasksRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const tasks = await getWorkspaceCalendarTasks(workspaceId, c.get("userId"));
    return c.json(tasks, 200);
  })
  .openapi(listCalendarInstallmentsRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const installments = await getWorkspaceCalendarFinanceInstallments(
      workspaceId,
      c.get("userId"),
    );
    return c.json(installments, 200);
  });

export default workspaceCalendar;
