import { z } from "../openapi";

export const projectAccessParams = z.object({ projectId: z.string() });
export const projectAccessMemberParams = z.object({
  projectId: z.string(),
  userId: z.string(),
});

export const updateProjectAccessBody = z.object({
  canView: z.boolean(),
  canPay: z.boolean(),
  canAttach: z.boolean(),
});
