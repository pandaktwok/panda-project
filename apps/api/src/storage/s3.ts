import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createId } from "@paralleldrive/cuid2";
import { config } from "dotenv-mono";

config();

const DEFAULT_MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_PRESIGN_TTL_SECONDS = 300;

const allowedImageMimeTypes = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function isImageContentType(contentType: string) {
  return allowedImageMimeTypes.has(contentType.toLowerCase());
}

type UploadSurface = "description" | "comment";

type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  keyPrefix: string;
  forcePathStyle: boolean;
  maxImageUploadBytes: number;
  presignTtlSeconds: number;
};

type TaskImageUploadContext = {
  workspaceId: string;
  projectId: string;
  taskId: string;
  surface: UploadSurface;
  filename: string;
  contentType: string;
};

type TaskImageUploadUrl = {
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
};

type AssetObject = {
  body: unknown;
  contentType: string | undefined;
  contentLength: number | undefined;
  etag: string | undefined;
  lastModified: Date | undefined;
};

let clientCache:
  | {
      cacheKey: string;
      client: S3Client;
    }
  | undefined;

function env(name: string) {
  return process.env[name]?.trim() || "";
}

export function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

export function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value?.trim() || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * Resolves static S3 credentials from the access key pair.
 *
 * Returns the explicit credentials only when BOTH the access key id and secret
 * are provided. When neither is set, returns `undefined` so the AWS SDK falls
 * back to its default credential provider chain (EC2 instance profile, ECS task
 * role, EKS IRSA, environment variables, or shared config), enabling
 * IAM-role-based access without static keys.
 *
 * Throws when exactly one of the two is set, since that is almost always a
 * misconfiguration rather than an intentional fallback.
 */
export function resolveS3Credentials(
  accessKeyId: string,
  secretAccessKey: string,
): { accessKeyId: string; secretAccessKey: string } | undefined {
  const hasAccessKeyId = Boolean(accessKeyId);
  const hasSecretAccessKey = Boolean(secretAccessKey);

  if (hasAccessKeyId !== hasSecretAccessKey) {
    throw new Error(
      "Incomplete S3 credentials. Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither to use the default AWS credential provider chain (IAM role / IRSA / environment).",
    );
  }

  if (hasAccessKeyId && hasSecretAccessKey) {
    return { accessKeyId, secretAccessKey };
  }

  return undefined;
}

function getStorageConfig(): StorageConfig {
  const endpoint = env("S3_ENDPOINT");
  const bucket = env("S3_BUCKET");
  const accessKeyId = env("S3_ACCESS_KEY_ID");
  const secretAccessKey = env("S3_SECRET_ACCESS_KEY");

  if (!endpoint || !bucket) {
    throw new Error(
      "S3 uploads are not configured. Set S3_ENDPOINT and S3_BUCKET (and either both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither to use the default AWS credential provider chain / IAM role).",
    );
  }

  // Validate the access key pair early so misconfiguration surfaces here rather
  // than as an opaque signing error later.
  resolveS3Credentials(accessKeyId, secretAccessKey);

  return {
    endpoint,
    region: env("S3_REGION") || "us-east-1",
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: env("S3_PUBLIC_BASE_URL") || undefined,
    keyPrefix: env("S3_KEY_PREFIX"),
    forcePathStyle: parseBoolean(process.env.S3_FORCE_PATH_STYLE, true),
    maxImageUploadBytes: parsePositiveInt(
      process.env.S3_MAX_IMAGE_UPLOAD_BYTES,
      DEFAULT_MAX_IMAGE_UPLOAD_BYTES,
    ),
    presignTtlSeconds: parsePositiveInt(
      process.env.S3_PRESIGN_TTL_SECONDS,
      DEFAULT_PRESIGN_TTL_SECONDS,
    ),
  };
}

function getMaxImageUploadBytes() {
  return parsePositiveInt(
    process.env.S3_MAX_IMAGE_UPLOAD_BYTES,
    DEFAULT_MAX_IMAGE_UPLOAD_BYTES,
  );
}

function getClient(config: StorageConfig) {
  const cacheKey = JSON.stringify({
    endpoint: config.endpoint,
    region: config.region,
    accessKeyId: config.accessKeyId,
    bucket: config.bucket,
    forcePathStyle: config.forcePathStyle,
  });

  if (clientCache?.cacheKey === cacheKey) {
    return clientCache.client;
  }

  const clientConfig: S3ClientConfig = {
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    // Avoid auto-injecting checksum params for presigned PUT URLs. Some
    // S3-compatible providers (e.g. Garage/R2) reject mismatched hoisted CRCs.
    requestChecksumCalculation: "WHEN_REQUIRED",
  };

  const credentials = resolveS3Credentials(
    config.accessKeyId,
    config.secretAccessKey,
  );

  // Only pin explicit credentials when both keys are provided. Otherwise leave
  // `credentials` unset so the AWS SDK resolves them from its default provider
  // chain (EC2 instance profile, ECS task role, EKS IRSA, env, shared config),
  // which is how IAM-role-based access works.
  if (credentials) {
    clientConfig.credentials = credentials;
  }

  const client = new S3Client(clientConfig);
  clientCache = { cacheKey, client };
  return client;
}

