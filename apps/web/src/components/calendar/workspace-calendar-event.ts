import type { PackableTask } from "./month-grid-model";

/**
 * Um evento do calendário global do workspace: uma tarefa com data OU uma
 * parcela do Financeiro, de qualquer projeto não arquivado. Ao contrário de
 * `CalendarTask` (calendário de um único projeto), aqui cada evento carrega
 * o projeto de origem, porque a grade mistura vários projetos e dois tipos
 * de dado diferentes.
 */
export type WorkspaceCalendarEvent = PackableTask & {
  kind: "task" | "finance";
  title: string;
  status: string;
  projectId: string;
  projectName: string;
  projectSlug?: string;
  projectLabel: { id: string; name: string } | null;
  taskNumber?: number | null;
  expectedCents?: number;
};

const FINANCE_STATUS_CLASSES: Record<string, string> = {
  paid: "border-emerald-500/35 bg-emerald-500/15 hover:border-emerald-500/50 hover:bg-emerald-500/20",
  overdue:
    "border-red-500/40 bg-red-500/15 hover:border-red-500/55 hover:bg-red-500/20",
  pending:
    "border-amber-500/40 bg-amber-500/15 hover:border-amber-500/55 hover:bg-amber-500/20",
};

const TASK_STATUS_CLASSES: Record<string, string> = {
  "to-do":
    "border-slate-500/35 bg-slate-500/15 hover:border-slate-500/50 hover:bg-slate-500/20",
  "in-progress":
    "border-blue-500/35 bg-blue-500/15 hover:border-blue-500/50 hover:bg-blue-500/20",
  "in-review":
    "border-amber-500/40 bg-amber-500/15 hover:border-amber-500/55 hover:bg-amber-500/20",
  done: "border-emerald-500/35 bg-emerald-500/15 hover:border-emerald-500/50 hover:bg-emerald-500/20",
};

export function workspaceCalendarEventStatusClass(
  event: Pick<WorkspaceCalendarEvent, "kind" | "status">,
): string {
  const table =
    event.kind === "finance" ? FINANCE_STATUS_CLASSES : TASK_STATUS_CLASSES;
  return (
    table[event.status] ??
    "border-primary/25 bg-primary/12 hover:border-primary/40 hover:bg-primary/18"
  );
}
