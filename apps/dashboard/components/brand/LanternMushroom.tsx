"use client";
import { useId } from "react";

export interface LanternMushroomProps {
  /** Pixel size for both width and height. Defaults to 26 (header usage). */
  size?: number;
  className?: string;
  /**
   * Accessible label. When set, the SVG renders as `role="img"` with this label.
   * When omitted, the SVG is marked `aria-hidden` (decorative — pair with a
   * visible "AgenticOS" wordmark).
   */
  ariaLabel?: string;
}

export function LanternMushroom({ size = 26, className, ariaLabel }: LanternMushroomProps) {
  const reactId = useId();
  // Sanitize React's generated id for use inside a URL fragment.
  const haloId = `lanternHalo-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const accessibility = ariaLabel
    ? { role: "img" as const, "aria-label": ariaLabel }
    : { "aria-hidden": true as const };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 26 26"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...accessibility}
    >
      <defs>
        <radialGradient id={haloId} cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#e3b94a" stopOpacity="0.45" />
          <stop offset="60%" stopColor="#c9a227" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#c9a227" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Warm lantern halo (glow bleeds outside the cap) */}
      <circle cx="13" cy="11" r="13" fill={`url(#${haloId})`} />

      {/* Cap: friendly rounded dome with a slight overhang at the bottom */}
      <path
        d="M 3.5 12
           C 3.5 7, 7.5 3.5, 13 3.5
           C 18.5 3.5, 22.5 7, 22.5 12
           C 22.5 13.2, 21.6 13.8, 20.5 13.8
           L 5.5 13.8
           C 4.4 13.8, 3.5 13.2, 3.5 12 Z"
        fill="#c9a227"
      />

      {/* Lantern "windows" (cute toadstool spots × glowing paper panels) */}
      <ellipse cx="8.4" cy="8.4" rx="1.7" ry="2" fill="#fdf6dc" />
      <ellipse cx="14.3" cy="6.5" rx="1.2" ry="1.5" fill="#fdf6dc" />
      <ellipse cx="17.5" cy="10" rx="1.1" ry="1.3" fill="#fdf6dc" />

      {/* Subtle gill ring shadow under the cap (implies the skirt, lifts the dome) */}
      <path
        d="M 5.5 13.8 Q 13 15.3, 20.5 13.8"
        stroke="#8a6f1b"
        strokeWidth="0.9"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      />

      {/* Stem: short, chunky lozenge (cute proportions: big head, stout body) */}
      <path
        d="M 10 14.2
           Q 9.4 19.5, 10.4 22
           Q 13 23.4, 15.6 22
           Q 16.6 19.5, 16 14.2 Z"
        fill="#c9a227"
      />

      {/* Pine sprout base — grounds the lantern in the forest floor */}
      <ellipse cx="13" cy="23" rx="3.2" ry="0.55" fill="#6ba480" opacity="0.7" />
    </svg>
  );
}

export default LanternMushroom;
