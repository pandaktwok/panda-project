import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { assertProjectVisible } from "../project-access";
import { resolveAssetBearerOrCookie } from "./authenticate-api-request";
import { hasWorkspacePermission } from "./require-workspace-permission";
import { validateWorkspaceAccess } from "./validate-workspace-access";

type AssetAccessTarget = {
  workspaceId: string;
  projectId?: string | null;
  isPublic: boolean | null;
  surface: string;
};

/** Arquivos do Financeiro: sempre privados, exigem finance:read. */
const FINANCE_SURFACES = new Set([
  "project",
  "payment",
  "payment_upload",
  "payment_merged",
]);

export function isFinanceAsset(surface: string): boolean {
  return FINANCE_SURFACES.has(surface);
}

/** Only description assets belong to the public project representation. */
export function isPublicAsset(asset: AssetAccessTarget): boolean {
  return asset.isPublic === true && asset.surface === "description";
}

export async function authorizeAssetAccess(
  c: Context,
  asset: AssetAccessTarget,
): Promise<void> {
  if (isPublicAsset(asset)) {
    return;
  }

  const { userId, apiKeyId } = await resolveAssetBearerOrCookie(c);
  await validateWorkspaceAccess(userId, asset.workspaceId, apiKeyId);
  // Fase 7A: arquivo de projeto escondido responde 404, como se não existisse.
  if (asset.projectId) await assertProjectVisible(userId, asset.projectId);

  if (isFinanceAsset(asset.surface)) {
    // O papel do usuário no workspace do arquivo decide, com o mesmo cálculo
    // das rotas (papéis personalizados incluídos). Nunca há link público.
    c.set("workspaceId", asset.workspaceId);
    c.set("userId", userId);
    if (!(await hasWorkspacePermission(c, { finance: ["read"] }))) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }
  }
}
