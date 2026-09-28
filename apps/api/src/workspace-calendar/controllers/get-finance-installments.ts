import { and, eq, isNull, notInArray } from "drizzle-orm";
import db from "../../database";
import {
  projectInstallmentTable,
  projectLabelTable,
  projectPaymentLineTable,
  projectTable,
} from "../../database/schema";
import { hiddenProjectIds } from "../../project-access";
import { getFinanceToday } from "../../project-finance/dates";

/**
 * Parcelas do Financeiro de todos os projetos não arquivados do workspace,
 * para o calendário global. Junção direta project_installment ->
 * project_payment_line -> project (+ project_label): `project_installment`
 * já é persistida, então não precisa recalcular o `buildFinanceState`
 * inteiro de cada projeto.
 */
async function getWorkspaceCalendarFinanceInstallments(
  workspaceId: string,
  userId?: string,
) {
  const hidden = userId ? await hiddenProjectIds(userId, workspaceId) : [];
  const today = getFinanceToday();

  const rows = await db
    .select({
      id: projectInstallmentTable.id,
      supplier: projectPaymentLineTable.supplier,
      dueDate: projectInstallmentTable.dueDate,
      expectedCents: projectInstallmentTable.expectedCents,
      paidAt: projectInstallmentTable.paidAt,
      projectId: projectTable.id,
      projectName: projectTable.name,
      projectLabelId: projectLabelTable.id,
      projectLabelName: projectLabelTable.name,
    })
    .from(projectInstallmentTable)
    .innerJoin(
      projectPaymentLineTable,
      eq(projectInstallmentTable.lineId, projectPaymentLineTable.id),
    )
    .innerJoin(
      projectTable,
      eq(projectPaymentLineTable.projectId, projectTable.id),
    )
    .leftJoin(projectLabelTable, eq(projectTable.labelId, projectLabelTable.id))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.archivedAt),
        hidden.length > 0 ? notInArray(projectTable.id, hidden) : undefined,
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    supplier: row.supplier,
    dueDate: row.dueDate,
    expectedCents: row.expectedCents,
    status: (row.paidAt !== null
      ? "paid"
      : row.dueDate < today
        ? "overdue"
        : "pending") as "paid" | "overdue" | "pending",
    projectId: row.projectId,
    projectName: row.projectName,
    projectLabel: row.projectLabelId
      ? { id: row.projectLabelId, name: row.projectLabelName ?? "" }
      : null,
  }));
}

export default getWorkspaceCalendarFinanceInstallments;
