import { describe, it, expect } from "vitest";
import {
  hexToRgb,
  rgbToHex,
  relativeLuminance,
  contrastRatio,
  accessibleTextColor,
} from "./colorContrast";

describe("hexToRgb", () => {
  it("parses 6-char hex", () => {
    expect(hexToRgb("#dc2626")).toEqual({ r: 220, g: 38, b: 38 });
  });

  it("parses 3-char hex", () => {
    expect(hexToRgb("#f00")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("returns undefined for invalid input", () => {
    expect(hexToRgb("not-a-color")).toBeUndefined();
  });
});

describe("rgbToHex", () => {
  it("formats RGB to 6-char lowercase hex", () => {
    expect(rgbToHex(220, 38, 38)).toBe("#dc2626");
  });

  it("zero-pads small values", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
  });
});

describe("relativeLuminance", () => {
  it("returns 0 for black", () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 4);
  });

  it("returns 1 for white", () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 4);
  });
});

describe("contrastRatio", () => {
  it("returns 21:1 for black vs white", () => {
    const black = relativeLuminance(0, 0, 0);
    const white = relativeLuminance(255, 255, 255);
    expect(contrastRatio(black, white)).toBeCloseTo(21, 0);
  });

  it("returns 1:1 for identical colors", () => {
    const lum = relativeLuminance(128, 128, 128);
    expect(contrastRatio(lum, lum)).toBeCloseTo(1, 4);
  });
});

describe("accessibleTextColor", () => {
  const testColors = [
    "#dc2626", // red-600
    "#ef4444", // red-500
    "#f59e0b", // amber-500
    "#10b981", // emerald-500
    "#3b82f6", // blue-500
    "#8b5cf6", // violet-500
    "#000000", // black
    "#ffffff", // white
    "#4f46e5", // indigo-600
    "#7c3aed", // violet-600
  ];

  const themes = ["light", "dark", "high-contrast"] as const;

  // Surface backgrounds from index.css
  const surfaceBgs: Record<string, { r: number; g: number; b: number }> = {
    light: { r: 255, g: 255, b: 255 },
    dark: { r: 15, g: 23, b: 42 }, // slate-900 gradient base
    "high-contrast": { r: 0, g: 0, b: 0 },
  };

  for (const theme of themes) {
    describe(`${theme} theme`, () => {
      for (const hex of testColors) {
        it(`${hex} meets WCAG AA (4.5:1) contrast`, () => {
          const result = accessibleTextColor(hex, theme);
          const rgb = hexToRgb(result);
          expect(rgb).toBeDefined();

          const bg = surfaceBgs[theme] ?? { r: 255, g: 255, b: 255 };
          const bgLum = relativeLuminance(bg.r, bg.g, bg.b);
          const textLum = relativeLuminance(rgb?.r ?? 0, rgb?.g ?? 0, rgb?.b ?? 0);
          const ratio = contrastRatio(textLum, bgLum);

          expect(ratio).toBeGreaterThanOrEqual(4.5);
        });
      }
    });
  }
});
