import { action, now, num, sender } from "./common";

export const set_alert_location = action((ctx, p) => {
  const row = { ownerId: sender(ctx), latitude: num(p, "latitude", -90, 90), longitude: num(p, "longitude", -180, 180), updatedAt: now(ctx) };
  if (!ctx.db.users.id.find(row.ownerId)) throw new Error("Profile required");
  if (ctx.db.alertLocations.ownerId.find(row.ownerId)) ctx.db.alertLocations.ownerId.update(row);
  else ctx.db.alertLocations.insert(row);
});

export const remove_alert_location = action((ctx) => {
  ctx.db.alertLocations.ownerId.delete(sender(ctx));
});
