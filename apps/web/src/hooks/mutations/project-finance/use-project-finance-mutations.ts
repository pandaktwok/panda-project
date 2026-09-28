import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createProjectLine,
  deleteProjectLine,
  type LineInput,
  updateProjectLine,
} from "@/fetchers/project-finance/lines";
import saveProjectFinance, {
  type SavePaymentInput,
} from "@/fetchers/project-finance/save-project-finance";
import {
  createProjectTag,
  deleteProjectTag,
  type TagInput,
  updateProjectTag,
} from "@/fetchers/project-finance/tags";
import type { FinanceState } from "@/fetchers/project-finance/types";
import undoInstallmentPayment from "@/fetchers/project-finance/undo-installment-payment";
import updateProjectFinanceSettings, {
  type FinanceSettingsInput,
} from "@/fetchers/project-finance/update-settings";
import { financeFilesKey } from "@/hooks/queries/project-finance/use-get-finance-files";
import { projectFinanceKey } from "@/hooks/queries/project-finance/use-get-project-finance";
import { tagCatalogKey } from "@/hooks/queries/project-finance/use-get-tag-catalog";

/**
 * Toda mutação do financeiro devolve o estado novo do projeto: gravamos no
 * cache na hora (a tabela não pisca) e invalidamos o resumo do projeto e a
 * lista de projetos, que mostram totais.
 */
export function useProjectFinanceMutations(projectId: string) {
  const queryClient = useQueryClient();

  const apply = (state: FinanceState) => {
    queryClient.setQueryData(projectFinanceKey(projectId), state);
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    // Pagar ou desfazer muda a pasta Financeiro (PDF novo ou marcado como desfeito).
    void queryClient.invalidateQueries({
      queryKey: financeFilesKey(projectId),
    });
  };

  return {
    save: useMutation({
      mutationFn: (input: { version: string; payments: SavePaymentInput[] }) =>
        saveProjectFinance({ projectId, ...input }),
      onSuccess: apply,
    }),
    undo: useMutation({
      mutationFn: (installmentId: string) =>
        undoInstallmentPayment(installmentId),
      onSuccess: apply,
    }),
    createTag: useMutation({
      mutationFn: (input: TagInput) => createProjectTag(projectId, input),
      onSuccess: (state) => {
        apply(state);
        // Um nome novo pode ter entrado no catálogo do workspace.
        void queryClient.invalidateQueries({
          queryKey: tagCatalogKey(projectId),
        });
      },
    }),
    updateTag: useMutation({
      mutationFn: (input: { tagId: string; data: Partial<TagInput> }) =>
        updateProjectTag(input.tagId, input.data),
      onSuccess: (state) => {
        apply(state);
        void queryClient.invalidateQueries({
          queryKey: tagCatalogKey(projectId),
        });
      },
    }),
    deleteTag: useMutation({
      mutationFn: (input: { tagId: string; force?: boolean }) =>
        deleteProjectTag(input.tagId, input.force),
      onSuccess: apply,
    }),
    createLine: useMutation({
      mutationFn: (input: LineInput) => createProjectLine(projectId, input),
      onSuccess: apply,
    }),
    updateLine: useMutation({
      mutationFn: (input: { lineId: string; data: Partial<LineInput> }) =>
        updateProjectLine(input.lineId, input.data),
      onSuccess: apply,
    }),
    deleteLine: useMutation({
      mutationFn: (input: { lineId: string; force?: boolean }) =>
        deleteProjectLine(input.lineId, input.force),
      onSuccess: apply,
    }),
    updateSettings: useMutation({
      mutationFn: (input: FinanceSettingsInput) =>
        updateProjectFinanceSettings(projectId, input),
      onSuccess: apply,
    }),
  };
}
