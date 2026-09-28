import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { AuthLayout } from "@/components/auth/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { McpDecisionError } from "@/fetchers/mcp/submit-authorization-decision";
import { useMcpAuthorizationDecision } from "@/hooks/mutations/mcp/use-authorization-decision";
import { useAiEligibility } from "@/hooks/queries/ai-connection/use-ai-connection";
import { useMcpAuthorizationRequest } from "@/hooks/queries/mcp/use-authorization-request";
import { authClient } from "@/lib/auth-client";

const authorizationSearchSchema = z.object({
  request_id: z.string().optional(),
});

export const Route = createFileRoute("/mcp/authorize")({
  component: McpAuthorizePage,
  validateSearch: authorizationSearchSchema,
});

function McpAuthorizePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: "/mcp/authorize" });
  const requestId = search.request_id ?? "";
  const request = useMcpAuthorizationRequest(requestId);
  const decision = useMcpAuthorizationDecision();
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const eligibility = useAiEligibility(Boolean(session?.user));
  const [connectionName, setConnectionName] = useState("");

  if (!requestId || request.isError) {
    return (
      <AuthLayout
        title={t("settings:aiConnection.authorize.invalidTitle")}
        subtitle={t("settings:aiConnection.authorize.invalidBody")}
      >
        <span />
      </AuthLayout>
    );
  }

  if (request.isLoading || isSessionPending) {
    return (
      <AuthLayout
        title={t("settings:aiConnection.authorize.loadingTitle")}
        subtitle={t("settings:aiConnection.authorize.loadingBody")}
      >
        <span />
      </AuthLayout>
    );
  }

  if (!session?.user) {
    const redirectTarget = `/mcp/authorize?request_id=${encodeURIComponent(requestId)}`;
    return (
      <AuthLayout
        title={t("settings:aiConnection.authorize.signInTitle")}
        subtitle={t("settings:aiConnection.authorize.signInBody")}
      >
        <Button
          type="button"
          className="w-full"
          onClick={() =>
            void navigate({
              to: "/auth/sign-in",
              search: { redirect: redirectTarget },
            })
          }
        >
          {t("settings:aiConnection.authorize.signIn")}
        </Button>
      </AuthLayout>
    );
  }

  const notAdmin =
    eligibility.data === false ||
    (decision.error instanceof McpDecisionError &&
      decision.error.code === "admin_required");

  if (notAdmin) {
    return (
      <AuthLayout
        title={t("settings:aiConnection.authorize.notAdminTitle")}
        subtitle={t("settings:aiConnection.authorize.notAdminBody")}
      >
        <span />
      </AuthLayout>
    );
  }

  const submitDecision = (approved: boolean) => {
    decision.mutate(
      { requestId, approved, connectionName },
      {
        onSuccess: (redirect) => window.location.assign(redirect),
      },
    );
  };

  return (
    <AuthLayout
      title={t("settings:aiConnection.authorize.title")}
      subtitle={t("settings:aiConnection.authorize.subtitle")}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("settings:aiConnection.authorize.body")}
        </p>
        <div className="space-y-3 rounded-md border bg-muted/40 p-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              {t("settings:aiConnection.authorize.clientName")}
            </p>
            <p className="mt-1 text-sm">
              {request.data?.clientName ?? "MCP client"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              {t("settings:aiConnection.authorize.redirect")}
            </p>
            <p className="mt-1 break-all font-mono text-xs">
              {request.data?.redirectUri}
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ai-connection-name" className="text-sm font-medium">
            {t("settings:aiConnection.authorize.connectionName")}
          </label>
          <Input
            id="ai-connection-name"
            value={connectionName}
            maxLength={80}
            placeholder={request.data?.clientName ?? ""}
            onChange={(event) => setConnectionName(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t("settings:aiConnection.authorize.connectionNameHint")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1"
            loading={decision.isPending && decision.variables?.approved}
            disabled={decision.isPending || eligibility.isPending}
            onClick={() => submitDecision(true)}
          >
            {t("settings:aiConnection.authorize.approve")}
          </Button>
          <Button
            type="button"
            variant="outline"
            loading={decision.isPending && !decision.variables?.approved}
            disabled={decision.isPending}
            onClick={() => submitDecision(false)}
          >
            {t("settings:aiConnection.authorize.deny")}
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
