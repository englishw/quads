import type { Rotation, SideLabel, Sides } from '../engine/types';
import { rotatedSides } from '../engine/rules';

/** Tiles are drawn in a 100x100 local box. */
export const TILE_UNITS = 100;

/**
 * Stripe pitch must divide TILE_UNITS so that stripes line up across the whole
 * board: dark bands are centred on multiples of the pitch, which also puts a
 * half band flush against every tile edge. Two matching striped edges therefore
 * join into one full-width line.
 */
export const STRIPE_PITCH = 10;
const STRIPE_HALF = STRIPE_PITCH / 4;

export const COLORS = {
  light: '#dcd8b0',
  dark: '#7d4c43',
};

/**
 * Quadrant triangles, indexed by direction (N, E, S, W). They are grown slightly
 * past the tile edge and past the centre so that neighbouring quadrants overlap;
 * otherwise antialiasing leaves a hairline seam where two identical fills meet.
 */
const OVER = 0.6;
const QUADRANTS: readonly string[] = [
  `${-OVER},${-OVER} ${100 + OVER},${-OVER} 50,${50 + OVER}`,
  `${100 + OVER},${-OVER} ${100 + OVER},${100 + OVER} ${50 - OVER},50`,
  `${100 + OVER},${100 + OVER} ${-OVER},${100 + OVER} 50,${50 - OVER}`,
  `${-OVER},${100 + OVER} ${-OVER},${-OVER} ${50 + OVER},50`,
];

export function stripeDefs(suffix: string): string {
  const h = `qh-${suffix}`;
  const v = `qv-${suffix}`;
  return [
    `<pattern id="${h}" width="${STRIPE_PITCH}" height="${STRIPE_PITCH}" patternUnits="userSpaceOnUse">`,
    `<rect width="${STRIPE_PITCH}" height="${STRIPE_PITCH}" fill="${COLORS.light}"/>`,
    `<rect y="0" width="${STRIPE_PITCH}" height="${STRIPE_HALF}" fill="${COLORS.dark}"/>`,
    `<rect y="${STRIPE_PITCH - STRIPE_HALF}" width="${STRIPE_PITCH}" height="${STRIPE_HALF}" fill="${COLORS.dark}"/>`,
    `</pattern>`,
    `<pattern id="${v}" width="${STRIPE_PITCH}" height="${STRIPE_PITCH}" patternUnits="userSpaceOnUse">`,
    `<rect width="${STRIPE_PITCH}" height="${STRIPE_PITCH}" fill="${COLORS.light}"/>`,
    `<rect x="0" width="${STRIPE_HALF}" height="${STRIPE_PITCH}" fill="${COLORS.dark}"/>`,
    `<rect x="${STRIPE_PITCH - STRIPE_HALF}" width="${STRIPE_HALF}" height="${STRIPE_PITCH}" fill="${COLORS.dark}"/>`,
    `</pattern>`,
  ].join('');
}

/**
 * Stripes in a quadrant run either along its outer edge ('P') or across it ('X'),
 * so whether they are drawn horizontally or vertically depends on which side the
 * quadrant belongs to.
 */
function fillFor(dir: number, label: SideLabel, suffix: string): string {
  if (label === 'L') return COLORS.light;
  if (label === 'D') return COLORS.dark;
  const sideIsHorizontal = dir === 0 || dir === 2;
  const linesAreHorizontal = sideIsHorizontal ? label === 'P' : label === 'X';
  return `url(#${linesAreHorizontal ? 'qh' : 'qv'}-${suffix})`;
}

/**
 * Markup for one piece, already rotated. Rotation is baked into the side labels
 * instead of using an SVG transform, which keeps every stripe axis-aligned and
 * in phase with its neighbours.
 */
export function tileGroup(
  sides: Sides,
  rotation: Rotation,
  suffix: string,
  options: { x?: number; y?: number; className?: string; opacity?: number } = {},
): string {
  const view = rotatedSides(sides, rotation);
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const cls = options.className ? ` class="${options.className}"` : '';
  const opacity = options.opacity !== undefined ? ` opacity="${options.opacity}"` : '';
  const quads = view
    .map((label, dir) => `<polygon points="${QUADRANTS[dir]}" fill="${fillFor(dir, label, suffix)}"/>`)
    .join('');
  return (
    `<g${cls}${opacity} transform="translate(${x} ${y})">${quads}` +
    `<rect x="0" y="0" width="${TILE_UNITS}" height="${TILE_UNITS}" fill="none" stroke="rgba(40,20,15,0.35)" stroke-width="1"/>` +
    `</g>`
  );
}

let uid = 0;

/** A self-contained <svg> for a piece, safe to drop anywhere in the page. */
export function tileSvg(
  sides: Sides,
  rotation: Rotation = 0,
  options: { className?: string; title?: string } = {},
): string {
  uid += 1;
  const suffix = `u${uid}`;
  const cls = options.className ?? 'tile-svg';
  const title = options.title ? `<title>${options.title}</title>` : '';
  return (
    `<svg class="${cls}" viewBox="0 0 ${TILE_UNITS} ${TILE_UNITS}" role="img" aria-hidden="${options.title ? 'false' : 'true'}">` +
    `${title}<defs>${stripeDefs(suffix)}</defs>${tileGroup(sides, rotation, suffix)}</svg>`
  );
}
