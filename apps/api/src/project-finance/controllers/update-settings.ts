import { eq } from "drizzle-orm";
import { projectTable } from "../../database/schema";
import { readFinanceStateOrThrow, withProjectFinanceLock } from "../lock";
import { type FinanceActor, publishFinanceUpdated } from "./common";

type Settings = {
  financeTotalCents?: number | null;
  financeMonths?: number | null;
  financeFirstDueDate?: string | null;
};

/** Ajusta os padrões do projeto. Não mexe em linhas nem parcelas já criadas. */
async function updateFinanceSettings(
  projectId: string,
  settings: Settings,
  actor: FinanceActor,
) {
  const state = await withProjectFinanceLock(projectId, async (tx) => {
    const patch: Settings = {};
    if (settings.financeTotalCents !== undefined)
      patch.financeTotalCents = settings.financeTotalCents;
    if (settings.financeMonths !== undefined)
      patch.financeMonths = settings.financeMonths;
    if (settings.financeFirstDueDate !== undefined)
      patch.financeFirstDueDate = settings.financeFirstDueDate;
    if (Object.keys(patch).length > 0) {
      await tx
        .update(projectTable)
        .set(patch)
        .where(eq(projectTable.id, projectId));
    }
    return readFinanceStateOrThrow(tx, projectId);
  });
  await publishFinanceUpdated(projectId, actor, "settings.updated");
  return state;
}

export default updateFinanceSettings;
