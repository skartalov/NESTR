# NESTR

Web app for nesting rectangular ceramic tile pieces on stock tiles cut by a CNC knife (no kerf).

- Enter stock tile size and the pieces (width, height, qty).
- Optional **Notes** per piece row (e.g. room name), shown inside the tiles and in a list under each sheet, also in the PDF.
- Option **Same Direction Cuts**: G-code cuts always run left to right and bottom to top.
- Option **Respect pattern direction**: when off, pieces may be rotated 90°.
- Automatically continues on new stock tiles when one is not enough.
- Graphical sheets with dimensions on every piece; **Print / Save as PDF**.
- **Export GCODE** → one `NESTR_YYYYMMDD_HHMM_SheetN.txt` file per sheet using X/Y only, `M20` = head down, `M21` = head up. Guillotine cuts only: every cut runs fully across the tile piece it divides so tiles can be snapped by hand. Origin X0 Y0 = bottom-left of each sheet.

## Access control
The app is protected by access codes (Node server, no dependencies).
- `/login` asks for a code. The administrator code opens `/admin/` (add/remove user codes, change the administrator code, open the app); user codes open `/app/`.
- Codes are stored hashed (scrypt) in `DATA_DIR/codes.json` (default `./data`, git-ignored). Sessions are HttpOnly cookies; login is rate limited.
- On the very first start the administrator code is taken from the `ADMIN_CODE` environment variable (a random one is printed to the log if unset). After that the code stored in `codes.json` is used, and changing it in the admin page overrides the variable.

Run locally: `ADMIN_CODE=yourcode node server.js` → http://localhost:3000

## Deploy (Render)
Render → New → **Web Service** → connect this repo, runtime Node, build command empty, start command `node server.js`, environment variable `ADMIN_CODE` (see `render.yaml`).
Render's free disk is ephemeral: user codes and an admin-code change are lost on restart/redeploy (the admin code then reverts to `ADMIN_CODE`). To keep them, attach a Render Disk, e.g. mounted at `/var/data`, and set `DATA_DIR=/var/data`.
