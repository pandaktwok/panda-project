import { format, isSameMonth, isToday, isWeekend } from "date-fns";
import { type JSX, useMemo } from "react";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { packWeekLanes } from "./month-grid-model";
import type { WorkspaceCalendarEvent } from "./workspace-calendar-event";
import WorkspaceDayOverflowPopover from "./workspace-day-overflow-popover";
import WorkspaceEventBar from "./workspace-event-bar";

type WorkspaceMonthGridProps = {
  weeks: Date[][];
  events: WorkspaceCalendarEvent[];
  visibleMonth: Date;
  maxLanes: number;
  onOpenEvent: (event: WorkspaceCalendarEvent) => void;
};

/**
 * Igual a `MonthGrid`, mas para o calendário global do workspace: eventos de
 * vários projetos e dois tipos (tarefa/parcela) em vez de tarefas de um único
 * projeto. `packWeekLanes`/`buildMonthWeeks` são genéricos o bastante para
 * servir aos dois; só a renderização da barra e do popover muda.
 */
export default function WorkspaceMonthGrid({
  weeks,
  events,
  visibleMonth,
  maxLanes,
  onOpenEvent,
}: WorkspaceMonthGridProps): JSX.Element {
  const weekdayTemplate = weeks[0] ?? [];
  const layouts = useMemo(
    () => weeks.map((week) => packWeekLanes(week, events, maxLanes)),
    [weeks, events, maxLanes],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-x-contain">
      <div className="sticky top-0 z-20 grid grid-cols-7 border-b border-border bg-background/95 backdrop-blur">
        {weekdayTemplate.map((day) => (
          <div
            key={`weekday-${day.toISOString()}`}
            className="border-r border-border/60 px-1 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {formatDate(day, { weekday: "short" })}
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {weeks.map((week, weekIndex) => {
          const { segments, hiddenCountByDay, tasksByDay } = layouts[weekIndex];

          return (
            <div
              key={`week-${week[0].toISOString()}`}
              className="relative grid min-h-24 flex-1 grid-cols-7 border-b border-border/70 sm:min-h-28"
              style={{
                // Row 1 carries the date numbers, then one row per lane, then a
                // trailing row for the per-day overflow hint.
                gridTemplateRows: `auto repeat(${maxLanes}, min-content) auto`,
              }}
            >
              {week.map((day, dayIndex) => (
                <div
                  key={`cell-${day.toISOString()}`}
                  style={{ gridColumn: dayIndex + 1, gridRow: "1 / -1" }}
                  className={cn(
                    "min-w-0 border-r border-border/60",
                    isWeekend(day) && "bg-muted/25",
                  )}
                />
              ))}

              {week.map((day, dayIndex) => (
                <div
                  key={`number-${day.toISOString()}`}
                  style={{ gridColumn: dayIndex + 1, gridRow: 1 }}
                  className="z-10 flex justify-end px-1 py-1"
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full text-[11px] font-medium",
                      !isSameMonth(day, visibleMonth) &&
                        "text-muted-foreground/60",
                      isToday(day) && "bg-primary text-primary-foreground",
                    )}
                  >
                    {format(day, "d")}
                  </span>
                </div>
              ))}

              {segments.map((segment) => (
                <WorkspaceEventBar
                  key={`bar-${segment.task.kind}-${segment.task.id}`}
                  segment={segment}
                  onOpenEvent={onOpenEvent}
                />
              ))}

              {week.map((day, dayIndex) =>
                hiddenCountByDay[dayIndex] > 0 ? (
                  <div
                    key={`overflow-${day.toISOString()}`}
                    style={{ gridColumn: dayIndex + 1, gridRow: maxLanes + 2 }}
                    className="z-10 min-w-0"
                  >
                    <WorkspaceDayOverflowPopover
                      day={day}
                      events={tasksByDay[dayIndex]}
                      hiddenCount={hiddenCountByDay[dayIndex]}
                      onOpenEvent={onOpenEvent}
                    />
                  </div>
                ) : null,
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
