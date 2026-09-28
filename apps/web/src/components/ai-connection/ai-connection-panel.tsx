import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Switch } from "@/components/ui/switch";
import type { AiConnection } from "@/fetchers/ai-connection/ai-connection";
import {
  useRevokeAiConnection,
  useUpdateAiConnection,
} from "@/hooks/mutations/ai-connection/use-ai-connection-mutations";
import {
  useAiConnections,
  useAiHistory,
} from "@/hooks/queries/ai-connection/use-ai-connection";
import { toast } from "@/lib/toast";

/** dd/mm/aaaa HH:mm no horário de quem está olhando. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STEP_KEYS = ["one", "two", "three", "four", "five", "six"] as const;

export default function AiConnectionPanel() {
  const { t } = useTranslation();
  const connections = useAiConnections();
  const history = useAiHistory();
  const update = useUpdateAiConnection();
  const revoke = useRevokeAiConnection();
  const [copied, setCopied] = useState(false);
  const [toRevoke, setToRevoke] = useState<AiConnection | null>(null);

  const copyUrl = async () => {
    if (!connections.data) return;
    try {
      await navigator.clipboard.writeText(connections.data.mcpUrl);
      setCopied(true);
      toast.success(t("settings:aiConnection.address.copied"));
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error(t("settings:aiConnection.address.copyFailed"));
    }
  };

  const toggle = (
    connection: AiConnection,
    key: "canPay" | "canEdit",
    value: boolean,
  ) => {
    update.mutate(
      { id: connection.id, [key]: value },
      {
        onSuccess: () => toast.success(t("settings:aiConnection.saved")),
        onError: () => toast.error(t("settings:aiConnection.saveFailed")),
      },
    );
  };

  const statusLabel = (connection: AiConnection) =>
    connection.status === "revoked"
      ? t("settings:aiConnection.status.revoked", {
          date: formatDateTime(connection.revokedAt),
        })
      : connection.status === "expired"
        ? t("settings:aiConnection.status.expired")
        : t("settings:aiConnection.status.active");

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">
          {t("settings:aiConnection.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("settings:aiConnection.subtitle")}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          {t("settings:aiConnection.address.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings:aiConnection.address.hint")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code
            className="min-w-0 flex-1 break-all rounded-md border border-border bg-sidebar px-3 py-2 font-mono text-sm"
            data-testid="mcp-url"
          >
            {connections.data?.mcpUrl ?? "…"}
          </code>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={!connections.data}
            onClick={copyUrl}
          >
            {copied ? (
              <CheckIcon className="size-4" />
            ) : (
              <CopyIcon className="size-4" />
            )}
            {t("settings:aiConnection.address.copy")}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          {t("settings:aiConnection.steps.title")}
        </h2>
        <ol className="list-decimal space-y-2 ps-5 text-sm">
          {STEP_KEYS.map((key) => (
            <li key={key}>{t(`settings:aiConnection.steps.${key}`)}</li>
          ))}
        </ol>
        <p className="rounded-md border border-border bg-sidebar p-3 text-sm text-muted-foreground">
          {t("settings:aiConnection.steps.publicNote")}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          {t("settings:aiConnection.connections.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings:aiConnection.connections.inherits")}
        </p>
        {connections.isLoading ? (
          <p className="text-sm text-muted-foreground">
            {t("settings:aiConnection.loading")}
          </p>
        ) : connections.isError ? (
          <p className="text-sm text-destructive-foreground">
            {t("settings:aiConnection.loadFailed")}
          </p>
        ) : connections.data?.connections.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("settings:aiConnection.connections.empty")}
          </p>
        ) : (
          <ul className="space-y-3">
            {connections.data?.connections.map((connection) => {
              const active = connection.status === "active";
              return (
                <li
                  key={connection.id}
                  className="space-y-3 rounded-md border border-border p-4"
                  data-testid="ai-connection"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{connection.name}</span>
                        <Badge variant={active ? "success" : "outline"}>
                          {statusLabel(connection)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("settings:aiConnection.connections.meta", {
                          who:
                            connection.authorizedByName ??
                            connection.authorizedByEmail ??
                            "—",
                          created: formatDateTime(connection.createdAt),
                          used: connection.lastUsedAt
                            ? formatDateTime(connection.lastUsedAt)
                            : t("settings:aiConnection.connections.neverUsed"),
                        })}
                      </p>
                    </div>
                    {active ? (
                      <Button
                        variant="destructive-outline"
                        size="sm"
                        onClick={() => setToRevoke(connection)}
                      >
                        {t("settings:aiConnection.revoke.button")}
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SwitchRow
                      label={t("settings:aiConnection.switches.payLabel")}
                      hint={t("settings:aiConnection.switches.payHint")}
                      checked={connection.canPay}
                      disabled={!active || update.isPending}
                      onChange={(value) => toggle(connection, "canPay", value)}
                    />
                    <SwitchRow
                      label={t("settings:aiConnection.switches.editLabel")}
                      hint={t("settings:aiConnection.switches.editHint")}
                      checked={connection.canEdit}
                      disabled={!active || update.isPending}
                      onChange={(value) => toggle(connection, "canEdit", value)}
                    />
                  </div>
                  {active && !connection.canPay && !connection.canEdit ? (
                    <p className="text-xs text-muted-foreground">
                      {t("settings:aiConnection.switches.readOnlyNote")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          {t("settings:aiConnection.history.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings:aiConnection.history.hint")}
        </p>
        {history.data?.length ? (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-sidebar text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">
                    {t("settings:aiConnection.history.colWhen")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("settings:aiConnection.history.colConnection")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("settings:aiConnection.history.colAction")}
                  </th>
                  <th className="px-3 py-2 font-medium">
                    {t("settings:aiConnection.history.colResult")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-t border-border"
                    data-testid="ai-action"
                  >
                    <td className="px-3 py-2 tabular-nums">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">
                        {t("settings:aiConnection.history.byAi", {
                          name: entry.connectionName,
                        })}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{entry.action}</td>
                    <td className="px-3 py-2">
                      {entry.status === 403
                        ? t("settings:aiConnection.history.denied")
                        : entry.status >= 400
                          ? t("settings:aiConnection.history.error", {
                              status: entry.status,
                            })
                          : t("settings:aiConnection.history.done")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("settings:aiConnection.history.empty")}
          </p>
        )}
      </section>

      <AlertDialog
        open={toRevoke !== null}
        onOpenChange={(open) => !open && setToRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:aiConnection.revoke.title", {
                name: toRevoke?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:aiConnection.revoke.body")}
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
                  onClick={() => {
                    if (!toRevoke) return;
                    revoke.mutate(toRevoke.id, {
                      onSuccess: () =>
                        toast.success(t("settings:aiConnection.revoke.done")),
                      onError: () =>
                        toast.error(t("settings:aiConnection.saveFailed")),
                    });
                  }}
                />
              }
            >
              {t("settings:aiConnection.revoke.confirm")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md bg-sidebar p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}
