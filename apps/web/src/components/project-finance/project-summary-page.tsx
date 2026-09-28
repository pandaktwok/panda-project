import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FinanceFileRequestError } from "@/fetchers/project-finance/files";
import {
  FinanceConflictError,
  type FinanceLine,
  type FinanceState,
  type FinanceTag,
} from "@/fetchers/project-finance/types";
import useUpdateProject from "@/hooks/mutations/project/use-update-project";
import { useProjectFinanceMutations } from "@/hooks/mutations/project-finance/use-project-finance-mutations";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetProjectFinance, {
  projectFinanceKey,
} from "@/hooks/queries/project-finance/use-get-project-finance";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { financeFileErrorMessage } from "@/lib/finance/file-errors";
import { formatCents, formatIsoDate } from "@/lib/finance/money";
import {
  buildSchedule,
  type CellModel,
  type Mark,
  type Marks,
  type RowModel,
} from "@/lib/finance/schedule";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import AttachmentsCard from "./attachments-card";
import ConfirmDialog from "./confirm-dialog";
import EditProjectDialog from "./edit-project-dialog";
import FinalStretchAlert from "./final-stretch-alert";
import Legend from "./legend";
import LineDialog from "./line-dialog";
import PaymentDialog from "./payment-dialog";
import PaymentTable from "./payment-table";
import SummaryCards from "./summary-cards";
import TagDialog from "./tag-dialog";
import TagsSection from "./tags-section";

type Props = { projectId: string; workspaceId: string };

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    try {
      const parsed = JSON.parse(error.message) as { message?: unknown };
      if (typeof parsed.message === "string") return parsed.message;
    } catch {
      // mensagem simples
    }
    return error.message;
  }
  return fallback;
}

/** Só valem as marcações de parcelas que continuam não pagas no estado atual. */
function pruneMarks(state: FinanceState | undefined, marks: Marks): Marks {
  if (!state) return marks;
  const open = new Set<string>();
  for (const line of state.lines) {
    for (const installment of line.installments) {
      if (installment.status !== "paid") open.add(installment.id);
    }
  }
  const next: Marks = {};
  for (const [id, mark] of Object.entries(marks)) {
    if (open.has(id)) next[id] = mark;
  }
  return next;
}

