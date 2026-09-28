import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import icons from "@/constants/project-icons";
import {
  FINANCE_PROJECT_FILE_ACCEPT,
  uploadFinanceFile,
} from "@/fetchers/project-finance/files";
import useCreateProject from "@/hooks/mutations/project/use-create-project";
import useGetProjectLabels from "@/hooks/queries/project/use-get-project-labels";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { cn } from "@/lib/cn";
import { financeFileErrorMessage } from "@/lib/finance/file-errors";
import { formatFileSize } from "@/lib/finance/file-names";
import { parseMoneyToCents } from "@/lib/finance/money";
import generateProjectSlug from "@/lib/generate-project-id";
import { toast } from "@/lib/toast";

type CreateProjectModalProps = {
  open: boolean;
  onClose: () => void;
};

function CreateProjectModal({ open, onClose }: CreateProjectModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [selectedIcon, setSelectedIcon] = useState("Layout");
  const [iconPopoverOpen, setIconPopoverOpen] = useState(false);
  const [iconSearch, setIconSearch] = useState("");
  const [description, setDescription] = useState("");
  const [labelText, setLabelText] = useState("");
  const [totalText, setTotalText] = useState("");
  const [monthsText, setMonthsText] = useState("");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [pendingFiles, setPendingFiles] = useState<
    Array<{ id: string; file: File }>
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { data: workspace } = useActiveWorkspace();
  const { data: labelCatalog } = useGetProjectLabels(workspace?.id ?? "");

  // Financeiro (tudo opcional). Dinheiro vira centavos inteiros.
  const totalCents =
    totalText.trim() === ""
      ? undefined
      : (parseMoneyToCents(totalText) ?? null);
  const monthsNumber =
    monthsText.trim() === "" ? undefined : Number(monthsText);
  const totalInvalid = totalCents === null;
  const monthsInvalid =
    monthsNumber !== undefined &&
    !(
      Number.isInteger(monthsNumber) &&
      monthsNumber >= 1 &&
      monthsNumber <= 600
    );

  const { mutateAsync } = useCreateProject({
    name,
    slug,
    workspaceId: workspace?.id ?? "",
    icon: selectedIcon,
    description: description.trim() === "" ? undefined : description.trim(),
    label: labelText.trim() === "" ? undefined : labelText.trim(),
    financeTotalCents: totalCents ?? undefined,
    financeMonths: monthsInvalid ? undefined : monthsNumber,
    financeFirstDueDate: firstDueDate === "" ? undefined : firstDueDate,
  });
  const SelectedIcon =
    icons[selectedIcon as keyof typeof icons] || icons.Layout;
  const filteredIcons = Object.entries(icons).filter(([iconName]) =>
    iconName.toLowerCase().includes(iconSearch.trim().toLowerCase()),
  );
  const navigate = useNavigate();

  const handleClose = () => {
    setName("");
    setSlug("");
    setSelectedIcon("Layout");
    setIconPopoverOpen(false);
    setIconSearch("");
    setDescription("");
    setLabelText("");
    setTotalText("");
    setMonthsText("");
    setFirstDueDate("");
    setPendingFiles([]);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || totalInvalid || monthsInvalid) return;

    try {
      const { id } = await mutateAsync();
      toast.success(t("common:modals.createProject.successToast"));
      // Os anexos sobem depois que o projeto existe; falha em um não desfaz o projeto.
      for (const { file } of pendingFiles) {
        try {
          await uploadFinanceFile(id, "project", file);
        } catch (uploadError) {
          toast.error(
            t("finance:files.attachError", {
              name: file.name,
              reason: financeFileErrorMessage(uploadError, t),
            }),
          );
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["projects"] });

      navigate({
        to: "/dashboard/workspace/$workspaceId/project/$projectId/summary",
        params: {
          workspaceId: workspace?.id ?? "",
          projectId: id,
        },
      });

      handleClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("common:modals.createProject.errorToast"),
      );
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);
    setSlug(generateProjectSlug(newName));
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader className="px-3 pt-4 pb-1 gap-1.5">
          <DialogTitle className="sr-only">
            {t("common:modals.createProject.title")}
          </DialogTitle>
          <Breadcrumb>
            <BreadcrumbList className="gap-1 text-xs">
              <BreadcrumbItem className="text-muted-foreground font-medium tracking-wide">
                {workspace?.name?.toUpperCase() ||
                  t("common:modals.createProject.workspaceFallback")}
              </BreadcrumbItem>
              <BreadcrumbSeparator className="[&>svg]:size-3.5" />
              <BreadcrumbItem className="text-foreground font-medium">
                {t("common:modals.createProject.breadcrumbNew")}
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <DialogDescription className="sr-only">
            {t("common:modals.createProject.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-6 px-3 pt-2">
            <Popover
              open={iconPopoverOpen}
              onOpenChange={(open) => {
                setIconPopoverOpen(open);
                if (!open) setIconSearch("");
              }}
              modal={true}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="h-8 w-8 p-0"
                  title={t("common:modals.createProject.pickIcon")}
                >
                  <SelectedIcon className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                <div className="space-y-2">
                  <Input
                    value={iconSearch}
                    onChange={(e) => setIconSearch(e.target.value)}
                    placeholder={t("common:modals.createProject.searchIcons")}
                    className="h-8 text-xs"
                  />
                  <div className="max-h-[280px] overflow-y-auto pr-1">
                    <div className="grid grid-cols-6 gap-1.5">
                      {filteredIcons.map(([iconName, Icon]) => {
                        const isSelected = selectedIcon === iconName;
                        return (
                          <Button
                            key={iconName}
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedIcon(iconName);
                              setIconPopoverOpen(false);
                              setIconSearch("");
                            }}
                            className={cn(
                              "h-10 items-center justify-center rounded-md p-0",
                              isSelected &&
                                "bg-sidebar-accent text-sidebar-accent-foreground",
                            )}
                            title={iconName}
                          >
                            <Icon className="h-4 w-4" />
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <Input
              unstyled
              value={name}
              onChange={handleNameChange}
              autoFocus
              placeholder={t("common:modals.createProject.projectName")}
              className="w-full [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:px-0 [&_[data-slot=input]]:py-2 [&_[data-slot=input]]:text-2xl [&_[data-slot=input]]:leading-tight [&_[data-slot=input]]:font-semibold [&_[data-slot=input]]:tracking-tight [&_[data-slot=input]]:text-foreground [&_[data-slot=input]]:placeholder:text-muted-foreground [&_[data-slot=input]]:outline-none"
              required
            />
          </div>

          <div className="space-y-3 px-3">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  {t("common:modals.createProject.keyLabel")}
                </span>
                <Input
                  id="project-key"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="PRO"
                  maxLength={8}
                  className="w-20 h-8 text-center font-semibold text-sm bg-background border-border rounded-lg transition-colors duration-150"
                  required
                />
              </div>
              <div className="flex-1 text-xs text-muted-foreground opacity-80">
                {t("common:modals.createProject.keyHint", {
                  example: slug || "ABC",
                })}
              </div>
            </div>
          </div>

          <div className="space-y-3 px-3">
            <div className="space-y-1.5">
              <label
                htmlFor="project-label"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("common:modals.createProject.label")}
              </label>
              <Input
                id="project-label"
                value={labelText}
                maxLength={80}
                list="project-label-catalog-options"
                placeholder={t("common:modals.createProject.labelPlaceholder")}
                onChange={(e) => setLabelText(e.target.value)}
              />
              <datalist id="project-label-catalog-options">
                {(labelCatalog ?? []).map((entry) => (
                  <option key={entry.id} value={entry.name} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                {t("common:modals.createProject.labelHint")}
              </p>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="project-description"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("finance:createProject.description")}
              </label>
              <Textarea
                id="project-description"
                value={description}
                maxLength={10000}
                placeholder={t("finance:createProject.descriptionPlaceholder")}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-1">
                <label
                  htmlFor="project-total"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("finance:createProject.total")}
                </label>
                <Input
                  id="project-total"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  value={totalText}
                  aria-invalid={totalInvalid}
                  className="tabular-nums"
                  onChange={(e) => setTotalText(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="project-months"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("finance:createProject.months")}
                </label>
                <Input
                  id="project-months"
                  type="number"
                  min={1}
                  max={600}
                  inputMode="numeric"
                  value={monthsText}
                  aria-invalid={monthsInvalid}
                  onChange={(e) => setMonthsText(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="project-first-due"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("finance:createProject.firstDue")}
                </label>
                <Input
                  id="project-first-due"
                  type="date"
                  value={firstDueDate}
                  onChange={(e) => setFirstDueDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("finance:createProject.attachments")}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={FINANCE_PROJECT_FILE_ACCEPT}
                  className="sr-only"
                  data-testid="create-project-files"
                  aria-label={t("finance:createProject.attachButton")}
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    setPendingFiles((current) => [
                      ...current,
                      ...picked.map((file) => ({
                        id: crypto.randomUUID(),
                        file,
                      })),
                    ]);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip />
                  {t("finance:createProject.attachButton")}
                </Button>
              </div>
              {pendingFiles.length > 0 && (
                <ul className="space-y-1">
                  {pendingFiles.map(({ id, file }) => (
                    <li
                      key={id}
                      className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {file.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatFileSize(file.size)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("finance:createProject.attachRemove", {
                          name: file.name,
                        })}
                        onClick={() =>
                          setPendingFiles((current) =>
                            current.filter((item) => item.id !== id),
                          )
                        }
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("finance:createProject.hint")}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              onClick={handleClose}
              variant="outline"
              size="sm"
              className="border-border text-foreground hover:bg-accent"
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                !name.trim() || !slug.trim() || totalInvalid || monthsInvalid
              }
              size="sm"
              className="bg-primary hover:bg-primary/90  disabled:opacity-50"
            >
              {t("common:modals.createProject.createButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CreateProjectModal;
