import { createFileRoute, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import AccessTable from "@/components/project-access/access-table";
import useUpdateProjectAccess from "@/hooks/mutations/project-access/use-update-project-access";
import useGetProjectAccess from "@/hooks/queries/project-access/use-get-project-access";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/access",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = useParams({ strict: false });
  const { role } = useWorkspacePermission();
  const isAdmin = role === "owner" || role === "admin";
  const { data, isLoading } = useGetProjectAccess(projectId || "", isAdmin);
  const { mutateAsync, isPending } = useUpdateProjectAccess(projectId || "");

  return (
    <>
      <PageTitle title={t("settings:projectAccess.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:projectAccess.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:projectAccess.subtitle")}
          </p>
        </div>

        {!isAdmin ? (
          <p className="rounded-md border border-border bg-sidebar p-4 text-sm text-muted-foreground">
            {t("settings:projectAccess.adminOnly")}
          </p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">
            {t("common:empty.loading")}
          </p>
        ) : (
          <div className="rounded-md border border-border">
            <AccessTable
              members={data?.members ?? []}
              disabled={isPending}
              onChange={async (userId, keys) => {
                try {
                  await mutateAsync({ userId, keys });
                  toast.success(t("settings:projectAccess.toastSaved"));
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : t("settings:projectAccess.toastError"),
                  );
                }
              }}
            />
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {t("settings:projectAccess.footnote")}
        </p>
      </div>
    </>
  );
}
