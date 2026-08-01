import { describe, expect, it } from 'vitest';
import { applyMove, createGame, legalMoves, type GameState } from '../engine/game';
import {
  SNAPSHOT_VERSION,
  compareSnapshots,
  createGameId,
  decodeSnapshot,
  encodeSnapshot,
  extractGameId,
  hasAmbiguousCharacters,
  isValidGameId,
  makeSnapshot,
  normalizeGameId,
  parseSnapshot,
  restoreHistory,
  type Snapshot,
} from './snapshot';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/** Play `count` random legal moves and keep every state, like the app's undo stack. */
function playRandom(seed: number, count: number): GameState[] {
  const random = rng(seed);
  const states: GameState[] = [createGame({ seed, shuffleTrays: true })];
  for (let i = 0; i < count; i += 1) {
    const current = states[states.length - 1];
    const options = legalMoves(current);
    if (options.length === 0) break;
    states.push(applyMove(current, options[Math.floor(random() * options.length)]));
  }
  return states;
}

const meta = { gameId: 'ABC234', epoch: 0, mode: 'hotseat' as const, seat: 'light' as const };

function snapshotOf(state: GameState, overrides: Partial<Snapshot> = {}): Snapshot {
  return { ...makeSnapshot(state, meta), ...overrides };
}

describe('game codes', () => {
  it('generates codes of the requested length from an unambiguous alphabet', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = createGameId();
      expect(id).toHaveLength(6);
      expect(id).toMatch(/^[A-HJ-NP-Z2-9]+$/);
      expect(isValidGameId(id)).toBe(true);
    }
  });

  it('cleans up whatever the player typed', () => {
    expect(normalizeGameId(' abc-234 ')).toBe('ABC234');
    expect(normalizeGameId('io01')).toBe('');
    expect(normalizeGameId(null)).toBe('');
  });

  it('takes the code out of a pasted share link', () => {
    expect(extractGameId('https://englishw.github.io/quads/?game=abc234')).toBe('ABC234');
    expect(extractGameId('https://englishw.github.io/quads/?view=upright&game=KMQ47F')).toBe(
      'KMQ47F',
    );
    expect(extractGameId('  abc234  ')).toBe('ABC234');
    expect(extractGameId('')).toBe('');
  });

  it('flags codes containing characters that are never generated', () => {
    // Silently dropping these would send the player to a different, empty game.
    expect(hasAmbiguousCharacters('RLY190')).toBe(true);
    expect(hasAmbiguousCharacters('abc0')).toBe(true);
    expect(hasAmbiguousCharacters('ABCI23')).toBe(true);
    expect(hasAmbiguousCharacters('ABC234')).toBe(false);
    // A pasted link is judged on its code, not the surrounding URL.
    expect(hasAmbiguousCharacters('https://englishw.github.io/quads/?game=ABC234')).toBe(false);
  });

  it('rejects codes that are too short or contain ambiguous characters', () => {
    expect(isValidGameId('ABC')).toBe(false);
    expect(isValidGameId('ABC0')).toBe(false);
    expect(isValidGameId('abc234')).toBe(false);
    expect(isValidGameId('ABC234')).toBe(true);
  });
});

describe('saving and restoring a game', () => {
  it('restores the position, trays and every earlier state', () => {
    const states = playRandom(11, 12);
    const final = states[states.length - 1];
    const restored = restoreHistory(decodeSnapshot(encodeSnapshot(snapshotOf(final)))!);
    expect(restored).not.toBeNull();
    expect(restored).toHaveLength(states.length);
    restored!.forEach((state, i) => {
      expect(state.board).toEqual(states[i].board);
      expect(state.turn).toBe(states[i].turn);
      expect(state.phase).toBe(states[i].phase);
      expect(state.hands).toEqual(states[i].hands);
      expect(state.neutralQueue).toEqual(states[i].neutralQueue);
    });
  });

  it('restores a finished game with its winner', () => {
    const states = playRandom(5, 40);
    const final = states[states.length - 1];
    expect(final.phase).toBe('finished');
    const restored = restoreHistory(snapshotOf(final))!;
    const last = restored[restored.length - 1];
    expect(last.phase).toBe('finished');
    expect(last.winner).toBe(final.winner);
  });

  it('round trips a game that has not started', () => {
    const fresh = createGame({ seed: 3 });
    const restored = restoreHistory(snapshotOf(fresh))!;
    expect(restored).toHaveLength(1);
    expect(restored[0].phase).toBe('opening');
    expect(restored[0].hands).toEqual(fresh.hands);
  });
});

