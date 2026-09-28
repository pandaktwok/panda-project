import { CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FINANCE_PAYMENT_FILE_ACCEPT,
  uploadFinanceFile,
} from "@/fetchers/project-finance/files";
import { financeFileErrorMessage } from "@/lib/finance/file-errors";
import { formatFileSize } from "@/lib/finance/file-names";

/**
 * `label` é o nome que a pessoa digita só para se organizar na lista antes de
 * salvar (ex.: "Luz salão") — não entra no nome do arquivo final (Atualização 3).
 */
export type NamedFile = {
  assetId: string;
  name: string;
  size: number;
  label: string;
};

type Props = {
  projectId: string;
  purpose: "receipt" | "invoice";
  title: string;
  addLabel: string;
  value: NamedFile[];
  onChange: (value: NamedFile[]) => void;
  onBusyChange?: (busy: boolean) => void;
};

/** Lista de anexos (comprovantes OU notas fiscais) de uma parcela: envia
 * assim que cada arquivo é escolhido, permite nomear e remover antes de salvar. */
export default function FileList({
  projectId,
  purpose,
  title,
  addLabel,
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
      const label = file.name.replace(/\.[^.]+$/, "");
      onChange([
        ...value,
        { assetId: uploaded.id, name: file.name, size: uploaded.size, label },
      ]);
    } catch (uploadError) {
      setError(financeFileErrorMessage(uploadError, t));
    } finally {
      setUploading(null);
      onBusyChange?.(false);
    }
  };

  const updateLabel = (index: number, label: string) => {
    onChange(value.map((item, i) => (i === index ? { ...item, label } : item)));
  };
  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{title}</span>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={FINANCE_PAYMENT_FILE_ACCEPT}
        className="sr-only"
        data-testid={`finance-file-${purpose}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <ul className="flex flex-col gap-2">
        {value.map((item, index) => (
          <li
            key={item.assetId}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-success/50 bg-success/8 px-3 py-2 text-sm"
          >
            <CheckCircle2
              className="size-4 shrink-0 text-success"
              aria-hidden="true"
            />
            <Input
              value={item.label}
              onChange={(event) => updateLabel(index, event.target.value)}
              aria-label={t("finance:payment.attachmentLabelAria", {
                name: item.name,
              })}
              className="h-8 flex-1 text-sm"
              maxLength={120}
            />
            <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:inline">
              {item.name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatFileSize(item.size)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("finance:payment.fileRemove", { label: item.name })}
              onClick={() => removeAt(index)}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
      {uploading ? (
        <div className="flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-sm">
          <Loader2
            className="size-4 shrink-0 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate" role="status">
            {t("finance:payment.fileUploading", { name: uploading })}
          </span>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="self-start"
          onClick={() => inputRef.current?.click()}
        >
          <Plus />
          {addLabel}
        </Button>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive-foreground">
          {error}
        </span>
      )}
    </div>
  );
}
