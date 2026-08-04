import {
  DIRECTIONS,
  BOARD_SIZE,
  CELL_COUNT,
  type Owner,
  type PlacedTile,
  type Player,
  type Rotation,
} from './types';
import { TILES, tileById, tileIdsFor } from './tiles';
import {
  ROTATIONS,
  checkPlacement,
  distinctRotations,
  neighbourIndex,
  sideAt,
  touchingIndices,
  type Board,
  type PlacementCheck,
} from './rules';

export type Phase = 'opening' | 'playing' | 'finished';
export type PracticeDifficulty = 'easy' | 'medium' | 'hard';

export interface GameOptions {
  /** Also forbid diagonal touching for the second neutral piece. */
  blockDiagonalOpening: boolean;
  /** Require border-facing sides to match the board edge style. */
  requireBoardEdgeMatch: boolean;
  /** Shuffle the order pieces appear in each tray. */
  shuffleTrays: boolean;
  seed: number;
}

export interface Move {
  readonly index: number;
  readonly tileId: string;
  readonly rotation: Rotation;
  readonly by: Player;
}

export interface GameState {
  readonly board: ReadonlyArray<PlacedTile | null>;
  readonly hands: Readonly<Record<Player, readonly string[]>>;
  readonly neutralQueue: readonly string[];
  readonly turn: Player;
  readonly phase: Phase;
  readonly winner: Player | null;
  readonly history: readonly Move[];
  readonly options: GameOptions;
}

export const DEFAULT_OPTIONS: GameOptions = {
  blockDiagonalOpening: false,
  requireBoardEdgeMatch: false,
  shuffleTrays: false,
  seed: 1,
};

/** Small deterministic PRNG so a seed reproduces a tray order. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function createGame(options: Partial<GameOptions> = {}): GameState {
  const opts: GameOptions = { ...DEFAULT_OPTIONS, ...options };
  const rng = mulberry32(opts.seed);
  const light = tileIdsFor('light');
  const dark = tileIdsFor('dark');
  const neutral = tileIdsFor('neutral');
  return {
    board: new Array<PlacedTile | null>(CELL_COUNT).fill(null),
    hands: {
      light: opts.shuffleTrays ? shuffled(light, rng) : light,
      dark: opts.shuffleTrays ? shuffled(dark, rng) : dark,
    },
    neutralQueue: neutral,
    turn: 'light',
    phase: 'opening',
    winner: null,
    history: [],
    options: opts,
  };
}

export function other(player: Player): Player {
  return player === 'light' ? 'dark' : 'light';
}

export function ownerOf(tileId: string): Owner {
  return tileById(tileId).owner;
}

/** Piece ids the player to move is allowed to pick from. */
export function availableTileIds(state: GameState): readonly string[] {
  if (state.phase === 'finished') return [];
  if (state.phase === 'opening') {
    return state.neutralQueue.length > 0 ? [state.neutralQueue[0]] : [];
  }
  return state.hands[state.turn];
}

export function isLegalMove(
  state: GameState,
  index: number,
  tileId: string,
  rotation: Rotation,
): PlacementCheck {
  if (state.phase === 'finished') return { ok: false, reason: 'The game is over.' };
  const available = availableTileIds(state);
  if (!available.includes(tileId)) {
    return { ok: false, reason: 'That piece is not available this turn.' };
  }
  const sides = tileById(tileId).sides;

  if (state.phase === 'opening') {
    const edgeCheck = checkPlacement(state.board as Board, sides, index, rotation, {
      requireAdjacency: false,
      requireBoardEdgeMatch: state.options.requireBoardEdgeMatch,
    });
    if (!edgeCheck.ok) return edgeCheck;

    const placedCount = state.board.filter((c) => c !== null).length;
    if (placedCount > 0) {
      const blocked = touchingIndices(index, state.options.blockDiagonalOpening).some(
        (ni) => state.board[ni] !== null,
      );
      if (blocked) {
        return {
          ok: false,
          reason: 'The second neutral piece may not be placed next to the first one.',
        };
      }
    }
    return { ok: true };
  }

  return checkPlacement(state.board as Board, sides, index, rotation, {
    requireAdjacency: true,
    requireBoardEdgeMatch: state.options.requireBoardEdgeMatch,
  });
}

