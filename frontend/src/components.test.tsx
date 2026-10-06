// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Badge, DataTable, Empty } from "./components";
afterEach(cleanup);
describe("operational components", () => {
  it("shows actual status with readable text", () => {
    render(<Badge status="corrupted" />);
    expect(screen.getByText("Damaged").className).toContain("negative");
  });
  it("filters and paginates real data", () => {
    render(
      <DataTable
        rows={Array.from({ length: 12 }, (_, id) => ({
          id,
          name: `App ${id}`,
        }))}
        searchText={(r) => r.name}
        columns={[{ label: "Name", render: (r) => r.name }]}
      />,
    );
    expect(screen.queryByText("App 10")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("App 10")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter records"), {
      target: { value: "App 1" },
    });
    expect(screen.getByText("App 10")).toBeTruthy();
    expect(screen.queryByText("App 2")).toBeNull();
  });
  it("explains missing data without creating metrics", () => {
    render(<Empty title="No measured recovery" />);
    expect(screen.getByText("No measured recovery")).toBeTruthy();
  });
});
