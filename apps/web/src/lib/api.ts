/** Browser-side API client for the admin panel (same-origin, cookie session). */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details?: Record<string, unknown> } | null;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('SERVICE_UNAVAILABLE', 0);
  }
  let envelope: Envelope<T> | null = null;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    /* non-JSON error page */
  }
  if (response.status === 401 && typeof window !== 'undefined' && !path.endsWith('/admin/session')) {
    // A full navigation on purpose: it drops all client state of the expired session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/admin/login');
  }
  if (!response.ok || !envelope?.success) {
    throw new ApiError(envelope?.error?.code ?? 'INTERNAL_ERROR', response.status, envelope?.error?.details ?? {});
  }
  return envelope.data as T;
}
