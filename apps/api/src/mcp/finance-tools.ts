import { z } from "zod";
import { getMaxFinanceFileBytes } from "../storage/s3";
import type { McpToolResult } from "./tools";

// Ferramentas do módulo Financeiro (Panda Project). Cada uma declara se é de
// leitura, edição ou pagamento; a regra de verdade é aplicada na API pelo token
// (ver ai-connection/access.ts), então uma ferramenta nunca faz mais do que o
// administrador que autorizou a IA poderia fazer.
export const FINANCE_TOOL_KINDS = {
  get_project_finance: "read",
  list_project_tags: "read",
  create_finance_tag: "edit",
  update_finance_tag: "edit",
  delete_finance_tag: "edit",
  create_finance_line: "edit",
  update_finance_line: "edit",
  delete_finance_line: "edit",
  update_finance_project_settings: "edit",
  mark_installment_paid: "pay",
  undo_installment_payment: "pay",
} as const;

type FinanceToolName = keyof typeof FINANCE_TOOL_KINDS;

const KIND_LABEL = {
  read: "[LEITURA]",
  edit: "[EDIÇÃO - exige a chave 'IA pode editar']",
  pay: "[PAGAMENTO - exige a chave 'IA pode registrar pagamentos']",
} as const;

type FinanceToolDeps = {
  client: {
    json<T = unknown>(path: string, init?: RequestInit): Promise<T>;
  };
  register: <InputSchema extends z.ZodObject>(
    name: string,
    config: { description: string; inputSchema: InputSchema },
    callback: (args: z.output<InputSchema>) => Promise<McpToolResult>,
  ) => unknown;
  run: (fn: () => Promise<unknown>) => Promise<McpToolResult>;
  errorResult: (message: string) => McpToolResult;
};

const id = z.string().trim().min(1);
const cents = z
  .number()
  .int()
  .min(0)
  .describe("Valor em centavos (inteiro). R$ 1.234,56 = 123456.");
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a data no formato AAAA-MM-DD");

const fileInput = z
  .object({
    base64: z
      .string()
      .min(1)
      .describe("Conteúdo do arquivo em base64 (PDF, JPG ou PNG)."),
    filename: z.string().trim().min(1).max(255).describe("Nome do arquivo."),
  })
  .describe("Arquivo enviado agora.");

const FILE_TYPES = ["PDF", "JPG", "PNG"].join(", ");

type FileInput = z.infer<typeof fileInput>;

function decodeBase64(file: FileInput, label: string): Buffer {
  const max = getMaxFinanceFileBytes();
  // 4 caracteres de base64 carregam 3 bytes: recusa antes de decodificar.
  if (file.base64.length > Math.ceil((max * 4) / 3) + 8) {
    throw new Error(
      `${label}: arquivo maior que o limite de ${Math.floor(max / (1024 * 1024))} MB.`,
    );
  }
  const clean = file.base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new Error(`${label}: base64 inválido.`);
  }
  const bytes = Buffer.from(clean, "base64");
  if (bytes.length === 0) throw new Error(`${label}: arquivo vazio.`);
  if (bytes.length > max) {
    throw new Error(
      `${label}: arquivo maior que o limite de ${Math.floor(max / (1024 * 1024))} MB.`,
    );
  }
  return bytes;
}

