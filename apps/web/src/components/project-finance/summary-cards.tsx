import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import {
  formatBasisPoints,
  formatCents,
  formatIsoDayMonth,
} from "@/lib/finance/money";
import type { ScheduleModel } from "@/lib/finance/schedule";

type Props = { model: ScheduleModel };

function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card px-4 py-3.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export default function SummaryCards({ model }: Props) {
  const { t } = useTranslation();
  const { totals } = model;
  const executedPct = Math.min(100, totals.executedBasisPoints / 100);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card>
        <div className="text-xs font-semibold text-muted-foreground">
          {t("finance:cards.projectTotal")}
        </div>
        <div className="mt-1.5 text-lg font-bold whitespace-nowrap tabular-nums tracking-tight sm:text-2xl">
          {formatCents(totals.projectTotalCents)}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t("finance:cards.projectTotalHint", {
            count: model.tagRows.length,
          })}
        </div>
      </Card>

      <Card>
        <div className="text-xs font-semibold text-muted-foreground">
          {t("finance:cards.totalPaid")}
        </div>
        <div className="mt-1.5 text-lg font-bold whitespace-nowrap tabular-nums tracking-tight text-success-foreground sm:text-2xl">
          {formatCents(totals.paidCents)}
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(executedPct)}
          aria-label={t("finance:cards.executedAria")}
        >
          <div
            className="h-full rounded-full bg-success"
            style={{ width: `${executedPct}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t("finance:cards.executed", {
            percent: formatBasisPoints(totals.executedBasisPoints),
          })}
        </div>
      </Card>

      <Card>
        <div className="text-xs font-semibold text-muted-foreground">
          {t("finance:cards.toPay")}
        </div>
        <div className="mt-1.5 text-lg font-bold whitespace-nowrap tabular-nums tracking-tight sm:text-2xl">
          {formatCents(totals.remainingCents)}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {t("finance:cards.openInstallments", {
            count: totals.openInstallments,
          })}
        </div>
      </Card>

      <Card
        className={
          totals.overdueInstallments > 0
            ? "border-warning/40 bg-warning/8 text-warning-foreground"
            : undefined
        }
      >
        <div className="text-xs font-semibold">
          {t("finance:cards.overdue")}
        </div>
        <div className="mt-1.5 text-xl font-bold tabular-nums tracking-tight sm:text-2xl">
          {totals.overdueInstallments > 0
            ? t("finance:cards.overdueValue", {
                count: totals.overdueInstallments,
                amount: formatCents(totals.overdueCents),
              })
            : t("finance:cards.overdueNone")}
        </div>
        <div className="mt-0.5 text-xs">
          {totals.nextDue
            ? t("finance:cards.nextDue", {
                date: formatIsoDayMonth(totals.nextDue.date),
                amount: formatCents(totals.nextDue.cents),
              })
            : t("finance:cards.nextDueNone")}
        </div>
      </Card>
    </div>
  );
}
