/**
 * A very small MQTT 3.1.1 client over WebSockets.
 *
 * The game only needs to connect, subscribe to one filter, publish retained
 * messages and answer keepalives. A full MQTT library is 365 kB, which is ten
 * times the size of the entire game, and it would be downloaded over exactly the
 * mobile connection we are trying to support. The packet format is simple and
 * fully specified, so the few packet types we need are encoded here instead.
 *
 * Everything except `openMqtt` is a pure function, so the wire format is covered
 * by unit tests rather than trusted.
 */

const PROTOCOL_NAME = 'MQTT';
const PROTOCOL_LEVEL = 4;
const CLEAN_SESSION = 0x02;

export const PACKET_CONNECT = 1;
export const PACKET_CONNACK = 2;
export const PACKET_PUBLISH = 3;
export const PACKET_SUBSCRIBE = 8;
export const PACKET_SUBACK = 9;
export const PACKET_PINGREQ = 12;
export const PACKET_PINGRESP = 13;
export const PACKET_DISCONNECT = 14;

export interface MqttPublish {
  topic: string;
  payload: string;
  retain: boolean;
}

export type MqttPacket =
  | { type: 'connack'; returnCode: number }
  | { type: 'suback' }
  | { type: 'pingresp' }
  | { type: 'publish'; publish: MqttPublish }
  | { type: 'other'; packetType: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** MQTT "remaining length": 7 bits per byte, high bit marks continuation. */
export function encodeLength(value: number): number[] {
  if (value < 0) throw new Error('negative length');
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0 && bytes.length < 4);
  return bytes;
}

export function decodeLength(
  bytes: Uint8Array,
  offset: number,
): { value: number; bytesUsed: number } | null {
  let value = 0;
  let multiplier = 1;
  for (let i = 0; i < 4; i += 1) {
    const index = offset + i;
    if (index >= bytes.length) return null;
    const byte = bytes[index];
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return { value, bytesUsed: i + 1 };
    multiplier *= 128;
  }
  return null;
}

function encodeStringBytes(value: string): number[] {
  const bytes = encoder.encode(value);
  if (bytes.length > 0xffff) throw new Error('string too long for MQTT');
  return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
}

function packet(type: number, flags: number, body: number[]): Uint8Array {
  return Uint8Array.from([(type << 4) | flags, ...encodeLength(body.length), ...body]);
}

export function encodeConnect(clientId: string, keepaliveSeconds: number): Uint8Array {
  const body = [
    ...encodeStringBytes(PROTOCOL_NAME),
    PROTOCOL_LEVEL,
    CLEAN_SESSION,
    keepaliveSeconds >> 8,
    keepaliveSeconds & 0xff,
    ...encodeStringBytes(clientId),
  ];
  return packet(PACKET_CONNECT, 0, body);
}

export function encodeSubscribe(packetId: number, topicFilter: string): Uint8Array {
  const body = [packetId >> 8, packetId & 0xff, ...encodeStringBytes(topicFilter), 0x00];
  // Bit 1 of the flags nibble is required to be set on SUBSCRIBE.
  return packet(PACKET_SUBSCRIBE, 0x02, body);
}

/** QoS 0 only, which needs no packet identifier and expects no acknowledgement. */
export function encodePublish(topic: string, payload: string, retain: boolean): Uint8Array {
  const body = [...encodeStringBytes(topic), ...encoder.encode(payload)];
  return packet(PACKET_PUBLISH, retain ? 0x01 : 0x00, body);
}

export function encodePingReq(): Uint8Array {
  return packet(PACKET_PINGREQ, 0, []);
}

