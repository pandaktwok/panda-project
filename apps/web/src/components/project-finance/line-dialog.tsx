import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  FinanceLine,
  FinanceState,
} from "@/fetchers/project-finance/types";
import {
  formatCents,
  formatCentsPlain,
  parseMoneyToCents,
} from "@/lib/finance/money";
import MoneyField from "./money-field";

const NO_TAG = "__none__";

type Props = {
  open: boolean;
  onClose: () => void;
  state: FinanceState;
  /** null = criar. */
  line: FinanceLine | null;
  saving: boolean;
  onSubmit: (input: {
    supplier: string;
    tagId: string | null;
    firstDueDate: string;
    isFixedAmount?: boolean;
    totalCents?: number;
    installmentsCount?: number;
    finalDueDate?: string;
  }) => void;
};

/** Meses entre duas datas AAAA-MM-DD, incluindo os dois meses (mesma regra do
 * back-end em dates.ts: monthsBetweenInclusive). */
function monthsBetweenInclusive(first: string, final: string): number | null {
  const [fy, fm] = first.split("-").map(Number);
  const [ly, lm] = final.split("-").map(Number);
  if (!fy || !fm || !ly || !lm) return null;
  const months = ly * 12 + (lm - 1) - (fy * 12 + (fm - 1)) + 1;
  return months >= 1 ? months : null;
}

