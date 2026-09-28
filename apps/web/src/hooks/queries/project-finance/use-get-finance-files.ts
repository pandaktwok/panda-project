import { useQuery } from "@tanstack/react-query";
import { getFinanceFiles } from "@/fetchers/project-finance/files";

// Começa com ["project-finance", projectId]: o WebSocket e as mutações que
// invalidam o financeiro atualizam a lista de arquivos junto.
export const financeFilesKey = (projectId: string) =>
  ["project-finance", projectId, "files"] as const;

function useGetFinanceFiles(projectId: string, enabled = true) {
  return useQuery({
    enabled: Boolean(projectId) && enabled,
    queryKey: financeFilesKey(projectId),
    queryFn: () => getFinanceFiles(projectId),
  });
}

export default useGetFinanceFiles;
