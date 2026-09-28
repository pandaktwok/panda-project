import { Input } from "@/components/ui/input";

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: string;
  required?: boolean;
};

/** Campo de dinheiro em texto (R$ pt-BR); quem chama converte com parseMoneyToCents. */
export default function MoneyField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  required,
}: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        className="tabular-nums"
      />
      {error ? (
        <span className="text-xs text-destructive-foreground">{error}</span>
      ) : hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}
