import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type DriveOpenCopy = {
  assetId: string;
  filename: string;
  projectName: string;
  status: "pending" | "copied" | "failed";
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
};

export type DriveStatus = {
  status: "disconnected" | "connected" | "error";
  hasCredentials: boolean;
  clientId: string | null;
  hasClientSecret: boolean;
  accountEmail: string | null;
  lastError: string | null;
  connectedAt: string | null;
  redirectUri: string;
  secretsKeyConfigured: boolean;
  queue: { pending: number; copied: number; failed: number };
  open: DriveOpenCopy[];
};

async function fail(response: Response): Promise<never> {
  throw new HttpError(response.status, await response.text());
}

export async function getDriveStatus(): Promise<DriveStatus> {
  const response = await client["google-drive"].$get();
  if (!response.ok) return fail(response);
  return response.json();
}

export async function saveDriveCredentials(input: {
  clientId: string;
  clientSecret?: string;
}): Promise<DriveStatus> {
  const response = await client["google-drive"].credentials.$put({
    json: input,
  });
  if (!response.ok) return fail(response);
  return response.json();
}

export async function startDriveConnect(): Promise<string> {
  const response = await client["google-drive"].connect.$post();
  if (!response.ok) return fail(response);
  return (await response.json()).url;
}

export async function testDrive(): Promise<{ ok: boolean; message: string }> {
  const response = await client["google-drive"].test.$post();
  if (!response.ok) return fail(response);
  return response.json();
}

export async function disconnectDrive(): Promise<DriveStatus> {
  const response = await client["google-drive"].disconnect.$post();
  if (!response.ok) return fail(response);
  return response.json();
}

export async function backfillDrive(): Promise<{ queued: number }> {
  const response = await client["google-drive"].backfill.$post();
  if (!response.ok) return fail(response);
  return response.json();
}

export async function retryDriveCopy(
  assetId: string,
): Promise<{ retried: boolean }> {
  const response = await client["google-drive"].retry.$post({
    json: { assetId },
  });
  if (!response.ok) return fail(response);
  return response.json();
}
