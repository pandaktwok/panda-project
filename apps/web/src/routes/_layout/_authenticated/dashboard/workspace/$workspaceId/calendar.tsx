import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { addMonths, startOfMonth, subMonths } from "date-fns";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildMonthWeeks } from "@/components/calendar/month-grid-model";
import type { WorkspaceCalendarEvent } from "@/components/calendar/workspace-calendar-event";
import WorkspaceCalendarToolbar from "@/components/calendar/workspace-calendar-toolbar";
import WorkspaceMonthGrid from "@/components/calendar/workspace-month-grid";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import useGetWorkspaceCalendarFinanceInstallments from "@/hooks/queries/workspace-calendar/use-get-workspace-calendar-finance-installments";
import useGetWorkspaceCalendarTasks from "@/hooks/queries/workspace-calendar/use-get-workspace-calendar-tasks";
import { useIsMobile } from "@/hooks/use-mobile";
import { toScheduledTask } from "@/lib/task-schedule";
import { useUserPreferencesStore } from "@/store/user-preferences";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/calendar",
)({
  component: RouteComponent,
});

// Lanes are capped so a busy week cannot push a row taller than the viewport;
// anything past the cap surfaces as a per-day overflow hint.
const MAX_LANES_DESKTOP = 3;
const MAX_LANES_MOBILE = 2;

function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();
  const navigate = useNavigate();
  const {
    data: calendarTasks,
    isLoading: isLoadingTasks,
    isError: isErrorTasks,
  } = useGetWorkspaceCalendarTasks(workspaceId);
  const {
    data: installments,
    isLoading: isLoadingInstallments,
    isError: isErrorInstallments,
  } = useGetWorkspaceCalendarFinanceInstallments(workspaceId);
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const isMobile = useIsMobile();
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(new Date()),
  );

  const isLoading = isLoadingTasks || isLoadingInstallments;
  const isError = isErrorTasks || isErrorInstallments;

  const events = useMemo<WorkspaceCalendarEvent[]>(() => {
    const taskEvents = (calendarTasks ?? [])
      .map((task) => toScheduledTask(task))
      .filter((task): task is NonNullable<typeof task> => task !== null)
      .map((task) => ({
        ...task,
        kind: "task" as const,
        taskNumber: task.number,
      }));

    const financeEvents = (installments ?? [])
      .map((installment) =>
        toScheduledTask({
          ...installment,
          startDate: installment.dueDate,
          dueDate: installment.dueDate,
        }),
      )
      .filter(
        (installment): installment is NonNullable<typeof installment> =>
          installment !== null,
      )
      .map((installment) => ({
        ...installment,
        kind: "finance" as const,
        title: installment.supplier,
      }));

    return [...taskEvents, ...financeEvents].sort(
      (left, right) =>
        left.scheduleStart.getTime() - right.scheduleStart.getTime(),
    );
  }, [calendarTasks, installments]);

  const weeks = useMemo(
    () => buildMonthWeeks(visibleMonth, weekStartsOn),
    [visibleMonth, weekStartsOn],
  );

  const handlePreviousMonth = useCallback(() => {
    setVisibleMonth((current) => subMonths(current, 1));
  }, []);

  const handleNextMonth = useCallback(() => {
    setVisibleMonth((current) => addMonths(current, 1));
  }, []);

  const handleToday = useCallback(() => {
    setVisibleMonth(startOfMonth(new Date()));
  }, []);

  // Sem uma "gaveta" única para tarefa+parcela de vários projetos ao mesmo
  // tempo (ao contrário do calendário de um projeto): clicar leva para o
  // projeto de origem em vez de abrir um detalhe aqui mesmo.
  const handleOpenEvent = useCallback(
    (event: WorkspaceCalendarEvent) => {
      if (event.kind === "task") {
        navigate({
          to: "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
          params: { workspaceId, projectId: event.projectId },
          search: { taskId: event.id },
        });
        return;
      }

      navigate({
        to: "/dashboard/workspace/$workspaceId/project/$projectId/summary",
        params: { workspaceId, projectId: event.projectId },
      });
    },
    [navigate, workspaceId],
  );

  return (
    <WorkspaceLayout title={t("workspace:calendar.pageTitle")}>
      <PageTitle title={t("workspace:calendar.pageTitle")} />
      <div className="flex h-full min-h-0 flex-col bg-background">
        <WorkspaceCalendarToolbar
          visibleMonth={visibleMonth}
          onPreviousMonth={handlePreviousMonth}
          onNextMonth={handleNextMonth}
          onToday={handleToday}
        />

        {isLoading ? (
          <div className="border-b border-border/80 px-4 py-3 text-center">
            <p className="text-sm text-muted-foreground">
              {t("common:empty.loading")}
            </p>
          </div>
        ) : isError ? (
          <div className="border-b border-border/80 px-4 py-3 text-center">
            <p className="text-sm font-semibold text-destructive">
              {t("workspace:calendar.loadError")}
            </p>
          </div>
        ) : events.length === 0 ? (
          <div className="border-b border-border/80 px-4 py-3 text-center">
            <p className="text-sm font-semibold text-foreground">
              {t("workspace:calendar.empty")}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("workspace:calendar.emptySubtitle")}
            </p>
          </div>
        ) : null}

        <WorkspaceMonthGrid
          weeks={weeks}
          events={events}
          visibleMonth={visibleMonth}
          maxLanes={isMobile ? MAX_LANES_MOBILE : MAX_LANES_DESKTOP}
          onOpenEvent={handleOpenEvent}
        />
      </div>
    </WorkspaceLayout>
  );
}
