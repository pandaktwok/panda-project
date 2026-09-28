import { useQuery } from "@tanstack/react-query";
import { getProjectAccess } from "@/fetchers/project-access/project-access";

export const projectAccessKey = (projectId: string) =>
  ["project-access", projectId] as const;

function useGetProjectAccess(projectId: string, enabled = true) {
  return useQuery({
    enabled: Boolean(projectId) && enabled,
    queryKey: projectAccessKey(projectId),
    queryFn: () => getProjectAccess(projectId),
  });
}

export default useGetProjectAccess;
