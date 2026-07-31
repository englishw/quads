import type { Owner, SideLabel, Sides, TileDef } from './types';

/**
 * The physical Quads set is 17 light + 17 dark + 2 neutral = 36 pieces, which is
 * exactly the 6x6 board. That split falls out of one simple rule:
 *
 *   A coloured piece uses only its own colour plus striped quadrants, and must
 *   have at least one solid quadrant of its colour and at least one striped
 *   quadrant. Counting 4-tuples over {colour, 'P', 'X'} up to rotation gives
 *   24 classes; removing the 6 all-striped classes and the 1 all-solid class
 *   leaves exactly 17 per colour.
 *
 *   The two neutral pieces are the fully striped, fully symmetric ones:
 *   'PPPP' (concentric squares) and 'XXXX' (the pinwheel/cross).
 *
 * No piece mixes solid light with solid dark, which matches the photographed set.
 */

/** Lexicographically smallest rotation, used as the identity of a piece. */
export function canonicalKey(sides: readonly SideLabel[]): string {
  let best: string | null = null;
  for (let r = 0; r < 4; r += 1) {
    let s = '';
    for (let i = 0; i < 4; i += 1) s += sides[(i + r) % 4];
    if (best === null || s < best) best = s;
  }
  return best as string;
}

function toSides(key: string): Sides {
  const parts = key.split('') as SideLabel[];
  return [parts[0], parts[1], parts[2], parts[3]] as Sides;
}

function colourFamily(colour: 'L' | 'D'): Sides[] {
  const labels: SideLabel[] = [colour, 'P', 'X'];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const a of labels) {
    for (const b of labels) {
      for (const c of labels) {
        for (const d of labels) {
          const tuple: SideLabel[] = [a, b, c, d];
          const hasSolid = tuple.some((x) => x === colour);
          const hasStripe = tuple.some((x) => x !== colour);
          if (!hasSolid || !hasStripe) continue;
          const key = canonicalKey(tuple);
          if (seen.has(key)) continue;
          seen.add(key);
          keys.push(key);
        }
      }
    }
  }
  // Sort by number of solid quadrants (most solid first), then alphabetically,
  // so the generated order is stable and reads like the physical piece rows.
  keys.sort((a, b) => {
    const solidA = a.split('').filter((c) => c === colour).length;
    const solidB = b.split('').filter((c) => c === colour).length;
    if (solidA !== solidB) return solidB - solidA;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return keys.map(toSides);
}

export const NEUTRAL_KEYS = ['PPPP', 'XXXX'] as const;

function build(): TileDef[] {
  const tiles: TileDef[] = [];
  const push = (owner: Owner, prefix: string, sidesList: Sides[]) => {
    sidesList.forEach((sides, i) => {
      tiles.push({ id: `${prefix}${i + 1}`, owner, sides });
    });
  };
  push('light', 'L', colourFamily('L'));
  push('dark', 'D', colourFamily('D'));
  push(
    'neutral',
    'N',
    NEUTRAL_KEYS.map((k) => toSides(k)),
  );
  return tiles;
}

export const TILES: readonly TileDef[] = Object.freeze(build());

export const TILE_BY_ID: ReadonlyMap<string, TileDef> = new Map(TILES.map((t) => [t.id, t]));

export function tileById(id: string): TileDef {
  const tile = TILE_BY_ID.get(id);
  if (!tile) throw new Error(`Unknown tile id: ${id}`);
  return tile;
}

export function tileIdsFor(owner: Owner): string[] {
  return TILES.filter((t) => t.owner === owner).map((t) => t.id);
}

export function sidesKey(sides: Sides): string {
  return sides.join('');
}
