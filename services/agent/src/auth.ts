import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { ApiError, authenticate, systemStore, type Store } from "./db.js";

const scrypt = promisify(scryptCallback);
const input = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9._-]{2,31}$/),
    password: z.string().min(8).max(128),
  })
  .strict();
const registration = input.extend({ role: z.enum(["owner", "shelter"]) });
type CredentialRecord = {
  identity: string;
  appRole: "owner" | "shelter";
  passwordHash: string;
  salt: string;
  token: string;
};
const failures = new Map<string, { count: number; until: number }>();
const pending = new Set<string>();
const dummySalt = "0".repeat(32);

async function hash(password: string, salt: string) {
  return (await scrypt(password, Buffer.from(salt, "hex"), 64)) as Buffer;
}

export async function registerCredentials(
  authorization: string | undefined,
  body: unknown,
) {
  const { username, password, role } = registration.parse(body);
  const actor = await authenticate(authorization);
  const requestKey = `register:${actor.id}`;
  if (pending.has(requestKey))
    throw new ApiError(429, "Sign-in update already in progress");
  pending.add(requestKey);
  try {
    const token = /^Bearer ([^\s]+)$/i.exec(authorization ?? "")?.[1];
    if (!token) throw new ApiError(401, "Sign in first");
    const salt = randomBytes(16).toString("hex");
    await actor.system.write("save_credentials", {
      username,
      identity: actor.id,
      appRole: role,
      token,
      salt,
      passwordHash: (await hash(password, salt)).toString("hex"),
    });
    return { username };
  } finally {
    pending.delete(requestKey);
  }
}

export async function signInCredentials(
  body: unknown,
  remoteAddress = "",
  store: Store = systemStore(),
) {
  const { username, password } = input.parse(body);
  const key = `${remoteAddress}:${username}`;
  const attempt = failures.get(key);
  if (attempt && attempt.count >= 5 && attempt.until > Date.now())
    throw new ApiError(
      429,
      "Too many sign-in attempts. Try again in 15 minutes.",
    );
  if (pending.has(key)) throw new ApiError(429, "Sign-in already in progress");
  pending.add(key);
  try {
    const record = await store.read<CredentialRecord | null>(
      "service_credentials",
      username,
    );
    const expected = Buffer.from(
      record?.passwordHash ?? "0".repeat(128),
      "hex",
    );
    const actual = await hash(password, record?.salt ?? dummySalt);
    if (
      !record ||
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      failures.set(key, {
        count: (attempt?.until ?? 0) > Date.now() ? attempt!.count + 1 : 1,
        until: Date.now() + 15 * 60_000,
      });
      throw new ApiError(401, "Incorrect username or password");
    }
    failures.delete(key);
    return { token: record.token, role: record.appRole };
  } finally {
    pending.delete(key);
  }
}
