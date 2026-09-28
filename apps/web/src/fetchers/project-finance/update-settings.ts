import { client } from "@kaneo/libs";
import { readFinanceResponse } from "./request";

export type FinanceSettingsInput = {
  financeTotalCents?: number | null;
  financeMonths?: number | null;
  financeFirstDueDate?: string | null;
};

async function updateProjectFinanceSettings(
  projectId: string,
  input: FinanceSettingsInput,
) {
  const response = await client["project-finance"][":projectId"].settings.$put({
    param: { projectId },
    json: input,
  });
  return readFinanceResponse(response as unknown as Response);
}

export default updateProjectFinanceSettings;