/** Every legal move for the player to move. */
export function legalMoves(state: GameState): Move[] {
  const out: Move[] = [];
  if (state.phase === 'finished') return out;
  const available = availableTileIds(state);
  for (const tileId of available) {
    const sides = tileById(tileId).sides;
    const rotations = state.phase === 'opening' ? ([0] as Rotation[]) : distinctRotations(sides);
    for (let index = 0; index < state.board.length; index += 1) {
      if (state.board[index]) continue;
      for (const rotation of rotations) {
        if (isLegalMove(state, index, tileId, rotation).ok) {
          out.push({ index, tileId, rotation, by: state.turn });
        }
      }
    }
  }
  return out;
}

function randomIndex(length: number, rng: () => number): number {
  return Math.min(length - 1, Math.floor(rng() * length));
}

function compareMoves(a: Move, b: Move): number {
  return (
    a.tileId.localeCompare(b.tileId) ||
    a.index - b.index ||
    a.rotation - b.rotation ||
    a.by.localeCompare(b.by)
  );
}

function scoreOpponentReplies(state: GameState, move: Move): number {
  return legalMoves(applyMove(state, move)).length;
}

function legalMovesForTurn(state: GameState, turn: Player): number {
  return legalMoves({ ...state, turn }).length;
}

function evaluateMobilityForDark(state: GameState): number {
  const darkMoves = legalMovesForTurn(state, 'dark');
  const lightMoves = legalMovesForTurn(state, 'light');
  return darkMoves - lightMoves;
}

function simulateRandomPlayout(state: GameState, rng: () => number): Player | null {
  let current = state;
  while (current.phase !== 'finished') {
    const moves = legalMoves(current);
    if (moves.length === 0) {
      return current.winner ?? other(current.turn);
    }
    const chosen = moves[randomIndex(moves.length, rng)];
    current = applyMove(current, chosen);
  }
  return current.winner;
}

function countDarkSides(tileId: string): number {
  return tileById(tileId).sides.filter((side) => side === 'D').length;
}

function countLightSides(tileId: string): number {
  return tileById(tileId).sides.filter((side) => side === 'L').length;
}

function countDarkEdgeWaste(move: Move): number {
  const sides = tileById(move.tileId).sides;
  let wasted = 0;
  for (const dir of DIRECTIONS) {
    if (neighbourIndex(move.index, dir) !== null) continue;
    if (sideAt(sides, move.rotation, dir) === 'D') wasted += 1;
  }
  return wasted;
}

function countLightEdgeWaste(move: Move): number {
  const sides = tileById(move.tileId).sides;
  let wasted = 0;
  for (const dir of DIRECTIONS) {
    if (neighbourIndex(move.index, dir) !== null) continue;
    if (sideAt(sides, move.rotation, dir) === 'L') wasted += 1;
  }
  return wasted;
}

function reserveSideBalance(state: GameState): number {
  const darkReserve = state.hands.dark.reduce((total, tileId) => total + countDarkSides(tileId), 0);
  const lightReserve = state.hands.light.reduce(
    (total, tileId) => total + tileById(tileId).sides.filter((side) => side === 'L').length,
    0,
  );
  return darkReserve - lightReserve;
}

function centralWeight(index: number): number {
  const row = Math.floor(index / BOARD_SIZE);
  const col = index % BOARD_SIZE;
  if (row >= 2 && row <= 3 && col >= 2 && col <= 3) return 2;
  if (row >= 1 && row <= 4 && col >= 1 && col <= 4) return 1;
  return 0;
}

