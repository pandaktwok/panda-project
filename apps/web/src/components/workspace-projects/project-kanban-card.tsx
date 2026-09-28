import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, CalendarClock, Wallet } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ProjectLabelPill } from "@/components/project-label-pill";
import { Progress } from "@/components/ui/progress";
import icons from "@/constants/project-icons";
import { cn } from "@/lib/cn";
import { formatCents, formatIsoDate } from "@/lib/finance/money";
import { isFinanceScheduleNearEnd } from "@/lib/finance/schedule-end";
import type { GetProjectsResponseItem } from "@/types/project";

type ProjectKanbanCardProps = {
  project: GetProjectsResponseItem;
  onClick: () => void;
};

export function ProjectKanbanCard({
  project,
  onClick,
}: ProjectKanbanCardProps) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition:
      transition || "transform 250ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
    opacity: isDragging ? 0.6 : 1,
    touchAction: isDragging ? "none" : "auto",
    zIndex: isDragging ? 999 : "auto",
  };

  const IconComponent =
    icons[project.icon as keyof typeof icons] || icons.Layout;
  const completion = project.statistics?.completionPercentage ?? 0;
  const isOverdue = project.hasOverdueFinanceInstallment;
  const isNearEnd =
    !isOverdue && isFinanceScheduleNearEnd(project.financeEndDate);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex cursor-move flex-col gap-2 rounded-md border bg-card p-3 text-left text-sm shadow-xs/5 transition-[background-color,border-color,box-shadow] duration-150 ease-out",
          "w-full",
          isDragging
            ? "border-ring/40 bg-card shadow-lg"
            : "border-border hover:border-border/90 hover:bg-accent/40",
        )}
      >
        <div className="flex items-center gap-2">
          <IconComponent className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {project.name}
          </span>
          {project.label && <ProjectLabelPill label={project.label} />}
        </div>

        <div className="flex items-center gap-2">
          <Progress value={completion} className="h-1.5 flex-1" />
          <span className="text-xs text-muted-foreground">{completion}%</span>
        </div>

        {project.financeTotalCents !== null && (
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={t("workspace:projects.kanban.financeTotalLabel")}
          >
            <Wallet className="h-3 w-3 shrink-0" />
            <span>{formatCents(project.financeTotalCents)}</span>
          </div>
        )}

        {(isOverdue || isNearEnd) && (
          <span
            className={cn(
              "inline-flex w-fit items-center gap-1 rounded px-2 py-1 text-[10px] font-medium",
              isOverdue
                ? "bg-warning/16 text-warning-foreground"
                : "bg-destructive/6 text-destructive-foreground",
            )}
          >
            <AlertTriangle className="h-3 w-3" />
            {isOverdue
              ? t("workspace:projects.kanban.overdueInstallment")
              : t("workspace:projects.kanban.finalStretch")}
          </span>
        )}

        <div
          className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground"
          title={t("workspace:projects.kanban.scheduleEndLabel")}
        >
          <CalendarClock className="h-3 w-3" />
          <span>
            {project.financeEndDate
              ? formatIsoDate(project.financeEndDate)
              : t("workspace:projects.kanban.noFinanceSchedule")}
          </span>
        </div>
      </button>
    </div>
  );
}

export default ProjectKanbanCard;
