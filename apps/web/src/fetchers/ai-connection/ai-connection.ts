import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type AiConnection = {
  id: string;
  name: string;
  authorizedByName: string | null;
  authorizedByEmail: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  status: "active" | "revoked" | "expired";
  canPay: boolean;
  canEdit: boolean;
};

export type AiConnectionList = { mcpUrl: string; connections: AiConnection[] };

export type AiAction = {
  id: string;
  connectionId: string;
  connectionName: string;
  action: string;
  method: string;
  path: string;
  status: number;
  projectId: string | null;
  createdAt: string;
};

export async function getAiConnections(): Promise<AiConnectionList> {
  const response = await client["ai-connection"].$get();
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function getAiHistory(limit = 50): Promise<AiAction[]> {
  const response = await client["ai-connection"].history.$get({
    query: { limit: String(limit) },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()).actions;
}

export async function getAiEligibility(): Promise<boolean> {
  const response = await client["ai-connection"].eligibility.$get();
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()).canAuthorize;
}

export async function updateAiConnection(
  id: string,
  patch: { canPay?: boolean; canEdit?: boolean; name?: string },
): Promise<AiConnection> {
  const response = await client["ai-connection"][":id"].$patch({
    param: { id },
    json: patch,
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function revokeAiConnection(id: string): Promise<AiConnection> {
  const response = await client["ai-connection"][":id"].revoke.$post({
    param: { id },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
