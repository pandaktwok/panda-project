import { client } from "@kaneo/libs";
import { readFinanceResponse } from "./request";

async function undoInstallmentPayment(installmentId: string) {
  const response = await client["project-finance"].installments[
    ":installmentId"
  ].undo.$post({ param: { installmentId } });
  return readFinanceResponse(response as unknown as Response);
}

export default undoInstallmentPayment;
