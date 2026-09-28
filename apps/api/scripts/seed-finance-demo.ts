// SÓ PARA DESENVOLVIMENTO. Cria o projeto do mockup (3 tags, 4 fornecedores,
// parcelas de fev a nov/2026) no primeiro espaço da conta informada, para
// comparar a tela lado a lado com o mockup. "Hoje" do mockup é 24/09/2026.
//
// Uso (a API precisa estar com o mesmo DATABASE_URL):
//   SEED_EMAIL=voce@exemplo.com pnpm --filter @kaneo/api seed:finance-demo
// Rodar de novo cria outro projeto (nome ganha sufixo) e não mexe nos antigos.
import { and, eq } from "drizzle-orm";
import db from "../src/database";
import {
  projectInstallmentTable,
  projectPaymentLineTable,
  userTable,
  workspaceUserTable,
} from "../src/database/schema";
import createProject from "../src/project/controllers/create-project";
import { createLine } from "../src/project-finance/controllers/lines";
import { createTag } from "../src/project-finance/controllers/tags";

const email = process.env.SEED_EMAIL;
if (!email) {
  console.error(
    "Defina SEED_EMAIL com o e-mail da conta que vai ver o projeto.",
  );
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error("Recusado: script de desenvolvimento.");
  process.exit(1);
}

const [user] = await db
  .select()
  .from(userTable)
  .where(eq(userTable.email, email))
  .limit(1);
if (!user) {
  console.error(`Conta ${email} não encontrada. Crie a conta primeiro.`);
  process.exit(1);
}
const [membership] = await db
  .select()
  .from(workspaceUserTable)
  .where(eq(workspaceUserTable.userId, user.id))
  .limit(1);
if (!membership) {
  console.error("A conta não tem espaço de trabalho. Crie um pelo app.");
  process.exit(1);
}
const workspaceId = membership.workspaceId;
const actor = { userId: user.id, workspaceId };

const suffix = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const project = await createProject(
  workspaceId,
  `Cultura e Informação para a Pessoa Idosa (${suffix})`,
  "Layout",
  `CI${suffix.slice(-4)}`,
  {
    description:
      "Texto livre informado na criação do projeto: o que será executado, público atendido e período de fomento.",
    financeTotalCents: 13_970_000,
    financeMonths: 10,
    financeFirstDueDate: "2026-02-05",
  },
);
if (!project) throw new Error("Não foi possível criar o projeto.");

const tags = [
  {
    name: "Recurso Humano",
    description:
      "Equipe contratada: coordenação, produção e apoio (salários e encargos).",
    valueCents: 10_970_000,
  },
  {
    name: "Marketing",
    description: "Divulgação, material gráfico e mídia do projeto.",
    valueCents: 1_800_000,
  },
  {
    name: "Captação",
    description:
      "Custos e comissões de captadores de recurso, já cadastrados e pagos.",
    valueCents: 1_200_000,
  },
];
let state = null;
for (const tag of tags) {
  state = await createTag(project.id, tag, actor);
}
const tagId = (name: string) =>
  state?.tags.find((t) => t.name === name)?.id ?? null;

const lines = [
  {
    supplier: "Fabio Paulo Matias",
    tag: "Recurso Humano",
    total: 4_410_000,
    n: 10,
    paid: 8,
  },
  {
    supplier: "Mirella Sombrio",
    tag: "Recurso Humano",
    total: 6_560_000,
    n: 10,
    paid: 7,
  },
  {
    supplier: "Agência de mídia (exemplo)",
    tag: "Marketing",
    total: 1_800_000,
    n: 6,
    paid: 6,
  },
  {
    supplier: "Captador (exemplo)",
    tag: "Captação",
    total: 1_200_000,
    n: 1,
    paid: 1,
  },
];
for (const line of lines) {
  await createLine(
    project.id,
    {
      supplier: line.supplier,
      tagId: tagId(line.tag),
      totalCents: line.total,
      installmentsCount: line.n,
      firstDueDate: "2026-02-05",
    },
    actor,
  );
}

// Marca como pagas as primeiras parcelas de cada linha (direto no banco: o
// pagamento real exige comprovante e NF pela tela, a partir da Fase 4).
const createdLines = await db
  .select()
  .from(projectPaymentLineTable)
  .where(eq(projectPaymentLineTable.projectId, project.id));
for (const line of lines) {
  const row = createdLines.find((l) => l.supplier === line.supplier);
  if (!row) continue;
  const installments = await db
    .select()
    .from(projectInstallmentTable)
    .where(eq(projectInstallmentTable.lineId, row.id));
  for (const installment of installments.filter((i) => i.number <= line.paid)) {
    await db
      .update(projectInstallmentTable)
      .set({
        paidAt: installment.dueDate,
        paidCents: installment.expectedCents,
        paidBy: user.id,
      })
      .where(
        and(
          eq(projectInstallmentTable.id, installment.id),
          eq(projectInstallmentTable.lineId, row.id),
        ),
      );
  }
}

console.log(`Projeto criado: ${project.name}`);
console.log(
  `Abra: /dashboard/workspace/${workspaceId}/project/${project.id}/summary`,
);
process.exit(0);
