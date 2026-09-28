import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  backfillDrive,
  disconnectDrive,
  retryDriveCopy,
  saveDriveCredentials,
  startDriveConnect,
  testDrive,
} from "@/fetchers/google-drive/google-drive";
import { googleDriveKey } from "@/hooks/queries/google-drive/use-google-drive";

export function useSaveDriveCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveDriveCredentials,
    onSuccess: (status) => queryClient.setQueryData(googleDriveKey, status),
  });
}

export function useStartDriveConnect() {
  return useMutation({ mutationFn: startDriveConnect });
}

export function useTestDrive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: testDrive,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: googleDriveKey }),
  });
}

export function useDisconnectDrive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disconnectDrive,
    onSuccess: (status) => queryClient.setQueryData(googleDriveKey, status),
  });
}

export function useBackfillDrive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: backfillDrive,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: googleDriveKey }),
  });
}

export function useRetryDriveCopy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: retryDriveCopy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: googleDriveKey });
      queryClient.invalidateQueries({ queryKey: ["project-finance"] });
    },
  });
}
