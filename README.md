# Quads

A browser version of the tile matching board game **Quads** (Kris Burm / Gigamic), built for two
players sharing one screen. Touch first, no install, no server: the whole game runs client side and
is hosted on GitHub Pages.

## Play

Open the deployed page, hand the tablet to a friend and sit on opposite sides. The Dark tray sits at
the top of the screen upside down so it reads correctly from the far side of the table.

## Rules

- The board is 6x6, which is exactly the 36 pieces: 17 light, 17 dark and 2 neutral.
- Light opens by placing one neutral piece anywhere. Dark then places the other neutral piece, but
  not next to the first one.
- After that, players alternate placing one of their own pieces. A piece must border at least one
  piece already on the board, and every pair of touching sides must be identical:
  - light against light
  - dark against dark
  - lines along the edge against lines along the edge (vertical against vertical)
  - lines across the edge against lines across the edge (horizontal against horizontal)
- You may touch your opponent's pieces, and you may touch several pieces at once.
- Pieces may be rotated freely before being placed.
- The game ends as soon as the player to move has no legal placement. The other player wins.

An optional setting also forbids the second neutral piece from touching the first diagonally.

## Controls

- **Touch**: tap one of your pieces, then tap a cell to aim, then tap the same cell again to place.
  You can also drag a piece straight from your tray onto the board.
- **Rotate**: the Rotate button in your own panel, or the `R` key.
- **Place / clear**: the Place and Clear buttons, or `Enter` and `Escape`.
- **Undo, New game, Hints**: the toolbar under the board, or `U` and `H`.
- **Keyboard aiming**: arrow keys move the aim square once a piece is selected.

Green dots mark every legal cell for the selected piece. A green outline means the aimed placement is
legal; a red outline explains what does not match.

## How pieces are modelled

Each piece is four triangular quadrants, so it can be described by four side labels read North, East,
South, West:

- `L` solid light
- `D` solid dark
- `P` lines parallel to that side
- `X` lines perpendicular to that side

Rotation is a cyclic shift of those four labels, and two pieces match when the labels on their
touching sides are equal. The shared border is the same line for both pieces, so "parallel" means the
same absolute direction for both of them.

The full set falls out of one rule: a coloured piece uses only its own colour plus striped quadrants
and must have at least one of each. Up to rotation that gives exactly 17 pieces per colour, plus the
two fully striped symmetric pieces (`PPPP`, the concentric squares, and `XXXX`, the pinwheel) as the
neutral pieces. 17 + 17 + 2 = 36.

Open `?gallery` (for example `https://<user>.github.io/quads/?gallery`) to see every generated piece
with its side code, which is handy for comparing against the physical set. `?demo=N` opens a position
after N automatic legal moves, which is useful for checking the board rendering.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # engine unit tests and random self-play fuzz test
npm run typecheck  # TypeScript, no emit
npm run build      # production build into dist/
```

Layout:

- `src/engine` — pure game logic: piece set, rotation, matching, turn flow, endgame detection
- `src/render` — SVG generation for pieces and the board
- `src/ui` — hotseat interface, pointer/touch handling, piece gallery
- `.github/workflows/deploy.yml` — test, build and publish to GitHub Pages

## Deployment

Pushing to `main` runs the tests, builds with Vite and publishes `dist/` to GitHub Pages. Set
Settings → Pages → Build and deployment → Source to **GitHub Actions**. The build uses a relative
base path, so it works from a project page subpath.

Quads is a game by Kris Burm, published by Gigamic. This is an unofficial fan implementation of the
rules for personal use.
