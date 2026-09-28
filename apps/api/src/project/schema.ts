import { z } from "../openapi";
import {
  centsSchema,
  installmentsCountSchema,
  isoDateSchema,
} from "../project-finance/schema";

export const projectParam = z.object({ id: z.string() });

export const projectStatusSchema = z.enum([
  "notStarted",
  "inProgress",
  "complete",
]);

export const updateProjectStatusBody = z.object({
  status: projectStatusSchema,
});

export const workspaceIdQuery = z.object({ workspaceId: z.string() });

export const listProjectsQuery = z.object({
  workspaceId: z.string(),
  includeArchived: z.string().optional().openapi({
    description: 'Pass "true" to include archived projects in the list.',
  }),
});

export const createProjectBody = z.object({
  name: z.string(),
  workspaceId: z.string(),
  icon: z.string(),
  slug: z.string(),
  description: z.string().max(10_000).optional(),
  // Financeiro (todos opcionais; projetos antigos e clientes antigos seguem valendo).
  financeTotalCents: centsSchema.optional().openapi({
    description: "Total do projeto, em centavos.",
  }),
  financeMonths: installmentsCountSchema.optional().openapi({
    description: "Quantidade de meses (parcelas) a pagar.",
  }),
  financeFirstDueDate: isoDateSchema.optional().openapi({
    description: "Vencimento da 1ª parcela (AAAA-MM-DD).",
  }),
  label: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .openapi({
      description:
        "Etiqueta do projeto (fundo/categoria, ex.: FIA, FMI, Educação). " +
        "Diferente das etiquetas de orçamento do financeiro. Reaproveita uma " +
        "já cadastrada no workspace pelo nome, ou cria uma nova.",
    }),
});

export const updateProjectBody = z.object({
  name: z.string(),
  icon: z.string(),
  slug: z.string(),
  description: z.string(),
  isPublic: z.boolean(),
  // Ausente: não altera a etiqueta atual. null: remove a etiqueta. String:
  // reaproveita (ou cria) a etiqueta com esse nome no catálogo do workspace.
  label: z.string().trim().min(1).max(80).nullable().optional().openapi({
    description:
      "Etiqueta do projeto (fundo/categoria). Omitir mantém a atual; null remove.",
  }),
});

export const reorderProjectsBody = z.object({
  // Positions express a relative order only; the controller renumbers the
  // workspace to 0..n-1, so the values just have to be sane.
  projects: z
    .array(z.object({ id: z.string(), position: z.number().int().min(0) }))
    .min(1),
});
