import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { assertProjectKey } from "../project-access";
import { getMaxFinanceFileBytes } from "../storage/s3";
import { boundedRequestBody } from "../utils/bounded-request-body";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  projectIdOfInstallment,
  publishFinanceUpdated,
} from "./controllers/common";
import getFinance from "./controllers/get-finance";
import { createLine, deleteLine, updateLine } from "./controllers/lines";
import { savePayments } from "./controllers/save-payments";
import {
  createTag,
  deleteTag,
  listTagCatalog,
  updateTag,
} from "./controllers/tags";
import undoPayment from "./controllers/undo-payment";
import updateFinanceSettings from "./controllers/update-settings";
import { deleteProjectAttachment, listFinanceFiles } from "./files/listing";
import { uploadFinanceFile } from "./files/upload";
import { buildParcelZip } from "./files/zip";
import {
  financeFileErrorSchema,
  financeFilesSchema,
  financeLineHasPaymentsSchema,
  financeStateSchema,
  financeTagCatalogSchema,
  financeTagInUseSchema,
  financeUploadedFileSchema,
  financeVersionConflictSchema,
} from "./response";
import {
  createLineBody,
  createTagBody,
  forceQuery,
  installmentIdParam,
  lineIdParam,
  parcelZipParam,
  projectFileParam,
  projectIdParam,
  saveFinanceBody,
  tagIdParam,
  updateFinanceSettingsBody,
  updateLineBody,
  updateTagBody,
  uploadFileQuery,
} from "./schema";

const TAGS = ["Project finance"];

const getFinanceRoute = createRoute({
  method: "get",
  operationId: "getProjectFinance",
  path: "/{projectId}",
  tags: TAGS,
  summary: "Get project finance",
  description:
    "Tags, payment lines, installments and totals of a project in one self-contained state, plus the `version` token used by the save endpoint. Money is in integer cents; dates are YYYY-MM-DD.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ finance: ["read"] }),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The project's finance state", financeStateSchema),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("No workspace access, or missing finance:read"),
  },
});

const updateSettingsRoute = createRoute({
  method: "put",
  operationId: "updateProjectFinanceSettings",
  path: "/{projectId}/settings",
  tags: TAGS,
  summary: "Update project finance defaults",
  description:
    "Set the project's total, number of months and first due date. Existing lines and installments are not changed.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ finance: ["manage"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateFinanceSettingsBody } },
    },
  },
  responses: {
    200: jsonResponse("The new finance state", financeStateSchema),
    400: errorResponse("Invalid body, or unknown project"),
    403: errorResponse("No workspace access, or missing finance:manage"),
  },
});

const tagCatalogRoute = createRoute({
  method: "get",
  operationId: "getProjectFinanceTagCatalog",
  path: "/{projectId}/tag-catalog",
  tags: TAGS,
  summary: "List reusable tag names for this project's workspace",
  description:
    "Tag names already used in some project of this workspace, so the UI can suggest/reuse them when creating a new tag. Read-only; creating a tag with a new name adds it here automatically.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ finance: ["read"] }),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The workspace's tag catalog", financeTagCatalogSchema),
    400: errorResponse(
      "Unknown project, or its workspace could not be determined",
    ),
    403: errorResponse("No workspace access, or missing finance:read"),
  },
});

const createTagRoute = createRoute({
  method: "post",
  operationId: "createProjectFinanceTag",
  path: "/{projectId}/tags",
  tags: TAGS,
  summary: "Create a project tag",
  description:
    "Create an internal project tag (name, description, value in cents). Names are unique per project, ignoring case.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ finance: ["manage"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createTagBody } },
    },
  },
  responses: {
    200: jsonResponse("The new finance state", financeStateSchema),
    400: errorResponse("Invalid body, or unknown project"),
    403: errorResponse("No workspace access, or missing finance:manage"),
    409: errorResponse("A tag with this name already exists"),
  },
});

