import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import AiConnectionPanel from "@/components/ai-connection/ai-connection-panel";
import PageTitle from "@/components/page-title";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/ai-connection",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { role } = useWorkspacePermission();
  const isAdmin = role === "owner" || role === "admin";

  return (
    <>
      <PageTitle title={t("settings:aiConnection.pageTitle")} />
      {isAdmin ? (
        <AiConnectionPanel />
      ) : (
        <div className="max-w-4xl mx-auto">
          <p className="rounded-md border border-border bg-sidebar p-4 text-sm text-muted-foreground">
            {t("settings:aiConnection.adminOnly")}
          </p>
        </div>
      )}
    </>
  );
}
