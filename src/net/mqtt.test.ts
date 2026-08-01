import { describe, expect, it } from 'vitest';
import {
  PACKET_CONNECT,
  PACKET_PINGREQ,
  PACKET_PUBLISH,
  PACKET_SUBSCRIBE,
  concatBytes,
  decodeLength,
  decodePackets,
  encodeConnect,
  encodeDisconnect,
  encodePingReq,
  encodePublish,
  encodeSubscribe,
  encodeLength,
} from './mqtt';

/** Build a packet the way a broker would, so decoding is tested against real shapes. */
function serverPacket(type: number, flags: number, body: number[]): Uint8Array {
  return Uint8Array.from([(type << 4) | flags, ...encodeLength(body.length), ...body]);
}

function stringBytes(value: string): number[] {
  const bytes = new TextEncoder().encode(value);
  return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
}

describe('remaining length', () => {
  it('uses one byte below 128', () => {
    expect(encodeLength(0)).toEqual([0x00]);
    expect(encodeLength(127)).toEqual([0x7f]);
  });

  it('continues into further bytes at the documented boundaries', () => {
    expect(encodeLength(128)).toEqual([0x80, 0x01]);
    expect(encodeLength(16383)).toEqual([0xff, 0x7f]);
    expect(encodeLength(16384)).toEqual([0x80, 0x80, 0x01]);
  });

  it('round trips through the decoder', () => {
    for (const value of [0, 1, 127, 128, 300, 16383, 16384, 200000]) {
      const bytes = Uint8Array.from(encodeLength(value));
      expect(decodeLength(bytes, 0)).toEqual({ value, bytesUsed: bytes.length });
    }
  });

  it('reports an incomplete length rather than guessing', () => {
    expect(decodeLength(Uint8Array.from([0x80]), 0)).toBeNull();
    expect(decodeLength(new Uint8Array(0), 0)).toBeNull();
  });
});

describe('outgoing packets', () => {
  it('builds a CONNECT that declares MQTT 3.1.1 with a clean session', () => {
    const bytes = encodeConnect('abc', 45);
    expect(bytes[0] >> 4).toBe(PACKET_CONNECT);
    const body = bytes.subarray(2);
    expect([...body.subarray(0, 6)]).toEqual([0, 4, 0x4d, 0x51, 0x54, 0x54]); // "MQTT"
    expect(body[6]).toBe(4); // protocol level
    expect(body[7]).toBe(0x02); // clean session
    expect((body[8] << 8) | body[9]).toBe(45); // keepalive
    expect([...body.subarray(10)]).toEqual(stringBytes('abc'));
  });

  it('sets the required flag bit on SUBSCRIBE and asks for QoS 0', () => {
    const bytes = encodeSubscribe(7, 'quads/v1/ABC234/state/+');
    expect(bytes[0]).toBe((PACKET_SUBSCRIBE << 4) | 0x02);
    const body = bytes.subarray(2);
    expect((body[0] << 8) | body[1]).toBe(7);
    expect([...body.subarray(2, body.length - 1)]).toEqual(stringBytes('quads/v1/ABC234/state/+'));
    expect(body[body.length - 1]).toBe(0x00);
  });

  it('marks the retain flag on PUBLISH only when asked', () => {
    expect(encodePublish('t', 'x', true)[0]).toBe((PACKET_PUBLISH << 4) | 0x01);
    expect(encodePublish('t', 'x', false)[0]).toBe(PACKET_PUBLISH << 4);
  });

  it('encodes a long payload with a multi byte length', () => {
    const payload = 'x'.repeat(500);
    const bytes = encodePublish('topic', payload, true);
    const length = decodeLength(bytes, 1);
    expect(length?.value).toBe(2 + 5 + 500);
    expect(bytes.length).toBe(1 + (length?.bytesUsed ?? 0) + (length?.value ?? 0));
  });

  it('sends bare ping and disconnect packets', () => {
    expect([...encodePingReq()]).toEqual([PACKET_PINGREQ << 4, 0x00]);
    expect([...encodeDisconnect()]).toEqual([0xe0, 0x00]);
  });
});

describe('incoming packets', () => {
  it('reads a CONNACK return code', () => {
    const { packets } = decodePackets(serverPacket(2, 0, [0x00, 0x00]));
    expect(packets).toEqual([{ type: 'connack', returnCode: 0 }]);
    const refused = decodePackets(serverPacket(2, 0, [0x00, 0x05]));
    expect(refused.packets).toEqual([{ type: 'connack', returnCode: 5 }]);
  });

  it('reads a QoS 0 publish, including the retain flag', () => {
    const body = [...stringBytes('quads/v1/AB23/state/light'), ...new TextEncoder().encode('{"a":1}')];
    const { packets, rest } = decodePackets(serverPacket(3, 0x01, body));
    expect(rest).toHaveLength(0);
    expect(packets).toEqual([
      {
        type: 'publish',
        publish: { topic: 'quads/v1/AB23/state/light', payload: '{"a":1}', retain: true },
      },
    ]);
  });

  it('skips the packet identifier on a QoS 1 publish', () => {
    const body = [...stringBytes('t'), 0x00, 0x09, ...new TextEncoder().encode('hi')];
    const { packets } = decodePackets(serverPacket(3, 0x02, body));
    expect(packets[0]).toEqual({
      type: 'publish',
      publish: { topic: 't', payload: 'hi', retain: false },
    });
  });

  it('handles several packets arriving in one message', () => {
    const stream = concatBytes(
      serverPacket(9, 0, [0x00, 0x01, 0x00]),
      concatBytes(
        serverPacket(13, 0, []),
        serverPacket(3, 0, [...stringBytes('t'), ...new TextEncoder().encode('x')]),
      ),
    );
    const { packets, rest } = decodePackets(stream);
    expect(packets.map((p) => p.type)).toEqual(['suback', 'pingresp', 'publish']);
    expect(rest).toHaveLength(0);
  });

  it('keeps a split packet back until the rest arrives', () => {
    const full = serverPacket(3, 0, [...stringBytes('t'), ...new TextEncoder().encode('hello')]);
    const first = decodePackets(full.subarray(0, 4));
    expect(first.packets).toHaveLength(0);
    expect(first.rest).toHaveLength(4);

    const joined = concatBytes(first.rest, full.subarray(4));
    const second = decodePackets(joined);
    expect(second.packets).toHaveLength(1);
    expect(second.rest).toHaveLength(0);
  });

  it('reports unknown packet types instead of throwing', () => {
    const { packets } = decodePackets(serverPacket(11, 0, [0x00]));
    expect(packets).toEqual([{ type: 'other', packetType: 11 }]);
  });

  it('survives a truncated or empty stream', () => {
    expect(decodePackets(new Uint8Array(0)).packets).toEqual([]);
    expect(decodePackets(Uint8Array.from([0x30])).packets).toEqual([]);
  });
});
