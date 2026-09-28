import { z } from "../openapi";

export const saveCredentialsBody = z.object({
  clientId: z.string().trim().min(10).max(300),
  // Vazio = manter o segredo já guardado (o segredo nunca volta para a tela).
  clientSecret: z.string().trim().min(5).max(300).optional(),
});

export const retryCopyBody = z.object({ assetId: z.string().min(1) });

export const callbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});
