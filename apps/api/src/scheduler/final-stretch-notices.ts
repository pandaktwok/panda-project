import { and, eq, inArray, isNull } from "drizzle-orm";
import db from "../database";
import {
  projectFinalStretchNoticeTable,
  projectInstallmentTable,
  projectPaymentLineTable,
  projectTable,
  workspaceUserTable,
} from "../database/schema";
import { insertNotification } from "../notification/controllers/create-notification";
import { deliverNotification } from "../notification-preferences/delivery";
import { finalStretchNoticeMonth } from "../project-finance/final-stretch";
import { safeOutboundError } from "../utils/outbound-request";
import { withJobLease } from "./leader-lock";

export const FINAL_STRETCH_NOTICE_LEASE = "final-stretch-notices";
export const FINAL_STRETCH_NOTIFICATION_TYPE = "project_final_stretch";

/** Quem recebe: o dono e os administradores do workspace do projeto. */
export const FINAL_STRETCH_RECIPIENT_ROLES = ["owner", "admin"] as const;

function formatBrl(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  })
    .format(cents / 100)
    .replace(/ /g, " ");
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function joinDates(dates: string[]): string {
  if (dates.length <= 1) return dates[0] ?? "";
  return `${dates.slice(0, -1).join(", ")} e ${dates[dates.length - 1]}`;
}

type Candidate = { id: string; name: string; workspaceId: string };

/** Projetos com pelo menos uma parcela em aberto (os únicos que podem avisar). */
async function listCandidateProjects(): Promise<Candidate[]> {
  return db
    .selectDistinct({
      id: projectTable.id,
      name: projectTable.name,
      workspaceId: projectTable.workspaceId,
    })
    .from(projectTable)
    .innerJoin(
      projectPaymentLineTable,
      eq(projectPaymentLineTable.projectId, projectTable.id),
    )
    .innerJoin(
      projectInstallmentTable,
      eq(projectInstallmentTable.lineId, projectPaymentLineTable.id),
    )
    .where(isNull(projectInstallmentTable.paidAt));
}

async function loadInstallments(projectId: string) {
  return db
    .select({
      dueDate: projectInstallmentTable.dueDate,
      expectedCents: projectInstallmentTable.expectedCents,
      paidAt: projectInstallmentTable.paidAt,
    })
    .from(projectInstallmentTable)
    .innerJoin(
      projectPaymentLineTable,
      eq(projectInstallmentTable.lineId, projectPaymentLineTable.id),
    )
    .where(eq(projectPaymentLineTable.projectId, projectId));
}

async function listRecipients(workspaceId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        inArray(workspaceUserTable.role, [...FINAL_STRETCH_RECIPIENT_ROLES]),
      ),
    );
  return [...new Set(rows.map((row) => row.userId))];
}

async function releaseReservation(projectId: string, month: string) {
  await db
    .delete(projectFinalStretchNoticeTable)
    .where(
      and(
        eq(projectFinalStretchNoticeTable.projectId, projectId),
        eq(projectFinalStretchNoticeTable.month, month),
      ),
    )
    .catch((error) => {
      console.error("Failed to release the final stretch reservation", {
        projectId,
        month,
        error,
      });
    });
}

type ProjectOutcome = "sent" | "skipped" | "released";

async function noticeProject(
  project: Candidate,
  now: Date,
): Promise<ProjectOutcome> {
  const installments = await loadInstallments(project.id);
  const month = finalStretchNoticeMonth(
    installments.map((item) => ({
      dueDate: item.dueDate,
      paid: item.paidAt !== null,
    })),
    now,
  );
  if (!month) return "skipped";

  // Reserva o mês ANTES de enviar: outra instância ou outra rodada vê o
  // conflito e não repete.
  const [reservation] = await db
    .insert(projectFinalStretchNoticeTable)
    .values({ projectId: project.id, month })
    .onConflictDoNothing({
      target: [
        projectFinalStretchNoticeTable.projectId,
        projectFinalStretchNoticeTable.month,
      ],
    })
    .returning({ id: projectFinalStretchNoticeTable.id });
  if (!reservation) return "skipped";

  const lastDates = [...new Set(installments.map((item) => item.dueDate))]
    .sort()
    .slice(-3);
  const remainingCents = installments
    .filter((item) => item.paidAt === null)
    .reduce((sum, item) => sum + item.expectedCents, 0);
  const title = `Reta final: ${project.name}`;
  const content = `As últimas parcelas vencem em ${joinDates(lastDates.map(formatDate))}. Faltam ${formatBrl(remainingCents)} a pagar.`;

  let recipients: string[] = [];
  const channels = new Set<string>();
  let notified = 0;
  try {
    recipients = await listRecipients(project.workspaceId);
    for (const userId of recipients) {
      try {
        const notification = await insertNotification({
          userId,
          title,
          content,
          type: FINAL_STRETCH_NOTIFICATION_TYPE,
          eventData: {
            projectId: project.id,
            workspaceId: project.workspaceId,
            month,
            dates: lastDates,
            remainingCents,
          },
          resourceId: project.id,
          resourceType: "project",
        });
        if (!notification) continue;
        notified += 1;
        channels.add("app");
        try {
          for (const channel of await deliverNotification(notification.id)) {
            channels.add(channel);
          }
        } catch (error) {
          // O aviso no aplicativo já existe; só o canal externo falhou.
          console.error("Final stretch delivery failed", {
            projectId: project.id,
            userId,
            error: safeOutboundError(error),
          });
        }
      } catch (error) {
        console.error("Failed to notify final stretch", {
          projectId: project.id,
          userId,
          error,
        });
      }
    }
  } catch (error) {
    console.error("Failed to prepare the final stretch notice", {
      projectId: project.id,
      error,
    });
  }

  // Nada foi enviado e houve falha: libera o mês para tentar no próximo ciclo.
  // Sem destinatários (ou ninguém com acesso) também libera: um administrador
  // adicionado depois ainda recebe neste mês.
  if (notified === 0) {
    await releaseReservation(project.id, month);
    return "released";
  }

  await db
    .update(projectFinalStretchNoticeTable)
    .set({ channels: [...channels], recipients: notified })
    .where(eq(projectFinalStretchNoticeTable.id, reservation.id));
  return "sent";
}

/**
 * Envia o aviso mensal de reta final. `now` é injetável para simular datas nos
 * testes sem esperar dias.
 */
export async function sendFinalStretchNotices(
  now: Date = new Date(),
): Promise<{ degraded: boolean; sent: number }> {
  let degraded = false;
  let sent = 0;
  let projects: Candidate[] = [];
  try {
    projects = await listCandidateProjects();
  } catch (error) {
    console.error(
      "Failed to list projects for the final stretch notice",
      error,
    );
    return { degraded: true, sent: 0 };
  }
  for (const project of projects) {
    try {
      if ((await noticeProject(project, now)) === "sent") sent += 1;
    } catch (error) {
      degraded = true;
      console.error("Failed to process the final stretch notice", {
        projectId: project.id,
        error,
      });
    }
  }
  return { degraded, sent };
}

/** Entrada do agendador: um nó por vez (várias instâncias, um só envio). */
export async function runFinalStretchNotices(
  now: Date = new Date(),
): Promise<{ degraded: boolean; sent: number }> {
  return withJobLease(
    FINAL_STRETCH_NOTICE_LEASE,
    () => sendFinalStretchNotices(now),
    () => ({ degraded: false, sent: 0 }),
  );
}
