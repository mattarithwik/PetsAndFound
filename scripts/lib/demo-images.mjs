/** Small attributed Oxford-IIIT Pet sample for the local simulated surge. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { upload } from '../../services/agent/dist/media.js';

export const DATASET_PAGE = 'https://www.robots.ox.ac.uk/~vgg/data/pets/';
export const DATASET_LICENSE = 'CC BY-SA 4.0';
export const DOG_REID_PAGE = 'https://doi.org/10.7910/DVN/LVTRLG';
export const DOG_REID_LICENSE = 'CC0 1.0';
const cache = resolve('.demo-images');
const rowsUrl = 'https://datasets-server.huggingface.co/rows?dataset=timm/oxford-iiit-pet&config=default&split=train&offset=0&length=100&revision=089695c834a7deb60505b7cc506672db1c31a6aa';

async function checkedFetch(url, expectedHost) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== expectedHost || parsed.port || parsed.username || parsed.password)
    throw new Error('Unexpected dataset image host.');
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok) throw new Error(`Dataset download failed (${response.status}).`);
  return response;
}

export async function datasetSample() {
  const response = await checkedFetch(rowsUrl, 'datasets-server.huggingface.co');
  const body = await response.json();
  const cats = [], dogs = [];
  for (const item of body.rows ?? []) {
    const row = item.row;
    if (!/^[A-Za-z_]+_\d+$/.test(row?.image_id ?? '') || !row?.image?.src) continue;
    const entry = { id: row.image_id, url: row.image.src, species: row.label_cat_dog === 0 ? 'cat' : 'dog' };
    if (entry.species === 'cat') cats.push(entry);
    else dogs.push(entry);
  }
  if (cats.length < 21 || dogs.length < 20) throw new Error('Dataset sample did not contain enough cats and dogs.');
  return { cats: cats.slice(0, 21), dogs: dogs.slice(0, 20) };
}

export async function imageBytes(entry) {
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const path = entry.localPath ?? resolve(cache, `${entry.id}.jpg`);
  if (entry.localPath && (!path.startsWith(resolve(cache, 'dogreid') + '/') || !/^[a-f0-9-]+\.jpg$/.test(path.split('/').at(-1))))
    throw new Error('Unexpected local demo image path.');
  let bytes;
  try { bytes = await readFile(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await checkedFetch(entry.url, 'datasets-server.huggingface.co');
    if (Number(response.headers.get('content-length') || 0) > 10_000_000) throw new Error('Dataset image is too large.');
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 10_000_000) throw new Error('Dataset image is too large.');
    await writeFile(path, bytes, { mode: 0o600 });
  }
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (bytes.length < 100 || (!jpeg && !png))
    throw new Error(`Dataset image ${entry.id} has an unsupported image format.`);
  return bytes;
}

export async function uploadDemoImage(identity, entry) {
  const bytes = await imageBytes(entry);
  const ticket = upload({ id: identity });
  const body = new FormData();
  for (const [key, value] of Object.entries(ticket.fields)) body.append(key, value);
  const png = bytes[0] === 137;
  body.append('file', new Blob([bytes], { type: png ? 'image/png' : 'image/jpeg' }), `${entry.id}.${png ? 'png' : 'jpg'}`);
  const response = await fetch(ticket.uploadUrl, { method: 'POST', body,
    signal: AbortSignal.timeout(60000), redirect: 'error' });
  if (!response.ok) throw new Error(`Cloudinary demo upload failed (${response.status}): ${(await response.text()).slice(0, 180)}`);
  const uploaded = await response.json();
  if (uploaded.public_id !== ticket.storageKey) throw new Error('Cloudinary returned a different storage key.');
  return { id: ticket.photoId, storageKey: ticket.storageKey, animalCount: 1, angle: 'other' };
}

export async function deleteDemoImage(storageKey) {
  if (!/^pawsafe\/[a-f0-9]{64}\/[a-zA-Z0-9_-]{1,128}$/.test(storageKey))
    throw new Error('Refusing to delete an image outside the demo photo key format.');
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) throw new Error('Cloudinary credentials are required for image cleanup.');
  const body = new URLSearchParams({ public_id: storageKey, type: 'authenticated', invalidate: 'true' });
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/destroy`, {
    method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded' }, body,
    signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  if (!response.ok || (await response.json()).result !== 'ok')
    throw new Error(`Could not remove demo image ${storageKey}.`);
}
