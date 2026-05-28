import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Row, RowList } from "./Row";

describe("Row", () => {
  it("renders with .row class", () => {
    const { container } = render(<Row>x</Row>);
    expect((container.firstChild as HTMLElement).className).toContain("row");
  });

  it("adds .stuck class when stuck", () => {
    const { container } = render(<Row stuck>x</Row>);
    expect((container.firstChild as HTMLElement).className).toContain("stuck");
  });

  it("forwards custom className and style", () => {
    const { container } = render(
      <Row
        className="custom"
        style={{ gridTemplateColumns: "auto 1fr auto auto" }}
      >
        x
      </Row>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("custom");
    expect(el.style.gridTemplateColumns).toBe("auto 1fr auto auto");
  });
});

describe("RowList", () => {
  it("renders children with .row-list class", () => {
    const { container } = render(
      <RowList>
        <Row>a</Row>
        <Row>b</Row>
      </RowList>,
    );
    expect((container.firstChild as HTMLElement).className).toContain(
      "row-list",
    );
    expect(screen.getByText("a")).toBeDefined();
    expect(screen.getByText("b")).toBeDefined();
  });
});
