import { describe, expect, it } from 'vitest';
import { TILES, canonicalKey, tileIdsFor } from './tiles';

describe('piece set', () => {
  it('has 36 pieces split 17 light, 17 dark, 2 neutral', () => {
    expect(TILES).toHaveLength(36);
    expect(tileIdsFor('light')).toHaveLength(17);
    expect(tileIdsFor('dark')).toHaveLength(17);
    expect(tileIdsFor('neutral')).toHaveLength(2);
  });

  it('contains no duplicate piece, even allowing rotation', () => {
    const keys = TILES.map((t) => canonicalKey(t.sides));
    expect(new Set(keys).size).toBe(TILES.length);
  });

  it('never mixes solid light with solid dark on one piece', () => {
    for (const tile of TILES) {
      const key = tile.sides.join('');
      expect(key.includes('L') && key.includes('D')).toBe(false);
    }
  });

  it('gives every coloured piece at least one solid and one striped quadrant', () => {
    for (const tile of TILES) {
      if (tile.owner === 'neutral') continue;
      const solid = tile.owner === 'light' ? 'L' : 'D';
      const key = tile.sides.join('');
      expect(key.includes(solid)).toBe(true);
      expect(key.split('').some((c) => c === 'P' || c === 'X')).toBe(true);
    }
  });

  it('uses the two fully striped symmetric pieces as the neutral ones', () => {
    const neutral = TILES.filter((t) => t.owner === 'neutral').map((t) => t.sides.join(''));
    expect(neutral.sort()).toEqual(['PPPP', 'XXXX']);
  });

  it('uses unique ids', () => {
    expect(new Set(TILES.map((t) => t.id)).size).toBe(TILES.length);
  });
});
