import type React from "react";

/**
 * WCAG-compliant color contrast utilities.
 *
 * Provides functions to derive accessible text colors from arbitrary
 * hex values, ensuring a minimum 4.5:1 contrast ratio (WCAG AA) against
 * the actual page surface background in any theme (light, dark,
 * high-contrast).
 */

/** Parse a hex color (#abc or #aabbcc) to RGB components. */
export const hexToRgb = (
  hex: string,
): { r: number; g: number; b: number } | undefined => {
  const stripped = hex.replace("#", "");
  if (stripped.length === 3) {
    const r = parseInt((stripped[0] ?? "0") + (stripped[0] ?? "0"), 16);
    const g = parseInt((stripped[1] ?? "0") + (stripped[1] ?? "0"), 16);
    const b = parseInt((stripped[2] ?? "0") + (stripped[2] ?? "0"), 16);
    return { r, g, b };
  }
  if (stripped.length === 6) {
    return {
      r: parseInt(stripped.slice(0, 2), 16),
      g: parseInt(stripped.slice(2, 4), 16),
      b: parseInt(stripped.slice(4, 6), 16),
    };
  }
  return undefined;
};

/** Format RGB components back to a hex string. */
export const rgbToHex = (r: number, g: number, b: number): string =>
  `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;

/** Relative luminance per WCAG 2.x (0 = black, 1 = white). */
export const relativeLuminance = (r: number, g: number, b: number): number => {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  ) as [number, number, number];
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

/** WCAG contrast ratio between two relative-luminance values. */
export const contrastRatio = (l1: number, l2: number): number => {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * Read the effective surface background color from CSS custom properties.
 *
 * Falls back to theme-appropriate defaults when getComputedStyle is
 * unavailable (e.g. SSR or test environments).
 */
const getSurfaceBgRgb = (
  resolvedTheme: "light" | "dark" | "high-contrast",
): { r: number; g: number; b: number } => {
  // Theme-specific fallbacks that match index.css definitions
  const fallbacks: Record<string, { r: number; g: number; b: number }> = {
    light: { r: 255, g: 255, b: 255 }, // #ffffff
    dark: { r: 15, g: 23, b: 42 }, // #0f172a (slate-900 gradient base)
    "high-contrast": { r: 0, g: 0, b: 0 }, // #000000
  };

  if (typeof document === "undefined") {
    return fallbacks[resolvedTheme] ?? fallbacks["light"] ?? { r: 255, g: 255, b: 255 };
  }

  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--surface-bg")
      .trim();

    // Handle hex values
    if (raw.startsWith("#")) {
      const parsed = hexToRgb(raw);
      if (parsed) return parsed;
    }

    // Handle rgba() — for dark mode the surface-bg is rgba(255,255,255,0.1)
    // over the gradient base. Composite it against the gradient-from color.
    const rgbaMatch = raw.match(
      /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/,
    );
    if (rgbaMatch) {
      const fg = {
        r: parseInt(rgbaMatch[1] ?? "0", 10),
        g: parseInt(rgbaMatch[2] ?? "0", 10),
        b: parseInt(rgbaMatch[3] ?? "0", 10),
      };
      const alpha = parseFloat(rgbaMatch[4] ?? "1");

      if (alpha < 1) {
        // Composite over the gradient base
        const gradFrom = getComputedStyle(document.documentElement)
          .getPropertyValue("--bg-gradient-from")
          .trim();
        const base = hexToRgb(gradFrom) ?? fallbacks[resolvedTheme] ?? fallbacks["light"] ?? { r: 255, g: 255, b: 255 };
        return {
          r: Math.round(fg.r * alpha + base.r * (1 - alpha)),
          g: Math.round(fg.g * alpha + base.g * (1 - alpha)),
          b: Math.round(fg.b * alpha + base.b * (1 - alpha)),
        };
      }

      return fg;
    }
  } catch {
    // getComputedStyle can throw in edge-case environments
  }

  return fallbacks[resolvedTheme] ?? fallbacks["light"] ?? { r: 255, g: 255, b: 255 };
};

/**
 * Derive an accessible text color from an arbitrary hex color.
 *
 * Reads the actual surface background from CSS custom properties so it
 * works correctly across light, dark, and high-contrast themes. Adjusts
 * the color iteratively until it meets WCAG AA contrast (4.5:1).
 */
export const accessibleTextColor = (
  hex: string,
  resolvedTheme: "light" | "dark" | "high-contrast",
): string => {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const bg = getSurfaceBgRgb(resolvedTheme);
  const bgLum = relativeLuminance(bg.r, bg.g, bg.b);
  const shouldLighten = bgLum < 0.5;
  const minContrast = 4.5;

  let { r, g, b } = rgb;
  for (let i = 0; i < 20; i++) {
    const lum = relativeLuminance(r, g, b);
    if (contrastRatio(lum, bgLum) >= minContrast) break;
    if (shouldLighten) {
      r = Math.min(255, r + Math.ceil((255 - r) * 0.2));
      g = Math.min(255, g + Math.ceil((255 - g) * 0.2));
      b = Math.min(255, b + Math.ceil((255 - b) * 0.2));
    } else {
      r = Math.max(0, Math.floor(r * 0.8));
      g = Math.max(0, Math.floor(g * 0.8));
      b = Math.max(0, Math.floor(b * 0.8));
    }
  }

  return rgbToHex(r, g, b);
};

/**
 * Generate inline styles for a colored card element (shift, event, etc.).
 *
 * - Background: hex at ~10% opacity
 * - Border: hex at ~30% opacity
 * - Text: WCAG AA compliant against the current theme's surface background
 */
export const colorCardStyle = (
  hex: string,
  resolvedTheme: "light" | "dark" | "high-contrast",
): React.CSSProperties => ({
  backgroundColor: `${hex}18`,
  borderColor: `${hex}4D`,
  color: accessibleTextColor(hex, resolvedTheme),
});
