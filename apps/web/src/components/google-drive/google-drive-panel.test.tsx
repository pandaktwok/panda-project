import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriveStatus } from "@/fetchers/google-drive/google-drive";
import GoogleDrivePanel from "./google-drive-panel";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const saveMutate = vi.fn();
const retryMutate = vi.fn();
const disconnectMutate = vi.fn();

const base: DriveStatus = {
  status: "disconnected",
  hasCredentials: false,
  clientId: null,
  hasClientSecret: false,
  accountEmail: null,
  lastError: null,
  connectedAt: null,
  redirectUri: "https://projetos.exemplo.com/api/google-drive/callback",
  secretsKeyConfigured: true,
  queue: { pending: 0, copied: 0, failed: 0 },
  open: [],
};
const state = vi.hoisted(() => ({ data: null as DriveStatus | null }));

vi.mock("@/hooks/queries/google-drive/use-google-drive", () => ({
  useGoogleDriveStatus: () => ({
    isLoading: false,
    isError: false,
    data: state.data,
  }),
}));
vi.mock("@/hooks/mutations/google-drive/use-google-drive-mutations", () => ({
  useSaveDriveCredentials: () => ({ mutate: saveMutate, isPending: false }),
  useStartDriveConnect: () => ({ mutate: vi.fn(), isPending: false }),
  useTestDrive: () => ({ mutate: vi.fn(), isPending: false }),
  useDisconnectDrive: () => ({ mutate: disconnectMutate }),
  useBackfillDrive: () => ({ mutate: vi.fn(), isPending: false }),
  useRetryDriveCopy: () => ({ mutate: retryMutate, isPending: false }),
}));

afterEach(() => {
  cleanup();
  saveMutate.mockClear();
  retryMutate.mockClear();
  state.data = null;
});

describe("GoogleDrivePanel", () => {
  it("desconectado: mostra o passo a passo, o endereço de retorno e só o botão de conectar", () => {
    state.data = base;
    render(<GoogleDrivePanel />);
    expect(screen.getByTestId("redirect-uri").textContent).toBe(
      "https://projetos.exemplo.com/api/google-drive/callback",
    );
    expect(screen.getByText("settings:googleDrive.steps.seven")).toBeTruthy();
    expect(
      screen.getByText("settings:googleDrive.steps.publishNote"),
    ).toBeTruthy();
    expect(screen.queryByText("settings:googleDrive.actions.test")).toBeNull();
    const connect = screen.getByRole("button", {
      name: "settings:googleDrive.actions.connect",
    }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
  });

  it("o segredo é um campo de senha e o botão só habilita com ID e segredo", () => {
    state.data = base;
    render(<GoogleDrivePanel />);
    const [id, secret] = screen.getAllByRole("textbox").length
      ? [
          screen.getAllByRole("textbox")[0] as HTMLInputElement,
          document.querySelector('input[type="password"]') as HTMLInputElement,
        ]
      : [];
    expect(secret?.type).toBe("password");
    fireEvent.change(id as HTMLInputElement, {
      target: { value: "123-abc.apps.googleusercontent.com" },
    });
    fireEvent.change(secret as HTMLInputElement, {
      target: { value: "segredo-do-cliente" },
    });
    const connect = screen.getByRole("button", {
      name: "settings:googleDrive.actions.connect",
    }) as HTMLButtonElement;
    expect(connect.disabled).toBe(false);
    fireEvent.click(connect);
    expect(saveMutate.mock.calls[0]?.[0]).toEqual({
      clientId: "123-abc.apps.googleusercontent.com",
      clientSecret: "segredo-do-cliente",
    });
  });

  it("conectado: mostra a conta, a fila e 'Tentar de novo' nos itens abertos", () => {
    state.data = {
      ...base,
      status: "connected",
      hasCredentials: true,
      hasClientSecret: true,
      clientId: "123-abc",
      accountEmail: "financeiro@empresa.com",
      queue: { pending: 1, copied: 3, failed: 1 },
      open: [
        {
          assetId: "a1",
          filename: "Mirella Sombrio - Parcela 1.pdf",
          projectName: "Cultura",
          status: "failed",
          attempts: 8,
          lastError: "Google respondeu 503",
          nextAttemptAt: "2026-09-24T16:00:00.000Z",
        },
      ],
    };
    render(<GoogleDrivePanel />);
    expect(screen.getByTestId("drive-queue").textContent).toBe(
      "settings:googleDrive.queue.summary",
    );
    expect(screen.getAllByTestId("drive-open-item")).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:googleDrive.actions.retry",
      }),
    );
    expect(retryMutate).toHaveBeenCalledWith("a1");
    expect(
      screen.getByRole("button", { name: "settings:googleDrive.actions.test" }),
    ).toBeTruthy();
  });

  it("com problema: mostra a mensagem de erro e oferece reconectar", () => {
    state.data = {
      ...base,
      status: "error",
      hasCredentials: true,
      hasClientSecret: true,
      clientId: "123-abc",
      lastError: "O Google recusou o acesso. Reconecte.",
    };
    render(<GoogleDrivePanel />);
    expect(
      screen.getByText("O Google recusou o acesso. Reconecte."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "settings:googleDrive.actions.connect",
      }),
    ).toBeTruthy();
  });

  it("sem chave de criptografia no servidor: avisa e bloqueia o botão", () => {
    state.data = { ...base, secretsKeyConfigured: false };
    render(<GoogleDrivePanel />);
    expect(screen.getByText("settings:googleDrive.noSecretsKey")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "settings:googleDrive.actions.connect",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
