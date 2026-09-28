import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";
import { getApiUrl } from "../get-api-url";

export type FinanceFilePurpose = "project" | "receipt" | "invoice";

export type FinanceFileItem = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
};

export type FinanceParcelFile = FinanceFileItem & {
  installmentId: string | null;
  supplier: string | null;
  paidAt: string | null;
  undoneAt: string | null;
  undoneByName: string | null;
  drive: "pending" | "copied" | "failed" | null;
};

export type FinanceFiles = {
  projectFiles: FinanceFileItem[];
  paidInstallments: number;
  filesCount: number;
  parcels: Array<{
    label: string;
    number: number;
    dueDate: string | null;
    files: FinanceParcelFile[];
  }>;
  undone: FinanceParcelFile[];
};

export type UploadedFinanceFile = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  purpose: FinanceFilePurpose;
};

/** Erro de arquivo com o código estável que a API devolve (vira texto traduzido). */
export class FinanceFileRequestError extends HttpError {
  code: string | null;

  constructor(status: number, message: string, code: string | null) {
    super(status, message);
    this.name = "FinanceFileRequestError";
    this.code = code;
  }
}

/** Tipos aceitos no seletor (a API confere de novo pelo conteúdo). */
export const FINANCE_PAYMENT_FILE_ACCEPT =
  "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png";
export const FINANCE_PROJECT_FILE_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

export function financeAssetUrl(assetId: string) {
  return getApiUrl(`asset/${encodeURIComponent(assetId)}`);
}

export function financeParcelZipUrl(projectId: string, number: number) {
  return getApiUrl(
    `project-finance/${encodeURIComponent(projectId)}/files/parcels/${number}/zip`,
  );
}

export async function getFinanceFiles(
  projectId: string,
): Promise<FinanceFiles> {
  const response = await client["project-finance"][":projectId"].files.$get({
    param: { projectId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()) as FinanceFiles;
}

/**
 * Envia os bytes crus pela API (ela confere o conteúdo antes de guardar).
 * Não usamos o cliente tipado porque o corpo é binário, não JSON.
 */
export async function uploadFinanceFile(
  projectId: string,
  purpose: FinanceFilePurpose,
  file: File,
): Promise<UploadedFinanceFile> {
  const query = new URLSearchParams({ purpose, filename: file.name });
  const response = await fetch(
    getApiUrl(
      `project-finance/${encodeURIComponent(projectId)}/files?${query.toString()}`,
    ),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    },
  );
  if (!response.ok) {
    let message = response.statusText;
    let code: string | null = null;
    try {
      const body = (await response.json()) as {
        message?: unknown;
        code?: unknown;
      };
      if (typeof body.message === "string") message = body.message;
      if (typeof body.code === "string") code = body.code;
    } catch {
      // resposta sem JSON: fica o statusText
    }
    throw new FinanceFileRequestError(response.status, message, code);
  }
  return (await response.json()) as UploadedFinanceFile;
}

export async function deleteProjectAttachment(
  projectId: string,
  assetId: string,
): Promise<void> {
  const response = await client["project-finance"][":projectId"].files[
    ":assetId"
  ].$delete({ param: { projectId, assetId } });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
}
