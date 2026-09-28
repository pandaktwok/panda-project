import { useQuery } from "@tanstack/react-query";
import getProjectFinance from "@/fetchers/project-finance/get-project-finance";

export const projectFinanceKey = (projectId: string) =>
  ["project-finance", projectId] as const;

function useGetProjectFinance(projectId: string) {
  return useQuery({
    enabled: Boolean(projectId),
    queryKey: projectFinanceKey(projectId),
    queryFn: () => getProjectFinance(projectId),
  });
}

export default useGetProjectFinance;
