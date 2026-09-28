import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type {
  FinanceState,
  FinanceTag,
} from "@/fetchers/project-finance/types";
import { cn } from "@/lib/cn";
import { formatBasisPoints, formatCents } from "@/lib/finance/money";
import {
  type ScheduleModel,
  TAG_PALETTE,
  tagPaletteFor,
} from "@/lib/finance/schedule";

type Props = {
  state: FinanceState;
  model: ScheduleModel;
  canManage: boolean;
  onCreate: () => void;
  onEdit: (tag: FinanceTag) => void;
  onDelete: (tag: FinanceTag) => void;
};

export function TagPill({
  state,
  tagId,
  name,
}: {
  state: FinanceState;
  tagId: string | null;
  name: string;
}) {
  const palette = tagPaletteFor(state, tagId) ?? TAG_PALETTE[0];
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full px-2.5 py-0.5 text-xs font-semibold",
        palette.bg,
        palette.fg,
      )}
    >
      {name}
    </span>
  );
}

export default function TagsSection({
  state,
  model,
  canManage,
  onCreate,
  onEdit,
  onDelete,
}: Props) {
  const { t } = useTranslation();

  return (
    <section
      aria-labelledby="finance-tags-title"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex flex-col gap-3 px-5 pt-4 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2
            id="finance-tags-title"
            className="text-lg font-bold tracking-tight"
          >
            {t("finance:tags.title")}
          </h2>
          <p className="mt-1 max-w-[78ch] text-sm text-muted-foreground">
            {t("finance:tags.intro")}
          </p>
        </div>
        {canManage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 self-start"
            onClick={onCreate}
          >
            <Plus />
            {t("finance:tags.new")}
          </Button>
        )}
      </div>

      {model.tagRows.length === 0 ? (
        <p className="border-t border-border px-5 py-6 text-sm text-muted-foreground">
          {t("finance:tags.empty")}
        </p>
      ) : (
        <div className="border-t border-border">
          <div
            className="hidden grid-cols-[200px_minmax(0,1fr)_150px_230px_72px] gap-x-4 border-b border-border bg-muted/40 px-5 py-2 text-[11px] font-semibold tracking-wider text-foreground/75 uppercase md:grid"
            aria-hidden="true"
          >
            <div>{t("finance:tags.colTag")}</div>
            <div>{t("finance:tags.colMeaning")}</div>
            <div>{t("finance:tags.colValue")}</div>
            <div>{t("finance:tags.colPaid")}</div>
            <div />
          </div>
          <ul>
            {model.tagRows.map(({ tag, paidCents, paidBasisPoints }) => (
              <li
                key={tag.id}
                className="grid grid-cols-1 gap-x-4 gap-y-2 border-b border-border/70 px-5 py-3.5 last:border-b-0 md:grid-cols-[200px_minmax(0,1fr)_150px_230px_72px] md:items-center"
              >
                <div className="min-w-0">
                  <TagPill state={state} tagId={tag.id} name={tag.name} />
                </div>
                <div className="text-sm text-foreground/80">
                  {tag.description || (
                    <span className="text-muted-foreground">
                      {t("finance:tags.noDescription")}
                    </span>
                  )}
                </div>
                <div className="text-sm tabular-nums">
                  <div className="font-semibold">
                    <span className="mr-2 text-xs font-medium text-muted-foreground md:hidden">
                      {t("finance:tags.colValue")}
                    </span>
                    {formatCents(tag.valueCents)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("finance:tags.committed", {
                      value: formatCents(tag.linesTotalCents),
                    })}
                  </div>
                  <div
                    className={cn(
                      "text-xs font-medium",
                      tag.valueCents - tag.linesTotalCents < 0
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {t("finance:tags.balance", {
                      value: formatCents(tag.valueCents - tag.linesTotalCents),
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-[13px] tabular-nums">
                    <strong>{formatCents(paidCents)}</strong>{" "}
                    <span className="text-muted-foreground">
                      · {formatBasisPoints(paidBasisPoints)}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-1 rounded-full bg-muted"
                    role="presentation"
                  >
                    <div
                      className="h-1 rounded-full bg-success"
                      style={{
                        width: `${Math.min(100, paidBasisPoints / 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="flex justify-start gap-1 md:justify-end">
                  {canManage && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("finance:tags.editAria", {
                          name: tag.name,
                        })}
                        onClick={() => onEdit(tag)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("finance:tags.deleteAria", {
                          name: tag.name,
                        })}
                        onClick={() => onDelete(tag)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
