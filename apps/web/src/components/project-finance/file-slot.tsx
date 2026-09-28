import { CheckCircle2, FileUp, Loader2, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  FINANCE_PAYMENT_FILE_ACCEPT,
  uploadFinanceFile,
} from "@/fetchers/project-finance/files";
import { financeFileErrorMessage } from "@/lib/finance/file-errors";
import { formatFileSize } from "@/lib/finance/file-names";

export type SlotFile = { assetId: string; name: string; size: number };

type Props = {
  projectId: string;
  purpose: "receipt" | "invoice";
  label: string;
  value: SlotFile | null;
  onChange: (value: SlotFile | null) => void;
  /** Avisa o formulário quando há envio em andamento (trava o botão de confirmar). */
  onBusyChange?: (busy: boolean) => void;
};

/** Um campo de arquivo obrigatório: envia assim que o arquivo é escolhido. */
export default function FileSlot({
  projectId,
  purpose,
  label,
  value,
  onChange,
  onBusyChange,
}: Props) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setUploading(file.name);
    onBusyChange?.(true);
    try {
      const uploaded = await uploadFinanceFile(projectId, purpose, file);
      onChange({
        assetId: uploaded.id,
        name: file.name,
        size: uploaded.size,
      });
    } catch (uploadError) {
      onChange(null);
      setError(financeFileErrorMessage(uploadError, t));
    } finally {
      setUploading(null);
      onBusyChange?.(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold">
        {label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={FINANCE_PAYMENT_FILE_ACCEPT}
        className="sr-only"
        data-testid={`finance-file-${purpose}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Permite escolher o mesmo arquivo de novo depois de um erro.
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <div
        className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
          error
            ? "border-destructive/60 bg-destructive/5"
            : value
              ? "border-success/50 bg-success/8"
              : "border-dashed border-border bg-muted/30"
        }`}
      >
        {uploading ? (
          <>
            <Loader2
              className="size-4 shrink-0 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate" role="status">
              {t("finance:payment.fileUploading", { name: uploading })}
            </span>
          </>
        ) : value ? (
          <>
            <CheckCircle2
              className="size-4 shrink-0 text-success"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              {value.name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatFileSize(value.size)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => inputRef.current?.click()}
            >
              {t("finance:payment.fileReplace")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("finance:payment.fileRemove", { label })}
              onClick={() => onChange(null)}
            >
              <X />
            </Button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 text-muted-foreground">
              {t("finance:payment.fileHint")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => inputRef.current?.click()}
            >
              <FileUp />
              {t("finance:payment.filePick")}
            </Button>
          </>
        )}
      </div>
      {error && (
        <span role="alert" className="text-xs text-destructive-foreground">
          {error}
        </span>
      )}
    </div>
  );
}
