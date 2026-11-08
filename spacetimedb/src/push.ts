import { action, choice, fail, id, now, sender, service, str, user } from "./common";

export const register_push_device = action((ctx, p) => {
  user(ctx);
  const deviceId = id(p, "deviceId"), token = str(p, "token", 256);
  if (!/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/.test(token)) fail("Invalid Expo push token");
  const old = ctx.db.pushDevices.id.find(deviceId);
  if (old && old.ownerId !== sender(ctx)) fail("Device ID already in use");
  const row = { id: deviceId, ownerId: sender(ctx), token };
  if (old) ctx.db.pushDevices.id.update(row);
  else ctx.db.pushDevices.insert(row);
});

export const unregister_push_device = action((ctx, p) => {
  const row = ctx.db.pushDevices.id.find(id(p, "deviceId"));
  if (!row || row.ownerId !== sender(ctx)) fail("Device not found");
  ctx.db.pushDevices.id.delete(row.id);
});

export const record_push_delivery = action((ctx, p) => {
  service(ctx);
  const notificationId = str(p, "notificationId", 1024), deviceId = id(p, "deviceId");
  if (!ctx.db.notifications.id.find(notificationId) || !ctx.db.pushDevices.id.find(deviceId))
    fail("Notification or device not found");
  const row = { id: notificationId + ":" + deviceId, notificationId, deviceId,
    status: choice(p, "status", ["accepted", "delivered", "failed"]),
    ticketId: str(p, "ticketId", 256, false), updatedAt: now(ctx) };
  if (ctx.db.pushDeliveries.id.find(row.id)) ctx.db.pushDeliveries.id.update(row);
  else ctx.db.pushDeliveries.insert(row);
  if (p.deviceNotRegistered === true) ctx.db.pushDevices.id.delete(deviceId);
});
