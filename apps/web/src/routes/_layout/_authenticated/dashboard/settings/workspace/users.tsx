import { createFileRoute } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import InviteTeamMemberModal from "@/components/team/invite-team-member-modal";
import MembersTable from "@/components/team/members-table";
import { Button } from "@/components/ui/button";
import useGetFullWorkspace from "@/hooks/queries/workspace/use-get-full-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/users",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { workspace, role } = useWorkspacePermission();
  const isAdmin = role === "owner" || role === "admin";
  const { data: fullWorkspace } = useGetFullWorkspace({
    workspaceId: workspace?.id ?? "",
  });
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  return (
    <>
      <PageTitle title={t("settings:workspaceUsers.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">
              {t("settings:workspaceUsers.title")}
            </h1>
            <p className="text-muted-foreground">
              {t("settings:workspaceUsers.subtitle")}
            </p>
          </div>
          {isAdmin ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setIsInviteOpen(true)}
            >
              <UserPlus className="size-4" />
              {t("team:members.inviteMember")}
            </Button>
          ) : null}
        </div>

        {!isAdmin ? (
          <p className="rounded-md border border-border bg-sidebar p-4 text-sm text-muted-foreground">
            {t("settings:workspaceUsers.adminOnly")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <MembersTable
              workspaceId={workspace?.id ?? ""}
              users={fullWorkspace?.members ?? []}
              invitations={fullWorkspace?.invitations ?? []}
            />
          </div>
        )}

        <InviteTeamMemberModal
          open={isInviteOpen}
          onClose={() => setIsInviteOpen(false)}
        />
      </div>
    </>
  );
}