function boardPositionalForDark(state: GameState): {
  edgeWasteDark: number;
  edgeWasteLight: number;
  centralDark: number;
  centralLight: number;
} {
  let edgeWasteDark = 0;
  let edgeWasteLight = 0;
  let centralDark = 0;
  let centralLight = 0;

  for (let index = 0; index < state.board.length; index += 1) {
    const cell = state.board[index];
    if (!cell) continue;

    const sides = tileById(cell.tileId).sides;
    for (const dir of DIRECTIONS) {
      if (neighbourIndex(index, dir) !== null) continue;
      const side = sideAt(sides, cell.rotation, dir);
      if (side === 'D') edgeWasteDark += 1;
      if (side === 'L') edgeWasteLight += 1;
    }

    const weight = centralWeight(index);
    if (weight === 0) continue;
    if (cell.owner === 'dark') centralDark += weight;
    if (cell.owner === 'light') centralLight += weight;
  }

  return { edgeWasteDark, edgeWasteLight, centralDark, centralLight };
}

function staticEvalForDark(state: GameState): number {
  if (state.phase === 'finished') {
    if (state.winner === 'dark') return 1_000_000;
    if (state.winner === 'light') return -1_000_000;
    return 0;
  }
  const mobility = evaluateMobilityForDark(state);
  const reserve = reserveSideBalance(state);
  const { edgeWasteDark, edgeWasteLight, centralDark, centralLight } = boardPositionalForDark(state);
  const positional = -edgeWasteDark * 3 + edgeWasteLight * 2 + centralDark * 2 - centralLight * 2;
  return mobility * 18 + reserve * 2 + positional;
}

function quickMoveScoreForDark(state: GameState, move: Move): number {
  const next = applyMove(state, move);
  const mobility = evaluateMobilityForDark(next);
  const replies = legalMoves(next).length;
  const edgePenalty = move.by === 'dark' ? countDarkEdgeWaste(move) : -countLightEdgeWaste(move);
  return mobility * 8 - replies * 2 - edgePenalty * 10;
}

function searchOrderScore(state: GameState, move: Move): number {
  if (state.turn === 'dark') {
    return -countDarkEdgeWaste(move) * 16 + countDarkSides(move.tileId) * 6;
  }
  return -countLightEdgeWaste(move) * 10 - countLightSides(move.tileId) * 3;
}

function stateKey(state: GameState, depth: number): string {
  const boardKey = state.board
    .map((cell) => (cell ? `${cell.tileId}:${cell.rotation}` : '_'))
    .join(',');
  return [
    state.turn,
    state.phase,
    depth.toString(),
    boardKey,
    state.hands.light.join('.'),
    state.hands.dark.join('.'),
    state.neutralQueue.join('.'),
  ].join('|');
}

function hardSearchDepth(state: GameState): number {
  const empties = CELL_COUNT - placedCount(state);
  if (empties <= 6) return 4;
  if (empties <= 14) return 3;
  return 2;
}

function hardBranchLimit(state: GameState): number {
  const empties = CELL_COUNT - placedCount(state);
  if (empties <= 10) return 14;
  if (empties <= 18) return 10;
  return 8;
}

function orderedMovesForSearch(state: GameState): Move[] {
  const limit = hardBranchLimit(state);
  const ranked = legalMoves(state)
    .map((move) => ({ move, score: searchOrderScore(state, move) }))
    .sort((a, b) => {
      if (state.turn === 'dark') {
        return b.score - a.score || compareMoves(a.move, b.move);
      }
      return a.score - b.score || compareMoves(a.move, b.move);
    });
  return ranked.slice(0, limit).map((item) => item.move);
}

function minimaxForDark(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  cache: Map<string, number>,
): number {
  if (state.phase === 'finished') {
    const terminal = staticEvalForDark(state);
    return terminal > 0 ? terminal + depth : terminal - depth;
  }
  if (depth === 0) return staticEvalForDark(state);

  const key = stateKey(state, depth);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const moves = orderedMovesForSearch(state);
  if (moves.length === 0) return staticEvalForDark(state);

  let best: number;
  if (state.turn === 'dark') {
    best = Number.NEGATIVE_INFINITY;
    let localAlpha = alpha;
    for (const move of moves) {
      const score = minimaxForDark(applyMove(state, move), depth - 1, localAlpha, beta, cache);
      if (score > best) best = score;
      if (best > localAlpha) localAlpha = best;
      if (localAlpha >= beta) break;
    }
  } else {
    best = Number.POSITIVE_INFINITY;
    let localBeta = beta;
    for (const move of moves) {
      const score = minimaxForDark(applyMove(state, move), depth - 1, alpha, localBeta, cache);
      if (score < best) best = score;
      if (best < localBeta) localBeta = best;
      if (alpha >= localBeta) break;
    }
  }

  cache.set(key, best);
  return best;
}

