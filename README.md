# NESTR

Web app for nesting rectangular ceramic tile pieces on stock tiles cut by a CNC knife (no kerf).

- Enter stock tile size and the pieces (width, height, qty).
- Optional **Notes** per piece row (e.g. room name), shown inside the tiles and in a list under each sheet, also in the PDF.
- Option **Same Direction Cuts**: G-code cuts always run left to right and bottom to top.
- Option **Add A axis**: every G0 move carries `A` = direction of the next cut (+X 0°, +Y 90°, -X 180°, -Y 270°, plus an offset) to orient a tangential knife.
- Option **Respect pattern direction**: when off, pieces may be rotated 90Â°.
- Automatically continues on new stock tiles when one is not enough.
- Graphical sheets with dimensions on every piece; **Print / Save as PDF**.
- **Export GCODE** â†’ one `NESTR_YYYYMMDD_HHMM_SheetN.txt` file per sheet using X/Y only, `M20` = head down, `M21` = head up. Guillotine cuts only: every cut runs fully across the tile piece it divides so tiles can be snapped by hand. Origin X0 Y0 = bottom-left of each sheet.

## Access control
The app is protected by access codes (Node server, no dependencies).
- `/login` asks for a code. The administrator code opens `/admin/` (add/remove user codes, change the administrator code, open the app); user codes open `/app/`.
- Codes are stored hashed (scrypt). Sessions are HttpOnly cookies; login is rate limited.
- Storage: if `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set, codes are kept in a free Upstash Redis database (survives restarts/redeploys). Otherwise they are kept in `DATA_DIR/codes.json` (default `./data`, git-ignored), which is lost on Render's free tier.
- On the very first start the administrator code is taken from `ADMIN_CODE` (a random one is printed to the log if unset). After that the stored code is used; changing it in the admin page overrides the variable.

Run locally: `ADMIN_CODE=yourcode node server.js` -> http://localhost:3000

## Deploy (Render)
New -> **Web Service**, connect this repo, runtime Node, build command `npm install`, start command `node server.js`.
Environment variables: `ADMIN_CODE`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.