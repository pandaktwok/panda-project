// Cor estável por etiqueta (mesmo nome/id sempre com a mesma cor, em
// qualquer lugar do app), diferente do `tagPaletteFor` usado nas etiquetas de
// orçamento do financeiro (que cicla por posição dentro de um projeto). Aqui
// a mesma etiqueta aparece em vários projetos ao mesmo tempo (barra lateral,
// calendário, Kanban de projetos), então a cor precisa depender só do id.
const LABEL_PALETTE = [
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-lime-500/15 text-lime-700 dark:text-lime-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function projectLabelColorClass(labelId: string): string {
  return LABEL_PALETTE[hashString(labelId) % LABEL_PALETTE.length];
}

type ProjectLabelPillProps = {
  label: { id: string; name: string };
  className?: string;
};

/** Etiqueta do projeto (fundo/categoria: FIA, FMI, Educação...), mostrada ao
 * lado do nome do projeto. Não confundir com as etiquetas de orçamento do
 * financeiro, que ficam dentro de cada projeto. */
export function ProjectLabelPill({ label, className }: ProjectLabelPillProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${projectLabelColorClass(label.id)} ${className ?? ""}`}
      title={label.name}
    >
      {label.name}
    </span>
  );
}

export default ProjectLabelPill;
