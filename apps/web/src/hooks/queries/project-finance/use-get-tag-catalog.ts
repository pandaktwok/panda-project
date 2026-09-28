import { useQuery } from "@tanstack/react-query";
import { getProjectTagCatalog } from "@/fetchers/project-finance/tags";

export const tagCatalogKey = (projectId: string) =>
  ["project-finance", projectId, "tag-catalog"] as const;

function useGetTagCatalog(projectId: string, enabled: boolean) {
  return useQuery({
    enabled: enabled && Boolean(projectId),
    queryKey: tagCatalogKey(projectId),
    queryFn: () => getProjectTagCatalog(projectId),
    staleTime: 60_000,
  });
}

export default useGetTagCatalog;
