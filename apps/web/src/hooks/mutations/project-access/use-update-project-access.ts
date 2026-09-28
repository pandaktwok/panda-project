import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type ProjectAccessKeys,
  updateProjectAccess,
} from "@/fetchers/project-access/project-access";
import { projectAccessKey } from "@/hooks/queries/project-access/use-get-project-access";

function useUpdateProjectAccess(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      keys,
    }: {
      userId: string;
      keys: ProjectAccessKeys;
    }) => updateProjectAccess(projectId, userId, keys),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: projectAccessKey(projectId) }),
  });
}

export default useUpdateProjectAccess;
