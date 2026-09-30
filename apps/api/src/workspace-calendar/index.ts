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
import getWorkspaceWidgetSummary from "./controllers/get-widget-summary";
import {
  workspaceCalendarInstallmentsSchema,
  workspaceCalendarTasksSchema,
  workspaceWidgetSummarySchema,
} from "./response";
import { workspaceCalendarQuery, workspaceWidgetSummaryQuery } from "./schema";

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

const widgetSummaryRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceWidgetSummary",
  path: "/widget-summary",
  tags: ["Workspace calendar"],
  summary: "Get the desktop widget summary",
  description:
    "Everything the desktop widget shows in one call: next scheduled " +
    "payment, overdue payments, projects created in the last 3 months, " +
    "newly created tasks and a calendar window of installments and tasks.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: workspaceWidgetSummaryQuery },
  responses: {
    200: jsonResponse("Widget summary", workspaceWidgetSummarySchema),
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
  })
  .openapi(widgetSummaryRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const { newTasksDays } = c.req.valid("query");
    const summary = await getWorkspaceWidgetSummary(
      workspaceId,
      c.get("userId"),
      newTasksDays,
    );
    return c.json(summary, 200);
  });

export default workspaceCalendar;
