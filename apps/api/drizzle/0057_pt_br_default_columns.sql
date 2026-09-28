-- Traduz apenas as colunas padrão que ainda têm o nome original em inglês
-- (o slug continua o mesmo, então tarefas, fluxos e integrações não mudam).
UPDATE "column" SET "name" = 'A fazer' WHERE "slug" = 'to-do' AND "name" = 'To Do';--> statement-breakpoint
UPDATE "column" SET "name" = 'Em andamento' WHERE "slug" = 'in-progress' AND "name" = 'In Progress';--> statement-breakpoint
UPDATE "column" SET "name" = 'Em revisão' WHERE "slug" = 'in-review' AND "name" = 'In Review';--> statement-breakpoint
UPDATE "column" SET "name" = 'Concluído' WHERE "slug" = 'done' AND "name" = 'Done';
