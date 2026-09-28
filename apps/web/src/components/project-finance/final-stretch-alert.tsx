import { BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { FinanceState } from "@/fetchers/project-finance/types";
import { formatCents, formatIsoDayMonth } from "@/lib/finance/money";
import { lastThreeDueDates } from "@/lib/finance/schedule";

type Props = { state: FinanceState; remainingCents: number };

/**
 * Faixa da reta final. A fonte é a MESMA do aviso mensal (finalStretch.active
 * vem da API), para a tela e a notificação nunca discordarem.
 */
export default function FinalStretchAlert({ state, remainingCents }: Props) {
  const { t } = useTranslation();
  if (!state.finalStretch.active) return null;

  const dates = lastThreeDueDates(state).map(formatIsoDayMonth);
  const notice = state.finalStretch.lastNotice;
  const list =
    dates.length <= 1
      ? (dates[0] ?? "")
      : `${dates.slice(0, -1).join(", ")} ${t("finance:finalStretch.and")} ${dates[dates.length - 1]}`;

  return (
    <Alert
      variant="error"
      className="border-destructive/40 bg-destructive/6 text-destructive-foreground"
    >
      <BellRing aria-hidden="true" />
      <AlertTitle className="font-bold">
        {t("finance:finalStretch.title")}
      </AlertTitle>
      <AlertDescription className="text-destructive-foreground/90">
        {t("finance:finalStretch.body", {
          dates: list,
          amount: formatCents(remainingCents),
        })}
        {notice && (
          <span className="mt-1 block text-[12.5px] opacity-90">
            {t("finance:finalStretch.lastNotice", {
              date: new Date(notice.sentAt).toLocaleDateString("pt-BR"),
              channels: notice.channels
                .map((channel) => t(`finance:finalStretch.channels.${channel}`))
                .join(", "),
            })}
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}
