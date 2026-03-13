/**
 * Simple Markdown Renderer
 *
 * Converts a small subset of markdown syntax to HTML for event descriptions.
 * Sanitizes HTML first (escapes angle brackets and ampersands) to prevent XSS,
 * then applies markdown conversions.
 *
 * Supported syntax:
 * - **bold** → <strong>bold</strong>
 * - *italic* → <em>italic</em>
 * - [text](url) → <a href="url">text</a>
 * - Lines starting with "- " → <ul><li>…</li></ul>
 * - Newlines → <br>
 */

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Validate that a URL is safe (http, https, or mailto only).
 */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Convert simple markdown text to sanitized HTML.
 *
 * The input is first HTML-escaped, then markdown patterns are converted.
 * This ensures no raw HTML can be injected.
 */
export function renderSimpleMarkdown(text: string): string {
  // First, escape all HTML
  let html = escapeHtml(text);

  // Convert **bold** (must come before italic to avoid conflict)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Convert *italic* (single asterisks, not preceded/followed by another asterisk)
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  // Convert [text](url) links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match: string, linkText: string, url: string) => {
      if (isSafeUrl(url)) {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300">${linkText}</a>`;
      }
      return linkText;
    },
  );

  // Convert bullet lists: lines starting with "- "
  // Split into lines, group consecutive bullet lines into <ul> blocks
  const lines = html.split('\n');
  const result: string[] = [];
  let inList = false;

  for (const line of lines) {
    if (line.startsWith('- ')) {
      if (!inList) {
        result.push('<ul class="list-disc list-inside my-1">');
        inList = true;
      }
      result.push(`<li>${line.slice(2)}</li>`);
    } else {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push(line);
    }
  }
  if (inList) {
    result.push('</ul>');
  }

  // Join lines back and convert remaining newlines to <br>
  // But don't add <br> right after </ul> or </li> or before <ul>
  html = result
    .join('\n')
    .replace(/\n(?!<\/?(?:ul|li))/g, '<br>')
    .replace(/(<\/ul>)\n/g, '$1')
    .replace(/\n(<ul)/g, '$1');

  return html;
}
