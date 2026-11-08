import type { Store } from "./db.js";

type Pending = { notificationId: string; deviceId: string; token: string; eventType: string; payload: Record<string, unknown> };
type Receipt = { notificationId: string; deviceId: string; ticketId: string };
type ExpoResult = { data?: { status: string; id?: string; details?: { error?: string } }[] | { status: string; id?: string; details?: { error?: string } } };

const titles: Record<string, string> = {
  POSSIBLE_PET_MATCH: "Possible pet match", MATCH_CONFIRMED: "Pet match confirmed",
  DISASTER_ALERT: "Official weather alert", SHELTER_CASE_ASSIGNED: "Shelter case update",
  REPORT_STATUS_CHANGED: "Report status updated", CASE_MESSAGE: "New case message",
  RESPONSE_PLAN_READY: "Response plan ready",
  URGENT_CASE: "Urgent animal report nearby", CASE_OVERDUE: "Case needs attention",
  MATCH_MESSAGE: "New match message",
};

export async function deliverPush(store: Store) {
  const pending = await store.read<Pending[]>("service_pending_push");
  if (pending.length) {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(pending.map((item) => ({ to: item.token, title: titles[item.eventType] ?? "PawSafe update",
        body: item.eventType === "DISASTER_ALERT" && typeof item.payload.event === "string" ? item.payload.event.slice(0, 120) : "Open PawSafe for details.",
        data: { notificationId: item.notificationId }, sound: "default", channelId: "pawsafe-updates" }))),
    });
    if (!response.ok) throw new Error(`Expo push request failed (${response.status})`);
    const raw = await response.json() as ExpoResult;
    const tickets = Array.isArray(raw.data) ? raw.data : raw.data ? [raw.data] : [];
    if (tickets.length !== pending.length) throw new Error("Expo push ticket count did not match request");
    for (const [index, ticket] of tickets.entries()) {
      if (ticket.status !== "ok" && ticket.details?.error !== "DeviceNotRegistered") continue;
      await store.write("record_push_delivery", { notificationId: pending[index].notificationId,
        deviceId: pending[index].deviceId, status: ticket.status === "ok" ? "accepted" : "failed",
        ticketId: ticket.id ?? "", deviceNotRegistered: ticket.details?.error === "DeviceNotRegistered" });
    }
  }
  const receipts = await store.read<Receipt[]>("service_push_receipts");
  if (!receipts.length) return;
  const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
    method: "POST", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: receipts.map((r) => r.ticketId) }),
  });
  if (!response.ok) throw new Error(`Expo receipt request failed (${response.status})`);
  const body = await response.json() as { data?: Record<string, { status: string; details?: { error?: string } }> };
  for (const row of receipts) {
    const receipt = body.data?.[row.ticketId];
    if (!receipt) continue;
    await store.write("record_push_delivery", { notificationId: row.notificationId, deviceId: row.deviceId,
      status: receipt.status === "ok" ? "delivered" : "failed", ticketId: row.ticketId,
      deviceNotRegistered: receipt.details?.error === "DeviceNotRegistered" });
  }
}
