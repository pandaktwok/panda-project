import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FinanceTag } from "@/fetchers/project-finance/types";
import useGetTagCatalog from "@/hooks/queries/project-finance/use-get-tag-catalog";
import { formatCentsPlain, parseMoneyToCents } from "@/lib/finance/money";
import MoneyField from "./money-field";

type Props = {
  open: boolean;
  projectId: string;
  onClose: () => void;
  /** null = criar. */
  tag: FinanceTag | null;
  saving: boolean;
  onSubmit: (input: {
    name: string;
    description: string | null;
    valueCents: number;
  }) => void;
};

export default function TagDialog(props: Props) {
  const { open, onClose, tag } = props;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        {open && <TagForm key={tag?.id ?? "new"} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function TagForm({ projectId, onClose, tag, saving, onSubmit }: Props) {
  const { t } = useTranslation();
  const { data: catalog } = useGetTagCatalog(projectId, true);
  const [name, setName] = useState(tag?.name ?? "");
  const [description, setDescription] = useState(tag?.description ?? "");
  const [valueText, setValueText] = useState(
    tag ? formatCentsPlain(tag.valueCents) : "",
  );

  const valueCents = valueText.trim() === "" ? 0 : parseMoneyToCents(valueText);
  const valid = name.trim().length > 0 && valueCents !== null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {tag
            ? t("finance:tagDialog.editTitle")
            : t("finance:tagDialog.newTitle")}
        </DialogTitle>
        <DialogDescription>
          {t("finance:tagDialog.description")}
        </DialogDescription>
      </DialogHeader>
      <form
        id="finance-tag-form"
        className="space-y-4 px-6 pb-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          onSubmit({
            name: name.trim(),
            description: description.trim() === "" ? null : description.trim(),
            valueCents: valueCents as number,
          });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="finance-tag-name" className="text-sm font-semibold">
            {t("finance:tagDialog.name")}
          </label>
          <Input
            id="finance-tag-name"
            value={name}
            maxLength={120}
            autoFocus
            required
            list="finance-tag-catalog-options"
            placeholder={t("finance:tagDialog.namePlaceholder")}
            onChange={(event) => setName(event.target.value)}
          />
          <datalist id="finance-tag-catalog-options">
            {(catalog?.tags ?? []).map((entry) => (
              <option key={entry.id} value={entry.name} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">
            {t("finance:tagDialog.catalogHint")}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="finance-tag-desc" className="text-sm font-semibold">
            {t("finance:tagDialog.meaning")}
          </label>
          <Textarea
            id="finance-tag-desc"
            value={description}
            maxLength={2000}
            placeholder={t("finance:tagDialog.meaningPlaceholder")}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <MoneyField
          id="finance-tag-value"
          label={t("finance:tagDialog.value")}
          value={valueText}
          onChange={setValueText}
          error={
            valueText.trim() !== "" && valueCents === null
              ? t("finance:common.amountInvalid")
              : null
          }
          hint={t("finance:tagDialog.valueHint")}
        />
      </form>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          type="submit"
          form="finance-tag-form"
          disabled={!valid || saving}
        >
          {t("finance:common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