function monteCarloWinRate(stateAfterMove: GameState, playouts: number, rng: () => number): number {
  let darkWins = 0;
  for (let i = 0; i < playouts; i += 1) {
    const winner = simulateRandomPlayout(stateAfterMove, rng);
    if (winner === 'dark') darkWins += 1;
  }
  return darkWins / playouts;
}

function compareHardScores(
  a: { winRate: number; replies: number; edgeWaste: number; darkSides: number; move: Move },
  b: { winRate: number; replies: number; edgeWaste: number; darkSides: number; move: Move },
): number {
  return (
    b.winRate - a.winRate ||
    a.replies - b.replies ||
    a.edgeWaste - b.edgeWaste ||
    a.darkSides - b.darkSides ||
    compareMoves(a.move, b.move)
  );
}

/** Pick a move for the single-player practice opponent. */
export function pickPracticeMove(
  state: GameState,
  difficulty: PracticeDifficulty = 'easy',
  rng: () => number = Math.random,
): Move | null {
  const options = legalMoves(state);
  if (options.length === 0) return null;

  if (difficulty === 'easy') {
    const ranked = options
      .map((move) => ({ move, replies: scoreOpponentReplies(state, move) }))
      .sort((a, b) => a.replies - b.replies || compareMoves(a.move, b.move));
    const keep = Math.max(1, Math.ceil(ranked.length / 2));
    const pool = ranked.slice(ranked.length - keep);
    return pool[randomIndex(pool.length, rng)].move;
  }

  if (difficulty === 'medium') {
    const ranked = options
      .map((move) => {
        const stateAfter = applyMove(state, move);
        return { move, score: evaluateMobilityForDark(stateAfter) };
      })
      .sort((a, b) => b.score - a.score || compareMoves(a.move, b.move));
    const keep = Math.max(1, Math.ceil(ranked.length / 2));
    const pool = ranked.slice(0, keep);
    return pool[randomIndex(pool.length, rng)].move;
  }

  const depth = hardSearchDepth(state);
  const cache = new Map<string, number>();
  const rootCandidates = options
    .map((move) => ({ move, quick: quickMoveScoreForDark(state, move) }))
    .sort((a, b) => b.quick - a.quick || compareMoves(a.move, b.move));
  const rootLimit = Math.min(rootCandidates.length, 8);
  const narrowed = rootCandidates.slice(0, rootLimit).map((item) => item.move);

  const searchScored = narrowed.map((move) => {
    const stateAfter = applyMove(state, move);
    return {
      move,
      minimax: minimaxForDark(
        stateAfter,
        Math.max(0, depth - 1),
        Number.NEGATIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        cache,
      ),
      replies: legalMoves(stateAfter).length,
      edgeWaste: countDarkEdgeWaste(move),
      darkSides: countDarkSides(move.tileId),
      stateAfter,
    };
  });

  searchScored.sort(
    (a, b) =>
      b.minimax - a.minimax ||
      a.replies - b.replies ||
      a.edgeWaste - b.edgeWaste ||
      a.darkSides - b.darkSides ||
      compareMoves(a.move, b.move),
  );

  const empties = CELL_COUNT - placedCount(state);
  const useMonteCarlo = empties <= 8;
  if (!useMonteCarlo) {
    return searchScored[0].move;
  }

  const bestMinimax = searchScored[0].minimax;
  const finalists = searchScored.filter((item) => item.minimax >= bestMinimax - 3).slice(0, 2);
  const playoutsPerFinalist = 6;
  const hardScored = finalists.map((item) => ({
    move: item.move,
    replies: item.replies,
    edgeWaste: item.edgeWaste,
    darkSides: item.darkSides,
    winRate: monteCarloWinRate(item.stateAfter, playoutsPerFinalist, rng),
  }));

  hardScored.sort(compareHardScores);
  return hardScored[0].move;
}