const updateTagRoute = createRoute({
  method: "put",
  operationId: "updateProjectFinanceTag",
  path: "/tags/{tagId}",
  tags: TAGS,
  summary: "Update a project tag",
  description: "Change a tag's name, description and/or value.",
  middleware: [
    workspaceAccess.fromProjectTag("tagId"),
    requireWorkspacePermission({ finance: ["manage"] }),
  ] as const,
  request: {
    params: tagIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTagBody } },
    },
  },
  responses: {
    200: jsonResponse("The new finance state", financeStateSchema),
    400: errorResponse("Invalid body, or unknown tag"),
    403: errorResponse("No workspace access, or missing finance:manage"),
    404: errorResponse("Tag not found"),
    409: errorResponse("A tag with this name already exists"),
  },
});

const deleteTagRoute = createRoute({
  method: "delete",
  operationId: "deleteProjectFinanceTag",
  path: "/tags/{tagId}",
  tags: TAGS,
  summary: "Delete a project tag",
  description:
    "Delete a tag. If payment lines still use it the request is refused with 409 and the number of lines in use; repeat with force=true to detach those lines (they keep existing, without a type) and delete the tag.",
  middleware: [
    workspaceAccess.fromProjectTag("tagId"),
    requireWorkspacePermission({ finance: ["manage"] }),
  ] as const,
  request: { params: tagIdParam, query: forceQuery },
  responses: {
    200: jsonResponse("The new finance state", financeStateSchema),
    400: errorResponse("Unknown tag"),
    403: errorResponse("No workspace access, or missing finance:manage"),
    404: errorResponse("Tag not found"),
    409: jsonResponse(
      "The tag is in use by payment lines",
      financeTagInUseSchema,
    ),
  },
});

const createLineRoute = createRoute({
  method: "post",
  operationId: "createProjectFinanceLine",
  path: "/{projectId}/lines",
  tags: TAGS,
  summary: "Create a payment line",
  description:
    "Create a supplier line and generate its monthly installments: consecutive due dates from the first due date (day 31 becomes the last day of short months) and equal values, the last one absorbing the remainder. `installmentsCount` and `firstDueDate` default to the project's settings.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ finance: ["manage"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createLineBody } },
    },
  },
  responses: {
    200: jsonResponse("The new finance state", financeStateSchema),
    400: errorResponse("Invalid body, or unknown project"),
    403: errorResponse("No workspace access, or missing finance:manage"),
    404: errorResponse("Tag not found in this project"),
  },
});

const updateLineRoute = createRoute({
  method: "put",
  operationId: "updateProjectFinanceLine",
  path: "/lines/{lineId}",
  tags: TAGS,
  summary: "Update a payment line",
  description:
    "Change supplier, tag, total, number of installments and/or first due date. Only unpaid installments change: their due dates follow the new first date and their values are recalculated as (total - paid) / unpaid count. Reducing the count removes the last unpaid installments; it is refused (409) if a paid installment would be removed. Increasing it appends new installments.",
  middleware: [
    workspaceAccess.fromPaymentLine("lineId"),
    requireWorkspacePermission({ finance: ["manage"] }),
  ] as const,
  request: {
    params: lineIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateLineBody } },
    },
  },
  responses: {
    200: jsonResponse("The new finance state", financeStateSchema),
    400: errorResponse("Invalid body, or unknown line"),
    403: errorResponse("No workspace access, or missing finance:manage"),
    404: errorResponse("Line or tag not found"),
    409: errorResponse("The installment count would remove a paid installment"),
  },
});

