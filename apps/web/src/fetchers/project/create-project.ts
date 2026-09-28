import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

export type CreateProjectRequest = InferRequestType<
  (typeof client)["project"]["$post"]
>["json"];

async function createProject({
  name,
  slug,
  workspaceId,
  icon,
  description,
  financeTotalCents,
  financeMonths,
  financeFirstDueDate,
  label,
}: CreateProjectRequest) {
  const response = await client.project.$post({
    json: {
      name,
      slug,
      icon,
      workspaceId,
      description,
      financeTotalCents,
      financeMonths,
      financeFirstDueDate,
      label,
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();

  return data;
}

export default createProject;
