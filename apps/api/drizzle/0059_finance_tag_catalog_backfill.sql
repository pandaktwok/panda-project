-- Preenche o catálogo de etiquetas por workspace com os nomes que já existem
-- nas etiquetas de cada projeto (sem duplicar, ignorando maiúsculas/minúsculas).
-- Nada é apagado nem alterado em project_tag; isso só alimenta as sugestões.
INSERT INTO "finance_tag_catalog" ("id", "workspace_id", "name")
SELECT DISTINCT ON (p."workspace_id", lower(t."name"))
  'ftc_' || substr(md5(p."workspace_id" || ':' || lower(t."name")), 1, 20),
  p."workspace_id",
  t."name"
FROM "project_tag" t
JOIN "project" p ON p."id" = t."project_id"
ON CONFLICT ("workspace_id", "name") DO NOTHING;