export function sanitizePathSegment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "") || "file"
  );
}

export function getFileExtension(filename: string) {
  const normalized = filename.trim();
  const extension = normalized.includes(".")
    ? normalized.split(".").pop() || ""
    : "";

  return sanitizePathSegment(extension).slice(0, 12);
}

export function buildObjectKeyPrefix(
  context: Omit<TaskImageUploadContext, "filename" | "contentType">,
) {
  const surfaceFolder =
    context.surface === "comment" ? "comments" : "descriptions";

  return [
    "workspace",
    sanitizePathSegment(context.workspaceId),
    "project",
    sanitizePathSegment(context.projectId),
    "task",
    sanitizePathSegment(context.taskId),
    surfaceFolder,
  ].join("/");
}

export function buildObjectKey(context: TaskImageUploadContext) {
  const extension = getFileExtension(context.filename);
  const objectKeyPrefix = buildObjectKeyPrefix(context);
  const timestamp = Date.now();
  const randomId = createId();

  const baseName = sanitizePathSegment(
    context.filename.replace(/\.[^/.]+$/, "") || "image",
  ).slice(0, 64);

  const fileName = extension
    ? `${baseName}-${timestamp}-${randomId}.${extension}`
    : `${baseName}-${timestamp}-${randomId}`;

  return `${objectKeyPrefix}/${fileName}`;
}

export function applyKeyPrefix(prefix: string, key: string) {
  if (!prefix) return key;
  const trimmed = prefix.replace(/\/+$/, "");
  return `${trimmed}/${key}`;
}

export function validateTaskAssetUploadInput(
  contentType: string,
  size: number,
) {
  const maxImageUploadBytes = getMaxImageUploadBytes();

  if (!contentType.trim()) {
    throw new Error("A valid content type is required.");
  }

  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("Upload size must be a positive safe integer.");
  }

  if (size > maxImageUploadBytes) {
    throw new Error(
      `Upload exceeds the maximum upload size of ${Math.floor(maxImageUploadBytes / (1024 * 1024))}MB.`,
    );
  }
}

export async function createTaskImageUploadUrl(
  context: TaskImageUploadContext & { size: number },
): Promise<TaskImageUploadUrl> {
  validateTaskAssetUploadInput(context.contentType, context.size);
  const config = getStorageConfig();
  const client = getClient(config);
  const rawKey = buildObjectKey(context);
  const key = applyKeyPrefix(config.keyPrefix, rawKey);

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: context.contentType,
    ContentLength: context.size,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: config.presignTtlSeconds,
    signableHeaders: new Set(["content-length", "content-type"]),
  });

  return {
    key,
    uploadUrl,
    headers: {
      // The browser supplies Content-Length from the File body. It is signed,
      // but must not be set by JS because it is a forbidden request header.
      "Content-Type": context.contentType,
    },
  };
}

export class InvalidUploadedAssetError extends Error {}

/** Call only after checking the object's task/workspace key prefix. */
export async function verifyTaskAssetUpload(
  key: string,
  expected: { size: number; contentType: string },
) {
  const config = getStorageConfig();
  const client = getClient(config);
  const abortSignal = AbortSignal.timeout(10_000);
  let object: HeadObjectCommandOutput;
  try {
    object = await client.send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
      { abortSignal },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "NotFound" ||
        error.name === "NoSuchKey" ||
        ("$metadata" in error &&
          (error.$metadata as { httpStatusCode?: number }).httpStatusCode ===
            404))
    ) {
      throw new InvalidUploadedAssetError("Uploaded object was not found.");
    }
    // Provider errors may include endpoints, signed URLs or other secrets.
    throw new Error("Unable to verify uploaded object.");
  }

  const size = object.ContentLength;
  if (typeof size === "number" && size > config.maxImageUploadBytes) {
    // Also remove oversized objects made with a still-valid older upload URL.
    // Invalid client size claims never cause deletion of an in-limit object.
    try {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal },
      );
    } catch {
      throw new Error("Unable to remove oversized uploaded object.");
    }
    throw new InvalidUploadedAssetError(
      "Uploaded object exceeds the maximum upload size.",
    );
  }
  if (
    !Number.isSafeInteger(size) ||
    !size ||
    size !== expected.size ||
    !object.ContentType ||
    object.ContentType.toLowerCase() !== expected.contentType.toLowerCase()
  ) {
    throw new InvalidUploadedAssetError(
      "Uploaded object does not match the declared size and content type.",
    );
  }
  return { size, contentType: object.ContentType };
}

export function assertStorageConfigured() {
  return getStorageConfig();
}

