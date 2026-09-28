import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/components/ai-connection/ai-connection-panel";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DriveStatus } from "@/fetchers/google-drive/google-drive";
import {
  useBackfillDrive,
  useDisconnectDrive,
  useRetryDriveCopy,
  useSaveDriveCredentials,
  useStartDriveConnect,
  useTestDrive,
} from "@/hooks/mutations/google-drive/use-google-drive-mutations";
import { useGoogleDriveStatus } from "@/hooks/queries/google-drive/use-google-drive";
import { toast } from "@/lib/toast";

const STEP_KEYS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
] as const;

export default function GoogleDrivePanel() {
  const { t } = useTranslation();
  const status = useGoogleDriveStatus();
  const save = useSaveDriveCredentials();
  const start = useStartDriveConnect();
  const test = useTestDrive();
  const disconnect = useDisconnectDrive();
  const backfill = useBackfillDrive();
  const retry = useRetryDriveCopy();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const data = status.data;

  // Preenche o ID já salvo (o segredo nunca volta do servidor).
  useEffect(() => {
    if (data?.clientId)
      setClientId((current) => current || data.clientId || "");
  }, [data?.clientId]);

  // Volta do Google: a rota de retorno redireciona para cá com ?drive=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("drive");
    if (!result) return;
    if (result === "connected") {
      toast.success(t("settings:googleDrive.connectedToast"));
    } else {
      toast.error(t("settings:googleDrive.connectErrorToast"));
    }
    params.delete("drive");
    const rest = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${rest ? `?${rest}` : ""}`,
    );
  }, [t]);

  const copyRedirect = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.redirectUri);
      setCopied(true);
      toast.success(t("settings:googleDrive.redirect.copied"));
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error(t("settings:googleDrive.redirect.copyFailed"));
    }
  };

  const secretNeeded = !data?.hasClientSecret;
  const canSubmit =
    clientId.trim().length > 0 &&
    (clientSecret.trim().length > 0 || !secretNeeded);

  const saveAndConnect = () => {
    save.mutate(
      {
        clientId: clientId.trim(),
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
      },
      {
        onSuccess: () => {
          setClientSecret("");
          start.mutate(undefined, {
            onSuccess: (url) => {
              window.location.href = url;
            },
            onError: () =>
              toast.error(t("settings:googleDrive.connectErrorToast")),
          });
        },
        onError: () => toast.error(t("settings:googleDrive.saveFailed")),
      },
    );
  };

  const runTest = () =>
    test.mutate(undefined, {
      onSuccess: (result) =>
        result.ok ? toast.success(result.message) : toast.error(result.message),
      onError: () => toast.error(t("settings:googleDrive.testFailed")),
    });

  const runBackfill = () =>
    backfill.mutate(undefined, {
      onSuccess: ({ queued }) =>
        toast.success(
          t("settings:googleDrive.backfill.done", { count: queued }),
        ),
      onError: () => toast.error(t("settings:googleDrive.backfill.failed")),
    });

  const badge = (current: DriveStatus["status"]) =>
    current === "connected" ? (
      <Badge variant="success">
        {t("settings:googleDrive.status.connected")}
      </Badge>
    ) : current === "error" ? (
      <Badge variant="destructive">
        {t("settings:googleDrive.status.error")}
      </Badge>
    ) : (
      <Badge variant="outline">
        {t("settings:googleDrive.status.disconnected")}
      </Badge>
    );

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">
          {t("settings:googleDrive.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("settings:googleDrive.subtitle")}
        </p>
      </div>

      {status.isLoading ? (
        <p className="text-sm text-muted-foreground">
          {t("settings:googleDrive.loading")}
        </p>
      ) : status.isError || !data ? (
        <p className="text-sm text-destructive-foreground">
          {t("settings:googleDrive.loadFailed")}
        </p>
      ) : (
        <>
          <section
            className="space-y-3 rounded-md border border-border p-4"
            data-testid="drive-state"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-medium">
                {t("settings:googleDrive.stateTitle")}
              </h2>
              {badge(data.status)}
            </div>
            {data.status === "connected" ? (
              <p className="text-sm">
                {t("settings:googleDrive.connectedAs", {
                  email: data.accountEmail ?? "—",
                  date: formatDateTime(data.connectedAt),
                })}
              </p>
            ) : null}
            {data.status === "error" ? (
              <p className="text-sm text-destructive-foreground">
                {data.lastError ?? t("settings:googleDrive.genericError")}
              </p>
            ) : null}
            {data.status === "disconnected" ? (
              <p className="text-sm text-muted-foreground">
                {t("settings:googleDrive.disconnectedNote")}
              </p>
            ) : null}
            {!data.secretsKeyConfigured ? (
              <p className="text-sm text-destructive-foreground">
                {t("settings:googleDrive.noSecretsKey")}
              </p>
            ) : null}
            {data.status !== "disconnected" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={test.isPending}
                  onClick={runTest}
                >
                  {t("settings:googleDrive.actions.test")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={backfill.isPending}
                  onClick={runBackfill}
                >
                  {t("settings:googleDrive.actions.backfill")}
                </Button>
                <Button
                  variant="destructive-outline"
                  size="sm"
                  onClick={() => setConfirmDisconnect(true)}
                >
                  {t("settings:googleDrive.actions.disconnect")}
                </Button>
              </div>
            ) : null}
            {data.status === "error" ? (
              <p className="text-xs text-muted-foreground">
                {t("settings:googleDrive.reconnectHint")}
              </p>
            ) : null}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">
              {t("settings:googleDrive.steps.title")}
            </h2>
            <ol className="list-decimal space-y-2 ps-5 text-sm">
              {STEP_KEYS.map((key) => (
                <li key={key}>{t(`settings:googleDrive.steps.${key}`)}</li>
              ))}
            </ol>
            <p className="rounded-md border border-border bg-sidebar p-3 text-sm text-muted-foreground">
              {t("settings:googleDrive.steps.publishNote")}
            </p>
            <div className="space-y-1">
              <div className="text-sm font-medium">
                {t("settings:googleDrive.redirect.label")}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code
                  className="min-w-0 flex-1 break-all rounded-md border border-border bg-sidebar px-3 py-2 font-mono text-sm"
                  data-testid="redirect-uri"
                >
                  {data.redirectUri}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={copyRedirect}
                >
                  {copied ? (
                    <CheckIcon className="size-4" />
                  ) : (
                    <CopyIcon className="size-4" />
                  )}
                  {t("settings:googleDrive.redirect.copy")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings:googleDrive.redirect.hint")}
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">
              {t("settings:googleDrive.credentials.title")}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 text-sm">
                <label htmlFor="drive-client-id" className="font-medium">
                  {t("settings:googleDrive.credentials.clientId")}
                </label>
                <Input
                  id="drive-client-id"
                  value={clientId}
                  autoComplete="off"
                  onChange={(event) => setClientId(event.target.value)}
                />
              </div>
              <div className="space-y-1 text-sm">
                <label htmlFor="drive-client-secret" className="font-medium">
                  {t("settings:googleDrive.credentials.clientSecret")}
                </label>
                <Input
                  id="drive-client-secret"
                  type="password"
                  value={clientSecret}
                  autoComplete="off"
                  placeholder={
                    data.hasClientSecret
                      ? t("settings:googleDrive.credentials.secretSaved")
                      : ""
                  }
                  onChange={(event) => setClientSecret(event.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings:googleDrive.credentials.hint")}
            </p>
            <Button
              disabled={
                !canSubmit ||
                !data.secretsKeyConfigured ||
                save.isPending ||
                start.isPending
              }
              onClick={saveAndConnect}
            >
              {data.status === "connected"
                ? t("settings:googleDrive.actions.reconnect")
                : t("settings:googleDrive.actions.connect")}
            </Button>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium">
              {t("settings:googleDrive.queue.title")}
            </h2>
            <p
              className="text-sm text-muted-foreground"
              data-testid="drive-queue"
            >
              {t("settings:googleDrive.queue.summary", {
                copied: data.queue.copied,
                pending: data.queue.pending,
                failed: data.queue.failed,
              })}
            </p>
            {data.open.length > 0 ? (
              <ul className="divide-y divide-border rounded-md border border-border">
                {data.open.map((item) => (
                  <li
                    key={item.assetId}
                    className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                    data-testid="drive-open-item"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {item.filename}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {item.projectName}
                        {item.lastError ? ` · ${item.lastError}` : ""}
                      </div>
                    </div>
                    <Badge
                      variant={
                        item.status === "failed" ? "destructive" : "outline"
                      }
                    >
                      {t(`settings:googleDrive.queue.state.${item.status}`)}
                    </Badge>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={retry.isPending}
                      onClick={() => retry.mutate(item.assetId)}
                    >
                      {t("settings:googleDrive.actions.retry")}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </>
      )}

      <AlertDialog
        open={confirmDisconnect}
        onOpenChange={(open) => !open && setConfirmDisconnect(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:googleDrive.disconnect.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:googleDrive.disconnect.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    disconnect.mutate(undefined, {
                      onSuccess: () =>
                        toast.success(
                          t("settings:googleDrive.disconnect.done"),
                        ),
                      onError: () =>
                        toast.error(t("settings:googleDrive.saveFailed")),
                    })
                  }
                />
              }
            >
              {t("settings:googleDrive.disconnect.confirm")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
