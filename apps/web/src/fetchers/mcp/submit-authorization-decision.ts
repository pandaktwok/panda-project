import { getApiUrl } from "@/fetchers/get-api-url";

export class McpDecisionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function submitMcpAuthorizationDecision(
  requestId: string,
  approved: boolean,
  connectionName?: string,
): Promise<string> {
  const response = await fetch(
    getApiUrl(`/mcp/authorize/request/${encodeURIComponent(requestId)}`),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approved,
        ...(connectionName?.trim()
          ? { connectionName: connectionName.trim() }
          : {}),
      }),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    throw new McpDecisionError(
      body.error ?? "unknown",
      body.error_description ?? "",
    );
  }

  const body = (await response.json()) as { redirect: string };
  return body.redirect;
}
