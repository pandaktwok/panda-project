import { processDriveQueue } from "../google-drive/mirror";

/** Retoma cópias pendentes (Drive fora do ar, espera entre tentativas). */
export async function runGoogleDriveCopy() {
  const result = await processDriveQueue();
  return { degraded: false, ...result };
}
