import { describe, it, expect } from 'vitest';
import { plainTextToHtml, richTextToPlain, sanitizeRichText, sectionIsBlank } from './richText';

describe('sanitizeRichText', () => {
  it('keeps what the editor produces', () => {
    const html =
      '<h2>Old business</h2><p>Moved <strong>and</strong> <em>seconded</em> <u>twice</u></p><ul><li>One</li></ul><ol><li>Two</li></ol><blockquote><p>Quoted</p></blockquote>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<p onclick="alert(1)">x</p>',
    '<a href="javascript:alert(1)">x</a>',
    '<iframe src="https://evil.example"></iframe>',
    '<p style="position:fixed">x</p>',
    '<svg onload="alert(1)"></svg>',
  ])('removes active content: %s', (attack) => {
    const cleaned = sanitizeRichText(`<p>kept</p>${attack}`).toLowerCase();
    expect(cleaned).toContain('kept');
    for (const danger of [
      '<script',
      'onerror',
      'onclick',
      'onload',
      'javascript:',
      '<iframe',
      'style=',
      '<svg',
      '<img',
    ]) {
      expect(cleaned).not.toContain(danger);
    }
  });

  it('makes every link safe to open', () => {
    const cleaned = sanitizeRichText('<a href="https://ok.example" target="_blank">go</a>');
    expect(cleaned).toContain('href="https://ok.example"');
    expect(cleaned).toContain('rel="noopener noreferrer"');
    expect(cleaned).not.toContain('target');
  });

  it('allows only web and email links', () => {
    expect(sanitizeRichText('<a href="mailto:a@b.example">m</a>')).toContain('mailto:a@b.example');
    expect(sanitizeRichText('<a href="ftp://x.example">f</a>')).not.toContain('ftp:');
  });
});

describe('plainTextToHtml', () => {
  it('turns blank lines into paragraphs and single breaks into <br>', () => {
    expect(plainTextToHtml('One\nstill one\n\nTwo')).toBe('<p>One<br>still one</p><p>Two</p>');
  });

  it('escapes text so it is never read as markup', () => {
    expect(plainTextToHtml('Quorum <5 & a > b <b>x</b>')).toBe(
      '<p>Quorum &lt;5 &amp; a &gt; b &lt;b&gt;x&lt;/b&gt;</p>'
    );
  });

  it('yields nothing for blank input', () => {
    expect(plainTextToHtml('  \n\n  ')).toBe('');
  });
});

describe('blank detection', () => {
  it('reads the words, not the markup', () => {
    expect(richTextToPlain('<p>Fish &amp; chips</p>')).toBe('Fish & chips');
    expect(sectionIsBlank({ content: '<p></p>', format: 'html' })).toBe(true);
    expect(sectionIsBlank({ content: '<p><br></p>', format: 'html' })).toBe(true);
    expect(sectionIsBlank({ content: '<p>x</p>', format: 'html' })).toBe(false);
  });

  it('treats plain text as plain text, markup characters and all', () => {
    expect(sectionIsBlank({ content: '   ' })).toBe(true);
    expect(sectionIsBlank({ content: '<p></p>' })).toBe(false);
  });
});
