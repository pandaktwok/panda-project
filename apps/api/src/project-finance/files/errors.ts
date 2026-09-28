import { HTTPException } from "hono/http-exception";

export type FinanceFileErrorCode =
  | "FILE_EMPTY"
  | "FILE_TOO_LARGE"
  | "FILE_TYPE_UNSUPPORTED"
  | "FILE_NEEDS_CONVERSION"
  | "PDF_ENCRYPTED"
  | "PDF_CORRUPT"
  | "IMAGE_CORRUPT"
  | "FILE_NOT_FOUND"
  | "FILE_NOT_ALLOWED"
  | "STORAGE_UNAVAILABLE";

/** Erro com `code` estável no corpo: a tela traduz pelo código, não pelo texto. */
export class FinanceFileError extends HTTPException {
  code: FinanceFileErrorCode;

  constructor(
    status: 400 | 403 | 404 | 413 | 415 | 422 | 503,
    code: FinanceFileErrorCode,
    message: string,
  ) {
    super(status, {
      message,
      res: Response.json({ message, code }, { status }),
    });
    this.code = code;
  }
}
