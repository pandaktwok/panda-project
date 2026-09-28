import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  defaultDropAnimationSideEffects,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useUpdateProjectStatus from "@/hooks/mutations/project/use-update-project-status";
import { toast } from "@/lib/toast";
import type { GetProjectsResponseItem } from "@/types/project";
import { ProjectKanbanCard } from "./project-kanban-card";

type Status = "notStarted" | "inProgress" | "complete";

type ProjectsKanbanProps = {
  workspaceId: string;
  projects: GetProjectsResponseItem[];
  onProjectClick: (projectId: string) => void;
};

/**
 * Kanban de PROJETOS agrupados por status. O status é manual (arrastar um
 * cartão entre colunas grava em project.status), independente do progresso
 * calculado a partir das tarefas -- esse continua sendo a barra de progresso
 * dentro do cartão. Mesmo mecanismo de arrastar do quadro de tarefas
 * (kanban-board/index.tsx): @dnd-kit/core + @dnd-kit/sortable.
 */
function KanbanColumn({
  status,
  title,
  projects,
  onProjectClick,
}: {
  status: Status;
  title: string;
  projects: GetProjectsResponseItem[];
  onProjectClick: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: { type: "column", status },
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{projects.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex min-h-16 flex-col gap-2 rounded-lg p-2 transition-colors duration-150 ${
          isOver ? "bg-accent/60 ring-2 ring-ring/30" : "bg-muted/30"
        }`}
      >
        <SortableContext
          items={projects}
          strategy={verticalListSortingStrategy}
        >
          {projects.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {t("workspace:projects.kanban.empty")}
            </p>
          )}
          {projects.map((project) => (
            <ProjectKanbanCard
              key={project.id}
              project={project}
              onClick={() => onProjectClick(project.id)}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

export function ProjectsKanban({
  workspaceId,
  projects,
  onProjectClick,
}: ProjectsKanbanProps) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const updateStatus = useUpdateProjectStatus();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 10 },
    }),
    useSensor(KeyboardSensor),
  );

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: { active: { opacity: "0.8" } },
    }),
    duration: 300,
    easing: "cubic-bezier(0.23, 1, 0.32, 1)",
  };

  const columns: Array<{ status: Status; title: string }> = [
    {
      status: "notStarted",
      title: t("workspace:projects.projectStatus.notStarted"),
    },
    {
      status: "inProgress",
      title: t("workspace:projects.projectStatus.inProgress"),
    },
    {
      status: "complete",
      title: t("workspace:projects.projectStatus.complete"),
    },
  ];

  const byStatus: Record<Status, GetProjectsResponseItem[]> = {
    notStarted: [],
    inProgress: [],
    complete: [],
  };
  for (const project of projects) {
    (byStatus[project.status as Status] ?? byStatus.notStarted).push(project);
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeProject = projects.find((p) => p.id === active.id);
    if (!activeProject) return;

    const overData = over.data.current as
      | { type: "column"; status: Status }
      | undefined;
    const destinationStatus: Status | undefined =
      overData?.type === "column"
        ? overData.status
        : (projects.find((p) => p.id === over.id)?.status as
            | Status
            | undefined);

    if (!destinationStatus || destinationStatus === activeProject.status) {
      return;
    }

    updateStatus(workspaceId, activeProject.id, destinationStatus, () => {
      toast.error(t("workspace:projects.statusUpdateError"));
    });
  };

  const activeProject = activeId
    ? projects.find((p) => p.id === activeId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {columns.map((column) => (
          <KanbanColumn
            key={column.status}
            status={column.status}
            title={column.title}
            projects={byStatus[column.status]}
            onProjectClick={onProjectClick}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={dropAnimation}>
        {activeProject ? (
          <div className="w-72 rotate-1 scale-[1.03] shadow-lg">
            <div className="ring-2 ring-ring/35 rounded-lg">
              <ProjectKanbanCard project={activeProject} onClick={() => {}} />
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default ProjectsKanban;
