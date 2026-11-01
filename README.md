# NESTR

Web app for nesting rectangular ceramic tile pieces on stock tiles cut by a CNC knife (no kerf).

- Enter stock tile size and the pieces (width, height, qty).
- Optional **Notes** per piece row (e.g. room name), shown inside the tiles and in a list under each sheet, also in the PDF.
- Option **Respect pattern direction**: when off, pieces may be rotated 90°.
- Automatically continues on new stock tiles when one is not enough.
- Graphical sheets with dimensions on every piece; **Print / Save as PDF**.
- **Export GCODE** → `.txt` using X/Y only, `M20` = head down, `M21` = head up. Guillotine cuts only: every cut runs fully across the tile piece it divides (edge to edge / to an earlier cut) so tiles can be snapped by hand. Stock borders are not cut; origin X0 Y0 = bottom-left of each sheet.

Pure static site (no build). Run locally by opening `index.html`.

## Deploy
Render → New → Static Site → connect this repo, publish directory `.`, no build command (see `render.yaml`).
