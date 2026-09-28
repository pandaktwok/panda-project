import { z } from "../openapi";

export const workspaceCalendarQuery = z.object({ workspaceId: z.string() });
