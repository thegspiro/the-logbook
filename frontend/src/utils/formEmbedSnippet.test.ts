import { describe, it, expect } from 'vitest';
import { buildFormEmbedSnippet } from './formEmbedSnippet';

describe('buildFormEmbedSnippet', () => {
  const snippet = buildFormEmbedSnippet('https://logbook.example.org', 'abc123def456', 'Join "Us" <now>');

  it('frames the embed page, not the standalone one', () => {
    expect(snippet).toContain('<iframe src="https://logbook.example.org/embed/f/abc123def456"');
  });

  it('escapes the form name inside the title attribute', () => {
    expect(snippet).toContain('title="Join &quot;Us&quot; &lt;now&gt;"');
    expect(snippet).not.toContain('"Us"');
  });

  it('resizes only on a height message from the app naming this form', () => {
    expect(snippet).toContain('e.origin !== "https://logbook.example.org"');
    expect(snippet).toContain('e.data.type !== "logbook:form-height"');
    expect(snippet).toContain('e.data.slug !== "abc123def456"');
  });
});
