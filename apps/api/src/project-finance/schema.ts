import { z } from "../openapi";
import { isValidIsoDate } from "./dates";
import { MAX_MONEY_CENTS } from "./recalculate";

export const MAX_INSTALLMENTS = 600;

export const isoDateSchema = z
  .string()
  .refine(isValidIsoDate, { message: "Invalid date, expected YYYY-MM-DD" })
  .openapi({ format: "date", example: "2026-09-30" });

export const centsSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_MONEY_CENTS)
  .openapi({ description: "Valor em centavos (inteiro)." });

export const installmentsCountSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_INSTALLMENTS);

export const projectIdParam = z.object({ projectId: z.string() });
export const tagIdParam = z.object({ tagId: z.string() });
export const lineIdParam = z.object({ lineId: z.string() });
export const installmentIdParam = z.object({ installmentId: z.string() });

export const forceQuery = z.object({
  force: z.enum(["true", "false"]).optional().openapi({
    description:
      'Passe "true" para confirmar a exclusão mesmo com itens em uso/pagos.',
  }),
});

export const updateFinanceSettingsBody = z.object({
  financeTotalCents: centsSchema.nullable().optional(),
  financeMonths: installmentsCountSchema.nullable().optional(),
  financeFirstDueDate: isoDateSchema.nullable().optional(),
});

const tagName = z.string().trim().min(1).max(120);
const tagDescription = z.string().trim().max(2000).nullable();

export const createTagBody = z.object({
  name: tagName,
  description: tagDescription.optional(),
  valueCents: centsSchema.optional(),
});

export const updateTagBody = z.object({
  name: tagName.optional(),
  description: tagDescription.optional(),
  valueCents: centsSchema.optional(),
});

const supplier = z.string().trim().min(1).max(200);

const isFixedAmountField = z
  .boolean()
  .optional()
  .default(true)
  .openapi({
    description:
      "true (padrão) = valor de cada parcela fixo, informado por totalCents/installmentsCount. " +
      "false = linha automática (Atualização 3): usa finalDueDate em vez de installmentsCount/totalCents; " +
      "o valor de cada parcela é calculado a partir da sobra do orçamento da tag.",
  });

const finalDueDateField = isoDateSchema.optional().openapi({
  description:
    "Só para linha automática (isFixedAmount=false): data da última parcela. " +
    "A quantidade de parcelas é a diferença de meses entre firstDueDate e finalDueDate (inclusive).",
});

export const createLineBody = z
  .object({
    supplier,
    tagId: z.string().nullable().optional(),
    isFixedAmount: isFixedAmountField,
    totalCents: centsSchema.optional().openapi({
      description: "Obrigatório quando isFixedAmount=true (padrão).",
    }),
    installmentsCount: installmentsCountSchema.optional().openapi({
      description:
        "Se omitido (linha fixa), usa financeMonths do projeto. Ignorado em linha automática.",
    }),
    firstDueDate: isoDateSchema.optional().openapi({
      description: "Se omitido, usa financeFirstDueDate do projeto.",
    }),
    finalDueDate: finalDueDateField,
  })
  .superRefine((body, ctx) => {
    if (body.isFixedAmount === false) {
      if (!body.tagId) {
        ctx.addIssue({
          code: "custom",
          message: "Linha automática precisa de uma etiqueta (tagId)",
          path: ["tagId"],
        });
      }
      if (body.finalDueDate === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "finalDueDate é obrigatório quando isFixedAmount é false",
          path: ["finalDueDate"],
        });
      }
    } else if (body.totalCents === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "totalCents é obrigatório quando isFixedAmount é true",
        path: ["totalCents"],
      });
    }
  });

export const updateLineBody = z
  .object({
    supplier: supplier.optional(),
    tagId: z.string().nullable().optional(),
    isFixedAmount: z.boolean().optional(),
    totalCents: centsSchema.optional(),
    installmentsCount: installmentsCountSchema.optional(),
    firstDueDate: isoDateSchema.optional(),
    finalDueDate: finalDueDateField,
  })
  .superRefine((body, ctx) => {
    if (body.isFixedAmount === false && body.finalDueDate === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "finalDueDate é obrigatório ao mudar a linha para automática",
        path: ["finalDueDate"],
      });
    }
  });

export const MAX_PAYMENTS_PER_SAVE = 500;
export const MAX_ATTACHMENTS_PER_PAYMENT = 20;

const assetIdListField = z
  .array(z.string().min(1))
  .min(1)
  .max(MAX_ATTACHMENTS_PER_PAYMENT);

export const saveFinanceBody = z.object({
  version: z.string().min(1).max(200).openapi({
    description: "Valor de `version` do último GET; se mudou, responde 409.",
  }),
  payments: z
    .array(
      z.object({
        installmentId: z.string(),
        paidCents: centsSchema,
        paidAt: isoDateSchema,
        receiptAssetIds: assetIdListField.openapi({
          description:
            "Comprovantes de pagamento: ids devolvidos pelo envio com purpose=receipt, na ordem em que devem aparecer no PDF final. Ao menos 1.",
        }),
        invoiceAssetIds: assetIdListField.openapi({
          description:
            "Notas fiscais/boletos: ids devolvidos pelo envio com purpose=invoice, na ordem em que devem aparecer no PDF final. Ao menos 1. O servidor junta todos os comprovantes, depois todas as notas, num PDF único.",
        }),
      }),
    )
    .min(1)
    .max(MAX_PAYMENTS_PER_SAVE),
});

export const uploadFileQuery = z.object({
  purpose: z.enum(["project", "receipt", "invoice"]).openapi({
    description:
      "project = anexo do projeto; receipt = comprovante de pagamento; invoice = nota fiscal.",
  }),
  filename: z.string().trim().min(1).max(255).openapi({
    description: "Nome original do arquivo (só serve para dar nome ao anexo).",
  }),
});

export const projectFileParam = z.object({
  projectId: z.string(),
  assetId: z.string(),
});

export const parcelZipParam = z.object({
  projectId: z.string(),
  number: z.coerce.number().int().min(1).max(MAX_INSTALLMENTS),
});
