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
import useGetProjectLabels from "@/hooks/queries/project/use-get-project-labels";
import { formatCentsPlain, parseMoneyToCents } from "@/lib/finance/money";
import MoneyField from "./money-field";

export type EditableProject = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  icon: string | null;
  slug: string;
  isPublic: boolean | null;
  financeTotalCents: number | null;
  financeMonths: number | null;
  financeFirstDueDate: string | null;
  label: { id: string; name: string } | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  project: EditableProject | null;
  canEditProject: boolean;
  canManageFinance: boolean;
  saving: boolean;
  onSubmit: (input: {
    name: string;
    description: string;
    financeTotalCents: number | null;
    financeMonths: number | null;
    financeFirstDueDate: string | null;
    // undefined: sem mudança. null: remove a etiqueta. string: define/cria.
    label?: string | null;
  }) => void;
};

export default function EditProjectDialog(props: Props) {
  const { open, onClose, project } = props;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        {open && project && (
          <EditForm key={project.id} {...props} project={project} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  onClose,
  project,
  canEditProject,
  canManageFinance,
  saving,
  onSubmit,
}: Props & { project: EditableProject }) {
  const { t } = useTranslation();
  const { data: labelCatalog } = useGetProjectLabels(project.workspaceId);
  const [name, setName] = useState(project.name);
  const [labelText, setLabelText] = useState(project.label?.name ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [totalText, setTotalText] = useState(
    project.financeTotalCents !== null
      ? formatCentsPlain(project.financeTotalCents)
      : "",
  );
  const [months, setMonths] = useState(
    project.financeMonths !== null ? String(project.financeMonths) : "",
  );
  const [firstDue, setFirstDue] = useState(project.financeFirstDueDate ?? "");

  const totalCents =
    totalText.trim() === "" ? null : parseMoneyToCents(totalText);
  const totalValid = totalText.trim() === "" || totalCents !== null;
  const monthsNumber = months.trim() === "" ? null : Number(months);
  const monthsValid =
    monthsNumber === null ||
    (Number.isInteger(monthsNumber) &&
      monthsNumber >= 1 &&
      monthsNumber <= 600);
  const valid = name.trim().length > 0 && totalValid && monthsValid;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("finance:editProject.title")}</DialogTitle>
        <DialogDescription>
          {t("finance:editProject.description")}
        </DialogDescription>
      </DialogHeader>
      <form
        id="finance-edit-project-form"
        className="space-y-4 px-6 pb-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          const trimmedLabel = labelText.trim();
          const currentLabelName = project.label?.name ?? "";
          const label =
            trimmedLabel === currentLabelName
              ? undefined
              : trimmedLabel === ""
                ? null
                : trimmedLabel;
          onSubmit({
            name: name.trim(),
            description: description.trim(),
            financeTotalCents: totalCents,
            financeMonths: monthsNumber,
            financeFirstDueDate: firstDue === "" ? null : firstDue,
            label,
          });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="finance-project-name"
            className="text-sm font-semibold"
          >
            {t("finance:editProject.name")}
          </label>
          <Input
            id="finance-project-name"
            value={name}
            required
            disabled={!canEditProject}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="finance-project-label"
            className="text-sm font-semibold"
          >
            {t("finance:editProject.label")}
          </label>
          <Input
            id="finance-project-label"
            value={labelText}
            maxLength={80}
            disabled={!canEditProject}
            list="project-label-catalog-options"
            placeholder={t("finance:editProject.labelPlaceholder")}
            onChange={(event) => setLabelText(event.target.value)}
          />
          <datalist id="project-label-catalog-options">
            {(labelCatalog ?? []).map((entry) => (
              <option key={entry.id} value={entry.name} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">
            {t("finance:editProject.labelHint")}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="finance-project-desc"
            className="text-sm font-semibold"
          >
            {t("finance:editProject.descriptionLabel")}
          </label>
          <Textarea
            id="finance-project-desc"
            value={description}
            disabled={!canEditProject}
            maxLength={10000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <MoneyField
          id="finance-project-total"
          label={t("finance:editProject.total")}
          value={totalText}
          onChange={setTotalText}
          error={totalValid ? null : t("finance:common.amountInvalid")}
          hint={t("finance:editProject.totalHint")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="finance-project-months"
              className="text-sm font-semibold"
            >
              {t("finance:editProject.months")}
            </label>
            <Input
              id="finance-project-months"
              type="number"
              min={1}
              max={600}
              inputMode="numeric"
              value={months}
              disabled={!canManageFinance}
              aria-invalid={!monthsValid}
              onChange={(event) => setMonths(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="finance-project-first"
              className="text-sm font-semibold"
            >
              {t("finance:editProject.firstDue")}
            </label>
            <Input
              id="finance-project-first"
              type="date"
              value={firstDue}
              disabled={!canManageFinance}
              onChange={(event) => setFirstDue(event.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("finance:editProject.defaultsNote")}
        </p>
      </form>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          type="submit"
          form="finance-edit-project-form"
          disabled={!valid || saving || (!canEditProject && !canManageFinance)}
        >
          {t("finance:common.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
