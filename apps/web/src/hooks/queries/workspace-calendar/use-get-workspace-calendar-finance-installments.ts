import { useQuery } from "@tanstack/react-query";
import getWorkspaceCalendarFinanceInstallments from "@/fetchers/workspace-calendar/get-workspace-calendar-finance-installments";

export const workspaceCalendarFinanceInstallmentsKey = (workspaceId: string) =>
  ["workspace-calendar-finance-installments", workspaceId] as const;

function useGetWorkspaceCalendarFinanceInstallments(workspaceId: string) {
  return useQuery({
    enabled: Boolean(workspaceId),
    queryKey: workspaceCalendarFinanceInstallmentsKey(workspaceId),
    queryFn: () => getWorkspaceCalendarFinanceInstallments(workspaceId),
  });
}

export default useGetWorkspaceCalendarFinanceInstallments;
