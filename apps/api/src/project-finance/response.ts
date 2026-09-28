import { z } from "../openapi";

const cents = (description: string) =>
  z.number().int().openapi({ description });

const isoDate = (description: string) =>
  z.string().openapi({ format: "date", example: "2026-09-30", description });

export const financeInstallmentSchema = z
  .object({
    id: z.string(),
    number: z
      .number()
      .int()
      .openapi({ description: "Posição na linha, a partir de 1." }),
    dueDate: isoDate("Vencimento (AAAA-MM-DD)."),
    expectedCents: cents("Valor previsto em centavos."),
    paidAt: isoDate("Data do pagamento (AAAA-MM-DD).").nullable(),
    paidCents: cents("Valor efetivamente pago, em centavos.").nullable(),
    paidBy: z
      .string()
      .nullable()
      .openapi({ description: "Id do usuário que marcou como paga." }),
    fileAssetId: z.string().nullable().openapi({
      description:
        "PDF único (comprovante + NF). Preenchido a partir da Fase 4.",
    }),
    isFinalStretch: z.boolean().openapi({
      description:
        "Uma das 3 últimas parcelas da linha (linha com até 3 parcelas: todas).",
    }),
    status: z.enum(["paid", "overdue", "pending"]).openapi({
      description:
        "paid = paga; overdue = não paga e vencida antes de `asOf`; pending = não paga em dia.",
    }),
  })
  .openapi("FinanceInstallment");

export const financeLineSchema = z
  .object({
    id: z.string(),
    supplier: z.string(),
    tag: z.object({ id: z.string(), name: z.string() }).nullable(),
    isFixedAmount: z.boolean().openapi({
      description:
        "true = valor de cada parcela fixo (informado); false = linha automática, cujo valor é a fatia da sobra da tag.",
    }),
    totalCents: cents(
      "Total da linha, em centavos (soma das parcelas; calculado, nunca digitado).",
    ),
    installmentsCount: z.number().int(),
    firstDueDate: isoDate("Vencimento da 1ª parcela."),
    position: z.number().int(),
    paidCents: cents("Soma do valor pago nas parcelas pagas."),
    remainingCents: cents("max(0, totalCents - paidCents)."),
    warning: z.enum(["paid_reached_total"]).nullable().openapi({
      description:
        "paid_reached_total: o total pago alcançou ou passou o total da linha; as parcelas restantes valem 0.",
    }),
    installments: z.array(financeInstallmentSchema),
  })
  .openapi("FinanceLine");

export const financeTagSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    valueCents: cents("Valor da tag (orçamento da categoria), em centavos."),
    position: z.number().int(),
    linesCount: z.number().int(),
    linesTotalCents: cents("Soma dos totais das linhas com esta tag."),
    paidCents: cents("Soma paga nas linhas com esta tag."),
    paidBasisPoints: z.number().int().openapi({
      description:
        "paidCents / valueCents em pontos-base (10000 = 100,00%), arredondado para baixo; 0 se valueCents = 0. Pode passar de 10000.",
    }),
  })
  .openapi("FinanceTag");

export const financeStateSchema = z
  .object({
    version: z.string().openapi({
      description:
        "Token opaco de concorrência otimista: mude-o de volta em POST /save. Muda a cada alteração de dados do financeiro do projeto.",
    }),
    asOf: isoDate(
      "Data de hoje em America/Sao_Paulo (ou FINANCE_TODAY, para testes/simulação).",
    ),
    project: z.object({
      id: z.string(),
      name: z.string(),
      totalCents: cents("Total do projeto informado no cadastro.").nullable(),
      months: z.number().int().nullable(),
      firstDueDate: isoDate(
        "Data da 1ª parcela informada no cadastro.",
      ).nullable(),
    }),
    tags: z.array(financeTagSchema),
    lines: z.array(financeLineSchema),
    totals: z.object({
      projectTotalCents: cents("Soma dos totais das linhas."),
      paidCents: cents("Soma paga em todas as linhas."),
      remainingCents: cents("Soma dos restantes por linha (nunca negativo)."),
      executedBasisPoints: z.number().int().openapi({
        description:
          "paidCents / projectTotalCents em pontos-base (10000 = 100,00%).",
      }),
      openInstallments: z.number().int(),
      overdueInstallments: z.number().int(),
      nextDueDate: isoDate(
        "Menor vencimento, a partir de `asOf`, entre as parcelas não pagas.",
      ).nullable(),
      tagsCount: z.number().int(),
    }),
    finalStretch: z.object({
      active: z.boolean().openapi({
        description:
          "Verdadeiro desde a data de referência (vencimento da antepenúltima parcela do projeto) até todas as parcelas estarem pagas.",
      }),
      referenceDate: isoDate("Data em que a reta final começa.").nullable(),
      lastDueDate: isoDate("Último vencimento do projeto.").nullable(),
      alertMonths: z.array(z.string()).openapi({
        description: "Os 3 últimos meses de vencimento (AAAA-MM).",
      }),
      currentMonth: z.string().nullable().openapi({
        description: "AAAA-MM corrente enquanto ativo; chave do aviso mensal.",
      }),
      lastNotice: z
        .object({
          month: z.string().openapi({ example: "2026-09" }),
          sentAt: z
            .string()
            .openapi({ description: "Instante do envio (ISO)." }),
          channels: z.array(z.string()).openapi({
            description:
              "Canais que entregaram: app, email, ntfy, gotify, webhook.",
          }),
          recipients: z.number().int(),
        })
        .nullable()
        .openapi({
          description:
            "Último aviso mensal de reta final enviado (histórico do projeto).",
        }),
    }),
  })
  .openapi("FinanceState");

