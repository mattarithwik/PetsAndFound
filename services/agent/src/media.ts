import { createHash, randomUUID } from "node:crypto";
import { ApiError, setting, type Actor, type Photo } from "./db.js";

const photoLimit = 8 * 1024 * 1024;
function cloud() {
  return (
    "https://api.cloudinary.com/v1_1/" + encodeURIComponent(setting("CLOUDINARY_CLOUD_NAME")) + "/image/"
  );
}
function signed<T extends Record<string, string>>(params: T) {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => k + "=" + params[k])
    .join("&");
  return {
    ...params,
    api_key: setting("CLOUDINARY_API_KEY"),
    signature: createHash("sha256")
      .update(canonical + setting("CLOUDINARY_API_SECRET"))
      .digest("hex"),
  };
}
export function upload(actor: Actor) {
  const photoId = randomUUID();
  const storageKey = `pawsafe/${actor.id}/${photoId}`;
  const fields = signed({
    type: "authenticated",
    public_id: storageKey,
    timestamp: String(Math.floor(Date.now() / 1000)),
    overwrite: "false",
    format: "jpg",
    allowed_formats: "jpg,jpeg,png,webp",
  });
  return { photoId, storageKey, uploadUrl: cloud() + "upload", fields };
}
export function downloadUrl(key: string) {
  if (!/^pawsafe\/[a-f\d]{64}\/[a-zA-Z0-9_-]{1,128}$/.test(key))
    throw new ApiError(422, "Invalid photo storage key");
  const now = Math.floor(Date.now() / 1000);
  return (
    cloud() +
    "download?" +
    new URLSearchParams(
      signed({
        type: "authenticated",
        public_id: key,
        format: "jpg",
        timestamp: String(now),
        expires_at: String(now + 120),
      }),
    )
  );
}
export async function getPhotoUrl(actor: Actor, id: string) {
  const photo = await actor.db.read<Photo | null>("photo", id);
  if (!photo) throw new ApiError(404, "Photo not found");
  return { url: downloadUrl(photo.storageKey), expiresIn: 120 };
}
export async function readImage(url: string, allowedHosts: Set<string>) {
  const timeout = AbortSignal.timeout(20000);
  for (let hop = 0; hop < 4; hop++) {
    const target = new URL(url);
    if (
      target.protocol !== "https:" ||
      target.port ||
      target.username ||
      target.password ||
      !allowedHosts.has(target.hostname)
    )
      throw new ApiError(422, "Image host is not permitted");
    const response = await fetch(target, { signal: timeout, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) break;
      url = new URL(location, target).href;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new ApiError(502, "Image is unavailable");
    }
    if (Number(response.headers.get("content-length") || 0) > photoLimit) {
      await response.body.cancel();
      throw new ApiError(413, "Photo exceeds 8 MiB");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > photoLimit) {
        await reader.cancel();
        throw new ApiError(413, "Photo exceeds 8 MiB");
      }
      chunks.push(part.value);
    }
    return Buffer.concat(chunks).toString("base64");
  }
  throw new ApiError(502, "Image redirect could not be resolved");
}
