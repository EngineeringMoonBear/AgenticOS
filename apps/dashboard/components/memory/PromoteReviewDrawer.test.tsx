import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromoteReviewDrawer } from "./PromoteReviewDrawer";

describe("PromoteReviewDrawer", () => {
  const note = {
    path: "capture.md",
    title: "Soil test",
    capturedAt: "2026-06-01T00:00:00Z",
    body: "pH was 6.2",
  };

  it("renders drafted frontmatter+body and an obsidian deep link", () => {
    render(
      <PromoteReviewDrawer
        inboxPath="capture.md"
        note={note}
        categories={["Farm", "Reference"]}
        onClose={() => {}}
      />
    );

    // drafted markdown preview present
    expect(screen.getByText(/title: "Soil test"/)).toBeInTheDocument();
    expect(screen.getByText(/pH was 6.2/)).toBeInTheDocument();

    // deep link to the inbox note
    const link = screen.getByRole("link", {
      name: /open in obsidian/i,
    }) as HTMLAnchorElement;
    expect(link.href).toContain("obsidian://open?vault=vault");
    expect(link.href).toContain("inbox/capture.md");
  });

  it("copies the drafted markdown to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <PromoteReviewDrawer
        inboxPath="capture.md"
        note={note}
        categories={["Farm"]}
        onClose={() => {}}
      />
    );

    const copyBtn = screen.getByRole("button", { name: /copy/i });
    copyBtn.click();

    expect(writeText).toHaveBeenCalledOnce();
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('title: "Soil test"');
    expect(copied).toContain("pH was 6.2");
  });

  it("does not make any network request (no server promote)", () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(
      <PromoteReviewDrawer
        inboxPath="capture.md"
        note={note}
        categories={["Farm"]}
        onClose={() => {}}
      />
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
