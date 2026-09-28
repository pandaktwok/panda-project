import {
  Check,
  Circle,
  Clock,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type {
  FinanceLine,
  FinanceState,
} from "@/fetchers/project-finance/types";
import { cn } from "@/lib/cn";
import {
  diffIsoDays,
  formatCents,
  formatIsoDayMonth,
} from "@/lib/finance/money";
import type {
  CellModel,
  RowModel,
  ScheduleModel,
} from "@/lib/finance/schedule";
import { TagPill } from "./tags-section";

export const COLUMN_WIDTH = 160;
export const VISIBLE_COLUMNS = 3;

type Props = {
  state: FinanceState;
  model: ScheduleModel;
  canManage: boolean;
  canPay: boolean;
  canUndo: boolean;
  saving: boolean;
  onCellClick: (cell: CellModel, row: RowModel) => void;
  onNewLine: () => void;
  onEditLine: (line: FinanceLine) => void;
  onDeleteLine: (line: FinanceLine) => void;
  onSave: () => void;
  onDiscard: () => void;
};

function cellClasses(cell: CellModel) {
  const tint = cell.isFinalStretch ? "bg-destructive/6" : "bg-background";
  switch (cell.status) {
    case "paid":
      return "bg-success/14 text-success-foreground";
    case "unsaved":
      return "bg-success/14 text-success-foreground outline-2 -outline-offset-[5px] outline-dashed outline-success";
    case "overdue":
      return "bg-warning/16 text-warning-foreground";
    case "pending":
      return cn(tint, "text-foreground/85");
    default:
      return cn(
        cell.isFinalStretch ? "bg-destructive/6" : "bg-muted/30",
        "text-muted-foreground",
      );
  }
}

export default function PaymentTable({
  state,
  model,
  canManage,
  canPay,
  canUndo,
  saving,
  onCellClick,
  onNewLine,
  onEditLine,
  onDeleteLine,
  onSave,
  onDiscard,
}: Props) {
  const { t } = useTranslation();
  const outerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const positioned = useRef(false);

  // Ao abrir, a rolagem já mostra a próxima parcela pendente.
  useEffect(() => {
    if (positioned.current || model.firstOpenNumber === null) return;
    positioned.current = true;
    const center = scrollRef.current;
    const outer = outerRef.current;
    const maxStart = Math.max(0, model.columns - VISIBLE_COLUMNS);
    const start = Math.min(model.firstOpenNumber - 1, maxStart);
    const left = start * COLUMN_WIDTH;
    if (center && center.scrollWidth > center.clientWidth + 1) {
      center.scrollLeft = left;
    } else if (outer && outer.scrollWidth > outer.clientWidth + 1) {
      outer.scrollLeft = left;
    }
  }, [model.firstOpenNumber, model.columns]);

  if (model.rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card px-5 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          {t("finance:table.empty")}
        </p>
        {canManage && (
          <Button type="button" size="sm" className="mt-4" onClick={onNewLine}>
            <Plus />
            {t("finance:table.newLine")}
          </Button>
        )}
      </div>
    );
  }

  const noneChanged = model.changes === 0;
  const totalWidth = model.columns * COLUMN_WIDTH;

  const noteFor = (cell: CellModel): string => {
    switch (cell.status) {
      case "paid":
        return t("finance:cell.paidOn", {
          date: cell.paidAt ? formatIsoDayMonth(cell.paidAt) : "—",
        });
      case "unsaved":
        return t("finance:cell.markedNotSaved");
      case "overdue":
        return t("finance:cell.overdueDays", {
          count: cell.dueDate ? diffIsoDays(cell.dueDate, state.asOf) : 0,
        });
      case "pending":
        return t("finance:cell.dueOn", {
          date: cell.dueDate ? formatIsoDayMonth(cell.dueDate) : "—",
        });
      default:
        return "—";
    }
  };

  const wordFor = (cell: CellModel): string =>
    t(`finance:cell.status.${cell.status}`);

  const lockedReason = (cell: CellModel): string | null => {
    if (cell.status === "empty") return t("finance:cell.noInstallment");
    if (cell.status === "paid") {
      return canUndo ? null : t("finance:cell.paidLocked");
    }
    return canPay ? null : t("finance:cell.noPayPermission");
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {canManage && (
        <div className="flex justify-end border-b border-border px-3 py-2">
          <Button type="button" variant="outline" size="sm" onClick={onNewLine}>
            <Plus />
            {t("finance:table.newLine")}
          </Button>
        </div>
      )}

      <div ref={outerRef} className="overflow-x-auto">
        <div className="flex w-full min-w-max">
          {/* Bloco fixo da esquerda: fornecedor */}
          <div className="sticky left-0 z-10 w-[150px] shrink-0 border-r border-border bg-card sm:w-[200px] md:static">
            <div className="h-8 border-b border-border/70 bg-muted/40" />
            <div className="flex h-16 items-center border-b border-border bg-muted/60 px-4 text-[11px] font-semibold tracking-wider text-foreground/80 uppercase">
              {t("finance:table.supplier")}
            </div>
            {model.rows.map((row) => (
              <div
                key={row.line.id}
                className="flex h-[60px] items-center gap-1 border-b border-border/70 pr-1 pl-4"
              >
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate font-semibold"
                    title={row.line.supplier}
                  >
                    {row.line.supplier}
                  </div>
                  <div className="truncate text-xs text-muted-foreground tabular-nums">
                    {row.line.installmentsCount === 1
                      ? t("finance:table.singlePayment")
                      : t("finance:table.plan", {
                          installments: row.line.installmentsCount,
                          amount: formatCents(
                            Math.floor(
                              row.line.totalCents / row.line.installmentsCount,
                            ),
                          ),
                        })}
                  </div>
                </div>
                {canManage && (
                  <div className="flex shrink-0 flex-col sm:flex-row">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("finance:table.editLineAria", {
                        name: row.line.supplier,
                      })}
                      onClick={() => onEditLine(row.line)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("finance:table.deleteLineAria", {
                        name: row.line.supplier,
                      })}
                      onClick={() => onDeleteLine(row.line)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </div>
            ))}
            <div className="flex h-14 items-center bg-muted/40 px-4 font-bold">
              {t("finance:table.grandTotal")}
            </div>
          </div>

          {/* Centro: parcelas (3 por vez; rola para o lado) */}
          <section
            ref={scrollRef}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a área rolável precisa de foco para rolar pelo teclado
            tabIndex={0}
            aria-label={t("finance:table.scrollAria")}
            className="md:w-[480px] md:shrink-0 md:overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <div style={{ width: totalWidth }}>
              <div className="flex h-8 items-center gap-2 border-b border-border/70 bg-muted/40 px-3.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                <span>{t("finance:table.payments")}</span>
                <span className="font-medium tracking-normal normal-case">
                  {t("finance:table.scrollHint")}
                </span>
              </div>
              <div className="flex">
                {model.heads.map((head) => (
                  <div
                    key={head.number}
                    style={{ width: COLUMN_WIDTH }}
                    className={cn(
                      "flex h-16 shrink-0 flex-col justify-center border-r px-3.5",
                      head.isFinalStretch
                        ? "border-destructive/70 bg-destructive text-white"
                        : "border-border bg-muted/60 text-foreground/85",
                    )}
                  >
                    <span className="text-[11px] font-semibold tracking-wide uppercase">
                      {head.isFinalStretch
                        ? t("finance:table.installmentFinal", {
                            number: head.number,
                          })
                        : t("finance:table.installment", {
                            number: head.number,
                          })}
                    </span>
                    <span className="text-[17px] font-bold tabular-nums">
                      {head.date ? formatIsoDayMonth(head.date) : "—"}
                    </span>
                  </div>
                ))}
              </div>
              {model.rows.map((row) => (
                <div key={row.line.id} className="flex">
                  {row.cells.map((cell) => {
                    const reason = lockedReason(cell);
                    const amount =
                      cell.status === "empty"
                        ? "—"
                        : formatCents(cell.amountCents);
                    return (
                      <button
                        key={`${row.line.id}-${cell.number}`}
                        type="button"
                        style={{ width: COLUMN_WIDTH }}
                        disabled={reason !== null}
                        title={reason ?? undefined}
                        aria-label={t("finance:cell.aria", {
                          supplier: row.line.supplier,
                          number: cell.number,
                          amount,
                          status: wordFor(cell),
                        })}
                        onClick={() => onCellClick(cell, row)}
                        className={cn(
                          "flex h-[60px] shrink-0 flex-col justify-center gap-px border-r border-b px-3.5 text-left tabular-nums transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                          cell.isFinalStretch
                            ? "border-r-destructive/40"
                            : "border-r-border",
                          "border-b-border/70",
                          cellClasses(cell),
                          reason === null
                            ? "cursor-pointer hover:brightness-95"
                            : "cursor-default disabled:opacity-100",
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-semibold">
                          {cell.status === "paid" ||
                          cell.status === "unsaved" ? (
                            <Check className="size-3.5" aria-hidden="true" />
                          ) : cell.status === "overdue" ? (
                            <TriangleAlert
                              className="size-3.5"
                              aria-hidden="true"
                            />
                          ) : cell.status === "pending" ? (
                            <Clock
                              className="size-3.5 opacity-60"
                              aria-hidden="true"
                            />
                          ) : (
                            <Circle
                              className="size-3 opacity-30"
                              aria-hidden="true"
                            />
                          )}
                          <span>{amount}</span>
                        </span>
                        <span className="text-[11.5px]">{noteFor(cell)}</span>
                      </button>
                    );
                  })}
                  {/* Linhas com menos parcelas: preenche o resto só para manter a grade */}
                  {model.heads.slice(row.cells.length).map((head) => (
                    <div
                      key={`${row.line.id}-pad-${head.number}`}
                      aria-hidden="true"
                      style={{ width: COLUMN_WIDTH }}
                      className="h-[60px] shrink-0 border-r border-b border-border/70 border-r-border bg-muted/10"
                    />
                  ))}
                </div>
              ))}
              <div className="flex">
                {model.columnTotals.map((total, index) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: colunas são posições fixas
                    key={index}
                    style={{ width: COLUMN_WIDTH }}
                    className={cn(
                      "flex h-14 shrink-0 items-center border-r px-3.5 font-semibold text-foreground/85 tabular-nums",
                      model.heads[index]?.isFinalStretch
                        ? "border-destructive/40 bg-destructive/6"
                        : "border-border/70 bg-muted/40",
                    )}
                  >
                    {formatCents(total)}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Bloco fixo da direita: tipo e totais */}
          <div className="w-[430px] shrink-0 border-l border-border bg-card md:w-auto md:min-w-[430px] md:flex-1">
            <div className="h-8 border-b border-border/70 bg-muted/40" />
            <div className="flex h-16 border-b border-border bg-muted/60 text-[11px] font-semibold tracking-wider text-foreground/80 uppercase">
              <div className="flex w-[150px] shrink-0 items-center px-3.5">
                {t("finance:table.type")}
              </div>
              <div className="flex w-[140px] shrink-0 items-center px-3.5">
                {t("finance:table.totalPaid")}
              </div>
              <div className="flex flex-1 items-center px-3.5 whitespace-nowrap">
                {t("finance:table.lineTotal")}
              </div>
            </div>
            {model.rows.map((row) => (
              <div
                key={row.line.id}
                className="flex h-[60px] border-b border-border/70"
              >
                <div className="flex w-[150px] shrink-0 items-center px-3.5">
                  {row.line.tag ? (
                    <TagPill
                      state={state}
                      tagId={row.line.tag.id}
                      name={row.line.tag.name}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("finance:table.noType")}
                    </span>
                  )}
                </div>
                <div className="flex w-[140px] shrink-0 flex-col justify-center px-3.5 tabular-nums">
                  <span className="font-bold whitespace-nowrap text-success-foreground">
                    {formatCents(row.paidCents)}
                  </span>
                  <div className="mt-1.5 h-1 rounded-full bg-muted">
                    <div
                      className="h-1 rounded-full bg-success"
                      style={{
                        width: `${Math.min(100, row.paidBasisPoints / 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="flex flex-1 flex-col justify-center px-3.5 font-semibold whitespace-nowrap tabular-nums">
                  {formatCents(row.line.totalCents)}
                  {row.warning && (
                    <span className="text-[11px] font-medium text-warning-foreground">
                      {t("finance:table.warningReachedTotal")}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div className="flex h-14 bg-muted/40 font-bold tabular-nums">
              <div className="w-[150px] shrink-0" />
              <div className="flex w-[140px] shrink-0 items-center px-3.5 whitespace-nowrap text-success-foreground">
                {formatCents(model.totals.paidCents)}
              </div>
              <div className="flex flex-1 items-center px-3.5 whitespace-nowrap">
                {formatCents(model.totals.linesTotalCents)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Barra de salvar */}
      <div className="flex flex-col gap-3 border-t border-border bg-muted/30 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              noneChanged ? "bg-muted-foreground/50" : "bg-warning",
            )}
            aria-hidden="true"
          />
          <span className="font-semibold" role="status">
            {noneChanged
              ? t("finance:save.none")
              : t("finance:save.pending", { count: model.changes })}
          </span>
          <span className="text-sm text-muted-foreground">
            {t("finance:save.permissionNote")}
          </span>
        </div>
        <div className="flex gap-2.5">
          <Button
            type="button"
            variant="outline"
            disabled={noneChanged || saving}
            onClick={onDiscard}
          >
            {t("finance:save.discard")}
          </Button>
          <Button
            type="button"
            disabled={noneChanged || saving}
            onClick={onSave}
          >
            {saving ? t("finance:save.saving") : t("finance:save.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
