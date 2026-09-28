import { useQuery } from "@tanstack/react-query";
import { getDriveStatus } from "@/fetchers/google-drive/google-drive";

export const googleDriveKey = ["google-drive", "status"] as const;

export function useGoogleDriveStatus(enabled = true) {
  return useQuery({
    enabled,
    queryKey: googleDriveKey,
    queryFn: getDriveStatus,
    // A fila anda sozinha: a tela acompanha enquanto está aberta.
    refetchInterval: 10_000,
  });
}
