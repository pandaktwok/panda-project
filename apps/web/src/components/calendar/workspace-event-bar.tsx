import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/finance/money";
import { formatDateShort } from "@/lib/format";
import { ProjectLabelPill } from "../project-label-pill";
import type { WeekSegment } from "./month-grid-model";
import {
  type WorkspaceCalendarEvent,
  workspaceCalendarEventStatusClass,
} from "./workspace-calendar-event";

type WorkspaceEventBarProps = {
  segment: WeekSegment<WorkspaceCalendarEvent>;
  onOpenEvent: (event: WorkspaceCalendarEvent) => void;
};

export default function WorkspaceEventBar({
  segment,
  onOpenEvent,
}: WorkspaceEventBarProps): JSX.Element {
  const { t } = useTranslation();
  const {
    task: event,
    lane,
    columnStart,
    columnEnd,
    continuesBefore,
    continuesAfter,
  } = segment;

  const range = `${formatDateShort(event.scheduleStart)} – ${formatDateShort(
    event.scheduleEnd,
  )}`;

  const detail =
    event.kind === "finance" && event.expectedCents !== undefined
      ? `${event.title} · ${formatCents(event.expectedCents)}`
      : event.title;

  const ariaLabel =
    event.kind === "finance"
      ? t("workspace:calendar.financeAriaLabel", {
          title: event.title,
          project: event.projectName,
          range,
        })
      : t("workspace:calendar.taskAriaLabel", {
          title: event.title,
          project: event.projectName,
          range,
        });

  return (
    <button
      type="button"
      style={{
        gridColumn: `${columnStart} / ${columnEnd}`,
        // Row 1 holds the date numbers, so lanes start at row 2.
        gridRow: lane + 2,
      }}
      title={`${event.projectName} · ${detail} · ${range}`}
      aria-label={ariaLabel}
      data-event-kind={event.kind}
      data-event-status={event.status}
      onClick={() => onOpenEvent(event)}
      className={cn(
        "z-10 mb-0.5 flex h-6 min-w-0 items-center gap-1 overflow-hidden border px-1.5 text-left text-[11px] font-medium leading-none text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-5",
        workspaceCalendarEventStatusClass(event),
        // Bars that run past a week edge lose their cap there so the two halves
        // read as one continuous span across rows.
        continuesBefore ? "rounded-l-none border-l-0" : "ml-1 rounded-l-md",
        continuesAfter ? "rounded-r-none border-r-0" : "mr-1 rounded-r-md",
      )}
    >
      {event.projectLabel ? (
        <ProjectLabelPill label={event.projectLabel} className="shrink-0" />
      ) : null}
      <span className="truncate">{event.projectName}</span>
      <span className="shrink-0 text-muted-foreground/80">·</span>
      <span className="truncate">{detail}</span>
    </button>
  );
}
