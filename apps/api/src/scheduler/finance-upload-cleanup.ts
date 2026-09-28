import { cleanupExpiredFinanceUploads } from "../project-finance/files/cleanup";
import { withJobLease } from "./leader-lock";

export const FINANCE_UPLOAD_CLEANUP_LEASE = "finance-upload-cleanup";

/** Apaga comprovantes/NF enviados e nunca usados (mais de 24 h). Um nó por vez. */
export async function runFinanceUploadCleanup(): Promise<{
  degraded: boolean;
}> {
  return withJobLease(
    FINANCE_UPLOAD_CLEANUP_LEASE,
    async () => {
      const { degraded } = await cleanupExpiredFinanceUploads();
      return { degraded };
    },
    () => ({ degraded: false }),
  );
}