export function hasLegalMove(state: GameState): boolean {
  if (state.phase === 'finished') return false;
  const available = availableTileIds(state);
  for (const tileId of available) {
    const sides = tileById(tileId).sides;
    const rotations = state.phase === 'opening' ? ([0] as Rotation[]) : distinctRotations(sides);
    for (let index = 0; index < state.board.length; index += 1) {
      if (state.board[index]) continue;
      for (const rotation of rotations) {
        if (isLegalMove(state, index, tileId, rotation).ok) return true;
      }
    }
  }
  return false;
}

/** Cells where the given piece can go in at least one rotation. */
export function legalCellsForTile(state: GameState, tileId: string): Set<number> {
  const cells = new Set<number>();
  if (state.phase === 'finished') return cells;
  const sides = tileById(tileId).sides;
  const rotations = state.phase === 'opening' ? ([0] as Rotation[]) : distinctRotations(sides);
  for (let index = 0; index < state.board.length; index += 1) {
    if (state.board[index]) continue;
    for (const rotation of rotations) {
      if (isLegalMove(state, index, tileId, rotation).ok) {
        cells.add(index);
        break;
      }
    }
  }
  return cells;
}

/** First rotation that works at `index`, preferring `preferred`. */
export function firstLegalRotation(
  state: GameState,
  index: number,
  tileId: string,
  preferred: Rotation = 0,
): Rotation | null {
  const order: Rotation[] = [preferred, ...ROTATIONS.filter((r) => r !== preferred)];
  for (const rotation of order) {
    if (isLegalMove(state, index, tileId, rotation).ok) return rotation;
  }
  return null;
}

export function applyMove(state: GameState, move: Move): GameState {
  const check = isLegalMove(state, move.index, move.tileId, move.rotation);
  if (!check.ok) throw new Error(`Illegal move: ${check.reason}`);

  const owner = ownerOf(move.tileId);
  const board = state.board.slice();
  board[move.index] = { tileId: move.tileId, rotation: move.rotation, owner };

  const hands: Record<Player, readonly string[]> = {
    light: state.hands.light,
    dark: state.hands.dark,
  };
  let neutralQueue = state.neutralQueue;
  if (owner === 'neutral') {
    neutralQueue = neutralQueue.filter((id) => id !== move.tileId);
  } else {
    hands[owner] = state.hands[owner].filter((id) => id !== move.tileId);
  }

  const history = [...state.history, { ...move, by: state.turn }];
  const openingDone = state.phase === 'opening' && neutralQueue.length === 0;
  const nextPhase: Phase = state.phase === 'opening' && !openingDone ? 'opening' : 'playing';
  // Light opens, dark places the other neutral piece, then light starts the main game.
  const nextTurn: Player = openingDone ? 'light' : other(state.turn);

  let next: GameState = {
    ...state,
    board,
    hands,
    neutralQueue,
    history,
    phase: nextPhase,
    turn: nextTurn,
  };

  if (next.phase === 'playing' && !hasLegalMove(next)) {
    next = { ...next, phase: 'finished', winner: other(next.turn) };
  }
  return next;
}

/**
 * Rebuild every state of a game from its options and move list. Trays are derived
 * from the options seed, so this reproduces the original game exactly, including
 * each intermediate position so undo keeps working after a reload.
 *
 * Throws if any move is illegal, which is what makes a tampered or corrupt saved
 * game fail loudly instead of loading a broken position.
 */
export function replayMoves(
  options: GameOptions,
  moves: ReadonlyArray<{ index: number; tileId: string; rotation: Rotation }>,
): GameState[] {
  const states: GameState[] = [createGame(options)];
  for (const move of moves) {
    const current = states[states.length - 1];
    states.push(
      applyMove(current, {
        index: move.index,
        tileId: move.tileId,
        rotation: move.rotation,
        by: current.turn,
      }),
    );
  }
  return states;
}

export function placedCount(state: GameState): number {
  return state.board.reduce((n, cell) => (cell ? n + 1 : n), 0);
}

export function totalPieces(): number {
  return TILES.length;
}