const deleteLineRoute = createRoute({
  method: "delete",
  operationId: "deleteProjectFinanceLine",
  path: "/lines/{lineId}",
  tags: TAGS,
  summary: "Delete a payment line",
  description:
    "Delete a line and its installments. Refused with 409 if any installment is paid, unless force=true.",
  middleware: [
    workspaceAccess.fromPaymentLine("lineId"),
    requireWorkspacePermission({ finance: ["manage"] }),
  ] as const,
  request: { params: lineIdParam, query: forceQuery },
  responses: {
    200: jsonResponse("The new finance state", financeStateSchema),
    400: errorResponse("Unknown line"),
    403: errorResponse("No workspace access, or missing finance:manage"),
    404: errorResponse("Line not found"),
    409: jsonResponse(
      "The line has paid installments",
      financeLineHasPaymentsSchema,
    ),
  },
});

const saveRoute = createRoute({
  method: "post",
  operationId: "saveProjectFinance",
  path: "/{projectId}/save",
  tags: TAGS,
  summary: "Save payments in batch",
  description:
    "Mark installments as paid (paid amount, date, and the receipt and invoice uploaded beforehand). For each installment the server merges receipt then invoice into a single PDF and stores it as `Supplier - Installment N.pdf`. All-or-nothing, in one transaction serialized per project; nothing stays half-written if the merge or the database fails. Remaining unpaid installments of each affected line are recalculated. If `version` is no longer current nothing is written and the current state is returned with 409.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ finance: ["pay"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: saveFinanceBody } },
    },
  },
  responses: {
    200: jsonResponse("The new finance state", financeStateSchema),
    400: errorResponse("Invalid body, or duplicated installment"),
    403: errorResponse(
      "No workspace access, missing finance:pay, or missing finance:attach",
    ),
    404: jsonResponse(
      "Installment not found, or the receipt/invoice upload was not found in this project",
      financeFileErrorSchema,
    ),
    413: jsonResponse("A file is too large", financeFileErrorSchema),
    415: jsonResponse(
      "A file type cannot be merged (convert to PDF, JPG or PNG)",
      financeFileErrorSchema,
    ),
    422: jsonResponse(
      "A PDF is password-protected or damaged",
      financeFileErrorSchema,
    ),
    503: jsonResponse("File storage unavailable", financeFileErrorSchema),
    409: jsonResponse(
      "Stale version (state attached), or an installment is already paid",
      financeVersionConflictSchema,
    ),
  },
});

const undoRoute = createRoute({
  method: "post",
  operationId: "undoProjectFinancePayment",
  path: "/installments/{installmentId}/undo",
  tags: TAGS,
  summary: "Undo a payment",
  description:
    "Return a paid installment to unpaid and recalculate the remaining unpaid installments of its line.",
  middleware: [
    workspaceAccess.fromInstallment("installmentId"),
    requireWorkspacePermission({ finance: ["undo"] }),
  ] as const,
  request: { params: installmentIdParam },
  responses: {
    200: jsonResponse("The new finance state", financeStateSchema),
    400: errorResponse("Unknown installment"),
    403: errorResponse("No workspace access, or missing finance:undo"),
    404: errorResponse("Installment not found"),
    409: errorResponse("The installment is not paid"),
  },
});

