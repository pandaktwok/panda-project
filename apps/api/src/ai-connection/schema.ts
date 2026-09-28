import { z } from "../openapi";

export const aiConnectionIdParam = z.object({ id: z.string() });

export const updateAiConnectionBody = z
  .object({
    canPay: z.boolean().optional(),
    canEdit: z.boolean().optional(),
    name: z.string().trim().min(1).max(80).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Informe ao menos um campo.",
  });

export const aiHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
