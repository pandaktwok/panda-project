// Roda o aviso de reta final AGORA, uma vez (o agendador já faz isso a cada 15
// minutos). Útil para conferir a instalação sem esperar.
//   pnpm --filter @kaneo/api finance:notices
//   NOW=2026-09-10T08:00:00-03:00 pnpm --filter @kaneo/api finance:notices   (simula a data)
import { sendFinalStretchNotices } from "../src/scheduler/final-stretch-notices";

const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error("NOW inválido. Exemplo: 2026-09-10T08:00:00-03:00");
  process.exit(1);
}
const result = await sendFinalStretchNotices(now);
console.log(
  `Avisos enviados: ${result.sent}${result.degraded ? " (com falhas, veja acima)" : ""}`,
);
process.exit(result.degraded ? 1 : 0);
