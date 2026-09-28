import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { boardColumnSchema, boardTaskSchema } from "../task/response";
import { projectStatusSchema } from "./schema";

export const projectSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    slug: z.string().openapi({
      description: "Short prefix used in task identifiers, e.g. KAN-12.",
    }),
    icon: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: responseTimestamp,
    isPublic: z.boolean().nullable().openapi({
      description:
        "When true the project's board is readable without signing in, via /api/public-project/{id}.",
    }),
    archivedAt: nullableResponseTimestamp.openapi({
      description:
        "Non-null once archived; archived projects are hidden by default.",
    }),
    position: z.number().openapi({ description: "Sidebar order, ascending." }),
    lastTaskNumber: z.number().openapi({
      description:
        "Highest task number issued in this project; the next task gets this plus one.",
    }),
    financeTotalCents: z.number().int().nullable().openapi({
      description: "Finance: total do projeto em centavos, se informado.",
    }),
    financeMonths: z.number().int().nullable().openapi({
      description: "Finance: quantidade de meses a pagar, se informada.",
    }),
    financeFirstDueDate: z.string().nullable().openapi({
      format: "date",
      description:
        "Finance: vencimento da 1ª parcela (AAAA-MM-DD), se informado.",
    }),
    status: projectStatusSchema.openapi({
      description:
        "Status manual do Kanban de projetos (arrastável), independente do " +
        "progresso calculado a partir das tarefas.",
    }),
    label: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .openapi({
        description:
          "Etiqueta do projeto (fundo/categoria), se houver. Não confundir " +
          "com as etiquetas de orçamento do financeiro.",
      }),
  })
  .openapi("Project");

export const projectLabelCatalogEntrySchema = z
  .object({ id: z.string(), name: z.string() })
  .openapi("ProjectLabelCatalogEntry");

export const projectLabelCatalogSchema = z.array(
  projectLabelCatalogEntrySchema,
);

export const projectStatisticsSchema = z
  .object({
    completionPercentage: z.number(),
    totalTasks: z.number(),
    dueDate: nullableResponseTimestamp.openapi({
      description: "The soonest due date among the project's open tasks.",
    }),
  })
  .openapi("ProjectStatistics");

export const projectListItemSchema = projectSchema
  .extend({
    statistics: projectStatisticsSchema,
    financeEndDate: z
      .string()
      .nullable()
      .openapi({
        format: "date",
        description:
          "Vencimento da última parcela do cronograma financeiro (todas as " +
          "linhas de pagamento), se houver alguma parcela lançada.",
      }),
    hasOverdueFinanceInstallment: z.boolean().openapi({
      description:
        "true se alguma parcela do financeiro está vencida e não paga.",
    }),
    // Legacy, always empty. Fetch the board via GET /task/tasks/{id}.
    archivedTasks: z
      .array(boardTaskSchema)
      .openapi({ description: "Always empty." }),
    plannedTasks: z
      .array(boardTaskSchema)
      .openapi({ description: "Always empty." }),
    columns: z
      .array(boardColumnSchema)
      .openapi({ description: "Always empty." }),
  })
  .openapi("ProjectListItem");

export const projectListSchema = z.array(projectListItemSchema);
