import { describe, expect, it } from 'vitest';
import {
  applyMove,
  availableTileIds,
  createGame,
  hasLegalMove,
  isLegalMove,
  legalCellsForTile,
  legalMoves,
  pickPracticeMove,
  placedCount,
  type GameState,
} from './game';
import { TILES, tileIdsFor } from './tiles';

function fresh(): GameState {
  return createGame({ shuffleTrays: false, seed: 7 });
}

/** Deterministic RNG for the self-play fuzz test. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function openGame(state: GameState, firstIndex: number, secondIndex: number): GameState {
  const first = availableTileIds(state)[0];
  const afterFirst = applyMove(state, { index: firstIndex, tileId: first, rotation: 0, by: state.turn });
  const second = availableTileIds(afterFirst)[0];
  return applyMove(afterFirst, {
    index: secondIndex,
    tileId: second,
    rotation: 0,
    by: afterFirst.turn,
  });
}

describe('setup', () => {
  it('starts in the opening phase with light to move and full trays', () => {
    const state = fresh();
    expect(state.phase).toBe('opening');
    expect(state.turn).toBe('light');
    expect(state.hands.light).toHaveLength(17);
    expect(state.hands.dark).toHaveLength(17);
    expect(state.neutralQueue).toHaveLength(2);
    expect(availableTileIds(state)).toEqual([state.neutralQueue[0]]);
  });

  it('keeps every piece of the physical set in play', () => {
    const state = fresh();
    const all = [...state.hands.light, ...state.hands.dark, ...state.neutralQueue].sort();
    expect(all).toEqual(TILES.map((t) => t.id).sort());
  });

  it('keeps the default player trays in stable side-count order', () => {
    const state = createGame();
    expect(state.hands.light).toEqual(tileIdsFor('light'));
    expect(state.hands.dark).toEqual(tileIdsFor('dark'));
  });
});

describe('opening', () => {
  it('lets light place a neutral piece anywhere', () => {
    const state = fresh();
    expect(isLegalMove(state, 0, state.neutralQueue[0], 0).ok).toBe(true);
    expect(isLegalMove(state, 35, state.neutralQueue[0], 0).ok).toBe(true);
    expect(legalCellsForTile(state, state.neutralQueue[0]).size).toBe(36);
  });

  it('does not let a player use a coloured piece during the opening', () => {
    const state = fresh();
    expect(isLegalMove(state, 0, tileIdsFor('light')[0], 0).ok).toBe(false);
  });

  it('stops the second neutral piece from touching the first', () => {
    const state = fresh();
    const afterFirst = applyMove(state, {
      index: 14,
      tileId: state.neutralQueue[0],
      rotation: 0,
      by: 'light',
    });
    expect(afterFirst.turn).toBe('dark');
    expect(afterFirst.phase).toBe('opening');
    const second = availableTileIds(afterFirst)[0];
    expect(isLegalMove(afterFirst, 15, second, 0).ok).toBe(false);
    expect(isLegalMove(afterFirst, 8, second, 0).ok).toBe(false);
    expect(isLegalMove(afterFirst, 21, second, 0).ok).toBe(true); // diagonal allowed by default
    expect(isLegalMove(afterFirst, 16, second, 0).ok).toBe(true);
  });

  it('can also forbid diagonal touching', () => {
    const state = createGame({ shuffleTrays: false, seed: 7, blockDiagonalOpening: true });
    const afterFirst = applyMove(state, {
      index: 14,
      tileId: state.neutralQueue[0],
      rotation: 0,
      by: 'light',
    });
    const second = availableTileIds(afterFirst)[0];
    expect(isLegalMove(afterFirst, 21, second, 0).ok).toBe(false);
    expect(isLegalMove(afterFirst, 16, second, 0).ok).toBe(true);
  });

  it('forces starter pieces to respect the board edge when that option is enabled', () => {
    const state = createGame({ shuffleTrays: false, seed: 7, requireBoardEdgeMatch: true });
    const neutral = state.neutralQueue[0];
    expect(isLegalMove(state, 0, neutral, 0).ok).toBe(false);
    expect(isLegalMove(state, 13, neutral, 0).ok).toBe(true);
  });

  it('hands the turn back to light once both neutral pieces are down', () => {
    const state = openGame(fresh(), 14, 16);
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe('light');
    expect(placedCount(state)).toBe(2);
    expect(state.neutralQueue).toHaveLength(0);
  });
});

describe('main play', () => {
  it('only offers moves that touch and match', () => {
    const state = openGame(fresh(), 14, 16);
    const moves = legalMoves(state);
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      expect(isLegalMove(state, move.index, move.tileId, move.rotation).ok).toBe(true);
      expect(state.hands.light).toContain(move.tileId);
    }
  });

  it('refuses an isolated placement', () => {
    const state = openGame(fresh(), 14, 16);
    const tileId = state.hands.light[0];
    expect(isLegalMove(state, 35, tileId, 0).ok).toBe(false);
  });

  it('throws when an illegal move is applied', () => {
    const state = openGame(fresh(), 14, 16);
    expect(() =>
      applyMove(state, { index: 35, tileId: state.hands.light[0], rotation: 0, by: 'light' }),
    ).toThrow(/Illegal move/);
  });

  it('removes the placed piece from its owner tray and alternates turns', () => {
    const state = openGame(fresh(), 14, 16);
    const move = legalMoves(state)[0];
    const next = applyMove(state, move);
    expect(next.hands.light).not.toContain(move.tileId);
    expect(next.hands.light).toHaveLength(16);
    expect(next.turn).toBe('dark');
    expect(next.board[move.index]?.tileId).toBe(move.tileId);
  });
});

describe('end of the game', () => {
  it('declares the mover the winner when the opponent cannot play', () => {
    const base = openGame(fresh(), 14, 16);
    // Light has nothing left, so once dark plays, light has no legal move.
    const rigged: GameState = {
      ...base,
      turn: 'dark',
      hands: { light: [], dark: base.hands.dark },
    };
    const move = legalMoves(rigged)[0];
    expect(move).toBeDefined();
    const finished = applyMove(rigged, move);
    expect(finished.phase).toBe('finished');
    expect(finished.winner).toBe('dark');
    expect(hasLegalMove(finished)).toBe(false);
    expect(legalMoves(finished)).toHaveLength(0);
  });
});

describe('practice AI', () => {
  function replyCountAfter(state: GameState, move: ReturnType<typeof legalMoves>[number]) {
    return legalMoves(applyMove(state, move)).length;
  }

  function mobilityScoreForDark(state: GameState): number {
    return legalMoves({ ...state, turn: 'dark' }).length - legalMoves({ ...state, turn: 'light' }).length;
  }

  it('easy chooses from the weak half that gives the opponent many replies', () => {
    const state = openGame(fresh(), 14, 16);
    const ranked = legalMoves(state)
      .map((candidate) => ({ candidate, replies: replyCountAfter(state, candidate) }))
      .sort((a, b) => a.replies - b.replies || a.candidate.tileId.localeCompare(b.candidate.tileId));
    const keep = Math.max(1, Math.ceil(ranked.length / 2));
    const pool = ranked.slice(ranked.length - keep);
    const weakestReplyCount = pool[0].replies;
    const bestReplyCount = ranked[0].replies;
    const move = pickPracticeMove(state, 'easy', () => 0);
    expect(move).not.toBeNull();
    if (!move) return;
    const replies = replyCountAfter(state, move);
    expect(pool.some((item) => item.candidate.index === move.index && item.candidate.tileId === move.tileId)).toBe(
      true,
    );
    expect(replies).toBeGreaterThanOrEqual(weakestReplyCount);
    expect(replies).toBeGreaterThanOrEqual(bestReplyCount);
  });

  it('medium chooses from top mobility-scoring moves for dark, with randomness in that pool', () => {
    const state = openGame(fresh(), 14, 16);
    const ranked = legalMoves(state)
      .map((candidate) => ({ candidate, score: mobilityScoreForDark(applyMove(state, candidate)) }))
      .sort((a, b) => b.score - a.score || a.candidate.tileId.localeCompare(b.candidate.tileId));
    const keep = Math.max(1, Math.ceil(ranked.length / 2));
    const pool = ranked.slice(0, keep);
    const move = pickPracticeMove(state, 'medium', () => 0.5);
    expect(move).not.toBeNull();
    if (!move) return;
    const pickedScore = mobilityScoreForDark(applyMove(state, move));
    expect(pool.some((item) => item.candidate.index === move.index && item.candidate.tileId === move.tileId)).toBe(
      true,
    );
    expect(pickedScore).toBeGreaterThanOrEqual(ranked[ranked.length - 1].score);
  });

  it(
    'hard returns a legal move and is stable with deterministic playout randomness',
    () => {
      let state = openGame(fresh(), 14, 16);
      // Move to a narrower mid/late-game branch so Monte Carlo remains quick in tests.
      for (let i = 0; i < 14 && state.phase !== 'finished'; i += 1) {
        const options = legalMoves(state);
        if (options.length === 0) break;
        state = applyMove(state, options[0]);
      }
    const first = pickPracticeMove(state, 'hard', () => 0);
    const second = pickPracticeMove(state, 'hard', () => 0);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;
    const legal = legalMoves(state);
    expect(legal.some((m) => m.index === first.index && m.tileId === first.tileId && m.rotation === first.rotation)).toBe(
      true,
    );
      expect(second).toEqual(first);
    },
    15000,
  );
});

describe('self play', () => {
  it('plays many random legal games to a finish without breaking any rule', () => {
    for (let game = 0; game < 30; game += 1) {
      const random = rng(game + 1);
      let state = createGame({ shuffleTrays: true, seed: game + 1 });
      let moves = 0;
      const used = new Set<string>();
      while (state.phase !== 'finished') {
        const options = legalMoves(state);
        expect(options.length).toBeGreaterThan(0);
        const move = options[Math.floor(random() * options.length)];
        expect(used.has(move.tileId)).toBe(false);
        used.add(move.tileId);
        state = applyMove(state, move);
        moves += 1;
        expect(placedCount(state)).toBe(moves);
        expect(state.history).toHaveLength(moves);
        expect(moves).toBeLessThanOrEqual(36);
      }
      expect(state.winner).not.toBeNull();
      expect(placedCount(state)).toBe(state.history.length);
      // Every placement in the finished game must still read as consistent.
      const ids = state.board.filter((c) => c !== null).map((c) => c!.tileId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
