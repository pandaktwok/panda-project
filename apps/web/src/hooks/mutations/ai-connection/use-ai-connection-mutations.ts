import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  revokeAiConnection,
  updateAiConnection,
} from "@/fetchers/ai-connection/ai-connection";
import {
  aiConnectionsKey,
  aiHistoryKey,
} from "@/hooks/queries/ai-connection/use-ai-connection";

export function useUpdateAiConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      canPay?: boolean;
      canEdit?: boolean;
      name?: string;
    }) => updateAiConnection(id, patch),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: aiConnectionsKey }),
  });
}

export function useRevokeAiConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeAiConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiConnectionsKey });
      queryClient.invalidateQueries({ queryKey: aiHistoryKey });
    },
  });
}
