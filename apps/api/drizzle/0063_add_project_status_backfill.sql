-- A coluna "status" acima de acabou de nascer com o padrão 'notStarted' para
-- toda linha existente. Aqui a gente ajusta os projetos que já têm tarefas,
-- para não fazer um projeto em andamento (ou concluído) reaparecer como "não
-- iniciado" no Kanban só porque a coluna é nova. Mesma regra que o Kanban
-- usava antes (calculada, não guardada): sem tarefas = não iniciado; todas
-- concluídas/arquivadas = concluído; senão, em andamento.
UPDATE "project" p
SET "status" = CASE
  WHEN t.completed_tasks = t.total_tasks THEN 'complete'
  ELSE 'inProgress'
END
FROM (
  SELECT
    "project_id",
    count(*) AS total_tasks,
    count(*) FILTER (WHERE "status" IN ('done', 'archived')) AS completed_tasks
  FROM "task"
  GROUP BY "project_id"
) t
WHERE t."project_id" = p."id" AND t.total_tasks > 0;
