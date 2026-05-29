import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Card, CardAction, CardHead, CardTitle } from "./Card";

describe("Card", () => {
  it("renders children with .card class", () => {
    const { container } = render(<Card>body</Card>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("card");
    expect(screen.getByText("body")).toBeDefined();
  });

  it("applies lane variant class", () => {
    const { container } = render(<Card lane="gold">x</Card>);
    expect((container.firstChild as HTMLElement).className).toContain(
      "lane--gold",
    );
  });

  it("applies span2 and spanFull classes", () => {
    const { container: c2 } = render(<Card span2>x</Card>);
    expect((c2.firstChild as HTMLElement).className).toContain("span-2");
    const { container: cf } = render(<Card spanFull>x</Card>);
    expect((cf.firstChild as HTMLElement).className).toContain("span-full");
  });

  it("supports compound pattern via Card.Head / Card.Title / Card.Action", () => {
    render(
      <Card lane="pine">
        <Card.Head>
          <Card.Title icon={<svg data-testid="icon" />}>Burndown</Card.Title>
          <Card.Action>24h</Card.Action>
        </Card.Head>
      </Card>,
    );
    expect(screen.getByText("Burndown")).toBeDefined();
    expect(screen.getByText("24h")).toBeDefined();
    expect(screen.getByTestId("icon")).toBeDefined();
  });

  it("supports flat named-export pattern", () => {
    render(
      <Card lane="amber">
        <CardHead>
          <CardTitle>Title</CardTitle>
          <CardAction>now</CardAction>
        </CardHead>
      </Card>,
    );
    expect(screen.getByText("Title")).toBeDefined();
    expect(screen.getByText("now")).toBeDefined();
  });
});
