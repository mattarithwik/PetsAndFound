export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function setting(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ApiError(503, `${name} is not configured`);
  return value;
}

export interface Store {
  read<T>(resource: string, key?: string): Promise<T>;
  write(operation: string, payload: object): Promise<void>;
}

export function database(token: string): Store {
  const base = setting("SPACETIME_URI").replace(/^ws/i, "http").replace(/\/$/, "");
  async function call(operation: string, args: string[]) {
    const url = `${base}/v1/database/${encodeURIComponent(setting("SPACETIME_DATABASE"))}/call/${operation}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
    } catch {
      throw new ApiError(503, "SpacetimeDB is unavailable");
    }
    const body = await response.text();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new ApiError(response.status, "Database authorization failed");
      if (response.status === 530 || response.status === 400 || response.status === 409) {
        throw new ApiError(409, "Database rejected the operation: " + body.slice(0, 300));
      }
      throw new ApiError(503, "Database request failed (" + response.status + ")");
    }
    return body;
  }
  return {
    async read<T>(resource: string, key = "") {
      const value = JSON.parse(await call("api_read", [resource, key]));
      // The procedure returns JSON text as a SpacetimeDB string.
      return (typeof value === "string" ? JSON.parse(value) : value) as T;
    },
    async write(operation, payload) {
      await call(operation, [JSON.stringify(payload)]);
    },
  };
}
export const systemStore = () => database(setting("SPACETIME_SERVICE_TOKEN"));

export interface Profile {
  id: string;
  name: string;
  generalLocation?: string;
}
export interface Actor {
  id: string;
  db: Store;
  system: Store;
}
export async function authenticate(header: string | undefined): Promise<Actor> {
  const token = /^Bearer ([^\s]+)$/i.exec(header ?? "")?.[1];
  if (!token) throw new ApiError(401, "Supply a SpacetimeDB bearer token");
  const db = database(token);
  const profile = await db.read<Profile | null>("profile");
  if (!profile) throw new ApiError(403, "Register a PawSafe profile first");
  return { id: profile.id, db, system: systemStore() };
}

export type Pet = {
  id: string;
  name: string;
  species: string;
  breed?: string;
  colors?: string[];
  markings?: string;
};
export type Photo = {
  id: string;
  storageKey: string;
  petId?: string;
  angle?: string;
  animalCount?: number;
  embeddingRef?: string;
};
export type Report = {
  id: string;
  petId?: string;
  type: string;
  status: string;
  species: string;
  breed?: string;
  colors?: string[];
  latitude: number;
  longitude: number;
  observedAt: string;
  generalLocation?: string;
  creatorId: string;
};
export type Job = {
  purgeExternalId?: string;
  photoUrls?: string[];
  id: string;
  reportId: string;
  version: number;
  kind?: string;
  photoId?: string;
  externalId?: string;
};
