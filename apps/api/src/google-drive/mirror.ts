import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import db, { schema } from "../database";
import { sanitizeNamePart } from "../project-finance/files/names";
import { withJobLease } from "../scheduler/leader-lock";
import { getMaxFinanceFileBytes, getPrivateObjectBytes } from "../storage/s3";
import {
  createFolder,
  findByAppProperty,
  folderIsUsable,
  GoogleApiError,
  refreshAccessToken,
  uploadPdf,
} from "./client";
import { getConfigRow, getCredentials, markError, markHealthy } from "./config";

export const MAX_ATTEMPTS = 8;
const BATCH = 20;
export const DRIVE_COPY_LEASE = "google-drive-copy";
const ROOT_FOLDER_NAME = "Panda Project";
const AUTH_RETRY_MS = 15 * 60 * 1000;

export type CopyState = "pending" | "copied" | "failed";

// ---------------------------------------------------------------------------
// Token de acesso (curta duração), guardado só em memória.
// ---------------------------------------------------------------------------
let cachedToken: { value: string; expiresAt: number } | null = null;
export function forgetAccessToken() {
  cachedToken = null;
}

export async function getAccessToken(): Promise<{
  token: string;
  rootFolderId: string;
}> {
  const creds = await getCredentials();
  if (
    !creds?.refreshToken ||
    !creds.rootFolderId ||
    creds.status === "disconnected"
  ) {
    throw new GoogleApiError("O Google Drive não está conectado.", 0, true);
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return { token: cachedToken.value, rootFolderId: creds.rootFolderId };
  }
  const fresh = await refreshAccessToken({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refreshToken: creds.refreshToken,
  });
  cachedToken = {
    value: fresh.access_token,
    expiresAt: Date.now() + fresh.expires_in * 1000,
  };
  return { token: fresh.access_token, rootFolderId: creds.rootFolderId };
}

export async function createRootFolder(accessToken: string) {
  const markKey = "panda_key";
  const markValue = "root";
  const existing = await findByAppProperty(accessToken, {
    key: markKey,
    value: markValue,
    folder: true,
  });
  if (existing) return existing.id;
  return (
    await createFolder(accessToken, {
      name: ROOT_FOLDER_NAME,
      markKey,
      markValue,
    })
  ).id;
}

// ---------------------------------------------------------------------------
// Pastas: procura antes de criar e guarda os ids (nunca duplica).
// ---------------------------------------------------------------------------
async function ensureFolder(
  token: string,
  rootFolderId: string,
  input: { key: string; name: string; parentId: string },
): Promise<string> {
  const [cached] = await db
    .select()
    .from(schema.googleDriveFolderTable)
    .where(
      and(
        eq(schema.googleDriveFolderTable.rootFolderId, rootFolderId),
        eq(schema.googleDriveFolderTable.key, input.key),
      ),
    )
    .limit(1);
  if (cached) {
    if (await folderIsUsable(token, cached.driveFolderId)) {
      return cached.driveFolderId;
    }
    await db
      .delete(schema.googleDriveFolderTable)
      .where(eq(schema.googleDriveFolderTable.id, cached.id));
  }
  const found = await findByAppProperty(token, {
    key: "panda_key",
    value: input.key,
    parentId: input.parentId,
    folder: true,
  });
  const id =
    found?.id ??
    (
      await createFolder(token, {
        name: input.name,
        parentId: input.parentId,
        markKey: "panda_key",
        markValue: input.key,
      })
    ).id;
  await db
    .insert(schema.googleDriveFolderTable)
    .values({ key: input.key, rootFolderId, driveFolderId: id })
    .onConflictDoUpdate({
      target: [
        schema.googleDriveFolderTable.rootFolderId,
        schema.googleDriveFolderTable.key,
      ],
      set: { driveFolderId: id },
    });
  return id;
}

type CopyJob = typeof schema.googleDriveCopyTable.$inferSelect;

