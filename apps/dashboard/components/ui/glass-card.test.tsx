import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { GlassCard } from "./glass-card"

describe("GlassCard", () => {
  it("renders children", () => {
    render(<GlassCard>hello world</GlassCard>)
    expect(screen.getByText("hello world")).toBeDefined()
  })

  it("applies glass classes by default", () => {
    const { container } = render(<GlassCard data-testid="card">x</GlassCard>)
    const el = container.firstChild as HTMLElement
    expect(el.className).toMatch(/backdrop-blur/)
    expect(el.className).toMatch(/bg-white/)
    expect(el.className).toMatch(/rounded-2xl/)
    expect(el.className).toMatch(/\bp-4\b/)
  })

  it("merges custom className", () => {
    const { container } = render(
      <GlassCard className="custom-extra">x</GlassCard>
    )
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain("custom-extra")
    expect(el.className).toMatch(/backdrop-blur/)
  })

  it("applies kpi variant padding", () => {
    const { container } = render(<GlassCard variant="kpi">x</GlassCard>)
    const el = container.firstChild as HTMLElement
    expect(el.className).toMatch(/\bp-6\b/)
  })

  it("applies row variant padding", () => {
    const { container } = render(<GlassCard variant="row">x</GlassCard>)
    const el = container.firstChild as HTMLElement
    expect(el.className).toMatch(/\bpx-4\b/)
    expect(el.className).toMatch(/\bpy-3\b/)
  })

  it("forwards HTML attributes", () => {
    render(
      <GlassCard id="my-id" role="region" aria-label="card">
        x
      </GlassCard>
    )
    const el = screen.getByRole("region")
    expect(el.id).toBe("my-id")
    expect(el.getAttribute("aria-label")).toBe("card")
  })
})
