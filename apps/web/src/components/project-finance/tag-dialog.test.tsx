import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TagDialog from "./tag-dialog";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

const catalog = { current: { tags: [{ id: "c1", name: "Aluguel" }] } };
vi.mock("@/hooks/queries/project-finance/use-get-tag-catalog", () => ({
  default: () => ({ data: catalog.current }),
}));

function setup() {
  const onSubmit = vi.fn();
  render(
    <TagDialog
      open
      projectId="p1"
      onClose={vi.fn()}
      tag={null}
      saving={false}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

afterEach(cleanup);

describe("TagDialog: catálogo reaproveitável", () => {
  it("sugere nomes já usados no workspace via datalist", () => {
    setup();
    const input = screen.getByLabelText(
      "finance:tagDialog.name",
    ) as HTMLInputElement;
    expect(input.getAttribute("list")).toBe("finance-tag-catalog-options");
    const option = document.querySelector(
      "#finance-tag-catalog-options option",
    );
    expect(option).not.toBeNull();
    expect(option?.getAttribute("value")).toBe("Aluguel");
  });

  it("continua permitindo criar um nome novo", () => {
    const { onSubmit } = setup();
    fireEvent.change(screen.getByLabelText("finance:tagDialog.name"), {
      target: { value: "Professor de música" },
    });
    fireEvent.click(screen.getByText("finance:common.save"));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: "Professor de música",
    });
  });
});
