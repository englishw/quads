/** Board is 6x6, which is exactly the 36 physical pieces (17 light + 17 dark + 2 neutral). */
export const BOARD_SIZE = 6;
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

/**
 * A Quads piece is made of four triangular quadrants, one per side.
 * Each quadrant/side is described relative to its own outer edge:
 *
 *  'L' solid light (cream)
 *  'D' solid dark (brown)
 *  'P' lines parallel to that side
 *  'X' lines perpendicular to that side
 *
 * Two touching sides match when their labels are equal. This works because the
 * shared border is the same line for both pieces, so "parallel" means the same
 * absolute line direction for both (vertical lines on a vertical border,
 * horizontal lines on a horizontal border) and likewise for "perpendicular".
 */
export type SideLabel = 'L' | 'D' | 'P' | 'X';

/** Sides in board order: North, East, South, West (piece frame, rotation 0). */
export type Sides = readonly [SideLabel, SideLabel, SideLabel, SideLabel];

/** Quarter-turn clockwise rotations. */
export type Rotation = 0 | 1 | 2 | 3;

export type Player = 'light' | 'dark';
export type Owner = Player | 'neutral';

export const NORTH = 0;
export const EAST = 1;
export const SOUTH = 2;
export const WEST = 3;
export type Direction = 0 | 1 | 2 | 3;
export const DIRECTIONS: readonly Direction[] = [NORTH, EAST, SOUTH, WEST];
export const DIRECTION_NAMES: Record<Direction, string> = {
  0: 'top',
  1: 'right',
  2: 'bottom',
  3: 'left',
};

export interface TileDef {
  readonly id: string;
  readonly owner: Owner;
  readonly sides: Sides;
}

export interface PlacedTile {
  readonly tileId: string;
  readonly rotation: Rotation;
  readonly owner: Owner;
}

export const SIDE_LABEL_NAMES: Record<SideLabel, string> = {
  L: 'light',
  D: 'dark',
  P: 'lines along the edge',
  X: 'lines across the edge',
};
