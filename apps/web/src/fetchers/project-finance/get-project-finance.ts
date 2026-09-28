import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";
import type { FinanceState } from "./types";

async function getProjectFinance(projectId: string): Promise<FinanceState> {
  const response = await client["project-finance"][":projectId"].$get({
    param: { projectId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export default getProjectFinance;
