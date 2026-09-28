import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type getProjects from "@/fetchers/project/get-projects";
import updateProjectStatus from "@/fetchers/project/update-project-status";

type ProjectList = NonNullable<Awaited<ReturnType<typeof getProjects>>>;
type ProjectStatus = ProjectList[number]["status"];

/**
 * Arrastar um cartão no Kanban de projetos grava o status manual na hora
 * (otimista), igual ao reordenar da lista: escreve o cache antes de chamar a
 * API, e desfaz se a chamada falhar.
 */
function useUpdateProjectStatus() {
  const queryClient = useQueryClient();

  const updateStatus = useCallback(
    (
      workspaceId: string,
      projectId: string,
      status: ProjectStatus,
      onError?: () => void,
    ) => {
      const queryKey = ["projects", workspaceId];
      const previousProjects = queryClient.getQueryData<ProjectList>(queryKey);

      queryClient.setQueryData<ProjectList>(queryKey, (current) =>
        current?.map((project) =>
          project.id === projectId ? { ...project, status } : project,
        ),
      );

      updateProjectStatus({ id: projectId, status }).catch(() => {
        if (previousProjects) {
          queryClient.setQueryData(queryKey, previousProjects);
        }
        onError?.();
      });
    },
    [queryClient],
  );

  return updateStatus;
}

export default useUpdateProjectStatus;
