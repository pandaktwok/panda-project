import { useQuery } from "@tanstack/react-query";
import getWorkspaceCalendarTasks from "@/fetchers/workspace-calendar/get-workspace-calendar-tasks";

export const workspaceCalendarTasksKey = (workspaceId: string) =>
  ["workspace-calendar-tasks", workspaceId] as const;

function useGetWorkspaceCalendarTasks(workspaceId: string) {
  return useQuery({
    enabled: Boolean(workspaceId),
    queryKey: workspaceCalendarTasksKey(workspaceId),
    queryFn: () => getWorkspaceCalendarTasks(workspaceId),
  });
}

export default useGetWorkspaceCalendarTasks;
