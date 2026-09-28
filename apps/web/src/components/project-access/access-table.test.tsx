import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectAccessEntry } from "@/fetchers/project-access/project-access";
import AccessTable, { nextKeys } from "./access-table";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const members: ProjectAccessEntry[] = [
  {
    userId: "o",
    name: "Dono",
    email: "dono@x.com",
    role: "owner",
    locked: true,
    canView: true,
    canPay: true,
    canAttach: true,
  },
  {
    userId: "u",
    name: "Usuario",
    email: "u@x.com",
    role: "member",
    locked: false,
    canView: true,
    canPay: true,
    canAttach: true,
  },
  {
    userId: "s",
    name: "Sem ver",
    email: "s@x.com",
    role: "member",
    locked: false,
    canView: false,
    canPay: false,
    canAttach: false,
  },
];

afterEach(cleanup);

describe("nextKeys", () => {
  const all = { canView: true, canPay: true, canAttach: true };
  it("desligar Ver desliga as outras duas", () => {
    expect(nextKeys(all, "canView", false)).toEqual({
      canView: false,
      canPay: false,
      canAttach: false,
    });
  });
  it("ligar Ver volta ao padrão", () => {
    expect(
      nextKeys(
        { canView: false, canPay: false, canAttach: false },
        "canView",
        true,
      ),
    ).toEqual(all);
  });
  it("as outras chaves mudam sozinhas", () => {
    expect(nextKeys(all, "canPay", false)).toEqual({
      canView: true,
      canPay: false,
      canAttach: true,
    });
  });
});

describe("AccessTable", () => {
  it("dono não é editável e quem não vê tem as outras chaves travadas", () => {
    render(<AccessTable members={members} onChange={vi.fn()} />);
    const switches = screen.getAllByRole("switch");
    // 3 linhas x 3 chaves
    expect(switches).toHaveLength(9);
    for (const locked of switches.slice(0, 3)) {
      expect(locked).toHaveAttribute("aria-disabled", "true");
    }
    // linha "Sem ver": Ver habilitado, Pagar/Anexar travados
    expect(switches[6]).not.toHaveAttribute("aria-disabled", "true");
    expect(switches[7]).toHaveAttribute("aria-disabled", "true");
    expect(switches[8]).toHaveAttribute("aria-disabled", "true");
  });

  it("clicar em Ver do Usuário manda as três chaves desligadas", () => {
    const onChange = vi.fn();
    render(<AccessTable members={members} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("switch")[3]);
    expect(onChange).toHaveBeenCalledWith("u", {
      canView: false,
      canPay: false,
      canAttach: false,
    });
  });
});
