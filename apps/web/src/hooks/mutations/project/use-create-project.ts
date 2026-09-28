import { useMutation } from "@tanstack/react-query";
import createProject from "@/fetchers/project/create-project";

function useCreateProject({
  name,
  slug,
  workspaceId,
  icon,
  description,
  financeTotalCents,
  financeMonths,
  financeFirstDueDate,
  label,
}: {
  name: string;
  slug: string;
  workspaceId: string;
  icon: string;
  description?: string;
  financeTotalCents?: number;
  financeMonths?: number;
  financeFirstDueDate?: string;
  label?: string;
}) {
  return useMutation({
    mutationFn: () =>
      createProject({
        name,
        slug,
        workspaceId,
        icon,
        description,
        financeTotalCents,
        financeMonths,
        financeFirstDueDate,
        label,
      }),
  });
}

export default useCreateProject;