export function assertTaskImageKeyMatchesContext(
  key: string,
  context: Omit<TaskImageUploadContext, "filename" | "contentType">,
) {
  const config = getStorageConfig();
  const objectPrefix = buildObjectKeyPrefix(context);
  const fullPrefix = `${applyKeyPrefix(config.keyPrefix, objectPrefix)}/`;

  if (!key.startsWith(fullPrefix)) {
    return false;
  }

  // The prefix alone is not enough: gateways that normalize paths would let
  // a traversal suffix walk back out into another workspace's objects.
  const suffix = key.slice(fullPrefix.length);
  return /^[A-Za-z0-9._-]+$/.test(suffix) && !suffix.startsWith(".");
}

export async function getPrivateObject(key: string): Promise<AssetObject> {
  const config = getStorageConfig();
  const client = getClient(config);
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );

  if (!response.Body) {
    throw new Error("Storage object body is missing.");
  }

  const body =
    "transformToWebStream" in response.Body
      ? response.Body.transformToWebStream()
      : Readable.toWeb(response.Body as Readable);

  return {
    body,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
    etag: response.ETag,
    lastModified: response.LastModified,
  };
}

export async function deleteS3Object(key: string): Promise<void> {
  const config = getStorageConfig();
  const client = getClient(config);
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );
}

// ---------------------------------------------------------------------------
// Financeiro: gravação de objetos feita pelo servidor. As chaves usam apenas
// ids (nunca o nome do projeto ou do fornecedor), então renomear não quebra
// caminho algum. O nome bonito do arquivo vive na tabela asset.
// ---------------------------------------------------------------------------

const DEFAULT_MAX_FINANCE_FILE_BYTES = 25 * 1024 * 1024;

/** Limite por arquivo do Financeiro (env FINANCE_MAX_FILE_BYTES, padrão 25 MB). */
export function getMaxFinanceFileBytes() {
  return parsePositiveInt(
    process.env.FINANCE_MAX_FILE_BYTES,
    DEFAULT_MAX_FINANCE_FILE_BYTES,
  );
}

type FinanceObjectArea =
  | { area: "anexos" }
  | { area: "envios" }
  | { area: "parcela"; installmentId: string };

export function buildFinanceObjectKey(
  context: { workspaceId: string; projectId: string; extension: string },
  where: FinanceObjectArea,
) {
  const base = [
    "workspace",
    sanitizePathSegment(context.workspaceId),
    "project",
    sanitizePathSegment(context.projectId),
  ];
  const folder =
    where.area === "anexos"
      ? ["anexos"]
      : where.area === "envios"
        ? ["financeiro", "envios"]
        : ["financeiro", sanitizePathSegment(where.installmentId)];
  const extension = sanitizePathSegment(context.extension).slice(0, 8);
  const file = `${randomUUID()}.${extension || "bin"}`;
  const config = getStorageConfig();
  return applyKeyPrefix(config.keyPrefix, [...base, ...folder, file].join("/"));
}

export async function putPrivateObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const config = getStorageConfig();
  const client = getClient(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.byteLength,
    }),
    { abortSignal: AbortSignal.timeout(60_000) },
  );
}

/** Lê o objeto inteiro em memória, recusando o que passar de `maxBytes`. */
export async function getPrivateObjectBytes(
  key: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const config = getStorageConfig();
  const client = getClient(config);
  const response = await client.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { abortSignal: AbortSignal.timeout(60_000) },
  );
  if (!response.Body) {
    throw new Error("Storage object body is missing.");
  }
  if (
    typeof response.ContentLength === "number" &&
    response.ContentLength > maxBytes
  ) {
    throw new Error("Storage object is larger than the allowed size.");
  }
  const bytes = await response.Body.transformToByteArray();
  if (bytes.byteLength > maxBytes) {
    throw new Error("Storage object is larger than the allowed size.");
  }
  return bytes;
}

/**
 * Cria o bucket se ele ainda não existe (instalação nova com armazenamento
 * local). Se não der para criar (permissão, provedor externo), só devolve
 * false: quem chama decide se tenta de novo.
 */
export async function ensureBucketExists(): Promise<boolean> {
  const config = getStorageConfig();
  const client = getClient(config);
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }), {
      abortSignal: AbortSignal.timeout(10_000),
    });
    return true;
  } catch {
    // Sem bucket (ou sem permissão para ver): tenta criar abaixo.
  }
  try {
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }), {
      abortSignal: AbortSignal.timeout(10_000),
    });
    return true;
  } catch (error) {
    const name = (error as { name?: string }).name;
    // Outro servidor criou no mesmo instante.
    return name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists";
  }
}

/** No início do servidor: espera o armazenamento subir e garante o bucket. */
export async function ensureBucketWithRetry(
  attempts = 60,
  delayMs = 3000,
): Promise<void> {
  try {
    getStorageConfig();
  } catch {
    return; // armazenamento não configurado: nada a fazer
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await ensureBucketExists()) return;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  console.error(
    "Could not reach the file storage or create its bucket. Check S3_* settings.",
  );
}
