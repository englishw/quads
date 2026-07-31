import type { Owner } from '../engine/types';
import { TILES } from '../engine/tiles';
import { tileSvg } from '../render/tile';

const GROUPS: { owner: Owner; title: string }[] = [
  { owner: 'light', title: 'Light pieces' },
  { owner: 'dark', title: 'Dark pieces' },
  { owner: 'neutral', title: 'Neutral pieces' },
];

/**
 * Debug view: renders every generated piece with its side code so the set can be
 * compared against the physical pieces. Codes read North, East, South, West with
 * L = solid light, D = solid dark, P = lines along that edge, X = lines across it.
 */
export function mountGallery(root: HTMLElement): void {
  const sections = GROUPS.map(({ owner, title }) => {
    const tiles = TILES.filter((t) => t.owner === owner);
    const cells = tiles
      .map(
        (tile) => `
        <figure class="gallery__item">
          ${tileSvg(tile.sides, 0, { className: 'tile-svg', title: `Piece ${tile.id}` })}
          <figcaption>${tile.id} · ${tile.sides.join('')}</figcaption>
        </figure>`,
      )
      .join('');
    return `<section><h2>${title} (${tiles.length})</h2><div class="gallery">${cells}</div></section>`;
  }).join('');

  const sample = TILES[0];
  const rotations = [0, 1, 2, 3]
    .map(
      (r) => `
      <figure class="gallery__item">
        ${tileSvg(sample.sides, r as 0 | 1 | 2 | 3, { className: 'tile-svg', title: `Rotation ${r}` })}
        <figcaption>${r * 90}&deg;</figcaption>
      </figure>`,
    )
    .join('');

  root.innerHTML = `
    <div class="gallery-page">
      <h1>Quads piece set (${TILES.length})</h1>
      <p>Side codes read North, East, South, West. <strong>L</strong> solid light,
      <strong>D</strong> solid dark, <strong>P</strong> lines along that edge,
      <strong>X</strong> lines across that edge.</p>
      ${sections}
      <section><h2>Rotations of ${sample.id}</h2><div class="gallery">${rotations}</div></section>
      <p><a href="./">Back to the game</a></p>
    </div>`;
}
