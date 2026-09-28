import { useQuery } from "@tanstack/react-query";
import getProjectLabels from "@/fetchers/project/get-project-labels";

export const projectLabelsKey = (workspaceId: string) =>
  ["project-labels", workspaceId] as const;

function useGetProjectLabels(workspaceId: string, enabled = true) {
  return useQuery({
    enabled: enabled && Boolean(workspaceId),
    queryKey: projectLabelsKey(workspaceId),
    queryFn: () => getProjectLabels(workspaceId),
    staleTime: 60_000,
  });
}

export default useGetProjectLabels;
