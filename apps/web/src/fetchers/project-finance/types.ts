import type { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";

type FinanceClient = (typeof client)["project-finance"];

export type FinanceState = InferResponseType<
  FinanceClient[":projectId"]["$get"],
  200
>;
export type FinanceLine = FinanceState["lines"][number];
export type FinanceInstallment = FinanceLine["installments"][number];
export type FinanceTag = FinanceState["tags"][number];

/** Erro de salvamento com estado novo (409 por versão antiga). */
export class FinanceConflictError extends Error {
  state: FinanceState | null;
  code: string | null;
  linesInUse: number | null;
  paidInstallments: number | null;

  constructor(
    message: string,
    state: FinanceState | null,
    extra?: {
      code?: string;
      linesInUse?: number;
      paidInstallments?: number;
    },
  ) {
    super(message);
    this.name = "FinanceConflictError";
    this.state = state;
    this.code = extra?.code ?? null;
    this.linesInUse = extra?.linesInUse ?? null;
    this.paidInstallments = extra?.paidInstallments ?? null;
  }
}