async function copyOne(job: CopyJob, token: string, rootFolderId: string) {
  const [row] = await db
    .select({
      filename: schema.assetTable.filename,
      objectKey: schema.assetTable.objectKey,
      folderLabel: schema.assetTable.folderLabel,
      projectName: schema.projectTable.name,
    })
    .from(schema.assetTable)
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.assetTable.projectId),
    )
    .where(eq(schema.assetTable.id, job.assetId))
    .limit(1);
  if (!row) throw new Error("O PDF do pagamento não existe mais.");

  const projectFolder = await ensureFolder(token, rootFolderId, {
    key: `project:${job.projectId}`,
    name: sanitizeNamePart(row.projectName, 120),
    parentId: rootFolderId,
  });
  const financeFolder = await ensureFolder(token, rootFolderId, {
    key: `finance:${job.projectId}`,
    name: "Financeiro",
    parentId: projectFolder,
  });
  const label = row.folderLabel ?? "Parcela";
  const parcelFolder = await ensureFolder(token, rootFolderId, {
    key: `parcel:${job.projectId}:${label}`,
    name: label,
    parentId: financeFolder,
  });

  // Se uma tentativa anterior enviou o arquivo mas caiu antes de anotar, o
  // arquivo já está lá: reaproveita em vez de duplicar.
  const existing = await findByAppProperty(token, {
    key: "panda_asset_id",
    value: job.assetId,
    parentId: parcelFolder,
  });
  const fileId =
    existing?.id ??
    (
      await uploadPdf(token, {
        name: row.filename,
        parentId: parcelFolder,
        bytes: await getPrivateObjectBytes(
          row.objectKey,
          getMaxFinanceFileBytes() * 2,
        ),
        markKey: "panda_asset_id",
        markValue: job.assetId,
      })
    ).id;
  return { fileId, folderId: parcelFolder };
}

const backoffMs = (attempts: number) =>
  Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempts - 1));

const safeMessage = (error: unknown) =>
  (error instanceof Error ? error.message : "Erro desconhecido").slice(0, 300);

/** Uma rodada da fila, com trava: só um servidor copia de cada vez. */
export function processDriveQueue(): Promise<{
  copied: number;
  retried: number;
  failed: number;
}> {
  const idle = { copied: 0, retried: 0, failed: 0 };
  return withJobLease(
    DRIVE_COPY_LEASE,
    async () => {
      const config = await getConfigRow();
      if (
        !config ||
        config.status === "disconnected" ||
        !config.refreshTokenEnc
      ) {
        return { ...idle };
      }
      const jobs = await db
        .select()
        .from(schema.googleDriveCopyTable)
        .where(
          and(
            eq(schema.googleDriveCopyTable.status, "pending"),
            lte(schema.googleDriveCopyTable.nextAttemptAt, new Date()),
          ),
        )
        .orderBy(asc(schema.googleDriveCopyTable.createdAt))
        .limit(BATCH);
      const result = { ...idle };
      for (const job of jobs) {
        try {
          const { token, rootFolderId } = await getAccessToken();
          const done = await copyOne(job, token, rootFolderId);
          await db
            .update(schema.googleDriveCopyTable)
            .set({
              status: "copied",
              driveFileId: done.fileId,
              driveFolderId: done.folderId,
              copiedAt: new Date(),
              lastError: null,
            })
            .where(eq(schema.googleDriveCopyTable.id, job.id));
          await markHealthy();
          result.copied += 1;
        } catch (error) {
          if (error instanceof GoogleApiError && error.authInvalid) {
            // O acesso foi recusado: não gasta tentativa do item, avisa na tela.
            forgetAccessToken();
            await markError(
              "O Google recusou o acesso. Reconecte em Configurações > Google Drive.",
            );
            await db
              .update(schema.googleDriveCopyTable)
              .set({
                lastError: safeMessage(error),
                nextAttemptAt: new Date(Date.now() + AUTH_RETRY_MS),
              })
              .where(eq(schema.googleDriveCopyTable.id, job.id));
            result.retried += 1;
            break;
          }
          const attempts = job.attempts + 1;
          const exhausted = attempts >= MAX_ATTEMPTS;
          await db
            .update(schema.googleDriveCopyTable)
            .set({
              attempts,
              status: exhausted ? "failed" : "pending",
              lastError: safeMessage(error),
              nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
            })
            .where(eq(schema.googleDriveCopyTable.id, job.id));
          if (exhausted) result.failed += 1;
          else result.retried += 1;
        }
      }
      return result;
    },
    () => ({ ...idle }),
    10 * 60 * 1000,
  );
}

let lastRun: Promise<unknown> = Promise.resolve();
/** Tenta copiar já (sem esperar o relógio). Nunca lança e ninguém espera por isso. */
export function triggerDriveProcessing() {
  lastRun = processDriveQueue().catch((error) => {
    console.error("Google Drive copy run failed", error);
  });
}
/** Só para testes: espera a rodada disparada por último. */
export const awaitDriveIdle = () => lastRun;

// ---------------------------------------------------------------------------
// Fila: entrada, reenvio e resumo.
// ---------------------------------------------------------------------------

export async function isDriveConnected() {
  const row = await getConfigRow();
  return Boolean(row && row.status !== "disconnected" && row.refreshTokenEnc);
}

