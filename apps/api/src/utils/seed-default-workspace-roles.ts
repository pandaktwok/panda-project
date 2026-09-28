import {
  DEFAULT_ROLE_NAMES,
  type DefaultRoleName,
  defaultRolePayloads,
} from "@kaneo/permissions";
import { and, eq, inArray, sql } from "drizzle-orm";
import db, { schema } from "../database";

/**
 * Backfill the editable default roles (viewer/member/admin) for every
 * workspace that's missing them. Runs on API startup after Drizzle
 * migrations.
 *
 * These three roles used to be static (compiled into better-auth's
 * `roles` config). They were converted to DB rows so admins can override
 * them per workspace, but that means existing workspaces, which were
 * created before the switch, have no rows yet. Without this backfill,
 * better-auth's dynamic-access-control resolution would treat them as
 * having an empty permission set on existing workspaces.
 *
 * Idempotent: only inserts rows that aren't already present.
 */
export async function seedDefaultWorkspaceRoles() {
  try {
    const tableExists = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'workspace_role'
      ) AS exists;
    `);

    const exists =
      tableExists.rows[0]?.exists === true ||
      tableExists.rows[0]?.exists === "t";
    if (!exists) {
      console.log(
        "🛈 workspace_role table does not exist; skipping default-role seed.",
      );
      return;
    }

    const workspaces = await db
      .select({ id: schema.workspaceTable.id })
      .from(schema.workspaceTable);

    if (workspaces.length === 0) {
      return;
    }

    const workspaceIds = workspaces.map((w) => w.id);

    const existingRows = await db
      .select({
        workspaceId: schema.workspaceRoleTable.workspaceId,
        role: schema.workspaceRoleTable.role,
      })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          inArray(schema.workspaceRoleTable.workspaceId, workspaceIds),
          inArray(
            schema.workspaceRoleTable.role,
            DEFAULT_ROLE_NAMES as unknown as string[],
          ),
        ),
      );

    const present = new Set(
      existingRows.map((r) => `${r.workspaceId}:${r.role}`),
    );

    const now = new Date();
    const rows: Array<typeof schema.workspaceRoleTable.$inferInsert> = [];
    for (const workspaceId of workspaceIds) {
      for (const name of DEFAULT_ROLE_NAMES) {
        if (present.has(`${workspaceId}:${name}`)) continue;
        rows.push({
          workspaceId,
          role: name,
          permission: JSON.stringify(defaultRolePayloads[name]),
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (rows.length === 0) {
      return;
    }

    // Postgres' bind protocol caps parameters at 65535 per query, so insert
    // in chunks. 6 columns × 1000 rows = 6000 params per batch, leaving ample
    // headroom even for instances with tens of thousands of workspaces.
    const BATCH_SIZE = 1000;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await db
        .insert(schema.workspaceRoleTable)
        .values(rows.slice(i, i + BATCH_SIZE));
    }
    console.log(
      `✅ Seeded ${rows.length} default workspace role row(s) across ${workspaceIds.length} workspace(s).`,
    );
  } catch (error) {
    console.error("❌ Failed to seed default workspace roles:", error);
    throw error;
  }
}

/**
 * Dá o recurso `finance` às linhas já existentes dos papéis padrão
 * (viewer/member/admin). As linhas de workspace_role guardam um JSON de
 * permissões; workspaces criados antes do módulo Financeiro não têm a chave
 * `finance` e, sem este passo, ficariam sem acesso.
 *
 * Idempotente e conservador:
 * - só acrescenta a chave `finance` quando ela NÃO existe no JSON (nunca
 *   sobrescreve o que o administrador já definiu);
 * - não mexe em nenhum outro recurso;
 * - papéis personalizados (nomes fora de DEFAULT_ROLE_NAMES) não são tocados.
 */
export async function backfillFinancePermission() {
  try {
    const rows = await db
      .select({
        id: schema.workspaceRoleTable.id,
        role: schema.workspaceRoleTable.role,
        permission: schema.workspaceRoleTable.permission,
      })
      .from(schema.workspaceRoleTable)
      .where(
        inArray(
          schema.workspaceRoleTable.role,
          DEFAULT_ROLE_NAMES as unknown as string[],
        ),
      );

    let updated = 0;
    for (const row of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.permission);
      } catch {
        // JSON ilegível: não adivinhamos o que o administrador quis.
        continue;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        continue;
      }
      const permission = parsed as Record<string, unknown>;
      if ("finance" in permission) continue;

      const defaults = defaultRolePayloads[row.role as DefaultRoleName];
      if (!defaults?.finance) continue;

      permission.finance = [...defaults.finance];
      await db
        .update(schema.workspaceRoleTable)
        .set({ permission: JSON.stringify(permission) })
        .where(eq(schema.workspaceRoleTable.id, row.id));
      updated += 1;
    }

    if (updated > 0) {
      console.log(
        `✅ Permissão "finance" adicionada a ${updated} papel(éis) padrão existente(s).`,
      );
    }
  } catch (error) {
    console.error("❌ Failed to backfill finance permission:", error);
    throw error;
  }
}