describe('rejecting bad saves', () => {
  const base = snapshotOf(playRandom(7, 4).slice(-1)[0]);

  it('ignores malformed or empty input', () => {
    expect(decodeSnapshot(null)).toBeNull();
    expect(decodeSnapshot('')).toBeNull();
    expect(decodeSnapshot('not json')).toBeNull();
    expect(decodeSnapshot('[]')).toBeNull();
    expect(parseSnapshot(undefined)).toBeNull();
  });

  it('ignores snapshots with a wrong shape', () => {
    expect(parseSnapshot({ ...base, version: SNAPSHOT_VERSION + 1 })).toBeNull();
    expect(parseSnapshot({ ...base, gameId: 'IO' })).toBeNull();
    expect(parseSnapshot({ ...base, epoch: 1.5 })).toBeNull();
    expect(parseSnapshot({ ...base, epoch: -1 })).toBeNull();
    expect(parseSnapshot({ ...base, mode: 'solo' })).toBeNull();
    expect(parseSnapshot({ ...base, seat: 'green' })).toBeNull();
    expect(parseSnapshot({ ...base, options: { seed: 1 } })).toBeNull();
    expect(parseSnapshot({ ...base, moves: [{ i: 40, t: 'L1', r: 0 }] })).toBeNull();
    expect(parseSnapshot({ ...base, moves: [{ i: 0, t: 'L1', r: 7 }] })).toBeNull();
    expect(parseSnapshot({ ...base, moves: 'nope' })).toBeNull();
  });

  it('refuses to load a structurally valid but illegal game', () => {
    // Two pieces on the same cell can never happen in a real game.
    const tampered = parseSnapshot({
      ...base,
      moves: [
        { i: 14, t: 'N1', r: 0 },
        { i: 14, t: 'N2', r: 0 },
      ],
    });
    expect(tampered).not.toBeNull();
    expect(restoreHistory(tampered!)).toBeNull();
  });

  it('refuses a game that uses an unknown piece', () => {
    const tampered = parseSnapshot({ ...base, moves: [{ i: 14, t: 'ZZ9', r: 0 }] });
    expect(tampered).not.toBeNull();
    expect(restoreHistory(tampered!)).toBeNull();
  });
});

describe('deciding between two screens', () => {
  const local = snapshotOf(playRandom(9, 6).slice(-1)[0], { mode: 'remote', epoch: 2 });

  it('ignores snapshots from a different game', () => {
    expect(compareSnapshots(local, { ...local, gameId: 'ZZZ999' }, 'light')).toBe('ignore');
  });

  it('prefers a newer epoch in either direction', () => {
    expect(compareSnapshots(local, { ...local, epoch: 3 }, 'light')).toBe('adopt');
    expect(compareSnapshots(local, { ...local, epoch: 1 }, 'light')).toBe('keep');
  });

  it('prefers the longer move list within the same epoch', () => {
    const ahead = { ...local, moves: [...local.moves, local.moves[0]] };
    const behind = { ...local, moves: local.moves.slice(0, -1) };
    expect(compareSnapshots(local, ahead, 'dark')).toBe('adopt');
    expect(compareSnapshots(local, behind, 'dark')).toBe('keep');
  });

  it('reports identical snapshots as the same so peers stop talking', () => {
    expect(compareSnapshots(local, { ...local }, 'light')).toBe('same');
    expect(compareSnapshots(local, { ...local }, 'dark')).toBe('same');
  });

  it('lets Light own the options when both sides are level', () => {
    const differing = { ...local, options: { ...local.options, seed: local.options.seed + 1 } };
    expect(compareSnapshots(local, differing, 'dark')).toBe('adopt');
    expect(compareSnapshots(local, differing, 'light')).toBe('keep');
  });

  it('never reports adopt on both sides at once', () => {
    const other = snapshotOf(playRandom(4, 3).slice(-1)[0], {
      gameId: local.gameId,
      mode: 'remote',
      epoch: 2,
    });
    for (const seat of ['light', 'dark'] as const) {
      const mine = compareSnapshots(local, other, seat);
      const theirs = compareSnapshots(other, local, seat === 'light' ? 'dark' : 'light');
      expect(mine === 'adopt' && theirs === 'adopt').toBe(false);
    }
  });
});
