import { config } from './config';

const tables = [
  'my_notifications',
  'my_profile',
  'my_staff_roles',
  'my_shelter_verifications',
  'my_cases',
  'my_available_cases',
  'my_matches',
  'my_reports',
  'my_pets',
  'my_pet_photos',
  'my_report_photos',
  'report_summaries',
  'shelters',
] as const;

export type LiveTable = (typeof tables)[number];
type Listener = (changed: ReadonlySet<string>) => void;
type Update = { tables: { table_name: string }[] };
type Message = {
  InitialSubscription?: unknown;
  TransactionUpdateLight?: { update: Update };
  TransactionUpdate?: { status: { Committed?: Update } };
  SubscriptionError?: unknown;
};

const listeners = new Set<Listener>();

export function watchTables(onChange: Listener) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** A single authenticated socket invalidates the same permission-checked reads used on reconnect. */
export function startRealtime(token: string, onChange: Listener) {
  let stopped = false;
  let retryDelay = 1000;
  let timer: ReturnType<typeof setTimeout>;
  let socket: WebSocket | undefined;
  const cancel = new AbortController();

  const retry = () => {
    if (stopped) return;
    timer = setTimeout(connect, retryDelay);
    retryDelay = Math.min(30000, retryDelay * 2);
  };

  async function connect() {
    try {
      const response = await fetch(config.spacetimeUrl + '/v1/identity/websocket-token', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        signal: cancel.signal,
      });
      if (!response.ok) return retry();
      const ticket = (await response.json()) as { token: string };
      if (stopped) return;
      const url = new URL(config.spacetimeUrl + '/v1/database/' + encodeURIComponent(config.database) + '/subscribe');
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('token', ticket.token);
      url.searchParams.set('light', 'true');
      const ws = new WebSocket(url.toString(), 'v1.json.spacetimedb');
      socket = ws;
      ws.onopen = () => {
        if (!stopped)
          ws.send(JSON.stringify({ Subscribe: { request_id: 1, query_strings: tables.map((name) => 'SELECT * FROM ' + name) } }));
      };
      ws.onmessage = ({ data }) => {
        if (stopped || typeof data !== 'string') return;
        let message: Message;
        try {
          message = JSON.parse(data);
        } catch {
          return;
        }
        if (message.SubscriptionError) return ws.close();
        const update = message.TransactionUpdateLight?.update ?? message.TransactionUpdate?.status.Committed;
        if (!message.InitialSubscription && !update) return;
        retryDelay = 1000;
        const changed = new Set<string>(message.InitialSubscription ? tables : update!.tables.map((t) => t.table_name));
        onChange(changed);
        for (const listener of listeners) listener(changed);
      };
      ws.onerror = () => ws.close();
      ws.onclose = retry;
    } catch {
      retry();
    }
  }
  void connect();
  return () => {
    stopped = true;
    cancel.abort();
    clearTimeout(timer);
    socket?.close();
  };
}
