import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type ProjectAccessEntry = {
  userId: string;
  name: string;
  email: string;
  role: string;
  /** Dono/administrador: sempre acesso total, não editável. */
  locked: boolean;
  canView: boolean;
  canPay: boolean;
  canAttach: boolean;
};

export type ProjectAccessKeys = Pick<
  ProjectAccessEntry,
  "canView" | "canPay" | "canAttach"
>;

export async function getProjectAccess(
  projectId: string,
): Promise<{ members: ProjectAccessEntry[] }> {
  const response = await client["project-access"][":projectId"].$get({
    param: { projectId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function updateProjectAccess(
  projectId: string,
  userId: string,
  keys: ProjectAccessKeys,
): Promise<ProjectAccessEntry> {
  const response = await client["project-access"][":projectId"][":userId"].$put(
    {
      param: { projectId, userId },
      json: keys,
    },
  );
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