/**
 * Depois que o pagamento foi salvo. Falha do Drive (ou do banco da fila) NUNCA
 * pode desfazer nem atrapalhar o pagamento: tudo aqui é melhor esforço.
 */
export async function enqueueCopies(
  assets: Array<{ id: string; projectId: string }>,
) {
  if (assets.length === 0) return;
  try {
    if (!(await isDriveConnected())) return;
    await db
      .insert(schema.googleDriveCopyTable)
      .values(
        assets.map((asset) => ({
          assetId: asset.id,
          projectId: asset.projectId,
        })),
      )
      .onConflictDoNothing();
    triggerDriveProcessing();
  } catch (error) {
    console.error("Failed to queue Google Drive copies", error);
  }
}

/** "Copiar pagamentos antigos": todo PDF de parcela paga que ainda não está na fila. */
export async function backfillOldPayments(): Promise<{ queued: number }> {
  const rows = await db
    .select({
      id: schema.assetTable.id,
      projectId: schema.assetTable.projectId,
    })
    .from(schema.projectInstallmentTable)
    .innerJoin(
      schema.assetTable,
      eq(schema.projectInstallmentTable.fileAssetId, schema.assetTable.id),
    )
    .where(
      and(
        isNotNull(schema.projectInstallmentTable.paidAt),
        isNull(schema.assetTable.undoneAt),
      ),
    );
  if (rows.length === 0) return { queued: 0 };
  const inserted = await db
    .insert(schema.googleDriveCopyTable)
    .values(rows.map((row) => ({ assetId: row.id, projectId: row.projectId })))
    .onConflictDoNothing()
    .returning({ id: schema.googleDriveCopyTable.id });
  triggerDriveProcessing();
  return { queued: inserted.length };
}

/** "Tentar de novo": volta o item para pendente com zero tentativas. */
export async function retryCopy(assetId: string): Promise<boolean> {
  const updated = await db
    .update(schema.googleDriveCopyTable)
    .set({
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
    })
    .where(
      and(
        eq(schema.googleDriveCopyTable.assetId, assetId),
        inArray(schema.googleDriveCopyTable.status, ["failed", "pending"]),
      ),
    )
    .returning({ id: schema.googleDriveCopyTable.id });
  if (updated.length > 0) triggerDriveProcessing();
  return updated.length > 0;
}

export async function queueSummary() {
  const rows = await db
    .select({
      status: schema.googleDriveCopyTable.status,
      total: count(),
    })
    .from(schema.googleDriveCopyTable)
    .groupBy(schema.googleDriveCopyTable.status);
  const summary = { pending: 0, copied: 0, failed: 0 };
  for (const row of rows) {
    if (row.status in summary)
      summary[row.status as CopyState] = Number(row.total);
  }
  return summary;
}

export type DriveCopyInfo = {
  state: CopyState;
  attempts: number;
  lastError: string | null;
};

/** Estado da cópia de cada arquivo (só existe se o Drive está configurado). */
export async function driveStatusForAssets(
  assetIds: string[],
): Promise<Map<string, DriveCopyInfo>> {
  const map = new Map<string, DriveCopyInfo>();
  if (assetIds.length === 0) return map;
  const rows = await db
    .select({
      assetId: schema.googleDriveCopyTable.assetId,
      status: schema.googleDriveCopyTable.status,
      attempts: schema.googleDriveCopyTable.attempts,
      lastError: schema.googleDriveCopyTable.lastError,
    })
    .from(schema.googleDriveCopyTable)
    .where(inArray(schema.googleDriveCopyTable.assetId, assetIds));
  for (const row of rows) {
    map.set(row.assetId, {
      state: row.status as CopyState,
      attempts: row.attempts,
      lastError: row.lastError,
    });
  }
  return map;
}

export async function listOpenCopies(limit = 50) {
  return db
    .select({
      assetId: schema.googleDriveCopyTable.assetId,
      status: schema.googleDriveCopyTable.status,
      attempts: schema.googleDriveCopyTable.attempts,
      lastError: schema.googleDriveCopyTable.lastError,
      nextAttemptAt: schema.googleDriveCopyTable.nextAttemptAt,
      filename: schema.assetTable.filename,
      projectName: schema.projectTable.name,
    })
    .from(schema.googleDriveCopyTable)
    .innerJoin(
      schema.assetTable,
      eq(schema.assetTable.id, schema.googleDriveCopyTable.assetId),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.googleDriveCopyTable.projectId),
    )
    .where(sql`${schema.googleDriveCopyTable.status} <> 'copied'`)
    .orderBy(asc(schema.googleDriveCopyTable.createdAt))
    .limit(limit);
}
