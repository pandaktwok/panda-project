import { and, eq, type SQLWrapper, sql } from "drizzle-orm";
import db from "../database";
import { userTable } from "../database/schema";

// Fase 7A: projeto escondido do usuário (chave "Ver" desligada) não gera nem
// mostra notificação. Dono/administrador do workspace ignora a chave.
function projectNotHidden(userId: string) {
  return sql`NOT EXISTS (
        SELECT 1 FROM project_member_access AS notification_access
        WHERE notification_access.project_id = notification_project.id
          AND notification_access.user_id = ${userId}
          AND notification_access.can_view = false
          AND notification_member.role NOT IN ('owner', 'admin')
          AND NOT EXISTS (
            SELECT 1 FROM "user" AS notification_user
            WHERE notification_user.id = ${userId} AND notification_user.role = 'admin'
          )
      )`;
}

// Membership, rather than public visibility or global admin privileges, defines
// who may be subscribed to private task activity. Use the same predicate when
// creating, reading and delivering notifications, including historical rows.
export function notificationResourceAccess(
  userId: string,
  resourceId: string | null | SQLWrapper,
  resourceType: string | null | SQLWrapper,
) {
  return sql<boolean>`(
    (${resourceId}::text IS NULL AND ${resourceType}::text IS NULL)
    OR (${resourceType}::text = 'task' AND EXISTS (
      SELECT 1 FROM task AS notification_task
      JOIN project AS notification_project ON notification_project.id = notification_task.project_id
      JOIN workspace_member AS notification_member ON notification_member.workspace_id = notification_project.workspace_id
      WHERE notification_task.id = ${resourceId} AND notification_member.user_id = ${userId}
        AND ${projectNotHidden(userId)}
    ))
    OR (${resourceType}::text = 'project' AND EXISTS (
      SELECT 1 FROM project AS notification_project
      JOIN workspace_member AS notification_member ON notification_member.workspace_id = notification_project.workspace_id
      WHERE notification_project.id = ${resourceId} AND notification_member.user_id = ${userId}
        AND ${projectNotHidden(userId)}
    ))
    OR (${resourceType}::text = 'workspace' AND EXISTS (
      SELECT 1 FROM workspace_member AS notification_member
      WHERE notification_member.workspace_id = ${resourceId} AND notification_member.user_id = ${userId}
    ))
  )`;
}

export async function canReceiveResourceNotification(
  userId: string,
  resourceId?: string | null,
  resourceType?: string | null,
) {
  const [user] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(
      and(
        eq(userTable.id, userId),
        notificationResourceAccess(
          userId,
          resourceId ?? null,
          resourceType ?? null,
        ),
      ),
    )
    .limit(1);
  return Boolean(user);
}
