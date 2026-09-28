import { HttpError } from "@/lib/http-error";
import { FinanceFileRequestError } from "./files";
import { FinanceConflictError, type FinanceState } from "./types";

type MaybeJson = {
  message?: unknown;
  code?: unknown;
  state?: unknown;
  linesInUse?: unknown;
  paidInstallments?: unknown;
};

async function readJson(response: Response): Promise<MaybeJson | null> {
  const text = await response.text();
  try {
    return JSON.parse(text) as MaybeJson;
  } catch {
    return null;
  }
}

/**
 * Lê a resposta do financeiro: 2xx devolve o estado novo; 409 vira
 * FinanceConflictError (com o estado atual, se a API mandou); o resto vira
 * HttpError com a mensagem da API.
 */
export async function readFinanceResponse(
  response: Response,
): Promise<FinanceState> {
  if (response.ok) {
    return (await response.json()) as FinanceState;
  }
  const body = await readJson(response);
  const message =
    typeof body?.message === "string" ? body.message : response.statusText;
  if (response.status === 409) {
    throw new FinanceConflictError(
      message,
      (body?.state as FinanceState | undefined) ?? null,
      {
        code: typeof body?.code === "string" ? body.code : undefined,
        linesInUse:
          typeof body?.linesInUse === "number" ? body.linesInUse : undefined,
        paidInstallments:
          typeof body?.paidInstallments === "number"
            ? body.paidInstallments
            : undefined,
      },
    );
  }
  if (
    typeof body?.code === "string" &&
    /^(FILE|PDF|IMAGE|STORAGE)_/.test(body.code)
  ) {
    throw new FinanceFileRequestError(response.status, message, body.code);
  }
  throw new HttpError(response.status, message);
}