export default function LineDialog(props: Props) {
  const { open, onClose, line } = props;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        {open && <LineForm key={line?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function LineForm({ onClose, state, line, saving, onSubmit }: Props) {
  const { t } = useTranslation();
  const paidCount = line
    ? line.installments.filter((i) => i.status === "paid").length
    : 0;

  const [supplier, setSupplier] = useState(line?.supplier ?? "");
  const [tagId, setTagId] = useState<string>(line?.tag?.id ?? NO_TAG);
  // Atualização 3: por padrão a linha tem valor fixo por parcela (comportamento
  // de sempre). Desmarcando, a parcela vira "automática": em vez de quantidade
  // de parcelas + valor de cada uma, se informa a data final, e o valor de
  // cada parcela é calculado a partir da sobra do orçamento da tag.
  const [isFixedAmount, setIsFixedAmount] = useState(
    line?.isFixedAmount ?? true,
  );
  // O que se digita é sempre o valor de CADA parcela; o total da linha é
  // calculado (valor da parcela × quantidade de parcelas). Ao editar uma
  // linha já existente, parte-se do total atual dividido pelas parcelas —
  // para linhas antigas cujo total não seja divisível exatamente, salvar
  // sem alterar o valor ajusta o total para o novo valor exato da parcela.
  const [eachText, setEachText] = useState(
    line
      ? formatCentsPlain(Math.floor(line.totalCents / line.installmentsCount))
      : "",
  );
  const [months, setMonths] = useState(
    String(line?.installmentsCount ?? state.project.months ?? ""),
  );
  const [firstDue, setFirstDue] = useState(
    line?.firstDueDate ?? state.project.firstDueDate ?? "",
  );
  const [finalDue, setFinalDue] = useState("");

  const eachCents = parseMoneyToCents(eachText);
  const monthsNumber = Number(months);
  const monthsValid =
    Number.isInteger(monthsNumber) && monthsNumber >= 1 && monthsNumber <= 600;
  const totalCents =
    eachCents !== null && monthsValid ? eachCents * monthsNumber : null;
  const dueValid = /^\d{4}-\d{2}-\d{2}$/.test(firstDue);
  const finalDueValid = /^\d{4}-\d{2}-\d{2}$/.test(finalDue);
  const autoMonths =
    dueValid && finalDueValid
      ? monthsBetweenInclusive(firstDue, finalDue)
      : null;
  const valid = isFixedAmount
    ? supplier.trim().length > 0 &&
      totalCents !== null &&
      monthsValid &&
      dueValid
    : supplier.trim().length > 0 &&
      tagId !== NO_TAG &&
      dueValid &&
      finalDueValid &&
      autoMonths !== null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {line
            ? t("finance:lineDialog.editTitle")
            : t("finance:lineDialog.newTitle")}
        </DialogTitle>
        <DialogDescription>
          {t("finance:lineDialog.description")}
        </DialogDescription>
      </DialogHeader>
      <form
        id="finance-line-form"
        className="space-y-4 px-6 pb-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          onSubmit(
            isFixedAmount
              ? {
                  supplier: supplier.trim(),
                  tagId: tagId === NO_TAG ? null : tagId,
                  isFixedAmount: true,
                  totalCents: totalCents as number,
                  installmentsCount: monthsNumber,
                  firstDueDate: firstDue,
                }
              : {
                  supplier: supplier.trim(),
                  tagId,
                  isFixedAmount: false,
                  firstDueDate: firstDue,
                  finalDueDate: finalDue,
                },
          );
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="finance-line-supplier"
            className="text-sm font-semibold"
          >
            {t("finance:lineDialog.supplier")}
          </label>
          <Input
            id="finance-line-supplier"
            value={supplier}
            maxLength={200}
            autoFocus
            required
            onChange={(event) => setSupplier(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span id="finance-line-tag-label" className="text-sm font-semibold">
            {t("finance:lineDialog.type")}
          </span>
          <Select
            value={tagId}
            onValueChange={(value) => setTagId((value as string) ?? NO_TAG)}
          >
            <SelectTrigger aria-labelledby="finance-line-tag-label">
              <SelectValue>
                {tagId === NO_TAG
                  ? t("finance:lineDialog.noType")
                  : (state.tags.find((tag) => tag.id === tagId)?.name ??
                    t("finance:lineDialog.noType"))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TAG}>
                {t("finance:lineDialog.noType")}
              </SelectItem>
              {state.tags.map((tag) => (
                <SelectItem key={tag.id} value={tag.id}>
                  {tag.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4"
            checked={isFixedAmount}
            onChange={(event) => setIsFixedAmount(event.target.checked)}
          />
          {t("finance:lineDialog.isFixedAmount")}
        </label>
        {!isFixedAmount && (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            {t("finance:lineDialog.automaticHint")}
          </p>
        )}
        {isFixedAmount ? (
          <>
            <MoneyField
              id="finance-line-total"
              label={t("finance:lineDialog.each")}
              value={eachText}
              onChange={setEachText}
              required
              error={
                eachText.trim() !== "" && eachCents === null
                  ? t("finance:common.amountInvalid")
                  : null
              }
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="finance-line-months"
                  className="text-sm font-semibold"
                >
                  {t("finance:lineDialog.months")}
                </label>
                <Input
                  id="finance-line-months"
                  type="number"
                  min={1}
                  max={600}
                  inputMode="numeric"
                  value={months}
                  required
                  aria-invalid={months !== "" && !monthsValid}
                  onChange={(event) => setMonths(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="finance-line-first"
                  className="text-sm font-semibold"
                >
                  {t("finance:lineDialog.firstDue")}
                </label>
                <Input
                  id="finance-line-first"
                  type="date"
                  value={firstDue}
                  required
                  onChange={(event) => setFirstDue(event.target.value)}
                />
              </div>
            </div>
            {totalCents !== null && eachCents !== null && (
              <p
                className="rounded-lg bg-muted/50 px-3 py-2 text-sm font-medium tabular-nums"
                data-testid="line-preview"
              >
                {t("finance:lineDialog.previewExact", {
                  count: monthsNumber,
                  each: formatCents(eachCents),
                  total: formatCents(totalCents),
                })}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="finance-line-first"
                  className="text-sm font-semibold"
                >
                  {t("finance:lineDialog.firstDue")}
                </label>
                <Input
                  id="finance-line-first"
                  type="date"
                  value={firstDue}
                  required
                  onChange={(event) => setFirstDue(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="finance-line-final"
                  className="text-sm font-semibold"
                >
                  {t("finance:lineDialog.finalDue")}
                </label>
                <Input
                  id="finance-line-final"
                  type="date"
                  value={finalDue}
                  required
                  aria-invalid={finalDueValid && autoMonths === null}
                  onChange={(event) => setFinalDue(event.target.value)}
                />
              </div>
            </div>
            {autoMonths !== null && (
              <p
                className="rounded-lg bg-muted/50 px-3 py-2 text-sm font-medium tabular-nums"
                data-testid="line-preview"
              >
                {t("finance:lineDialog.previewAuto", { count: autoMonths })}
              </p>
            )}
          </>
        )}
        {line && paidCount > 0 && (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            {t("finance:lineDialog.paidNote", { count: paidCount })}
          </p>
        )}
      </form>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          type="submit"
          form="finance-line-form"
          disabled={!valid || saving}
        >
          {t("finance:common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
