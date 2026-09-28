import { createFileRoute } from "@tanstack/react-router";
import ProjectLayout from "@/components/common/project-layout";
import ProjectSummaryPage from "@/components/project-finance/project-summary-page";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/summary",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectId, workspaceId } = Route.useParams();

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="summary"
    >
      <ProjectSummaryPage projectId={projectId} workspaceId={workspaceId} />
    </ProjectLayout>
  );
}
