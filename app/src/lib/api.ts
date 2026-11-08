import { config } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function send(service: string, url: string, init: RequestInit) {
  let response: Response;
  let raw: string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), service === 'database' ? 15000 : 180000);
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
    raw = await response.text();
  } catch {
    if (controller.signal.aborted) throw new ApiError(0, `The ${service} took too long to respond. Try again.`);
    throw new ApiError(0, `Can't reach the ${service}. Check your connection and that the service is running.`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    let message = raw.trim();
    try {
      const body = JSON.parse(raw) as { error?: string; fields?: string[] };
      if (body.error) message = body.fields?.length ? `${body.error}: ${body.fields.join(', ')}` : body.error;
    } catch {
      /* SpacetimeDB reducer failures are plain text. */
    }
    throw new ApiError(response.status, message.replace(/^Database rejected the operation: /, '') || `HTTP ${response.status}`);
  }
  return raw;
}

const headers = (token?: string, json = true) => ({
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  ...(json ? { 'Content-Type': 'application/json' } : {}),
});

const callUrl = (name: string) =>
  `${config.spacetimeUrl}/v1/database/${encodeURIComponent(config.database)}/call/${name}`;

export const db = {
  async createIdentity() {
    const raw = await send('database', `${config.spacetimeUrl}/v1/identity`, { method: 'POST' });
    return JSON.parse(raw) as { identity: string; token: string };
  },
  async read<T>(token: string, resource: string, key = ''): Promise<T> {
    const raw = await send('database', callUrl('api_read'), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify([resource, key]),
    });
    const value = JSON.parse(raw);
    return (typeof value === 'string' ? JSON.parse(value) : value) as T;
  },
  async call(token: string, reducer: string, payload: object) {
    await send('database', callUrl(reducer), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify([JSON.stringify(payload)]),
    });
  },
};

export const account = {
  async signIn(username: string, password: string) {
    return JSON.parse(await send('PawSafe service', config.agentUrl + '/v1/auth/login', {
      method: 'POST', headers: headers(), body: JSON.stringify({ username, password }),
    })) as { token: string; role: 'owner' | 'shelter' };
  },
  async setPassword(token: string, username: string, password: string, role: 'owner' | 'shelter') {
    await send('PawSafe service', config.agentUrl + '/v1/auth/register', {
      method: 'POST', headers: headers(token), body: JSON.stringify({ username, password, role }),
    });
  },
};

export const agent = {
  async get<T>(token: string, path: string): Promise<T> {
    return JSON.parse(await send('PawSafe service', config.agentUrl + path, { headers: headers(token, false) })) as T;
  },
  async post<T>(token: string, path: string, body: object = {}): Promise<T> {
    return JSON.parse(
      await send('PawSafe service', config.agentUrl + path, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify(body),
      }),
    ) as T;
  },
};

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
