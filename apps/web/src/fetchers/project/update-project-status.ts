import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";
import type { GetProjectsResponseItem } from "@/types/project";

type ProjectStatus = GetProjectsResponseItem["status"];

async function updateProjectStatus({
  id,
  status,
}: {
  id: string;
  status: ProjectStatus;
}) {
  const response = await client.project[":id"].status.$put({
    param: { id },
    json: { status },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default updateProjectStatus;