export type FinanceState = z.infer<typeof financeStateSchema>;

export const financeTagCatalogSchema = z
  .object({
    tags: z.array(z.object({ id: z.string(), name: z.string() })).openapi({
      description:
        "Nomes de etiqueta já usados em algum projeto deste workspace, em ordem alfabética (para sugerir/reaproveitar ao criar uma nova).",
    }),
  })
  .openapi("FinanceTagCatalog");

export const financeVersionConflictSchema = z
  .object({ message: z.string(), state: financeStateSchema })
  .openapi("FinanceVersionConflict");

export const financeTagInUseSchema = z
  .object({
    message: z.string(),
    code: z.literal("TAG_IN_USE"),
    linesInUse: z.number().int(),
  })
  .openapi("FinanceTagInUse");

export const financeLineHasPaymentsSchema = z
  .object({
    message: z.string(),
    code: z.literal("LINE_HAS_PAYMENTS"),
    paidInstallments: z.number().int(),
  })
  .openapi("FinanceLineHasPayments");

export const financeFileItemSchema = z
  .object({
    id: z.string().openapi({
      description:
        "Id do arquivo. Baixe por GET /asset/{id}; o download exige finance:read.",
    }),
    name: z.string(),
    size: z.number().int(),
    mimeType: z.string(),
    createdAt: z.string(),
  })
  .openapi("FinanceFileItem");

export const financeParcelFileSchema = financeFileItemSchema
  .extend({
    installmentId: z.string().nullable(),
    supplier: z.string().nullable(),
    paidAt: isoDate("Data do pagamento.").nullable(),
    undoneAt: z.string().nullable(),
    undoneByName: z.string().nullable(),
    drive: z.enum(["pending", "copied", "failed"]).nullable().openapi({
      description:
        "Cópia no Google Drive (opcional). Nulo se o Drive não está ligado.",
    }),
  })
  .openapi("FinanceParcelFile");

export const financeFilesSchema = z
  .object({
    projectFiles: z.array(financeFileItemSchema),
    paidInstallments: z.number().int(),
    filesCount: z.number().int(),
    parcels: z.array(
      z.object({
        label: z.string().openapi({ example: "Parcela 8 - 09-2026" }),
        number: z.number().int(),
        dueDate: isoDate("Vencimento.").nullable(),
        files: z.array(financeParcelFileSchema),
      }),
    ),
    undone: z.array(financeParcelFileSchema).openapi({
      description:
        "PDFs de pagamentos desfeitos (só vem preenchido para quem tem finance:undo).",
    }),
  })
  .openapi("FinanceFiles");

export const financeUploadedFileSchema = z
  .object({
    id: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    size: z.number().int(),
    purpose: z.enum(["project", "receipt", "invoice"]),
  })
  .openapi("FinanceUploadedFile");

export const financeFileErrorSchema = z
  .object({
    message: z.string(),
    code: z.string().openapi({
      description:
        "FILE_EMPTY, FILE_TOO_LARGE, FILE_TYPE_UNSUPPORTED, FILE_NEEDS_CONVERSION, PDF_ENCRYPTED, PDF_CORRUPT, IMAGE_CORRUPT, FILE_NOT_FOUND, FILE_NOT_ALLOWED, STORAGE_UNAVAILABLE.",
    }),
  })
  .openapi("FinanceFileError");
