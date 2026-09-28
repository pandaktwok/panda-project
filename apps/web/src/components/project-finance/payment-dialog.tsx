import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { FinanceState } from "@/fetchers/project-finance/types";
import { financeFolderPath, paymentPdfName } from "@/lib/finance/file-names";
import {
  formatCents,
  formatCentsPlain,
  formatIsoDate,
  formatIsoDayMonth,
  parseMoneyToCents,
} from "@/lib/finance/money";
import {
  type CellModel,
  type Mark,
  type Marks,
  previewMark,
  type RowModel,
} from "@/lib/finance/schedule";
import FileList, { type NamedFile } from "./file-list";
import { TagPill } from "./tags-section";

// A prévia do recálculo não depende dos arquivos.
const PREVIEW_FILE = { assetId: "", name: "", size: 0, label: "" };

type Props = {
  open: boolean;
  onClose: () => void;
  state: FinanceState;
  marks: Marks;
  cell: CellModel | null;
  row: RowModel | null;
  projectId: string;
  projectName: string;
  onConfirm: (installmentId: string, mark: Mark) => void;
  onRemoveMark: (installmentId: string) => void;
};

export default function PaymentDialog(props: Props) {
  const { open, onClose, cell, row } = props;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        {cell?.installmentId && row ? (
          <PaymentForm
            key={cell.installmentId}
            {...props}
            cell={cell}
            row={row}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({
  onClose,
  state,
  marks,
  cell,
  row,
  projectId,
  projectName,
  onConfirm,
  onRemoveMark,
}: Omit<Props, "open" | "cell" | "row"> & { cell: CellModel; row: RowModel }) {
  const { t } = useTranslation();
  const installmentId = cell.installmentId as string;
  const existing = marks[installmentId];
  const expectedNow = cell.serverExpectedCents;

  const [amountText, setAmountText] = useState(() =>
    formatCentsPlain(existing ? existing.paidCents : cell.amountCents),
  );
  const [date, setDate] = useState(existing?.paidAt ?? state.asOf);
  const [receipts, setReceipts] = useState<NamedFile[]>(
    existing?.receipts ?? [],
  );
  const [invoices, setInvoices] = useState<NamedFile[]>(
    existing?.invoices ?? [],
  );
  const [uploadsBusy, setUploadsBusy] = useState(0);

  const paidCents = parseMoneyToCents(amountText);
  const validAmount = paidCents !== null && paidCents > 0;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const hasFiles = receipts.length > 0 && invoices.length > 0;
  const canConfirm = validAmount && validDate && hasFiles && uploadsBusy === 0;
  const trackBusy = (busy: boolean) =>
    setUploadsBusy((count) => Math.max(0, count + (busy ? 1 : -1)));

  const preview = useMemo(
    () =>
      validAmount && validDate
        ? previewMark(state, marks, installmentId, {
            paidCents: paidCents as number,
            paidAt: date,
            receipts: existing?.receipts ?? [PREVIEW_FILE],
            invoices: existing?.invoices ?? [PREVIEW_FILE],
          })
        : null,
    [
      state,
      marks,
      installmentId,
      paidCents,
      validAmount,
      validDate,
      date,
      existing,
    ],
  );

  const supplier = row.line.supplier;
  const differenceCents = preview?.differenceCents ?? 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-xl font-bold tracking-tight">
          {t("finance:payment.title")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("finance:payment.description")}
        </DialogDescription>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{supplier}</span>
          {row.line.tag && (
            <TagPill
              state={state}
              tagId={row.line.tag.id}
              name={row.line.tag.name}
            />
          )}
          <span className="text-muted-foreground">
            {t("finance:payment.meta", {
              number: cell.number,
              total: row.line.installmentsCount,
              due: cell.dueDate ? formatIsoDate(cell.dueDate) : "—",
              expected: formatCents(preview?.expectedCents ?? expectedNow),
            })}
          </span>
        </div>
      </DialogHeader>

      <DialogPanel>
        <form
          id="finance-payment-form"
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canConfirm || receipts.length === 0 || invoices.length === 0)
              return;
            onConfirm(installmentId, {
              paidCents: paidCents as number,
              paidAt: date,
              receipts,
              invoices,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="finance-paid-amount"
                className="text-sm font-semibold"
              >
                {t("finance:payment.paidAmount")}
              </label>
              <Input
                id="finance-paid-amount"
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
                aria-invalid={!validAmount}
                className="font-bold tabular-nums"
              />
              {!validAmount ? (
                <span className="text-xs text-destructive-foreground">
                  {t("finance:payment.amountInvalid")}
                </span>
              ) : differenceCents !== 0 ? (
                <span className="text-xs text-warning-foreground">
                  {differenceCents > 0
                    ? t("finance:payment.above", {
                        amount: formatCents(differenceCents),
                      })
                    : t("finance:payment.below", {
                        amount: formatCents(-differenceCents),
                      })}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="finance-paid-date"
                className="text-sm font-semibold"
              >
                {t("finance:payment.paidDate")}
              </label>
              <Input
                id="finance-paid-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-invalid={!validDate}
                className="tabular-nums"
              />
            </div>
          </div>

          <fieldset className="space-y-3 rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-semibold">
              {t("finance:payment.filesTitle")}
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <FileList
                projectId={projectId}
                purpose="receipt"
                title={t("finance:payment.receiptLabel")}
                addLabel={t("finance:payment.addReceipt")}
                value={receipts}
                onChange={setReceipts}
                onBusyChange={trackBusy}
              />
              <FileList
                projectId={projectId}
                purpose="invoice"
                title={t("finance:payment.invoiceLabel")}
                addLabel={t("finance:payment.addInvoice")}
                value={invoices}
                onChange={setInvoices}
                onBusyChange={trackBusy}
              />
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              {t("finance:payment.mergeInfo", {
                name: paymentPdfName(supplier, cell.number),
              })}
              <br />
              {t("finance:payment.folderInfo", {
                path: financeFolderPath(projectName, cell.number, cell.dueDate),
              })}
            </p>
            {!hasFiles && (
              <p className="text-[12.5px] font-semibold text-warning-foreground">
                {t("finance:payment.filesRequired")}
              </p>
            )}
          </fieldset>

          {preview && differenceCents !== 0 && preview.after.length > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning/8 p-4 text-warning-foreground">
              <div className="font-bold">
                {t("finance:payment.adjustTitle")}
              </div>
              <div className="mt-1 tabular-nums">
                {t("finance:payment.formula", {
                  total: formatCents(preview.formula.lineTotalCents),
                  paid: formatCents(preview.formula.paidTotalCents),
                  installments: preview.formula.installmentsCount,
                  paidCount: preview.formula.paidCount,
                  each: formatCents(preview.formula.perInstallmentCents ?? 0),
                })}
              </div>
              <div className="mt-0.5 text-[12.5px]">
                {t("finance:payment.formulaTotals", {
                  paid: formatCents(preview.formula.paidTotalCents),
                  paidCount: preview.formula.paidCount,
                  installments: preview.formula.installmentsCount,
                })}
              </div>
              <table className="mt-3 w-full overflow-hidden rounded-lg border border-warning/40 bg-background text-left text-foreground tabular-nums">
                <caption className="sr-only">
                  {t("finance:payment.adjustTableAria")}
                </caption>
                <thead>
                  <tr className="bg-warning/16 text-[11px] tracking-wider uppercase">
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {t("finance:payment.colInstallment")}
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {t("finance:payment.colBefore")}
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {t("finance:payment.colAfter")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.after.map((afterItem, index) => {
                    const beforeItem = preview.before[index];
                    return (
                      <tr
                        key={afterItem.number}
                        className="border-t border-warning/30"
                      >
                        <td className="px-3 py-2">
                          {afterItem.number}
                          {afterItem.dueDate
                            ? ` · ${formatIsoDayMonth(afterItem.dueDate)}`
                            : ""}
                        </td>
                        <td className="px-3 py-2">
                          {formatCents(beforeItem?.cents ?? 0)}
                        </td>
                        <td className="px-3 py-2 font-bold">
                          {formatCents(afterItem.cents)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {preview.warning && (
                <div className="mt-2 text-[12.5px] font-semibold">
                  {t("finance:payment.warningReachedTotal")}
                </div>
              )}
            </div>
          )}
          {preview && differenceCents === 0 && (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              {t("finance:payment.noAdjust")}
            </p>
          )}
        </form>
      </DialogPanel>

      <DialogFooter className="items-center sm:justify-between">
        <span className="max-w-[40ch] text-[12.5px] text-muted-foreground">
          {t("finance:payment.footerHint")}
        </span>
        <div className="flex flex-wrap gap-2.5">
          {existing && (
            <Button
              type="button"
              variant="destructive-outline"
              onClick={() => {
                onRemoveMark(installmentId);
              }}
            >
              {t("finance:payment.removeMark")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            {t("finance:payment.cancel")}
          </Button>
          <Button
            type="submit"
            form="finance-payment-form"
            disabled={!canConfirm}
          >
            {t("finance:payment.confirm")}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