export function registerFinanceTools({
  client,
  register,
  run,
  errorResult,
}: FinanceToolDeps): void {
  const tool = <InputSchema extends z.ZodObject>(
    name: FinanceToolName,
    description: string,
    inputSchema: InputSchema,
    callback: (args: z.output<InputSchema>) => Promise<McpToolResult>,
  ) =>
    register(
      name,
      {
        description: `${KIND_LABEL[FINANCE_TOOL_KINDS[name]]} ${description}`,
        inputSchema,
      },
      callback,
    );

  const path = (value: string) => encodeURIComponent(value);

  tool(
    "get_project_finance",
    "Financeiro de um projeto: tags, linhas de pagamento, parcelas (previstas, pagas, atrasadas), totais e a reta final. Valores em centavos, datas AAAA-MM-DD. Devolve também `version`, usada ao registrar pagamentos.",
    z.object({ projectId: id }),
    async (args) =>
      run(() => client.json(`/api/project-finance/${path(args.projectId)}`)),
  );

  tool(
    "list_project_tags",
    "Tags do financeiro de um projeto, com valor previsto e quanto já foi pago em cada uma.",
    z.object({ projectId: id }),
    async (args) =>
      run(async () => {
        const state = await client.json<{ tags: unknown[] }>(
          `/api/project-finance/${path(args.projectId)}`,
        );
        return state.tags;
      }),
  );

  tool(
    "create_finance_tag",
    "Cria uma tag no financeiro do projeto.",
    z.object({
      projectId: id,
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(2000).nullable().optional(),
      valueCents: cents.optional(),
    }),
    async ({ projectId, ...body }) =>
      run(() =>
        client.json(`/api/project-finance/${path(projectId)}/tags`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      ),
  );

  tool(
    "update_finance_tag",
    "Altera nome, descrição ou valor previsto de uma tag (só os campos enviados).",
    z.object({
      tagId: id,
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().max(2000).nullable().optional(),
      valueCents: cents.optional(),
    }),
    async ({ tagId, ...body }) =>
      run(() =>
        client.json(`/api/project-finance/tags/${path(tagId)}`, {
          method: "PUT",
          body: JSON.stringify(body),
        }),
      ),
  );

  tool(
    "delete_finance_tag",
    "Apaga uma tag. Se ela estiver em uso, a API recusa; com force=true confirma a exclusão.",
    z.object({ tagId: id, force: z.boolean().optional() }),
    async (args) =>
      run(() =>
        client.json(
          `/api/project-finance/tags/${path(args.tagId)}${args.force ? "?force=true" : ""}`,
          { method: "DELETE" },
        ),
      ),
  );

  tool(
    "create_finance_line",
    "Cria uma linha de pagamento (fornecedor + total + parcelas). Se installmentsCount ou firstDueDate faltarem, usa os meses e a data da 1ª parcela do projeto.",
    z.object({
      projectId: id,
      supplier: z.string().trim().min(1).max(200),
      totalCents: cents,
      tagId: z.string().nullable().optional(),
      installmentsCount: z.number().int().min(1).max(600).optional(),
      firstDueDate: isoDate.optional(),
    }),
    async ({ projectId, ...body }) =>
      run(() =>
        client.json(`/api/project-finance/${path(projectId)}/lines`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      ),
  );

  tool(
    "update_finance_line",
    "Altera uma linha de pagamento (só os campos enviados). Parcelas ainda não pagas são recalculadas.",
    z.object({
      lineId: id,
      supplier: z.string().trim().min(1).max(200).optional(),
      tagId: z.string().nullable().optional(),
      totalCents: cents.optional(),
      installmentsCount: z.number().int().min(1).max(600).optional(),
      firstDueDate: isoDate.optional(),
    }),
    async ({ lineId, ...body }) =>
      run(() =>
        client.json(`/api/project-finance/lines/${path(lineId)}`, {
          method: "PUT",
          body: JSON.stringify(body),
        }),
      ),
  );

  tool(
    "delete_finance_line",
    "Apaga uma linha de pagamento. Se houver parcelas pagas, a API recusa; com force=true confirma a exclusão.",
    z.object({ lineId: id, force: z.boolean().optional() }),
    async (args) =>
      run(() =>
        client.json(
          `/api/project-finance/lines/${path(args.lineId)}${args.force ? "?force=true" : ""}`,
          { method: "DELETE" },
        ),
      ),
  );

  tool(
    "update_finance_project_settings",
    "Atualiza o total do projeto (centavos), a quantidade de meses e/ou a data da 1ª parcela. Envie null para limpar um campo.",
    z.object({
      projectId: id,
      financeTotalCents: cents.nullable().optional(),
      financeMonths: z.number().int().min(1).max(600).nullable().optional(),
      financeFirstDueDate: isoDate.nullable().optional(),
    }),
    async ({ projectId, ...body }) =>
      run(() =>
        client.json(`/api/project-finance/${path(projectId)}/settings`, {
          method: "PUT",
          body: JSON.stringify(body),
        }),
      ),
  );

  const fileSource = (label: string) =>
    z
      .object({
        upload: fileInput.optional(),
        assetId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            "Id de um envio já feito para este projeto (purpose correspondente).",
          ),
      })
      .describe(
        `${label}: envie o arquivo em base64 (${FILE_TYPES}) OU informe o assetId de um envio já feito. Obrigatório.`,
      );

  tool(
    "mark_installment_paid",
    "Marca UMA parcela como paga, com valor pago, data e os DOIS arquivos obrigatórios: comprovante e nota fiscal. Sem os dois a chamada é recusada. O servidor junta os dois num PDF e recalcula as parcelas seguintes.",
    z.object({
      projectId: id,
      installmentId: id,
      paidCents: cents.refine(
        (v) => v > 0,
        "O valor pago deve ser maior que zero",
      ),
      paidAt: isoDate.describe("Data do pagamento, AAAA-MM-DD."),
      receipt: fileSource("Comprovante de pagamento"),
      invoice: fileSource("Nota fiscal"),
    }),
    async (args) => {
      const missing: string[] = [];
      if (!args.receipt.upload && !args.receipt.assetId) {
        missing.push("comprovante de pagamento");
      }
      if (!args.invoice.upload && !args.invoice.assetId) {
        missing.push("nota fiscal");
      }
      if (missing.length > 0) {
        return errorResult(
          `Recusado: falta ${missing.join(" e ")}. Comprovante e nota fiscal são obrigatórios para marcar uma parcela como paga.`,
        );
      }
      return run(async () => {
        const base = `/api/project-finance/${path(args.projectId)}`;
        const send = async (
          file: { upload?: FileInput; assetId?: string },
          purpose: "receipt" | "invoice",
          label: string,
        ) => {
          if (file.upload) {
            const bytes = decodeBase64(file.upload, label);
            const uploaded = await client.json<{ id: string }>(
              `${base}/files?purpose=${purpose}&filename=${encodeURIComponent(file.upload.filename)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: new Uint8Array(bytes),
              },
            );
            return uploaded.id;
          }
          return file.assetId as string;
        };
        const receiptAssetId = await send(
          args.receipt,
          "receipt",
          "Comprovante",
        );
        const invoiceAssetId = await send(
          args.invoice,
          "invoice",
          "Nota fiscal",
        );
        const current = await client.json<{ version: string }>(base);
        return client.json(`${base}/save`, {
          method: "POST",
          body: JSON.stringify({
            version: current.version,
            payments: [
              {
                installmentId: args.installmentId,
                paidCents: args.paidCents,
                paidAt: args.paidAt,
                receiptAssetIds: [receiptAssetId],
                invoiceAssetIds: [invoiceAssetId],
              },
            ],
          }),
        });
      });
    },
  );

  tool(
    "undo_installment_payment",
    "Desfaz o pagamento de uma parcela e recalcula as parcelas ainda em aberto da mesma linha.",
    z.object({ installmentId: id }),
    async (args) =>
      run(() =>
        client.json(
          `/api/project-finance/installments/${path(args.installmentId)}/undo`,
          { method: "POST" },
        ),
      ),
  );
}
