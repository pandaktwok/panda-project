import { createId } from "@paralleldrive/cuid2";
import db from "../../database";
import { notificationTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deliverNotification } from "../../notification-preferences/delivery";

import { safeOutboundError } from "../../utils/outbound-request";
import { canReceiveResourceNotification } from "../resource-access";

/**
 * Grava a notificação (com as checagens de acesso e preferência) e avisa o
 * front, mas NÃO entrega por e-mail/ntfy/Gotify/webhook: quem chama decide se
 * espera a entrega (o job de reta final registra os canais) ou a deixa em
 * segundo plano (createNotification).
 */
export async function insertNotification({
  userId,
  title,
  content,
  type,
  eventData,
  resourceId,
  resourceType,
}: {
  userId: string;
  title?: string | null;
  content?: string | null;
  type?: string;
  eventData?: Record<string, unknown> | null;
  resourceId?: string;
  resourceType?: string;
}) {
  if (
    !(await canReceiveResourceNotification(userId, resourceId, resourceType))
  ) {
    return null;
  }

  const preferenceKey =
    type === "task_assignee_changed" || type === "task_created"
      ? "taskAssignmentEnabled"
      : type === "task_comment" || type === "task_mention"
        ? "taskCommentEnabled"
        : type === "task_status_changed"
          ? "taskStatusChangeEnabled"
          : type === "due_date_reminder" || type === "task_overdue"
            ? "dueDateReminderEnabled"
            : null;

  if (preferenceKey) {
    const preference = await db.query.userNotificationPreferenceTable.findFirst(
      {
        where: (table, { eq }) => eq(table.userId, userId),
      },
    );

    if (preference?.[preferenceKey] === false) {
      return null;
    }
  }

  const [notification] = await db
    .insert(notificationTable)
    .values({
      id: createId(),
      userId,
      title: title ?? null,
      content: content ?? null,
      type: type || "info",
      eventData: eventData ?? null,
      resourceId: resourceId || null,
      resourceType: resourceType || null,
    })
    .returning();

  if (notification) {
    await publishEvent("notification.created", {
      notificationId: notification.id,
      userId,
    });
  }

  return notification ?? null;
}

async function createNotification(
  input: Parameters<typeof insertNotification>[0],
) {
  const notification = await insertNotification(input);
  if (notification) {
    void deliverNotification(notification.id).catch((error) => {
      console.error("Failed to deliver notification", {
        notificationId: notification.id,
        error: safeOutboundError(error),
      });
    });
  }
  return notification;
}

export default createNotification;
