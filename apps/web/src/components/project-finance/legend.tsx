import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

function Swatch({ className }: { className: string }) {
  return (
    <span
      className={cn("size-4 shrink-0 rounded", className)}
      aria-hidden="true"
    />
  );
}

export default function Legend() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-foreground/80">
      <span className="flex items-center gap-1.5">
        <Swatch className="border border-success bg-success/14" />
        {t("finance:legend.paid")}
      </span>
      <span className="flex items-center gap-1.5">
        <Swatch className="border-2 border-dashed border-success bg-success/14" />
        {t("finance:legend.unsaved")}
      </span>
      <span className="flex items-center gap-1.5">
        <Swatch className="border border-warning bg-warning/16" />
        {t("finance:legend.overdue")}
      </span>
      <span className="flex items-center gap-1.5">
        <Swatch className="border border-border bg-background" />
        {t("finance:legend.pending")}
      </span>
      <span className="flex items-center gap-1.5">
        <Swatch className="bg-destructive" />
        {t("finance:legend.finalStretch")}
      </span>
      <span className="text-muted-foreground">{t("finance:legend.hint")}</span>
    </div>
  );
}
