import type { TFunction } from "i18next";
import { FinanceFileRequestError } from "@/fetchers/project-finance/files";

const KNOWN_CODES = new Set([
  "FILE_EMPTY",
  "FILE_TOO_LARGE",
  "FILE_TYPE_UNSUPPORTED",
  "FILE_NEEDS_CONVERSION",
  "PDF_ENCRYPTED",
  "PDF_CORRUPT",
  "IMAGE_CORRUPT",
  "FILE_NOT_FOUND",
  "FILE_NOT_ALLOWED",
  "STORAGE_UNAVAILABLE",
]);

/** Texto traduzido para o código de erro da API; sem código, uma mensagem genérica. */
export function financeFileErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof FinanceFileRequestError) {
    if (error.code && KNOWN_CODES.has(error.code)) {
      return t(`finance:files.errors.${error.code}`);
    }
    if (error.status === 403) return t("finance:files.errors.FORBIDDEN");
  }
  return t("finance:files.errors.UNKNOWN");
}
