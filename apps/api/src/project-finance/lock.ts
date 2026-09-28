import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { getFinanceToday } from "./dates";
import type { FinanceState } from "./response";
import { buildFinanceState, loadFinanceRows, type Tx } from "./state";

/**
 * Transação com trava por projeto. Toda escrita do financeiro (tags, linhas,
 * salvar em lote, desfazer) passa por aqui: escritas no mesmo projeto se
 * enfileiram e o token `version` lido dentro da trava é confiável.
 * Chave 1525 (a 1524 é a ordenação de projetos por workspace).
 */
export async function withProjectFinanceLock<T>(
  projectId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(1525, hashtext(${projectId}))`,
    );
    return fn(tx);
  });
}

/** Estado completo dentro de uma transação (já com a trava, nas escritas). */
export async function readFinanceState(
  tx: Tx,
  projectId: string,
): Promise<FinanceState | null> {
  const rows = await loadFinanceRows(tx, projectId);
  return rows ? buildFinanceState(rows, getFinanceToday()) : null;
}

export async function readFinanceStateOrThrow(
  tx: Tx,
  projectId: string,
): Promise<FinanceState> {
  const state = await readFinanceState(tx, projectId);
  if (!state) throw new HTTPException(404, { message: "Project not found" });
  return state;
}

/** Leitura consistente (um único snapshot) sem trava. */
export async function getFinanceState(
  projectId: string,
): Promise<FinanceState | null> {
  return db.transaction((tx) => readFinanceState(tx, projectId), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}
