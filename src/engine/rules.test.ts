import { describe, expect, it } from 'vitest';
import { CELL_COUNT, type PlacedTile, type Rotation, type Sides } from './types';
import {
  checkPlacement,
  distinctRotations,
  neighbourIndex,
  opposite,
  rotatedSides,
  sideAt,
  touchingIndices,
} from './rules';
import { TILES, tileById } from './tiles';

const emptyBoard = (): (PlacedTile | null)[] => new Array<PlacedTile | null>(CELL_COUNT).fill(null);

describe('rotation', () => {
  it('is the identity at rotation 0', () => {
    for (const tile of TILES) {
      expect(rotatedSides(tile.sides, 0)).toEqual(tile.sides);
    }
  });

  it('returns to the start after four quarter turns', () => {
    for (const tile of TILES) {
      let sides: Sides = tile.sides;
      for (let i = 0; i < 4; i += 1) sides = rotatedSides(sides, 1);
      expect(sides).toEqual(tile.sides);
    }
  });

  it('moves the north side to the east on a clockwise turn', () => {
    const sides: Sides = ['L', 'P', 'X', 'D'];
    expect(rotatedSides(sides, 1)).toEqual(['D', 'L', 'P', 'X']);
  });

  it('agrees with sideAt', () => {
    for (const tile of TILES) {
      for (const r of [0, 1, 2, 3] as Rotation[]) {
        const rotated = rotatedSides(tile.sides, r);
        for (const dir of [0, 1, 2, 3] as const) {
          expect(sideAt(tile.sides, r, dir)).toBe(rotated[dir]);
        }
      }
    }
  });

  it('counts distinct rotations by symmetry', () => {
    expect(distinctRotations(['P', 'P', 'P', 'P'])).toHaveLength(1);
    expect(distinctRotations(['L', 'P', 'L', 'P'])).toHaveLength(2);
    expect(distinctRotations(['L', 'L', 'L', 'P'])).toHaveLength(4);
  });
});

describe('geometry', () => {
  it('pairs opposite directions', () => {
    expect(opposite(0)).toBe(2);
    expect(opposite(1)).toBe(3);
  });

  it('keeps neighbours on the board', () => {
    expect(neighbourIndex(0, 0)).toBeNull();
    expect(neighbourIndex(0, 3)).toBeNull();
    expect(neighbourIndex(0, 1)).toBe(1);
    expect(neighbourIndex(0, 2)).toBe(6);
    expect(neighbourIndex(35, 1)).toBeNull();
  });

  it('lists orthogonal and diagonal touches', () => {
    expect(touchingIndices(14, false).sort((a, b) => a - b)).toEqual([8, 13, 15, 20]);
    expect(touchingIndices(14, true)).toHaveLength(8);
  });
});

describe('placement', () => {
  it('requires the piece to touch something', () => {
    const board = emptyBoard();
    const result = checkPlacement(board, ['L', 'L', 'L', 'P'], 14, 0);
    expect(result.ok).toBe(false);
  });

  it('accepts an isolated placement when adjacency is not required', () => {
    const board = emptyBoard();
    expect(checkPlacement(board, ['L', 'L', 'L', 'P'], 14, 0, { requireAdjacency: false }).ok).toBe(
      true,
    );
  });

  it('rejects an occupied cell', () => {
    const board = emptyBoard();
    board[14] = { tileId: TILES[0].id, rotation: 0, owner: TILES[0].owner };
    expect(checkPlacement(board, TILES[1].sides, 14, 0).ok).toBe(false);
  });

  it('matches identical facing sides and rejects mismatches', () => {
    const board = emptyBoard();
    // Place a piece whose east side is 'P'.
    const anchor = TILES.find((t) => t.sides[1] === 'P');
    expect(anchor).toBeDefined();
    board[14] = { tileId: anchor!.id, rotation: 0, owner: anchor!.owner };

    const eastNeighbour = 15;
    const matching: Sides = ['L', 'L', 'L', 'P']; // west side 'P' faces the anchor
    expect(checkPlacement(board, matching, eastNeighbour, 0).ok).toBe(true);

    const mismatching: Sides = ['L', 'L', 'L', 'X'];
    const bad = checkPlacement(board, mismatching, eastNeighbour, 0);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain('left side');
  });

  it('allows a placement that borders several pieces at once', () => {
    const board = emptyBoard();
    const west = TILES.find((t) => t.sides[1] === 'P'); // east side 'P'
    const east = TILES.find((t) => t.sides[3] === 'P'); // west side 'P'
    expect(west).toBeDefined();
    expect(east).toBeDefined();
    board[13] = { tileId: west!.id, rotation: 0, owner: west!.owner };
    board[15] = { tileId: east!.id, rotation: 0, owner: east!.owner };
    // Cell 14 sits between both of them, so both side pairs have to match.
    expect(checkPlacement(board, ['L', 'P', 'L', 'P'], 14, 0).ok).toBe(true);
    expect(checkPlacement(board, ['L', 'X', 'L', 'P'], 14, 0).ok).toBe(false);
    expect(tileById(west!.id).sides[1]).toBe('P');
  });

  it('can require border-facing sides to match the board edge', () => {
    const board = emptyBoard();
    expect(
      checkPlacement(board, ['X', 'L', 'L', 'P'], 0, 0, {
        requireAdjacency: false,
        requireBoardEdgeMatch: true,
      }).ok,
    ).toBe(true);

    const result = checkPlacement(board, ['P', 'L', 'L', 'P'], 0, 0, {
      requireAdjacency: false,
      requireBoardEdgeMatch: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('board edge');
  });
});
