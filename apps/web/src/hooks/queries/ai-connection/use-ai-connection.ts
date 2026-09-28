import { useQuery } from "@tanstack/react-query";
import {
  getAiConnections,
  getAiEligibility,
  getAiHistory,
} from "@/fetchers/ai-connection/ai-connection";

export const aiConnectionsKey = ["ai-connection", "list"] as const;
export const aiHistoryKey = ["ai-connection", "history"] as const;

export function useAiConnections(enabled = true) {
  return useQuery({
    enabled,
    queryKey: aiConnectionsKey,
    queryFn: getAiConnections,
    // A lista mostra "último uso": atualiza sozinha enquanto a tela está aberta.
    refetchInterval: 15_000,
  });
}

export function useAiHistory(enabled = true) {
  return useQuery({
    enabled,
    queryKey: aiHistoryKey,
    queryFn: () => getAiHistory(50),
    refetchInterval: 15_000,
  });
}

export function useAiEligibility(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["ai-connection", "eligibility"],
    queryFn: getAiEligibility,
    retry: false,
  });
}
