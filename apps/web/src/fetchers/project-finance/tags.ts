import { client } from "@kaneo/libs";
import { readFinanceResponse } from "./request";

export type TagInput = {
  name: string;
  description: string | null;
  valueCents: number;
};

export async function getProjectTagCatalog(projectId: string) {
  const response = await client["project-finance"][":projectId"][
    "tag-catalog"
  ].$get({
    param: { projectId },
  });
  return readFinanceResponse(response as unknown as Response) as Promise<{
    tags: { id: string; name: string }[];
  }>;
}

export async function createProjectTag(projectId: string, input: TagInput) {
  const response = await client["project-finance"][":projectId"].tags.$post({
    param: { projectId },
    json: input,
  });
  return readFinanceResponse(response as unknown as Response);
}

export async function updateProjectTag(
  tagId: string,
  input: Partial<TagInput>,
) {
  const response = await client["project-finance"].tags[":tagId"].$put({
    param: { tagId },
    json: input,
  });
  return readFinanceResponse(response as unknown as Response);
}

export async function deleteProjectTag(tagId: string, force = false) {
  const response = await client["project-finance"].tags[":tagId"].$delete({
    param: { tagId },
    query: force ? { force: "true" } : {},
  });
  return readFinanceResponse(response as unknown as Response);
}
