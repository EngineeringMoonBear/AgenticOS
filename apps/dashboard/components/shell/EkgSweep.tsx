"use client";
import { useEffect, useId, useRef } from "react";

/**
 * EKG monitor sweep — a CRT-style "live" pulse train that draws left-to-right
 * across the KPI vista, holds, then phosphor-decays. On every animation
 * iteration we regenerate the path with a fresh random arrangement of
 * 2–5 beats so no two sweeps look identical.
 *
 * The sweep animation itself is pure CSS (`@keyframes ekg-sweep` driving
 * `stroke-dashoffset`). The JS here only re-randomizes the path `d`.
 *
 * Ported from `docs/design/v2-ui-mockup.html` (`makeBeat` / `generateEKGPath`).
 */

function makeBeat(cx: number, amp: number): string {
  // amp ∈ [0, 1]:  0 = whisper, 1 = dramatic
  const peakUp = 90 - amp * 70; // upward spike (smaller y = higher)
  const peakDown = 110 + amp * 70; // downward trough (larger y = lower)
  const pH = 100 - 6 - amp * 4; // P-wave height
  const tH = 100 - 7 - amp * 7; // T-wave height
  return [
    "L", cx - 36, 100,
    // P wave
    "Q", cx - 28, 100, cx - 22, pH,
    "Q", cx - 16, 100, cx - 10, 100,
    // QRS
    "L", cx - 4, 100,
    "L", cx - 2, 90,
    "L", cx, peakUp,
    "L", cx + 2, peakDown,
    "L", cx + 4, 90,
    "L", cx + 8, 100,
    // T wave
    "Q", cx + 20, 100, cx + 28, tH,
    "Q", cx + 36, 100, cx + 44, 100,
  ].join(" ");
}

function generateEkgPath(): string {
  // Start past the panel's left fade margin.
  let x = 100 + Math.random() * 100;
  const segments: string[] = ["M 0 100"];
  while (x < 1480) {
    // Amplitude bias: small beats common, medium sometimes, big rare.
    let amp = Math.random();
    if (amp < 0.55) amp = amp * 0.5;
    else if (amp < 0.85) amp = 0.4 + amp * 0.4;
    else amp = 0.85 + (amp - 0.85) * 1.0;
    segments.push(makeBeat(x, amp));
    // Spacing varies — feels organic, not metronomic.
    x += 180 + Math.random() * 320;
  }
  segments.push("L 1600 100");
  return segments.join(" ");
}

export function EkgSweep() {
  const reactId = useId();
  // Sanitize for URL-fragment use; unique per instance to avoid collisions.
  const glowId = `ekgGlow-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const traceRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const trace = traceRef.current;
    if (!trace) return;
    // Respect reduced-motion users: render a single static path; skip refresh.
    const mql =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    trace.setAttribute("d", generateEkgPath());
    if (mql?.matches) return;
    const handler = () => trace.setAttribute("d", generateEkgPath());
    trace.addEventListener("animationiteration", handler);
    return () => trace.removeEventListener("animationiteration", handler);
  }, []);

  return (
    <div className="ekg-backdrop" aria-hidden="true">
      <svg viewBox="0 0 1600 200" preserveAspectRatio="none">
        <defs>
          {/* CRT phosphor glow — soft halo around the trace. */}
          <filter id={glowId} x="-2%" y="-30%" width="104%" height="160%">
            <feGaussianBlur stdDeviation="2.4" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <line className="ekg-baseline" x1="110" y1="100" x2="1490" y2="100" />

        <g filter={`url(#${glowId})`}>
          <path ref={traceRef} className="ekg-trace" d="M 0 100 L 1600 100" />
        </g>
      </svg>
    </div>
  );
}

export default EkgSweep;