function contentDispositionFor(filename: string) {
  const ascii = filename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/["\\]/g, "");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

const boundedFinanceUpload = (c: Context, next: Next) =>
  boundedRequestBody(getMaxFinanceFileBytes() + 4096, 60_000)(c, next);

const listFilesRoute = createRoute({
  method: "get",
  operationId: "listProjectFinanceFiles",
  path: "/{projectId}/files",
  tags: TAGS,
  summary: "List project files",
  description:
    "Project attachments plus the virtual tree Financeiro > Parcela N - MM-AAAA > `Supplier - Parcela N.pdf`, built from the paid installments (MM-AAAA is the month and year of the DUE date). PDFs of undone payments are only listed to callers with finance:undo. Download each file with GET /asset/{id}.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ finance: ["read"] }),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The project's files", financeFilesSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse("No workspace access, or missing finance:read"),
  },
});

const uploadFileRoute = createRoute({
  method: "post",
  operationId: "uploadProjectFinanceFile",
  path: "/{projectId}/files",
  tags: TAGS,
  summary: "Upload a project attachment, receipt or invoice",
  description:
    "Send the raw file bytes as the request body (any content type; the type is detected from the file contents). `purpose=project` stores a project attachment (PDF, JPG, PNG or WebP). `purpose=receipt` or `invoice` stores a temporary upload (PDF, JPG or PNG) to be used by the save endpoint; temporary uploads that are not used within 24 hours are removed. Files are always private. Maximum size is FINANCE_MAX_FILE_BYTES (default 25 MB).",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ finance: ["attach"] }),
    boundedFinanceUpload,
  ] as const,
  request: {
    params: projectIdParam,
    query: uploadFileQuery,
    body: {
      required: true,
      content: {
        "application/octet-stream": {
          schema: { type: "string", format: "binary" },
        },
      },
    },
  },
  responses: {
    200: jsonResponse("The stored file", financeUploadedFileSchema),
    400: jsonResponse("Empty file", financeFileErrorSchema),
    403: errorResponse(
      "No workspace access, missing finance:attach, or missing finance:pay for a receipt/invoice",
    ),
    413: jsonResponse("File too large", financeFileErrorSchema),
    415: jsonResponse(
      "Unsupported type, or a format that needs conversion (WebP/HEIC)",
      financeFileErrorSchema,
    ),
    503: jsonResponse("File storage unavailable", financeFileErrorSchema),
  },
});

const deleteFileRoute = createRoute({
  method: "delete",
  operationId: "deleteProjectFinanceFile",
  path: "/{projectId}/files/{assetId}",
  tags: TAGS,
  summary: "Delete a project attachment",
  description:
    "Remove an attachment of the project. Payment PDFs cannot be deleted here: undoing the payment keeps them, marked as undone.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ finance: ["manage"] }),
  ] as const,
  request: { params: projectFileParam },
  responses: {
    204: { description: "Deleted" },
    403: errorResponse("No workspace access, or missing finance:manage"),
    404: jsonResponse("File not found", financeFileErrorSchema),
  },
});

const parcelZipRoute = createRoute({
  method: "get",
  operationId: "downloadProjectFinanceParcelZip",
  path: "/{projectId}/files/parcels/{number}/zip",
  tags: TAGS,
  summary: "Download every file of an installment as a ZIP",
  description:
    "ZIP with the payment PDFs of installment N from all lines, inside the folder `Parcela N - MM-AAAA`.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ finance: ["read"] }),
  ] as const,
  request: { params: parcelZipParam },
  responses: {
    200: {
      description: "The ZIP archive",
      content: {
        "application/zip": { schema: { type: "string", format: "binary" } },
      },
    },
    403: errorResponse("No workspace access, or missing finance:read"),
    404: errorResponse("No files for this installment"),
  },
});

