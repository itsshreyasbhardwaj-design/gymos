import 'server-only';
import { headers } from 'next/headers';

/**
 * Origin check for route handlers that mutate state.
 *
 * Next.js Server Actions already verify Origin against the host. Route handlers do not,
 * so every mutating handler calls this. Combined with SameSite=Lax cookies this covers
 * the cross-site request cases that matter for this app.
 */
export async function assertSameOrigin(): Promise<void> {
  const hdrs = await headers();
  const origin = hdrs.get('origin');
  const host = hdrs.get('host');
  if (!origin) {
    // No Origin header: same-origin GET-style navigation or a non-browser client.
    // Mutating handlers additionally require a JSON content type (see requireJson).
    return;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new CsrfError();
  }
  if (!host || originHost !== host) throw new CsrfError();
}

export async function requireJson(request: Request): Promise<void> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    throw new CsrfError('This endpoint only accepts application/json.');
  }
}

export class CsrfError extends Error {
  constructor(message = 'Request blocked: the origin did not match.') {
    super(message);
    this.name = 'CsrfError';
  }
}

/**
 * Stricter origin check for handlers that accept non-JSON bodies.
 *
 * `multipart/form-data` is a CORS-"simple" content type, so a cross-site HTML form
 * can post one without a preflight. The JSON content-type gate therefore does not
 * protect file uploads, and these handlers insist on positive same-origin proof
 * instead of treating a missing Origin header as benign.
 */
export async function assertSameOriginStrict(): Promise<void> {
  const hdrs = await headers();
  const site = hdrs.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new CsrfError();

  const origin = hdrs.get('origin');
  const host = hdrs.get('host');
  if (!origin) {
    // Modern browsers always send Origin on POST. Without it and without a
    // same-origin Sec-Fetch-Site, there is nothing to verify, so refuse.
    if (!site) throw new CsrfError('This endpoint requires a same-origin request.');
    return;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new CsrfError();
  }
  if (!host || originHost !== host) throw new CsrfError();
}
