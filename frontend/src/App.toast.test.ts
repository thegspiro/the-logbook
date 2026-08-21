import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToRgb, relativeLuminance } from './utils/colorContrast';

const app = readFileSync(join(__dirname, 'App.tsx'), 'utf8');
const stylesheet = readFileSync(join(__dirname, 'styles/index.css'), 'utf8');

describe('global toast presentation', () => {
  it('clears the mobile header and stays within the viewport', () => {
    const mobileRule = /@media \(max-width: 767px\) \{([\s\S]*?)\n\}/.exec(
      stylesheet.slice(stylesheet.indexOf('.app-toaster'))
    )?.[1];

    expect(mobileRule).toMatch(/top:\s*calc\(4rem \+ env\(safe-area-inset-top\)\)\s*!important/);
    expect(mobileRule).toMatch(/right:\s*1rem\s*!important/);
    expect(mobileRule).toMatch(/left:\s*1rem\s*!important/);
    expect(mobileRule).toMatch(/\.app-toaster > div[\s\S]*max-width:\s*100%\s*!important/);
    expect(stylesheet).toMatch(/\.app-toast \{[\s\S]*?overflow-wrap:\s*anywhere/);
  });

  it('preserves the compact desktop offset and layers above application chrome', () => {
    const toasterRule = /\.app-toaster \{([\s\S]*?)\}/.exec(stylesheet)?.[1];

    expect(toasterRule).toMatch(/top:\s*calc\(0\.5rem \+ env\(safe-area-inset-top\)\)/);
    expect(toasterRule).toMatch(/z-index:\s*110\s*!important/);
  });

  it('uses an opaque modal surface and accessible dark-theme text contrast', () => {
    expect(stylesheet).toMatch(/\.app-toast \{[\s\S]*?background:\s*var\(--surface-modal\)\s*!important/);
    expect(stylesheet).toMatch(/\.app-toast \{[\s\S]*?color:\s*var\(--text-primary\)\s*!important/);
    expect(stylesheet).toMatch(/\.app-toast \{[\s\S]*?(border:[^;]+|box-shadow:[^;]+)/);

    // Dark theme: --text-primary #f8fafc on opaque --surface-modal #1e293b.
    const text = hexToRgb('#f8fafc');
    const surface = hexToRgb('#1e293b');
    expect(text).toBeDefined();
    expect(surface).toBeDefined();
    expect(
      contrastRatio(
        relativeLuminance(text?.r ?? 0, text?.g ?? 0, text?.b ?? 0),
        relativeLuminance(surface?.r ?? 0, surface?.g ?? 0, surface?.b ?? 0)
      )
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('announces routine messages politely and errors assertively', () => {
    expect(app).toMatch(/ariaProps:\s*\{\s*role:\s*'status',\s*'aria-live':\s*'polite'/);
    expect(app).toMatch(/error:\s*\{[\s\S]*?ariaProps:\s*\{\s*role:\s*'alert',\s*'aria-live':\s*'assertive'/);
    expect(app).toMatch(/success:\s*\{\s*className:\s*'app-toast app-toast--success'/);
    expect(app).toMatch(/error:\s*\{\s*className:\s*'app-toast app-toast--error'/);
    expect(stylesheet).toContain('.app-toast--warning');
  });
});