const projectFinance = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getFinanceRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json(await getFinance(projectId), 200);
  })
  .openapi(updateSettingsRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const state = await updateFinanceSettings(projectId, c.req.valid("json"), {
      userId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
    });
    return c.json(state, 200);
  })
  .openapi(tagCatalogRoute, async (c) => {
    const tags = await listTagCatalog(c.get("workspaceId"));
    return c.json({ tags }, 200);
  })
  .openapi(createTagRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const state = await createTag(projectId, c.req.valid("json"), {
      userId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
    });
    return c.json(state, 200);
  })
  .openapi(updateTagRoute, async (c) => {
    const { tagId } = c.req.valid("param");
    const state = await updateTag(tagId, c.req.valid("json"), {
      userId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
    });
    return c.json(state, 200);
  })
  .openapi(deleteTagRoute, async (c) => {
    const { tagId } = c.req.valid("param");
    const { force } = c.req.valid("query");
    const result = await deleteTag(tagId, force === "true", {
      userId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
    });
    if (!result.deleted) {
      return c.json(
        {
          message: `The tag is used by ${result.linesInUse} payment line(s); repeat with force=true to detach them`,
          code: "TAG_IN_USE" as const,
          linesInUse: result.linesInUse,
        },
        409,
      );
    }
    return c.json(result.state, 200);
  })
  .openapi(createLineRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const state = await createLine(projectId, c.req.valid("json"), {
      userId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
    });
    return c.json(state, 200);
  })
  .openapi(updateLineRoute, async (c) => {
    const { lineId } = c.req.valid("param");
    const state = await updateLine(lineId, c.req.valid("json"), {
      userId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
    });
    return c.json(state, 200);
  })
  .openapi(deleteLineRoute, async (c) => {
    const { lineId } = c.req.valid("param");
    const { force } = c.req.valid("query");
    const result = await deleteLine(lineId, force === "true", {
      userId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
    });
    if (!result.deleted) {
      return c.json(
        {
          message: `The line has ${result.paidInstallments} paid installment(s); repeat with force=true to delete it anyway`,
          code: "LINE_HAS_PAYMENTS" as const,
          paidInstallments: result.paidInstallments,
        },
        409,
      );
    }
    return c.json(result.state, 200);
  })
  .openapi(saveRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { version, payments } = c.req.valid("json");
    // Todo pagamento leva comprovante e NF: anexar é outra ação (finance:attach).
    if (!(await hasWorkspacePermission(c, { finance: ["attach"] }))) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }
    // Fase 7A: as chaves do projeto (registrar pagamentos e anexar) valem por cima do papel.
    await assertProjectKey(c.get("userId"), projectId, "pay");
    await assertProjectKey(c.get("userId"), projectId, "attach");
    const result = await savePayments(projectId, version, payments, {
      userId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
    });
    if (result.conflict) {
      return c.json(
        {
          message:
            "The project's finance data changed since it was loaded; review the current state and try again",
          state: result.state,
        },
        409,
      );
    }
    return c.json(result.state, 200);
  })
  .openapi(listFilesRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const includeUndone = await hasWorkspacePermission(c, {
      finance: ["undo"],
    });
    return c.json(await listFinanceFiles(projectId, { includeUndone }), 200);
  })
  .openapi(uploadFileRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { purpose, filename } = c.req.valid("query");
    await assertProjectKey(
      c.get("userId"),
      projectId,
      purpose === "project" ? "attach" : "pay",
    );
    if (
      purpose !== "project" &&
      !(await hasWorkspacePermission(c, { finance: ["pay"] }))
    ) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const file = await uploadFinanceFile({
      projectId,
      purpose,
      filename,
      bytes,
      actor: { userId: c.get("userId"), workspaceId: c.get("workspaceId") },
    });
    if (purpose === "project") {
      await publishFinanceUpdated(
        projectId,
        {
          userId: c.get("userId"),
          workspaceId: c.get("workspaceId"),
        },
        "attachment.created",
      );
    }
    return c.json(file, 200);
  })
  .openapi(deleteFileRoute, async (c) => {
    const { projectId, assetId } = c.req.valid("param");
    await assertProjectKey(c.get("userId"), projectId, "attach");
    await deleteProjectAttachment(projectId, assetId, {
      userId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
    });
    return c.body(null, 204);
  })
  .openapi(parcelZipRoute, async (c) => {
    const { projectId, number } = c.req.valid("param");
    const zip = await buildParcelZip(projectId, number);
    if (!zip)
      throw new HTTPException(404, {
        message: "No files for this installment",
      });
    return new Response(zip.bytes as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDispositionFor(zip.filename),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  })
  .openapi(undoRoute, async (c) => {
    const { installmentId } = c.req.valid("param");
    await assertProjectKey(
      c.get("userId"),
      await projectIdOfInstallment(installmentId),
      "pay",
    );
    const state = await undoPayment(installmentId, {
      userId: c.get("userId"),
      workspaceId: c.get("workspaceId"),
    });
    return c.json(state, 200);
  });

export default projectFinance;
