import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiConnection } from "@/fetchers/ai-connection/ai-connection";
import AiConnectionPanel, { formatDateTime } from "./ai-connection-panel";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mutate = vi.fn();
const revokeMutate = vi.fn();
const connection: AiConnection = {
  id: "c1",
  name: "Claude do Renan",
  authorizedByName: "Admin",
  authorizedByEmail: "a@x.com",
  createdAt: "2026-09-24T16:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  expiresAt: "2026-10-24T16:00:00.000Z",
  status: "active",
  canPay: true,
  canEdit: true,
};

const state = vi.hoisted(() => ({ connections: [] as AiConnection[] }));

vi.mock("@/hooks/queries/ai-connection/use-ai-connection", () => ({
  useAiConnections: () => ({
    isLoading: false,
    isError: false,
    data: {
      mcpUrl: "https://projetos.exemplo.com/api/mcp",
      connections: state.connections,
    },
  }),
  useAiHistory: () => ({ data: [] }),
}));
vi.mock("@/hooks/mutations/ai-connection/use-ai-connection-mutations", () => ({
  useUpdateAiConnection: () => ({ mutate, isPending: false }),
  useRevokeAiConnection: () => ({ mutate: revokeMutate }),
}));

afterEach(() => {
  cleanup();
  mutate.mockClear();
  state.connections = [];
});

describe("formatDateTime", () => {
  it("usa dd/mm/aaaa e devolve vazio sem data", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime("2026-09-24T12:00:00.000Z")).toMatch(
      /^\d{2}\/\d{2}\/2026,? \d{2}:\d{2}$/,
    );
  });
});

describe("AiConnectionPanel", () => {
  it("mostra o endereço do MCP e o estado vazio", () => {
    render(<AiConnectionPanel />);
    expect(screen.getByTestId("mcp-url").textContent).toBe(
      "https://projetos.exemplo.com/api/mcp",
    );
    expect(
      screen.getByText("settings:aiConnection.connections.empty"),
    ).toBeTruthy();
  });

  it("as duas chaves começam ligadas e cada uma manda só o próprio campo", () => {
    state.connections = [connection];
    render(<AiConnectionPanel />);
    const pay = screen.getByRole("switch", {
      name: "settings:aiConnection.switches.payLabel",
    });
    const edit = screen.getByRole("switch", {
      name: "settings:aiConnection.switches.editLabel",
    });
    expect(pay.getAttribute("aria-checked")).toBe("true");
    expect(edit.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(pay);
    expect(mutate.mock.calls[0]?.[0]).toEqual({ id: "c1", canPay: false });
    fireEvent.click(edit);
    expect(mutate.mock.calls[1]?.[0]).toEqual({ id: "c1", canEdit: false });
  });

  it("conexão revogada não oferece Revogar e trava as chaves", () => {
    state.connections = [
      { ...connection, status: "revoked", revokedAt: "2026-09-24T17:00:00Z" },
    ];
    render(<AiConnectionPanel />);
    expect(
      screen.queryByText("settings:aiConnection.revoke.button"),
    ).toBeNull();
    const pay = screen.getByRole("switch", {
      name: "settings:aiConnection.switches.payLabel",
    });
    expect(
      pay.hasAttribute("disabled") ||
        pay.getAttribute("aria-disabled") === "true",
    ).toBe(true);
  });
});
