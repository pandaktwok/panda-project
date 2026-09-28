import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import GoogleDrivePanel from "@/components/google-drive/google-drive-panel";
import PageTitle from "@/components/page-title";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/google-drive",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { role } = useWorkspacePermission();
  const isAdmin = role === "owner" || role === "admin";

  return (
    <>
      <PageTitle title={t("settings:googleDrive.pageTitle")} />
      {isAdmin ? (
        <GoogleDrivePanel />
      ) : (
        <div className="max-w-4xl mx-auto">
          <p className="rounded-md border border-border bg-sidebar p-4 text-sm text-muted-foreground">
            {t("settings:googleDrive.adminOnly")}
          </p>
        </div>
      )}
    </>
  );
}
