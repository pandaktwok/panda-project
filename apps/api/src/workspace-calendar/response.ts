import { z } from "../openapi";

const projectLabelRef = z
  .object({ id: z.string(), name: z.string() })
  .nullable();

export const workspaceCalendarTaskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    number: z.number().int().nullable(),
    status: z.string(),
    startDate: z.string().nullable().openapi({ format: "date-time" }),
    dueDate: z.string().nullable().openapi({ format: "date-time" }),
    projectId: z.string(),
    projectName: z.string(),
    projectSlug: z.string(),
    projectLabel: projectLabelRef,
  })
  .openapi("WorkspaceCalendarTask");

export const workspaceCalendarInstallmentSchema = z
  .object({
    id: z.string(),
    supplier: z.string(),
    dueDate: z.string().openapi({ format: "date" }),
    expectedCents: z.number().int(),
    status: z.enum(["paid", "overdue", "pending"]),
    projectId: z.string(),
    projectName: z.string(),
    projectLabel: projectLabelRef,
  })
  .openapi("WorkspaceCalendarInstallment");

export const workspaceCalendarTasksSchema = z.array(
  workspaceCalendarTaskSchema,
);
export const workspaceCalendarInstallmentsSchema = z.array(
  workspaceCalendarInstallmentSchema,
);
