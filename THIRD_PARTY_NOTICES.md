# Third-party notices

Synth Piano is MIT-licensed. It includes or uses the following third-party software.

## Verovio — LGPL-3.0-or-later

Music engraving by [Verovio](https://www.verovio.org) © Laurent Pugin, RISM Digital
Center and contributors. Source code: https://github.com/rism-digital/verovio.

Verovio is shipped **unmodified** as the separate file
`resources/app.asar.unpacked/out/renderer/vendor/verovio/verovio-toolkit-wasm.js` and is
loaded at runtime by the engraving worker. You may replace this file with another
(compatible or modified) build of Verovio, as permitted by the GNU Lesser General Public
License v3. The full license text is available at
https://www.gnu.org/licenses/lgpl-3.0.html.

Bundled music fonts (inside the Verovio module): Leipzig, Bravura, Leland, Petaluma and
Gootville, licensed under the SIL Open Font License 1.1.

## Runtime libraries

| Package | License |
| --- | --- |
| Electron (Chromium, Node.js) | MIT (see `LICENSE.electron.txt` and `LICENSES.chromium.html` in the install folder) |
| React, React DOM | MIT |
| Zustand | MIT |
| Immer | MIT |
| Lucide icons (`lucide-react`) | ISC |
| electron-updater | MIT |
