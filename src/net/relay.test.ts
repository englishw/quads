import { describe, expect, it } from 'vitest';
import {
  PRESENCE_WINDOW_MS,
  deriveStatus,
  isPresent,
  parseRelayMessage,
  reconnectDelay,
  stateFilter,
  stateTopic,
} from './relay';

describe('relay topics', () => {
  it('gives each seat its own topic under the game code', () => {
    expect(stateTopic('ABC234', 'light')).toBe('quads/v1/ABC234/state/light');
    expect(stateTopic('ABC234', 'dark')).toBe('quads/v1/ABC234/state/dark');
  });

  it('subscribes to both seats with one filter', () => {
    expect(stateFilter('ABC234')).toBe('quads/v1/ABC234/state/+');
  });
});

describe('status', () => {
  it('is connecting until a broker answers', () => {
    expect(deriveStatus({ online: 0, failed: 0, total: 3, opponentPresent: false })).toBe(
      'connecting',
    );
    expect(deriveStatus({ online: 0, failed: 2, total: 3, opponentPresent: false })).toBe(
      'connecting',
    );
  });

  it('only reports an error when every broker has failed', () => {
    expect(deriveStatus({ online: 0, failed: 3, total: 3, opponentPresent: false })).toBe('error');
  });

  it('waits once connected but alone, and connects when the opponent is live', () => {
    expect(deriveStatus({ online: 1, failed: 2, total: 3, opponentPresent: false })).toBe('waiting');
    expect(deriveStatus({ online: 1, failed: 2, total: 3, opponentPresent: true })).toBe('connected');
  });

  it('prefers a working broker over failures elsewhere', () => {
    expect(deriveStatus({ online: 2, failed: 1, total: 3, opponentPresent: true })).toBe('connected');
  });
});

describe('presence', () => {
  it('treats never-heard-from as absent', () => {
    expect(isPresent(0, 10_000)).toBe(false);
  });

  it('holds presence for the window, then drops it', () => {
    const now = 1_000_000;
    expect(isPresent(now - 1000, now)).toBe(true);
    expect(isPresent(now - (PRESENCE_WINDOW_MS - 1), now)).toBe(true);
    expect(isPresent(now - PRESENCE_WINDOW_MS, now)).toBe(false);
    expect(isPresent(now - PRESENCE_WINDOW_MS * 2, now)).toBe(false);
  });
});

describe('reconnect backoff', () => {
  it('backs off with each attempt but stays bounded', () => {
    expect(reconnectDelay(0)).toBe(3000);
    expect(reconnectDelay(1)).toBe(3000);
    expect(reconnectDelay(3)).toBe(9000);
    expect(reconnectDelay(50)).toBe(30000);
  });
});

describe('message parsing', () => {
  const valid = JSON.stringify({
    client: 'abc',
    seat: 'light',
    snapshot: { version: 1, gameId: 'ABC234', epoch: 0, mode: 'remote', seat: 'light', options: {}, moves: [] },
  });

  it('accepts a well formed message', () => {
    const parsed = parseRelayMessage(valid);
    expect(parsed?.client).toBe('abc');
    expect(parsed?.seat).toBe('light');
  });

  it('rejects anything malformed', () => {
    expect(parseRelayMessage('')).toBeNull();
    expect(parseRelayMessage('not json')).toBeNull();
    expect(parseRelayMessage('[]')).toBeNull();
    expect(parseRelayMessage(JSON.stringify({ seat: 'light', snapshot: {} }))).toBeNull();
    expect(parseRelayMessage(JSON.stringify({ client: 'a', seat: 'green', snapshot: {} }))).toBeNull();
    expect(parseRelayMessage(JSON.stringify({ client: 'a', seat: 'light' }))).toBeNull();
    expect(parseRelayMessage(JSON.stringify({ client: 'a', seat: 'light', snapshot: null }))).toBeNull();
  });
});
