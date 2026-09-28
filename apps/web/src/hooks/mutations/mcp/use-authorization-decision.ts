import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  McpDecisionError,
  submitMcpAuthorizationDecision,
} from "@/fetchers/mcp/submit-authorization-decision";
import { toast } from "@/lib/toast";

export function useMcpAuthorizationDecision() {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({
      requestId,
      approved,
      connectionName,
    }: {
      requestId: string;
      approved: boolean;
      connectionName?: string;
    }) => submitMcpAuthorizationDecision(requestId, approved, connectionName),
    onError: (error) =>
      // "Somente administradores" já aparece na própria tela; o resto vira aviso.
      error instanceof McpDecisionError && error.code === "admin_required"
        ? undefined
        : toast.error(t("settings:aiConnection.authorize.failed")),
  });
}
