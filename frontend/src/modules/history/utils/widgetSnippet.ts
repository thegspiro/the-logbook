/**
 * The line a department pastes into its own website to show the "Today in
 * history" widget. The token is base64url (made by the server), so it needs
 * no escaping inside the attribute.
 */
export function buildHistoryWidgetSnippet(appOrigin: string, token: string): string {
  return `<iframe src="${appOrigin}/embed/history/${token}" title="Today in history" style="width:100%;height:260px;border:0" loading="lazy"></iframe>`;
}
