import { EMBED_HEIGHT_MESSAGE } from '../hooks/useEmbedHeight';

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The HTML a department pastes into its own website to show a form.
 *
 * The iframe works alone at its starting height. The script beside it grows
 * the frame to fit as the visitor moves through the form: it acts only on a
 * height message that came from this app's origin and names this form, so a
 * second embed on the same page, or another script posting messages, cannot
 * resize it.
 */
export function buildFormEmbedSnippet(appOrigin: string, slug: string, formName: string): string {
  const src = `${appOrigin}/embed/f/${slug}`;
  return [
    `<iframe src="${src}" title="${escapeAttribute(formName)}" style="width:100%;min-height:600px;border:0" loading="lazy"></iframe>`,
    '<script>',
    'window.addEventListener("message", function (e) {',
    `  if (e.origin !== ${JSON.stringify(appOrigin)} || !e.data || e.data.type !== ${JSON.stringify(EMBED_HEIGHT_MESSAGE)} || e.data.slug !== ${JSON.stringify(slug)}) return;`,
    `  document.querySelectorAll('iframe[src=${JSON.stringify(src)}]').forEach(function (f) { f.style.height = e.data.height + "px"; });`,
    '});',
    '</script>',
  ].join('\n');
}
