import { createHash } from "node:crypto";
import type { Store } from "./db.js";
import { getWeatherAlerts } from "./providers/index.js";

type Location = { ownerId: string; latitude: number; longitude: number };

export async function pollSubscribedAlerts(store: Store, offset = 0) {
  const locations = await store.read<Location[]>("service_alert_locations");
  if (!locations.length) return 0;
  const batch = Array.from({ length: Math.min(25, locations.length) }, (_, i) => locations[(offset + i) % locations.length]);
  const groups = new Map<string, Location[]>();
  for (const location of batch) {
    const key = `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`;
    groups.set(key, [...(groups.get(key) ?? []), location]);
  }
  for (const group of groups.values()) {
    const point = group[0];
    try {
      const response = await getWeatherAlerts({ latitude: point.latitude, longitude: point.longitude });
      for (const alert of response.items) {
        await store.write("upsert_disaster_alert", alert);
        for (const owner of group) {
          const hash = createHash("sha256").update(owner.ownerId + "\0" + alert.alertId).digest("hex");
          await store.write("create_notification", { id: "weather-" + hash, recipientId: owner.ownerId,
            eventType: "DISASTER_ALERT", payload: { alertId: alert.alertId, event: alert.event, expiresAt: alert.expiresAt } });
        }
      }
    } catch { /* One unavailable NWS point must not block other subscribed areas. */ }
  }
  return (offset + batch.length) % locations.length;
}
