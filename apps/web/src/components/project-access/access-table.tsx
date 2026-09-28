import { ShieldIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ProjectAccessEntry,
  ProjectAccessKeys,
} from "@/fetchers/project-access/project-access";

type Props = {
  members: ProjectAccessEntry[];
  disabled?: boolean;
  onChange: (userId: string, keys: ProjectAccessKeys) => void;
};

type KeyName = keyof ProjectAccessKeys;

/** Desligar "Ver" desliga as outras duas; ligar "Ver" volta ao padrão (tudo ligado). */
export function nextKeys(
  current: ProjectAccessKeys,
  key: KeyName,
  value: boolean,
): ProjectAccessKeys {
  if (key === "canView") {
    return value
      ? { canView: true, canPay: true, canAttach: true }
      : { canView: false, canPay: false, canAttach: false };
  }
  return { ...current, [key]: value };
}

export default function AccessTable({ members, disabled, onChange }: Props) {
  const { t } = useTranslation();
  const keys: Array<{ key: KeyName; label: string }> = [
    { key: "canView", label: t("settings:projectAccess.keyView") },
    { key: "canPay", label: t("settings:projectAccess.keyPay") },
    { key: "canAttach", label: t("settings:projectAccess.keyAttach") },
  ];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="ps-4 text-foreground font-medium">
            {t("settings:projectAccess.colUser")}
          </TableHead>
          {keys.map(({ key, label }) => (
            <TableHead
              key={key}
              className="text-center text-foreground font-medium"
            >
              {label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.userId}>
            <TableCell className="ps-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{member.name}</span>
                  {member.locked ? (
                    <Badge variant="outline" className="gap-1">
                      <ShieldIcon className="size-3" />
                      {t(`team:roles.${member.role}`, {
                        defaultValue: member.role,
                      })}
                    </Badge>
                  ) : null}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {member.email}
                </div>
                {member.locked ? (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("settings:projectAccess.lockedHint")}
                  </div>
                ) : null}
              </div>
            </TableCell>
            {keys.map(({ key, label }) => (
              <TableCell key={key} className="py-3 text-center">
                <Switch
                  aria-label={`${label}: ${member.name}`}
                  checked={member[key]}
                  disabled={
                    disabled ||
                    member.locked ||
                    (key !== "canView" && !member.canView)
                  }
                  onCheckedChange={(value) =>
                    onChange(member.userId, nextKeys(member, key, value))
                  }
                />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
