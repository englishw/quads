import type { Player } from '../engine/types';
import type { Snapshot } from '../state/snapshot';
import { openMqtt, type MqttConnection, type MqttPublish } from './mqtt';

/**
 * Two-screen play relays game state through public MQTT brokers over WebSockets.
 *
 * This replaced a direct WebRTC connection, which could not reach a player on a
 * mobile network: carrier-grade NAT is typically symmetric, so the two browsers
 * exchanged connection details successfully and then failed to open a direct path.
 * Fixing that properly needs a TURN relay, which means depending on a third party
 * anyway, to prop up a transport whose only advantage - low latency - is worthless
 * in a turn-based game where a whole game state is about a kilobyte.
 *
 * A broker connection is an ordinary outbound WebSocket, so NAT never comes into
 * it. Two further benefits fall out of using MQTT:
 *
 *  - Each side publishes its state as a *retained* message, so the broker holds the
 *    latest position. A player who reloads, or who opens the link hours later, gets
 *    the current board immediately and both players need not be online together.
 *  - The retain flag on an incoming message tells us whether we are hearing a live
 *    opponent or reading stored state, which is how presence is detected without
 *    relying on the two devices' clocks agreeing.
 *
 * Several brokers are used at once for redundancy. Duplicate messages are harmless
 * because game states are compared, not applied blindly.
 */
const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
] as const;

const TOPIC_ROOT = 'quads/v1';
/** Republish this often so the other side can tell we are still here. */
const HEARTBEAT_MS = 7000;
/** Treat the opponent as gone if nothing live has arrived for this long. */
export const PRESENCE_WINDOW_MS = 25000;
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 30000;

export type RelayStatus = 'idle' | 'connecting' | 'waiting' | 'connected' | 'error';

export interface StatePayload {
  seat: Player;
  snapshot: Snapshot;
}

interface RelayMessage extends StatePayload {
  /** Identifies the sending tab so we ignore our own messages. */
  client: string;
}

export interface RelayHooks {
  onStatus: (status: RelayStatus, detail?: string) => void;
  onPayload: (payload: StatePayload) => void;
  /** Called whenever we publish, to get the latest state. */
  getPayload: () => StatePayload;
}

export interface RelaySession {
  readonly gameId: string;
  broadcast: () => void;
  leave: () => void;
}

export function stateTopic(gameId: string, seat: Player): string {
  return `${TOPIC_ROOT}/${gameId}/state/${seat}`;
}

export function stateFilter(gameId: string): string {
  return `${TOPIC_ROOT}/${gameId}/state/+`;
}

/** Pure status rule, kept separate so it can be tested without a network. */
export function deriveStatus(input: {
  online: number;
  failed: number;
  total: number;
  opponentPresent: boolean;
}): RelayStatus {
  if (input.online > 0) return input.opponentPresent ? 'connected' : 'waiting';
  if (input.failed >= input.total) return 'error';
  return 'connecting';
}

export function isPresent(lastSeenAt: number, now: number, windowMs = PRESENCE_WINDOW_MS): boolean {
  return lastSeenAt > 0 && now - lastSeenAt < windowMs;
}

export function reconnectDelay(attempts: number): number {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.max(1, attempts));
}

export function parseRelayMessage(raw: string): RelayMessage | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null) return null;
    const message = value as Record<string, unknown>;
    if (typeof message.client !== 'string') return null;
    if (message.seat !== 'light' && message.seat !== 'dark') return null;
    if (typeof message.snapshot !== 'object' || message.snapshot === null) return null;
    // The snapshot itself is validated by the caller before it is trusted.
    return message as unknown as RelayMessage;
  } catch {
    return null;
  }
}

interface Link {
  online: boolean;
  failed: boolean;
  attempts: number;
  connection: MqttConnection | null;
  retry: ReturnType<typeof setTimeout> | null;
}

export async function connectRelay(gameId: string, hooks: RelayHooks): Promise<RelaySession> {
  hooks.onStatus('connecting');

  const clientId = `q${Math.random().toString(36).slice(2, 10)}`;
  const filter = stateFilter(gameId);
  const links: Link[] = BROKERS.map(() => ({
    online: false,
    failed: false,
    attempts: 0,
    connection: null,
    retry: null,
  }));
  let opponentSeenAt = 0;
  let lastStatus: RelayStatus | null = null;
  let closed = false;

  function pushStatus(detail?: string): void {
    const status = deriveStatus({
      online: links.filter((link) => link.online).length,
      failed: links.filter((link) => link.failed).length,
      total: links.length,
      opponentPresent: isPresent(opponentSeenAt, Date.now()),
    });
    if (status === lastStatus && !detail) return;
    lastStatus = status;
    hooks.onStatus(status, detail);
  }

  function publishTo(link: Link): void {
    if (closed || !link.online || !link.connection) return;
    const payload = hooks.getPayload();
    const message: RelayMessage = {
      client: clientId,
      seat: payload.seat,
      snapshot: payload.snapshot,
    };
    link.connection.publish(stateTopic(gameId, payload.seat), JSON.stringify(message), true);
  }

  function publishAll(): void {
    for (const link of links) publishTo(link);
  }

  function handleIncoming(incoming: MqttPublish): void {
    const message = parseRelayMessage(incoming.payload);
    if (!message || message.client === clientId) return;
    // A retained message is stored state, not evidence that anyone is there now.
    if (!incoming.retain) opponentSeenAt = Date.now();
    hooks.onPayload({ seat: message.seat, snapshot: message.snapshot });
    pushStatus();
  }

  function openLink(index: number): void {
    if (closed) return;
    const link = links[index];
    link.connection = openMqtt(
      BROKERS[index],
      { clientId: `${clientId}${index}`, keepaliveSeconds: 45, connectTimeoutMs: 10000 },
      {
        onReady: () => {
          link.online = true;
          link.failed = false;
          link.attempts = 0;
          link.connection?.subscribe(filter);
          publishTo(link);
          pushStatus();
        },
        onPublish: handleIncoming,
        onClosed: (reason) => {
          link.online = false;
          link.failed = true;
          link.connection = null;
          const allFailed = links.every((other) => other.failed);
          pushStatus(allFailed ? (reason ?? 'no broker reachable') : undefined);
          if (closed) return;
          link.attempts += 1;
          link.retry = setTimeout(() => openLink(index), reconnectDelay(link.attempts));
        },
      },
    );
  }

  links.forEach((_link, index) => openLink(index));

  const heartbeat = setInterval(() => {
    publishAll();
    // Also re-evaluates presence, so a silent opponent eventually shows as away.
    pushStatus();
  }, HEARTBEAT_MS);

  return {
    gameId,
    broadcast: publishAll,
    leave: () => {
      closed = true;
      clearInterval(heartbeat);
      const seat = hooks.getPayload().seat;
      for (const link of links) {
        if (link.retry) clearTimeout(link.retry);
        if (link.online && link.connection) {
          // Clearing our retained state stops a stale position being served to
          // anyone who opens this code later.
          link.connection.publish(stateTopic(gameId, seat), '', true);
        }
        link.connection?.close();
        link.connection = null;
        link.online = false;
      }
      hooks.onStatus('idle');
    },
  };
}
