import { z } from "../openapi";

export const workspaceCalendarQuery = z.object({ workspaceId: z.string() });

export const workspaceWidgetSummaryQuery = workspaceCalendarQuery.extend({
  newTasksDays: z.coerce.number().int().min(1).max(90).default(7),
});
