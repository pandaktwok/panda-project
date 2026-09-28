import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Paperclip,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  deleteProjectAttachment,
  FINANCE_PROJECT_FILE_ACCEPT,
  type FinanceParcelFile,
  financeAssetUrl,
  financeParcelZipUrl,
  uploadFinanceFile,
} from "@/fetchers/project-finance/files";
import { useRetryDriveCopy } from "@/hooks/mutations/google-drive/use-google-drive-mutations";
import useGetFinanceFiles, {
  financeFilesKey,
} from "@/hooks/queries/project-finance/use-get-finance-files";
import { financeFileErrorMessage } from "@/lib/finance/file-errors";
import { formatFileSize } from "@/lib/finance/file-names";
import { toast } from "@/lib/toast";
import ConfirmDialog from "./confirm-dialog";

type Props = {
  projectId: string;
  canAttach: boolean;
  canManage: boolean;
  canRead: boolean;
};

export default function AttachmentsCard({
  projectId,
  canAttach,
  canManage,
  canRead,
}: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data, isLoading, isError, refetch } = useGetFinanceFiles(
    projectId,
    canRead,
  );
  const [uploading, setUploading] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: financeFilesKey(projectId),
    });
  };

  const remove = useMutation({
    mutationFn: (assetId: string) =>
      deleteProjectAttachment(projectId, assetId),
    onSuccess: () => {
      toast.success(t("finance:files.removed"));
      invalidate();
    },
    onError: () => toast.error(t("finance:files.removeError")),
  });

  const handleFiles = async (files: File[]) => {
    for (const file of files) {
      setUploading(file.name);
      try {
        await uploadFinanceFile(projectId, "project", file);
        toast.success(t("finance:files.attached", { name: file.name }));
      } catch (error) {
        toast.error(
          t("finance:files.attachError", {
            name: file.name,
            reason: financeFileErrorMessage(error, t),
          }),
        );
      }
    }
    setUploading(null);
    invalidate();
  };

  const parcels = data?.parcels ?? [];
  const hasTree = (data?.filesCount ?? 0) > 0 || (data?.undone.length ?? 0) > 0;

  return (
    <section
      aria-labelledby="finance-attach-title"
      className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="finance-attach-title"
          className="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
        >
          {t("finance:page.attachments")}
        </h2>
        {canAttach && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={FINANCE_PROJECT_FILE_ACCEPT}
              className="sr-only"
              data-testid="finance-project-file-input"
              aria-label={t("finance:page.attachFile")}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (files.length > 0) void handleFiles(files);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={uploading !== null}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
              {uploading
                ? t("finance:files.uploading", { name: uploading })
                : t("finance:page.attachFile")}
            </Button>
          </>
        )}
      </div>

      {isLoading && canRead && (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t("finance:files.loading")}
        </p>
      )}
      {isError && (
        <p className="text-sm text-destructive-foreground">
          {t("finance:files.loadError")}{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => refetch()}
          >
            {t("finance:page.retry")}
          </button>
        </p>
      )}

      {data && data.projectFiles.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("finance:page.noAttachments")}
        </p>
      )}
      {data && data.projectFiles.length > 0 && (
        <ul className="flex flex-col gap-1" data-testid="finance-project-files">
          {data.projectFiles.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50"
            >
              <FileText
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <a
                href={financeAssetUrl(file.id)}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate font-medium underline-offset-2 hover:underline"
                aria-label={t("finance:files.downloadAria", {
                  name: file.name,
                })}
              >
                {file.name}
              </a>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatFileSize(file.size)}
              </span>
              {canManage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("finance:files.removeAria", {
                    name: file.name,
                  })}
                  onClick={() =>
                    setRemoveTarget({ id: file.id, name: file.name })
                  }
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {data && (
        <div className="mt-1 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <FolderOpen
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="font-semibold">
              {t("finance:files.treeTitle")}
            </span>
            <span className="text-muted-foreground">
              {t("finance:files.treePaid", { count: data.paidInstallments })}
              {" · "}
              {t("finance:files.treeFiles", { count: data.filesCount })}
            </span>
          </div>

          {!hasTree && (
            <p className="mt-1.5 pl-6 text-sm text-muted-foreground">
              {t("finance:files.treeEmpty")}
            </p>
          )}

          {parcels.length > 0 && (
            <ul
              className="mt-1.5 flex flex-col gap-0.5 pl-3"
              data-testid="finance-tree"
            >
              {parcels.map((parcel) => (
                <li key={parcel.number}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/50">
                      <Folder
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {parcel.label}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t("finance:files.treeFiles", {
                          count: parcel.files.length,
                        })}
                      </span>
                    </summary>
                    <div className="pl-6">
                      <ul className="flex flex-col gap-0.5">
                        {parcel.files.map((file) => (
                          <ParcelFileRow
                            key={file.id}
                            file={file}
                            canRetryDrive={canManage}
                          />
                        ))}
                      </ul>
                      <a
                        href={financeParcelZipUrl(projectId, parcel.number)}
                        className="mt-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        aria-label={t("finance:files.zipAria", {
                          label: parcel.label,
                        })}
                      >
                        <Download className="size-3.5" aria-hidden="true" />
                        {t("finance:files.zip")}
                      </a>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}

          {data.undone.length > 0 && (
            <details className="mt-2 pl-3" data-testid="finance-undone">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/50">
                <Folder
                  className="size-4 shrink-0 text-warning-foreground"
                  aria-hidden="true"
                />
                <span className="flex-1 font-medium">
                  {t("finance:files.undoneTitle")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("finance:files.treeFiles", { count: data.undone.length })}
                </span>
              </summary>
              <p className="px-2 pt-1 text-xs text-muted-foreground">
                {t("finance:files.undoneHelp")}
              </p>
              <ul className="flex flex-col gap-0.5 pl-6">
                {data.undone.map((file) => (
                  <ParcelFileRow key={file.id} file={file} undone />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title={t("finance:files.removeTitle")}
        description={t("finance:files.removeBody", {
          name: removeTarget?.name ?? "",
        })}
        confirmLabel={t("finance:files.removeConfirm")}
        cancelLabel={t("common:actions.cancel")}
        destructive
        busy={remove.isPending}
        onConfirm={async () => {
          if (!removeTarget) return;
          await remove.mutateAsync(removeTarget.id).catch(() => undefined);
          setRemoveTarget(null);
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </section>
  );
}

function ParcelFileRow({
  file,
  undone,
  canRetryDrive,
}: {
  file: FinanceParcelFile;
  undone?: boolean;
  canRetryDrive?: boolean;
}) {
  const { t } = useTranslation();
  const retryDrive = useRetryDriveCopy();
  const undoneDate = file.undoneAt
    ? new Date(file.undoneAt).toLocaleDateString("pt-BR")
    : null;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1 text-sm">
      <FileText
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <a
        href={financeAssetUrl(file.id)}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
        aria-label={t("finance:files.downloadAria", { name: file.name })}
      >
        {file.name}
      </a>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {formatFileSize(file.size)}
      </span>
      {file.drive ? (
        <Badge
          variant={
            file.drive === "copied"
              ? "success"
              : file.drive === "failed"
                ? "destructive"
                : "outline"
          }
          data-testid="drive-badge"
        >
          {t(`finance:files.drive.${file.drive}`)}
        </Badge>
      ) : null}
      {file.drive === "failed" && canRetryDrive ? (
        <Button
          variant="outline"
          size="xs"
          disabled={retryDrive.isPending}
          onClick={() =>
            retryDrive.mutate(file.id, {
              onError: () => toast.error(t("finance:files.drive.retryError")),
            })
          }
        >
          {t("finance:files.drive.retry")}
        </Button>
      ) : null}
      {undone && undoneDate && (
        <span className="w-full pl-6 text-xs text-warning-foreground">
          {file.undoneByName
            ? t("finance:files.undoneNote", {
                name: file.undoneByName,
                date: undoneDate,
              })
            : t("finance:files.undoneNoteAnon", { date: undoneDate })}
        </span>
      )}
    </li>
  );
}
