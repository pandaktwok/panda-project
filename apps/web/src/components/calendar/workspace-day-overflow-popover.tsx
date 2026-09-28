import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatCents } from "@/lib/finance/money";
import { formatDate, formatDateShort } from "@/lib/format";
import { ProjectLabelPill } from "../project-label-pill";
import type { WorkspaceCalendarEvent } from "./workspace-calendar-event";

type WorkspaceDayOverflowPopoverProps = {
  day: Date;
  /** Every event on this day, not just the ones the lane cap hid. */
  events: WorkspaceCalendarEvent[];
  hiddenCount: number;
  onOpenEvent: (event: WorkspaceCalendarEvent) => void;
};

export default function WorkspaceDayOverflowPopover({
  day,
  events,
  hiddenCount,
  onOpenEvent,
}: WorkspaceDayOverflowPopoverProps): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const dayLabel = formatDate(day, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const handleSelectEvent = (event: WorkspaceCalendarEvent) => {
    setOpen(false);
    onOpenEvent(event);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        aria-label={t("workspace:calendar.dayEventsAriaLabel", {
          date: dayLabel,
        })}
        className="w-full truncate rounded-sm px-1.5 pb-1 text-left text-[10px] leading-tight text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("workspace:calendar.moreEvents", { count: hiddenCount })}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="space-y-1">
          <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {dayLabel}
          </p>
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {events.map((event) => (
              <button
                key={`${event.kind}-${event.id}`}
                type="button"
                onClick={() => handleSelectEvent(event)}
                className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex w-full min-w-0 items-center gap-1">
                  {event.projectLabel ? (
                    <ProjectLabelPill
                      label={event.projectLabel}
                      className="shrink-0"
                    />
                  ) : null}
                  <span className="truncate text-[10px] text-muted-foreground">
                    {event.projectName}
                  </span>
                </span>
                <span className="w-full truncate text-xs font-medium text-foreground">
                  {event.title}
                  {event.kind === "finance" && event.expectedCents !== undefined
                    ? ` · ${formatCents(event.expectedCents)}`
                    : ""}
                </span>
                <span className="w-full truncate text-[11px] text-muted-foreground">
                  {formatDateShort(event.scheduleStart)} –{" "}
                  {formatDateShort(event.scheduleEnd)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