export default function ProjectSummaryPage({ projectId, workspaceId }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const permissions = useWorkspacePermission();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const {
    data: state,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetProjectFinance(projectId);
  const mutations = useProjectFinanceMutations(projectId);
  const { mutateAsync: updateProject, isPending: updatingProject } =
    useUpdateProject();

  const canManage = permissions.canManageFinance();
  const canPay = permissions.canPayFinance();
  const canUndo = permissions.canUndoFinance();
  const canEditProject = permissions.canUpdateProjects();

  const [rawMarks, setRawMarks] = useState<Marks>({});
  const marks = useMemo(() => pruneMarks(state, rawMarks), [state, rawMarks]);
  const model = useMemo(
    () => (state ? buildSchedule(state, marks) : null),
    [state, marks],
  );

  const [payTarget, setPayTarget] = useState<{
    cell: CellModel;
    row: RowModel;
  } | null>(null);
  const [undoTarget, setUndoTarget] = useState<{
    installmentId: string;
    supplier: string;
    number: number;
  } | null>(null);
  const [tagDialog, setTagDialog] = useState<{ tag: FinanceTag | null } | null>(
    null,
  );
  const [lineDialog, setLineDialog] = useState<{
    line: FinanceLine | null;
  } | null>(null);
  const [deleteTag, setDeleteTag] = useState<{
    tag: FinanceTag;
    linesInUse: number | null;
  } | null>(null);
  const [deleteLine, setDeleteLine] = useState<{
    line: FinanceLine;
    paidInstallments: number | null;
  } | null>(null);
  const [editingProject, setEditingProject] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  const handleCellClick = useCallback(
    (cell: CellModel, row: RowModel) => {
      if (cell.status === "paid" && cell.installmentId) {
        if (!canUndo) return;
        setUndoTarget({
          installmentId: cell.installmentId,
          supplier: row.line.supplier,
          number: cell.number,
        });
        return;
      }
      if (cell.status === "empty" || !cell.installmentId || !canPay) return;
      setPayTarget({ cell, row });
    },
    [canPay, canUndo],
  );

  const handleConfirmMark = (installmentId: string, mark: Mark) => {
    setRawMarks((current) => ({ ...current, [installmentId]: mark }));
    setConflict(null);
    setPayTarget(null);
  };

  const handleRemoveMark = (installmentId: string) => {
    setRawMarks((current) => {
      const next = { ...current };
      delete next[installmentId];
      return next;
    });
    setPayTarget(null);
  };

  const handleSave = async () => {
    if (!state) return;
    const payments = Object.entries(marks).map(([installmentId, mark]) => ({
      installmentId,
      paidCents: mark.paidCents,
      paidAt: mark.paidAt,
      receiptAssetIds: mark.receipts.map((f) => f.assetId),
      invoiceAssetIds: mark.invoices.map((f) => f.assetId),
    }));
    if (payments.length === 0) return;
    try {
      await mutations.save.mutateAsync({ version: state.version, payments });
      setRawMarks({});
      setConflict(null);
      toast.success(t("finance:toast.saved", { count: payments.length }));
    } catch (saveError) {
      if (saveError instanceof FinanceConflictError) {
        // Outra pessoa mexeu no meio: nada foi gravado. Mostramos o estado novo.
        if (saveError.state) {
          queryClient.setQueryData(
            projectFinanceKey(projectId),
            saveError.state,
          );
        } else {
          void refetch();
        }
        setConflict(saveError.message);
        return;
      }
      toast.error(
        saveError instanceof FinanceFileRequestError
          ? financeFileErrorMessage(saveError, t)
          : errorMessage(saveError, t("finance:toast.saveError")),
      );
    }
  };

  const runMutation = async (
    action: () => Promise<unknown>,
    successKey: string,
  ): Promise<boolean> => {
    try {
      await action();
      toast.success(t(successKey));
      return true;
    } catch (mutationError) {
      toast.error(errorMessage(mutationError, t("finance:toast.error")));
      return false;
    }
  };

  const handleConfirmUndo = async () => {
    if (!undoTarget) return;
    const target = undoTarget;
    await runMutation(
      () => mutations.undo.mutateAsync(target.installmentId),
      "finance:toast.undone",
    );
    setUndoTarget(null);
  };

  const handleDeleteTag = async (force: boolean) => {
    if (!deleteTag) return;
    const target = deleteTag;
    try {
      await mutations.deleteTag.mutateAsync({ tagId: target.tag.id, force });
      toast.success(t("finance:toast.tagDeleted"));
      setDeleteTag(null);
    } catch (deleteError) {
      if (
        deleteError instanceof FinanceConflictError &&
        deleteError.code === "TAG_IN_USE"
      ) {
        setDeleteTag({ tag: target.tag, linesInUse: deleteError.linesInUse });
        return;
      }
      toast.error(errorMessage(deleteError, t("finance:toast.error")));
      setDeleteTag(null);
    }
  };

  const handleDeleteLine = async (force: boolean) => {
    if (!deleteLine) return;
    const target = deleteLine;
    try {
      await mutations.deleteLine.mutateAsync({ lineId: target.line.id, force });
      toast.success(t("finance:toast.lineDeleted"));
      setDeleteLine(null);
    } catch (deleteError) {
      if (
        deleteError instanceof FinanceConflictError &&
        deleteError.code === "LINE_HAS_PAYMENTS"
      ) {
        setDeleteLine({
          line: target.line,
          paidInstallments: deleteError.paidInstallments,
        });
        return;
      }
      toast.error(errorMessage(deleteError, t("finance:toast.error")));
      setDeleteLine(null);
    }
  };

  const handleSaveProject = async (input: {
    name: string;
    description: string;
    financeTotalCents: number | null;
    financeMonths: number | null;
    financeFirstDueDate: string | null;
    label?: string | null;
  }) => {
    if (!project) return;
    try {
      if (
        canEditProject &&
        (input.name !== project.name ||
          input.description !== (project.description ?? "") ||
          input.label !== undefined)
      ) {
        await updateProject({
          id: project.id,
          name: input.name,
          icon: project.icon ?? "Layout",
          slug: project.slug,
          description: input.description,
          isPublic: project.isPublic ?? false,
          label: input.label,
        });
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
      }
      if (
        canManage &&
        (input.financeTotalCents !== project.financeTotalCents ||
          input.financeMonths !== project.financeMonths ||
          input.financeFirstDueDate !== project.financeFirstDueDate)
      ) {
        await mutations.updateSettings.mutateAsync({
          financeTotalCents: input.financeTotalCents,
          financeMonths: input.financeMonths,
          financeFirstDueDate: input.financeFirstDueDate,
        });
      }
      toast.success(t("finance:toast.projectSaved"));
      setEditingProject(false);
    } catch (projectError) {
      toast.error(errorMessage(projectError, t("finance:toast.error")));
    }
  };

  const projectName = project?.name ?? state?.project.name ?? "";

  const durationMonths = state?.project.months ?? (model ? model.columns : 0);
  const firstDate =
    state?.project.firstDueDate ??
    state?.lines.map((l) => l.firstDueDate).sort()[0] ??
    null;
  const lastDate = state
    ? (state.lines
        .flatMap((l) => l.installments.map((i) => i.dueDate))
        .sort()
        .at(-1) ?? null)
    : null;

  // Projeto escondido (chave "Ver" desligada) ou apagado: a API responde 404.
  if (isError && error instanceof HttpError && error.status === 404) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">
          {t("finance:page.notFoundTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("finance:page.notFoundBody")}
        </p>
      </div>
    );
  }

  if (!permissions.isCheckingPermissions && !permissions.canReadFinance()) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Alert variant="warning">
          <AlertTitle>{t("finance:page.noAccessTitle")}</AlertTitle>
          <AlertDescription>{t("finance:page.noAccessBody")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <PageTitle title={`${t("finance:nav.summary")} · ${projectName}`} />
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6 md:px-10 md:pb-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <h1 className="text-2xl leading-tight font-bold tracking-tight break-words sm:text-[32px]">
              {projectName || <Skeleton className="h-8 w-64" />}
            </h1>
            <p className="mt-2 text-[13px] text-muted-foreground">
              {t("finance:page.formatNote")}
            </p>
          </div>
          {(canEditProject || canManage) && project && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0 self-start"
              onClick={() => setEditingProject(true)}
            >
              {t("finance:page.editProject")}
            </Button>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <section
            aria-labelledby="finance-desc-title"
            className="rounded-xl border border-border bg-card p-5"
          >
            <h2
              id="finance-desc-title"
              className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase"
            >
              {t("finance:page.description")}
            </h2>
            {project?.description ? (
              <p className="max-w-[62ch] whitespace-pre-line text-foreground/85">
                {project.description}
              </p>
            ) : (
              <p className="text-muted-foreground">
                {t("finance:page.noDescription")}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2.5">
              <span className="rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-[13px]">
                {t("finance:page.duration", {
                  count: durationMonths,
                })}
              </span>
              <span className="rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-[13px] tabular-nums">
                {t("finance:page.firstInstallment", {
                  date: firstDate ? formatIsoDate(firstDate) : "—",
                })}
              </span>
              <span className="rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-[13px] tabular-nums">
                {t("finance:page.lastInstallment", {
                  date: lastDate ? formatIsoDate(lastDate) : "—",
                })}
              </span>
            </div>
          </section>

          <AttachmentsCard
            projectId={projectId}
            canRead={permissions.canReadFinance()}
            canAttach={permissions.canAttachFinance()}
            canManage={canManage}
          />
        </div>

        {isLoading && (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
        )}

        {isError && (
          <Alert variant="error">
            <AlertTitle>{t("finance:page.loadErrorTitle")}</AlertTitle>
            <AlertDescription>
              {errorMessage(error, t("finance:page.loadErrorBody"))}
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => refetch()}
                >
                  {t("finance:page.retry")}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {state && model && (
          <>
            <TagsSection
              state={state}
              model={model}
              canManage={canManage}
              onCreate={() => setTagDialog({ tag: null })}
              onEdit={(tag) => setTagDialog({ tag })}
              onDelete={(tag) => setDeleteTag({ tag, linesInUse: null })}
            />

            <section
              aria-labelledby="finance-schedule-title"
              className="flex flex-col gap-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2
                  id="finance-schedule-title"
                  className="text-xl font-bold tracking-tight sm:text-2xl"
                >
                  {t("finance:page.scheduleTitle")}
                </h2>
                <span className="text-[13px] text-muted-foreground tabular-nums">
                  {t("finance:page.today", { date: formatIsoDate(state.asOf) })}
                </span>
              </div>

              <SummaryCards model={model} />
              <FinalStretchAlert
                state={state}
                remainingCents={model.totals.remainingCents}
              />

              {conflict && (
                <Alert variant="warning">
                  <AlertTitle>{t("finance:conflict.title")}</AlertTitle>
                  <AlertDescription>
                    {t("finance:conflict.body")}{" "}
                    <span className="text-muted-foreground">({conflict})</span>
                  </AlertDescription>
                </Alert>
              )}

              <PaymentTable
                state={state}
                model={model}
                canManage={canManage}
                canPay={canPay}
                canUndo={canUndo}
                saving={mutations.save.isPending}
                onCellClick={handleCellClick}
                onNewLine={() => setLineDialog({ line: null })}
                onEditLine={(line) => setLineDialog({ line })}
                onDeleteLine={(line) =>
                  setDeleteLine({ line, paidInstallments: null })
                }
                onSave={handleSave}
                onDiscard={() => {
                  setRawMarks({});
                  setConflict(null);
                }}
              />
              <Legend />
            </section>

            <PaymentDialog
              open={payTarget !== null}
              onClose={() => setPayTarget(null)}
              state={state}
              marks={marks}
              cell={payTarget?.cell ?? null}
              row={payTarget?.row ?? null}
              projectId={projectId}
              projectName={projectName}
              onConfirm={handleConfirmMark}
              onRemoveMark={handleRemoveMark}
            />

            <TagDialog
              open={tagDialog !== null}
              projectId={projectId}
              onClose={() => setTagDialog(null)}
              tag={tagDialog?.tag ?? null}
              saving={
                mutations.createTag.isPending || mutations.updateTag.isPending
              }
              onSubmit={async (input) => {
                const editing = tagDialog?.tag ?? null;
                const ok = await runMutation(
                  () =>
                    editing
                      ? mutations.updateTag.mutateAsync({
                          tagId: editing.id,
                          data: input,
                        })
                      : mutations.createTag.mutateAsync(input),
                  editing
                    ? "finance:toast.tagUpdated"
                    : "finance:toast.tagCreated",
                );
                if (ok) setTagDialog(null);
              }}
            />

            <LineDialog
              open={lineDialog !== null}
              onClose={() => setLineDialog(null)}
              state={state}
              line={lineDialog?.line ?? null}
              saving={
                mutations.createLine.isPending || mutations.updateLine.isPending
              }
              onSubmit={async (input) => {
                const editing = lineDialog?.line ?? null;
                try {
                  const newState = editing
                    ? await mutations.updateLine.mutateAsync({
                        lineId: editing.id,
                        data: input,
                      })
                    : await mutations.createLine.mutateAsync(input);
                  toast.success(
                    t(
                      editing
                        ? "finance:toast.lineUpdated"
                        : "finance:toast.lineCreated",
                    ),
                  );
                  // Aviso (não bloqueia) quando a linha empurra a soma das
                  // linhas da etiqueta para além do orçamento dela.
                  const tag = input.tagId
                    ? newState.tags.find((item) => item.id === input.tagId)
                    : undefined;
                  if (tag && tag.linesTotalCents > tag.valueCents) {
                    toast.warning(
                      t("finance:toast.tagOverBudget", {
                        tag: tag.name,
                        value: formatCents(tag.valueCents),
                        committed: formatCents(tag.linesTotalCents),
                        over: formatCents(tag.linesTotalCents - tag.valueCents),
                      }),
                    );
                  }
                  setLineDialog(null);
                } catch (mutationError) {
                  toast.error(
                    errorMessage(mutationError, t("finance:toast.error")),
                  );
                }
              }}
            />
          </>
        )}

        <EditProjectDialog
          open={editingProject}
          onClose={() => setEditingProject(false)}
          project={project ?? null}
          canEditProject={canEditProject}
          canManageFinance={canManage}
          saving={updatingProject || mutations.updateSettings.isPending}
          onSubmit={handleSaveProject}
        />

        <ConfirmDialog
          open={undoTarget !== null}
          title={t("finance:undo.title")}
          description={`${t("finance:undo.body", {
            supplier: undoTarget?.supplier ?? "",
            number: undoTarget?.number ?? 0,
          })} ${t("finance:undo.keepsPdf")}`}
          confirmLabel={t("finance:undo.confirm")}
          cancelLabel={t("common:actions.cancel")}
          destructive
          busy={mutations.undo.isPending}
          onConfirm={handleConfirmUndo}
          onCancel={() => setUndoTarget(null)}
        />

        <ConfirmDialog
          open={deleteTag !== null}
          title={
            deleteTag?.linesInUse
              ? t("finance:deleteTag.inUseTitle")
              : t("finance:deleteTag.title")
          }
          description={
            deleteTag?.linesInUse
              ? t("finance:deleteTag.inUseBody", {
                  name: deleteTag.tag.name,
                  count: deleteTag.linesInUse,
                })
              : t("finance:deleteTag.body", { name: deleteTag?.tag.name ?? "" })
          }
          confirmLabel={
            deleteTag?.linesInUse
              ? t("finance:deleteTag.confirmForce")
              : t("finance:deleteTag.confirm")
          }
          cancelLabel={t("common:actions.cancel")}
          destructive
          busy={mutations.deleteTag.isPending}
          onConfirm={() => handleDeleteTag(Boolean(deleteTag?.linesInUse))}
          onCancel={() => setDeleteTag(null)}
        />

        <ConfirmDialog
          open={deleteLine !== null}
          title={
            deleteLine?.paidInstallments
              ? t("finance:deleteLine.paidTitle")
              : t("finance:deleteLine.title")
          }
          description={
            deleteLine?.paidInstallments
              ? t("finance:deleteLine.paidBody", {
                  name: deleteLine.line.supplier,
                  count: deleteLine.paidInstallments,
                })
              : t("finance:deleteLine.body", {
                  name: deleteLine?.line.supplier ?? "",
                })
          }
          confirmLabel={
            deleteLine?.paidInstallments
              ? t("finance:deleteLine.confirmForce")
              : t("finance:deleteLine.confirm")
          }
          cancelLabel={t("common:actions.cancel")}
          destructive
          busy={mutations.deleteLine.isPending}
          onConfirm={() =>
            handleDeleteLine(Boolean(deleteLine?.paidInstallments))
          }
          onCancel={() => setDeleteLine(null)}
        />
      </div>
    </div>
  );
}
