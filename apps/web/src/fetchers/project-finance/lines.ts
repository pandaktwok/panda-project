import { client } from "@kaneo/libs";
import { readFinanceResponse } from "./request";

export type LineInput = {
  supplier: string;
  tagId: string | null;
  firstDueDate: string;
  /** true (padrão) = valor fixo por parcela, como hoje; false = linha
   * automática (Atualização 3): valor calculado a partir da sobra da tag. */
  isFixedAmount?: boolean;
  /** Obrigatório quando isFixedAmount é true (ou omitido). */
  totalCents?: number;
  installmentsCount?: number;
  /** Obrigatório quando isFixedAmount é false: define a quantidade de
   * parcelas junto com firstDueDate (meses entre as duas datas, inclusive). */
  finalDueDate?: string;
};

export async function createProjectLine(projectId: string, input: LineInput) {
  const response = await client["project-finance"][":projectId"].lines.$post({
    param: { projectId },
    json: input,
  });
  return readFinanceResponse(response as unknown as Response);
}

export async function updateProjectLine(
  lineId: string,
  input: Partial<LineInput>,
) {
  const response = await client["project-finance"].lines[":lineId"].$put({
    param: { lineId },
    json: input,
  });
  return readFinanceResponse(response as unknown as Response);
}

export async function deleteProjectLine(lineId: string, force = false) {
  const response = await client["project-finance"].lines[":lineId"].$delete({
    param: { lineId },
    query: force ? { force: "true" } : {},
  });
  return readFinanceResponse(response as unknown as Response);
}
