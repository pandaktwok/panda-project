import { HTTPException } from "hono/http-exception";
import { getFinanceState } from "../lock";

async function getFinance(projectId: string) {
  const state = await getFinanceState(projectId);
  if (!state) throw new HTTPException(404, { message: "Project not found" });
  return state;
}

export default getFinance;
