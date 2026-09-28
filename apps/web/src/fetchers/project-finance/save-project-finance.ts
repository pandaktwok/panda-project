import { client } from "@kaneo/libs";
import { readFinanceResponse } from "./request";

export type SavePaymentInput = {
  installmentId: string;
  paidCents: number;
  paidAt: string;
  /** Na ordem em que devem aparecer no PDF final. Ao menos 1 de cada. */
  receiptAssetIds: string[];
  invoiceAssetIds: string[];
};

async function saveProjectFinance(input: {
  projectId: string;
  version: string;
  payments: SavePaymentInput[];
}) {
  const response = await client["project-finance"][":projectId"].save.$post({
    param: { projectId: input.projectId },
    json: { version: input.version, payments: input.payments },
  });
  return readFinanceResponse(response as unknown as Response);
}

export default saveProjectFinance;
