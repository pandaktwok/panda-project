import { z } from "../openapi";

export const projectAccessEntrySchema = z
  .object({
    userId: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.string().openapi({ description: "owner, admin, member ou outro." }),
    /** Dono/administrador: sempre acesso total, não editável. */
    locked: z.boolean(),
    canView: z.boolean(),
    canPay: z.boolean(),
    canAttach: z.boolean(),
  })
  .openapi("ProjectAccessEntry");

export const projectAccessListSchema = z
  .object({ members: z.array(projectAccessEntrySchema) })
  .openapi("ProjectAccessList");