export function encodeDisconnect(): Uint8Array {
  return packet(PACKET_DISCONNECT, 0, []);
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Pull whole packets out of a byte stream. A WebSocket message is not guaranteed
 * to align with packet boundaries, so leftover bytes are returned for next time.
 */
export function decodePackets(bytes: Uint8Array): { packets: MqttPacket[]; rest: Uint8Array } {
  const packets: MqttPacket[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    const header = bytes[offset];
    const length = decodeLength(bytes, offset + 1);
    if (!length) break;
    const bodyStart = offset + 1 + length.bytesUsed;
    const bodyEnd = bodyStart + length.value;
    if (bodyEnd > bytes.length) break;

    const packetType = header >> 4;
    const flags = header & 0x0f;
    const body = bytes.subarray(bodyStart, bodyEnd);

    if (packetType === PACKET_CONNACK) {
      packets.push({ type: 'connack', returnCode: body.length > 1 ? body[1] : 0xff });
    } else if (packetType === PACKET_SUBACK) {
      packets.push({ type: 'suback' });
    } else if (packetType === PACKET_PINGRESP) {
      packets.push({ type: 'pingresp' });
    } else if (packetType === PACKET_PUBLISH) {
      const qos = (flags >> 1) & 0x03;
      if (body.length >= 2) {
        const topicLength = (body[0] << 8) | body[1];
        let cursor = 2 + topicLength;
        const topic = decoder.decode(body.subarray(2, cursor));
        // A packet identifier is only present above QoS 0.
        if (qos > 0) cursor += 2;
        packets.push({
          type: 'publish',
          publish: {
            topic,
            payload: decoder.decode(body.subarray(cursor)),
            retain: (flags & 0x01) === 0x01,
          },
        });
      }
    } else {
      packets.push({ type: 'other', packetType });
    }

    offset = bodyEnd;
  }

  return { packets, rest: bytes.subarray(offset) };
}

export interface MqttHandlers {
  onReady: () => void;
  onPublish: (publish: MqttPublish) => void;
  onClosed: (reason?: string) => void;
}

export interface MqttConnection {
  publish: (topic: string, payload: string, retain: boolean) => void;
  subscribe: (topicFilter: string) => void;
  close: () => void;
}

export function openMqtt(
  url: string,
  options: { clientId: string; keepaliveSeconds?: number; connectTimeoutMs?: number },
  handlers: MqttHandlers,
): MqttConnection {
  const keepaliveSeconds = options.keepaliveSeconds ?? 45;
  const socket = new WebSocket(url, 'mqtt');
  socket.binaryType = 'arraybuffer';

  // Annotated because the byte views handed to us by the socket are not tied to a
  // plain ArrayBuffer, and the stream buffer has to accept either.
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let ready = false;
  let done = false;
  let packetId = 1;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const connectTimer = setTimeout(() => {
    if (!ready) finish('connect timed out');
  }, options.connectTimeoutMs ?? 10000);

  function finish(reason?: string): void {
    if (done) return;
    done = true;
    clearTimeout(connectTimer);
    if (pingTimer !== undefined) clearInterval(pingTimer);
    try {
      socket.close();
    } catch {
      /* Already closing. */
    }
    handlers.onClosed(reason);
  }

  function send(bytes: Uint8Array): void {
    if (done || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(bytes);
    } catch {
      finish('send failed');
    }
  }

  socket.onopen = () => send(encodeConnect(options.clientId, keepaliveSeconds));

  socket.onmessage = (event) => {
    const data = event.data;
    if (!(data instanceof ArrayBuffer)) return;
    buffer = concatBytes(buffer, new Uint8Array(data));
    const { packets, rest } = decodePackets(buffer);
    buffer = rest;
    for (const item of packets) {
      if (item.type === 'connack') {
        if (item.returnCode === 0) {
          ready = true;
          clearTimeout(connectTimer);
          // Keepalives are sent at half the negotiated interval.
          pingTimer = setInterval(() => send(encodePingReq()), (keepaliveSeconds / 2) * 1000);
          handlers.onReady();
        } else {
          finish(`broker refused the connection (code ${item.returnCode})`);
        }
      } else if (item.type === 'publish') {
        handlers.onPublish(item.publish);
      }
    }
  };

  socket.onerror = () => finish('connection error');
  socket.onclose = () => finish(ready ? undefined : 'connection closed before ready');

  return {
    publish: (topic, payload, retain) => {
      if (ready) send(encodePublish(topic, payload, retain));
    },
    subscribe: (topicFilter) => {
      if (!ready) return;
      const id = packetId;
      packetId = (packetId % 0xffff) + 1;
      send(encodeSubscribe(id, topicFilter));
    },
    close: () => {
      if (ready) send(encodeDisconnect());
      finish();
    },
  };
}
