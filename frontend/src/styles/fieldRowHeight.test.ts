import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const stylesheet = readFileSync(join(__dirname, 'index.css'), 'utf8');

/**
 * The desktop field-row height contract, read from the source rather than a
 * render. A button in the same flex row as a field takes the field's height on
 * a mouse-driven screen, so a toolbar does not mix a 42px search box with a
 * 38px or 44px button. jsdom compiles no Tailwind and applies no cascade; the
 * laid-out result is asserted by `e2e/desktop-layout.spec.ts`.
 */

const block = (() => {
  const marker = '@media (min-width: 768px) and (pointer: fine) {';
  const at = stylesheet.indexOf(marker);
  if (at < 0) return '';
  let depth = 1;
  let i = at + marker.length;
  while (i < stylesheet.length && depth > 0) {
    if (stylesheet[i] === '{') depth += 1;
    else if (stylesheet[i] === '}') depth -= 1;
    i += 1;
  }
  return stylesheet.slice(at, i);
})();

describe('field-row height on a desktop', () => {
  it('registers the height so 1lh resolves on the row, not on each button', () => {
    expect(stylesheet).toMatch(/@property --row-field-h \{\s*syntax: '<length>';\s*inherits: true;/);
  });

  it('applies only to a mouse-driven screen from 768px, so touch keeps its 44px targets', () => {
    expect(block).not.toBe('');
    expect(block).toContain('min-height: var(--row-field-h);');
  });

  it("publishes each form-input size's own height", () => {
    // One line of the inherited text + py-2 + border; text-sm; py-3; form-input-sm.
    expect(block).toContain('--row-field-h: calc(1lh + 1rem + 2px);');
    expect(block).toContain('--row-field-h: 2.375rem;');
    expect(block).toContain('--row-field-h: 3.125rem;');
    expect(block).toContain('--row-field-h: 2.125rem;');
  });

  it('treats a column as a row only once a breakpoint turns it into one', () => {
    expect(block).toMatch(/\.flex-col:not\(\.sm\\:flex-row, \.md\\:flex-row, \.lg\\:flex-row\)/);
  });

  it('leaves segmented controls, toggle groups and in-field icon buttons alone', () => {
    for (const excluded of ['nav,', '.segmented-group', "[role='tablist']", "[role='group']", "[role='radiogroup']"]) {
      expect(block).toContain(excluded);
    }
    expect(block).toContain(':not(.absolute)');
  });

  it('is a minimum, not a fixed height, so a wrapping label can still grow the button', () => {
    expect(block).not.toMatch(/(?<!min-)height: var\(--row-field-h\)/);
  });
});
