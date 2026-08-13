/** Convert a request path into a safe, human-readable resource name. */
function requestResource(path?: string): string | null {
  if (!path) return null;

  const segments = path
    .split('?')[0]
    ?.split('/')
    .filter(Boolean)
    .filter((segment) => segment !== 'api' && segment !== 'v1');
  const segment = segments?.find((part) => !/^\d+$/.test(part) && !/^[0-9a-f-]{32,}$/i.test(part));
  if (!segment) return null;

  return segment.replace(/[-_]/g, ' ');
}

const ENDPOINT_ACTIONS: Record<string, string> = {
  approve: 'Approving',
  reject: 'Rejecting',
  cancel: 'Cancelling',
  withdraw: 'Withdrawing',
  void: 'Voiding',
  publish: 'Publishing',
  send: 'Sending',
  import: 'Importing',
  export: 'Exporting',
  'check-in': 'Checking in',
};

/** Recognize only an allowlist of operation segments, never arbitrary path data. */
function endpointAction(path?: string): string | null {
  const segments = path?.split('?')[0]?.split('/').filter(Boolean) ?? [];
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]?.toLowerCase();
    if (segment && ENDPOINT_ACTIONS[segment]) return ENDPOINT_ACTIONS[segment];
  }
  return null;
}

/**
 * Describe an API operation without copying button labels or submitted data
 * into an organization-wide log. The endpoint supplies a little more useful
 * detail than the HTTP verb alone while remaining safe to retain.
 */
export function requestAction(method?: string, path?: string): string {
  const resource = requestResource(path);
  const target = resource ? ` ${resource}` : ' data';
  const explicitAction = endpointAction(path);
  if (explicitAction) return `${explicitAction}${target}`;

  switch (method?.toUpperCase()) {
    case 'GET':
      return `Loading${target}`;
    case 'POST':
      return `Creating or submitting${target}`;
    case 'PUT':
    case 'PATCH':
      return `Updating${target}`;
    case 'DELETE':
      return `Deleting${target}`;
    default:
      return `Requesting${target}`;
  }
}

export function contextText(context: Record<string, unknown>, key: string): string | null {
  return typeof context[key] === 'string' && context[key] ? context[key] : null;
}

/** Browser page when known; server-only reports fall back to their endpoint. */
export function errorPage(context: Record<string, unknown>): string {
  return contextText(context, 'page') ?? contextText(context, 'path') ?? 'Not recorded';
}

export function errorAction(context: Record<string, unknown>): string {
  return (
    contextText(context, 'action') ??
    requestAction(contextText(context, 'method') ?? undefined, contextText(context, 'path') ?? undefined)
  );
}
