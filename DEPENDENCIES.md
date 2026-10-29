# Dependencies and licence report

Novamail is a proprietary product built on open-source software. This report was
generated from `package-lock.json` (566 installed packages: 244 runtime,
322 development-only) at version 1.0.0.

## Summary

| Licence | Packages |
|---|---|
| MIT | 456 |
| ISC | 30 |
| Apache-2.0 | 17 |
| BSD-2-Clause | 14 |
| BSD-3-Clause | 13 |
| MPL-2.0 (file-level copyleft) | 12 |
| BlueOak-1.0.0 | 6 |
| MIT-0 | 3 |
| CC0-1.0 / CC-BY-4.0 / Unlicense / 0BSD / WTFPL / Python-2.0 / BSD | 1 each |
| Dual: `jszip` (MIT OR GPL-3.0-or-later) | 1 |
| Dual: `(MIT OR EUPL-1.1+)`, `(MIT AND Zlib)`, `(WTFPL OR MIT)` | 1 each |

**Obligations that matter for distributing a binary:**

- **MIT / ISC / BSD / Apache-2.0** — keep the copyright notice and licence text.
  Apache-2.0 additionally requires a NOTICE file if the upstream project has one.
- **MPL-2.0** (12 packages) — file-level copyleft: if you *modify* those files
  you must publish the modified files. Novamail does not modify them, so
  shipping them unmodified in the asar archive is compliant as long as the
  licence text is included.
- **`jszip` is dual-licensed MIT *or* GPL-3.0-or-later.** Novamail ships it under
  the **MIT** option, so no GPL obligation applies. If you ever relicense or fork
  jszip itself, keep that choice in mind.
- No AGPL, SSPL or GPL-only dependency is used at runtime.

`electron` itself (MIT) is a Chromium + Node.js runtime; the resulting
`Novamail.exe` also contains Chromium's third-party notices (BSD-style), which
Electron places in `LICENSES.chromium.html` inside the packaged app. Keep that
file in the installer.

One transitive **dev-only** package (`buffers`) declares no licence field in its
`package.json`; it is not distributed in the installer.

---

## Direct runtime dependencies

| Package | Version | Licence | Used for |
|---|---|---|---|
| `better-sqlite3` | 13.0.3 | MIT | Local database (messages, folders, rules, settings, queue) |
| `imapflow` | 2.9.1 | MIT | IMAP receive, IDLE, flags, append |
| `nodemailer` | 10.3.0 | MIT-0 | SMTP send and MIME compilation |
| `mailparser` | 3.12.4 | MIT | Parsing RFC 822 messages and attachments |
| `sanitize-html` | 2.18.1 | MIT | Stripping active content from received HTML |
| `zod` | 4.6.7 | MIT | Validating every IPC payload |
| `exceljs` | 4.4.0 | MIT | XLSX preview (local conversion) |
| `jszip` | 3.10.2 | MIT *or* GPL-3.0+ (**MIT chosen**) | Reading PPTX/DOCX/XLSX containers |
| `mammoth` | 1.13.0 | BSD-2-Clause | DOCX to HTML preview |
| `pdfjs-dist` | 5.4.624 | Apache-2.0 | PDF preview rendering |
| `react` | 19.3.1 | MIT | User interface |
| `react-dom` | 19.3.1 | MIT | User interface |

## Direct development dependencies

| Package | Version | Licence |
|---|---|---|
| `electron` | 45.1.0 | MIT |
| `electron-builder` | 26.18.0 | MIT |
| `electron-vite` | 6.0.0 | MIT |
| `vite` | 8.3.5 | MIT |
| `@vitejs/plugin-react` | 6.1.2 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |
| `vitest` | 5.0.5 | MIT |
| `jsdom` | 27.1.0 | MIT |
| `@playwright/test` | 1.64.1 | Apache-2.0 |
| `@types/better-sqlite3` | 7.6.13 | MIT |
| `@types/node` | 22.19.1 | MIT |
| `@types/react` | 19.2.2 | MIT |
| `@types/react-dom` | 19.2.1 | MIT |
| `@types/sanitize-html` | 2.16.0 | MIT |

---

## Maintenance and security review

Each dependency was checked for maintenance status, licence and known
vulnerabilities before adoption. Notes on the ones that carry risk:

| Package | Status | Notes |
|---|---|---|
| `better-sqlite3` 13.0.3 | Actively maintained | Synchronous native SQLite. v13 ships N-API prebuilds for `win32-x64`, so no compiler is needed and the binary works across Electron versions. SQLite 3.53.4 bundled. |
| `imapflow` 2.9.1 | Actively maintained | Same author as Nodemailer. Only pure-JS IMAP client with IDLE + UTF-7 folder support that is still shipping. |
| `nodemailer` 10.3.0 | Actively maintained | No known CVE at the reviewed version. |
| `mailparser` 3.12.4 | Maintained | Parses untrusted input; runs on a worker-free path but is fuzzed upstream. Novamail parses in the main process and enforces size limits before parsing. |
| `pdfjs-dist` 5.4.624 | Actively maintained (Mozilla) | Runs with `isEvalSupported: false`; see security notes. |
| `sanitize-html` 2.18.1 | Maintained | Allow-list based. Its output is *also* rendered inside a sandboxed iframe with its own CSP, so a sanitiser bypass is not sufficient to execute code. |
| `mammoth` 1.13.0 | Maintained | Converts DOCX locally. Output is sanitised again before display. |
| `exceljs` 4.4.0 | Maintained, slow releases | Used read-only for previews. Protection against zip bombs is applied before extraction. |
| `jszip` 3.10.2 | Maintained | CVE-2022-48285 (path traversal) is fixed in 3.8.0+. |
| `electron` 45.1.0 | Current stable | Follows Electron's 8-week support window; plan an upgrade cadence. |
| `vite` / `vitest` / `playwright` | Dev only | Not shipped to users. |

### Known limitations

- **No automated vulnerability scanning in CI.** `npm audit` is not run because
  the build environment has no registry access. Run `npm audit --omit=dev`
  locally before each release.
- **No SBOM is generated.** If you need one for procurement, run
  `npx @cyclonedx/cyclonedx-npm --output-file sbom.json`.

---

## Full runtime dependency tree

Every package below is present in the installed application.

| Package | Version | Licence |
|---|---|---|
| @fast-csv/format | 4.3.5 | MIT |
| @fast-csv/parse | 4.3.6 | MIT |
| @napi-rs/canvas | 0.1.100 | MIT |
| @napi-rs/canvas-android-arm64 | 0.1.100 | MIT |
| @napi-rs/canvas-darwin-arm64 | 0.1.100 | MIT |
| @napi-rs/canvas-darwin-x64 | 0.1.100 | MIT |
| @napi-rs/canvas-linux-arm-gnueabihf | 0.1.100 | MIT |
| @napi-rs/canvas-linux-arm64-gnu | 0.1.100 | MIT |
| @napi-rs/canvas-linux-arm64-musl | 0.1.100 | MIT |
| @napi-rs/canvas-linux-riscv64-gnu | 0.1.100 | MIT |
| @napi-rs/canvas-linux-x64-gnu | 0.1.100 | MIT |
| @napi-rs/canvas-linux-x64-musl | 0.1.100 | MIT |
| @napi-rs/canvas-win32-arm64-msvc | 0.1.100 | MIT |
| @napi-rs/canvas-win32-x64-msvc | 0.1.100 | MIT |
| @pinojs/redact | 0.4.0 | MIT |
| @selderee/plugin-htmlparser2 | 0.12.0 | MIT |
| @xmldom/xmldom | 0.8.15 | MIT |
| @zone-eu/mailsplit | 5.4.29 | (MIT OR EUPL-1.1+) |
| archiver | 5.3.2 | MIT |
| archiver-utils | 2.1.0 | MIT |
| array-buffer-byte-length | 1.0.2 | MIT |
| arraybuffer.prototype.slice | 1.0.4 | MIT |
| async | 3.2.6 | MIT |
| async-function | 1.0.0 | MIT |
| atomic-sleep | 1.0.0 | MIT |
| available-typed-arrays | 1.0.7 | MIT |
| base64-js | 1.5.1 | MIT |
| better-sqlite3 | 13.0.3 | MIT |
| big-integer | 1.6.52 | Unlicense |
| binary | 0.3.0 | MIT |
| bl | 4.1.0 | MIT |
| buffer | 5.7.1 | MIT |
| buffer-crc32 | 0.2.13 | MIT |
| buffer-indexof-polyfill | 1.0.2 | MIT |
| buffers | 0.1.1 | UNKNOWN |
| call-bind | 1.0.9 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| call-bound | 1.0.4 | MIT |
| chainsaw | 0.1.0 | MIT/X11 |
| compress-commons | 4.1.2 | MIT |
| concat-map | 0.0.1 | MIT |
| core-util-is | 1.0.3 | MIT |
| crc-32 | 1.2.2 | Apache-2.0 |
| crc32-stream | 4.0.3 | MIT |
| data-view-buffer | 1.0.2 | MIT |
| data-view-byte-length | 1.0.2 | MIT |
| data-view-byte-offset | 1.0.1 | MIT |
| dayjs | 1.11.23 | MIT |
| deepmerge-ts | 8.0.2 | BSD-3-Clause |
| define-data-property | 1.1.4 | MIT |
| define-properties | 1.2.1 | MIT |
| dingbat-to-unicode | 1.0.2 | BSD-2-Clause |
| dom-serializer | 2.0.0 | MIT |
| domelementtype | 2.3.0 | BSD-2-Clause |
| domhandler | 5.0.3 | BSD-2-Clause |
| domutils | 3.2.2 | BSD-2-Clause |
| duck | 0.1.12 | BSD |
| dunder-proto | 1.0.1 | MIT |
| duplexer2 | 0.1.4 | BSD-3-Clause |
| encoding-japanese | 2.4.0 | MIT |
| end-of-stream | 1.4.5 | MIT |
| entities | 4.5.0 | BSD-2-Clause |
| es-abstract | 1.24.2 | MIT |
| es-abstract-get | 1.0.0 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-object-atoms | 1.1.2 | MIT |
| es-set-tostringtag | 2.1.0 | MIT |
| es-to-primitive | 1.3.4 | MIT |
| escape-string-regexp | 4.0.0 | MIT |
| exceljs | 4.4.0 | MIT |
| fast-csv | 4.3.6 | MIT |
| for-each | 0.3.5 | MIT |
| fs-constants | 1.0.0 | MIT |
| fs.realpath | 1.0.0 | ISC |
| fstream | 1.0.12 | ISC |
| function-bind | 1.1.2 | MIT |
| function.prototype.name | 1.2.0 | MIT |
| functions-have-names | 1.2.3 | MIT |
| generator-function | 2.0.1 | MIT |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| get-symbol-description | 1.1.0 | MIT |
| glob | 7.2.3 | ISC |
| globalthis | 1.0.4 | MIT |
| gopd | 1.2.0 | MIT |
| graceful-fs | 4.2.11 | ISC |
| has-bigints | 1.1.0 | MIT |
| has-property-descriptors | 1.0.2 | MIT |
| has-proto | 1.2.0 | MIT |
| has-symbols | 1.1.0 | MIT |
| has-tostringtag | 1.0.2 | MIT |
| hasown | 2.0.4 | MIT |
| he | 1.2.0 | MIT |
| html-to-text | 10.0.1 | MIT |
| iconv-lite | 0.7.3 | MIT |
| ieee754 | 1.2.1 | BSD-3-Clause |
| imapflow | 2.9.1 | MIT |
| immediate | 3.0.6 | MIT |
| inflight | 1.0.6 | ISC |
| inherits | 2.0.4 | ISC |
| internal-slot | 1.1.0 | MIT |
| ip-address | 10.7.5 | MIT |
| is-array-buffer | 3.0.5 | MIT |
| is-async-function | 2.1.1 | MIT |
| is-bigint | 1.1.0 | MIT |
| is-boolean-object | 1.2.2 | MIT |
| is-callable | 1.2.7 | MIT |
| is-data-view | 1.0.2 | MIT |
| is-date-object | 1.1.0 | MIT |
| is-document.all | 1.0.0 | MIT |
| is-finalizationregistry | 1.1.1 | MIT |
| is-generator-function | 1.1.2 | MIT |
| is-map | 2.0.3 | MIT |
| is-negative-zero | 2.0.3 | MIT |
| is-number-object | 1.1.1 | MIT |
| is-plain-object | 5.1.0 | MIT |
| is-regex | 1.2.1 | MIT |
| is-set | 2.0.3 | MIT |
| is-shared-array-buffer | 1.0.4 | MIT |
| is-string | 1.1.1 | MIT |
| is-symbol | 1.1.1 | MIT |
| is-typed-array | 1.1.15 | MIT |
| is-weakmap | 2.0.2 | MIT |
| is-weakref | 1.1.1 | MIT |
| is-weakset | 2.0.4 | MIT |
| isarray | 1.0.0 | MIT |
| jszip | 3.10.2 | (MIT OR GPL-3.0-or-later) |
| launder | 1.7.2 | MIT |
| lazystream | 1.0.1 | MIT |
| leac | 0.7.0 | MIT |
| libbase64 | 1.4.1 | MIT |
| libmime | 5.6.3 | MIT |
| libqp | 3.0.1 | MIT |
| lie | 3.3.0 | MIT |
| linkify-it | 5.0.2 | MIT |
| listenercount | 1.0.1 | ISC |
| lodash.defaults | 4.2.0 | MIT |
| lodash.difference | 4.5.0 | MIT |
| lodash.escaperegexp | 4.1.2 | MIT |
| lodash.flatten | 4.4.0 | MIT |
| lodash.groupby | 4.6.0 | MIT |
| lodash.isboolean | 3.0.3 | MIT |
| lodash.isequal | 4.5.0 | MIT |
| lodash.isfunction | 3.0.9 | MIT |
| lodash.isnil | 4.0.0 | MIT |
| lodash.isplainobject | 4.0.6 | MIT |
| lodash.isundefined | 3.0.1 | MIT |
| lodash.union | 4.6.0 | MIT |
| lodash.uniq | 4.5.0 | MIT |
| lop | 0.4.2 | BSD-2-Clause |
| mailparser | 3.12.4 | MIT |
| mammoth | 1.13.0 | BSD-2-Clause |
| math-intrinsics | 1.1.0 | MIT |
| minimist | 1.2.8 | MIT |
| mkdirp | 0.5.6 | MIT |
| nanoid | 3.3.20 | MIT |
| node-addon-api | 8.9.2 | MIT |
| node-readable-to-web-readable-stream | 0.4.2 | MIT |
| nodemailer | 10.3.0 | MIT-0 |
| normalize-path | 3.0.0 | MIT |
| object-inspect | 1.13.4 | MIT |
| object-keys | 1.1.1 | MIT |
| object.assign | 4.1.7 | MIT |
| on-exit-leak-free | 2.1.2 | MIT |
| once | 1.4.0 | ISC |
| option | 0.2.4 | BSD-2-Clause |
| own-keys | 1.0.2 | MIT |
| pako | 1.0.11 | (MIT AND Zlib) |
| parse-srcset | 1.0.2 | MIT |
| parseley | 0.13.1 | MIT |
| path-is-absolute | 1.0.1 | MIT |
| pdfjs-dist | 5.4.624 | Apache-2.0 |
| peberminta | 0.10.0 | MIT |
| picocolors | 1.1.1 | ISC |
| pino | 10.3.1 | MIT |
| pino-abstract-transport | 3.0.0 | MIT |
| pino-std-serializers | 7.1.0 | MIT |
| possible-typed-array-names | 1.1.0 | MIT |
| postcss | 8.5.32 | MIT |
| process-nextick-args | 2.0.1 | MIT |
| process-warning | 5.1.1 | MIT |
| punycode.js | 2.3.1 | MIT |
| quick-format-unescaped | 4.0.4 | MIT |
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| readable-stream | 3.6.2 | MIT |
| readdir-glob | 1.1.3 | Apache-2.0 |
| real-require | 0.2.0 | MIT |
| reflect.getprototypeof | 1.0.10 | MIT |
| regexp.prototype.flags | 1.5.4 | MIT |
| rimraf | 2.6.3 | ISC |
| safe-array-concat | 1.1.4 | MIT |
| safe-buffer | 5.2.1 | MIT |
| safe-push-apply | 1.0.0 | MIT |
| safe-regex-test | 1.1.0 | MIT |
| safe-stable-stringify | 2.5.0 | MIT |
| safer-buffer | 2.1.2 | MIT |
| sanitize-html | 2.18.1 | MIT |
| saxes | 5.0.1 | ISC |
| scheduler | 0.28.0 | MIT |
| selderee | 0.12.0 | MIT |
| set-function-length | 1.2.2 | MIT |
| set-function-name | 2.0.2 | MIT |
| set-proto | 1.0.0 | MIT |
| setimmediate | 1.0.5 | MIT |
| side-channel | 1.1.1 | MIT |
| side-channel-list | 1.0.1 | MIT |
| side-channel-map | 1.0.1 | MIT |
| side-channel-weakmap | 1.0.2 | MIT |
| smart-buffer | 4.2.0 | MIT |
| socks | 2.8.10 | MIT |
| sonic-boom | 4.2.1 | MIT |
| source-map-js | 1.2.2 | BSD-3-Clause |
| split2 | 4.2.0 | ISC |
| stop-iteration-iterator | 1.1.0 | MIT |
| string_decoder | 1.3.0 | MIT |
| string.prototype.trim | 1.2.11 | MIT |
| string.prototype.trimend | 1.0.10 | MIT |
| string.prototype.trimstart | 1.0.8 | MIT |
| tar-stream | 2.2.0 | MIT |
| thread-stream | 4.2.0 | MIT |
| tlds | 1.261.0 | MIT |
| tmp | 0.2.7 | MIT |
| traverse | 0.3.10 | MIT |
| typed-array-buffer | 1.0.3 | MIT |
| typed-array-byte-length | 1.0.3 | MIT |
| typed-array-byte-offset | 1.0.5 | MIT |
| typed-array-length | 1.0.8 | MIT |
| typedarray.prototype.slice | 1.0.6 | MIT |
| uc.micro | 2.1.0 | MIT |
| unbox-primitive | 1.1.0 | MIT |
| underscore | 1.13.8 | MIT |
| util-deprecate | 1.0.2 | MIT |
| uuid | 8.3.2 | MIT |
| which-boxed-primitive | 1.1.1 | MIT |
| which-builtin-type | 1.2.1 | MIT |
| which-collection | 1.0.2 | MIT |
| which-typed-array | 1.1.24 | MIT |
| wrappy | 1.0.2 | ISC |
| xmlbuilder | 10.1.1 | MIT |
| xmlchars | 2.2.0 | MIT |
| zip-stream | 4.1.1 | MIT |
| zod | 4.6.7 | MIT |

## Full development dependency tree

Not shipped in the installer.

| Package | Version | Licence |
|---|---|---|
| @acemir/cssom | 0.9.32 | MIT |
| @asamuzakjp/css-color | 4.1.2 | MIT |
| @asamuzakjp/dom-selector | 6.8.1 | MIT |
| @asamuzakjp/nwsapi | 2.3.9 | MIT |
| @babel/code-frame | 7.29.7 | MIT |
| @babel/compat-data | 7.29.7 | MIT |
| @babel/core | 7.29.7 | MIT |
| @babel/generator | 7.29.8 | MIT |
| @babel/helper-compilation-targets | 7.29.7 | MIT |
| @babel/helper-globals | 7.29.7 | MIT |
| @babel/helper-module-imports | 7.29.7 | MIT |
| @babel/helper-module-transforms | 7.29.7 | MIT |
| @babel/helper-plugin-utils | 7.29.7 | MIT |
| @babel/helper-string-parser | 7.29.11 | MIT |
| @babel/helper-validator-identifier | 7.29.7 | MIT |
| @babel/helper-validator-option | 7.29.7 | MIT |
| @babel/helpers | 7.29.10 | MIT |
| @babel/parser | 7.29.11 | MIT |
| @babel/plugin-transform-arrow-functions | 7.29.7 | MIT |
| @babel/template | 7.29.7 | MIT |
| @babel/traverse | 7.29.10 | MIT |
| @babel/types | 7.29.11 | MIT |
| @csstools/color-helpers | 6.1.2 | MIT-0 |
| @csstools/css-calc | 3.4.3 | MIT |
| @csstools/css-color-parser | 4.2.6 | MIT |
| @csstools/css-parser-algorithms | 4.0.2 | MIT |
| @csstools/css-syntax-patches-for-csstree | 1.1.15 | MIT-0 |
| @csstools/css-tokenizer | 4.0.2 | MIT |
| @electron-internal/extract-zip | 1.0.7 | MIT |
| @electron/asar | 3.4.1 | MIT |
| @electron/fuses | 1.8.0 | MIT |
| @electron/get | 5.1.0 | MIT |
| @electron/notarize | 2.5.0 | MIT |
| @electron/osx-sign | 1.3.3 | BSD-2-Clause |
| @electron/rebuild | 4.2.1 | MIT |
| @electron/universal | 2.0.3 | MIT |
| @electron/windows-sign | 1.2.2 | BSD-2-Clause |
| @isaacs/fs-minipass | 4.0.1 | ISC |
| @jridgewell/gen-mapping | 0.3.13 | MIT |
| @jridgewell/remapping | 2.3.5 | MIT |
| @jridgewell/resolve-uri | 3.1.2 | MIT |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT |
| @jridgewell/trace-mapping | 0.3.31 | MIT |
| @malept/cross-spawn-promise | 2.0.0 | Apache-2.0 |
| @malept/flatpak-bundler | 0.4.0 | MIT |
| @noble/hashes | 1.8.0 | MIT |
| @oxc-project/types | 0.155.0 | MIT |
| @peculiar/asn1-schema | 2.11.1 | MIT |
| @peculiar/json-schema | 1.1.12 | MIT |
| @peculiar/utils | 2.0.3 | MIT |
| @peculiar/webcrypto | 1.7.2 | MIT |
| @playwright/test | 1.64.1 | Apache-2.0 |
| @rolldown/binding-android-arm-eabi | 1.2.15 | MIT |
| @rolldown/binding-android-arm64 | 1.2.15 | MIT |
| @rolldown/binding-darwin-arm64 | 1.2.15 | MIT |
| @rolldown/binding-darwin-x64 | 1.2.15 | MIT |
| @rolldown/binding-freebsd-x64 | 1.2.15 | MIT |
| @rolldown/binding-linux-arm-gnueabihf | 1.2.15 | MIT |
| @rolldown/binding-linux-arm64-gnu | 1.2.15 | MIT |
| @rolldown/binding-linux-arm64-musl | 1.2.15 | MIT |
| @rolldown/binding-linux-ppc64-gnu | 1.2.15 | MIT |
| @rolldown/binding-linux-s390x-gnu | 1.2.15 | MIT |
| @rolldown/binding-linux-x64-gnu | 1.2.15 | MIT |
| @rolldown/binding-linux-x64-musl | 1.2.15 | MIT |
| @rolldown/binding-openharmony-arm64 | 1.2.15 | MIT |
| @rolldown/binding-win32-arm64-msvc | 1.2.15 | MIT |
| @rolldown/binding-win32-x64-msvc | 1.2.15 | MIT |
| @rolldown/pluginutils | 1.0.1 | MIT |
| @sindresorhus/is | 4.6.0 | MIT |
| @szmarczak/http-timer | 4.0.6 | MIT |
| @types/better-sqlite3 | 7.6.13 | MIT |
| @types/cacheable-request | 6.0.3 | MIT |
| @types/chai | 5.2.3 | MIT |
| @types/debug | 4.1.13 | MIT |
| @types/deep-eql | 4.0.2 | MIT |
| @types/estree | 1.0.10 | MIT |
| @types/fs-extra | 9.0.13 | MIT |
| @types/http-cache-semantics | 4.2.0 | MIT |
| @types/keyv | 3.1.4 | MIT |
| @types/ms | 2.1.0 | MIT |
| @types/node | 22.19.1 | MIT |
| @types/react | 19.2.2 | MIT |
| @types/react-dom | 19.2.1 | MIT |
| @types/responselike | 1.0.3 | MIT |
| @types/sanitize-html | 2.16.0 | MIT |
| @vitejs/plugin-react | 6.1.2 | MIT |
| @vitest/mocker | 5.0.5 | MIT |
| @vitest/spy | 5.0.5 | MIT |
| abbrev | 4.0.0 | ISC |
| agent-base | 7.1.4 | MIT |
| ajv | 8.20.0 | MIT |
| ansi-regex | 5.0.1 | MIT |
| ansi-styles | 4.3.0 | MIT |
| app-builder-lib | 26.18.0 | MIT |
| argparse | 2.0.1 | Python-2.0 |
| asn1js | 3.1.0 | BSD-3-Clause |
| assertion-error | 2.0.1 | MIT |
| async-exit-hook | 2.0.1 | MIT |
| asynckit | 0.4.0 | MIT |
| at-least-node | 1.0.0 | ISC |
| aws4 | 1.13.2 | MIT |
| balanced-match | 4.0.4 | MIT |
| baseline-browser-mapping | 2.11.34 | Apache-2.0 |
| bidi-js | 1.1.0 | MIT |
| bluebird | 3.7.2 | MIT |
| boolean | 3.2.0 | MIT |
| brace-expansion | 5.0.12 | MIT |
| browserslist | 4.29.5 | MIT |
| buffer-from | 1.1.2 | MIT |
| builder-util | 26.16.0 | MIT |
| builder-util-runtime | 9.7.0 | MIT |
| bytestreamjs | 2.0.1 | BSD-3-Clause |
| cac | 7.1.0 | MIT |
| cacheable-lookup | 5.0.4 | MIT |
| cacheable-request | 7.0.4 | MIT |
| caniuse-lite | 1.0.30001819 | CC-BY-4.0 |
| chai | 6.3.0 | MIT |
| chalk | 4.1.2 | MIT |
| chownr | 3.0.0 | BlueOak-1.0.0 |
| chromium-pickle-js | 0.2.0 | MIT |
| ci-info | 4.4.0 | MIT |
| cliui | 8.0.1 | ISC |
| clone-response | 1.0.3 | MIT |
| color-convert | 2.0.1 | MIT |
| color-name | 1.1.4 | MIT |
| combined-stream | 1.0.8 | MIT |
| commander | 5.1.0 | MIT |
| compare-version | 0.1.2 | MIT |
| convert-source-map | 2.0.0 | MIT |
| cross-dirname | 0.1.0 | MIT |
| cross-spawn | 7.0.6 | MIT |
| css-tree | 3.2.1 | MIT |
| cssstyle | 5.3.7 | MIT |
| csstype | 3.2.3 | MIT |
| data-urls | 6.0.1 | MIT |
| debug | 4.4.3 | MIT |
| decimal.js | 10.6.0 | MIT |
| decompress-response | 6.0.0 | MIT |
| defer-to-connect | 2.0.1 | MIT |
| delayed-stream | 1.0.0 | MIT |
| detect-libc | 2.1.2 | Apache-2.0 |
| detect-node | 2.1.0 | MIT |
| dir-compare | 4.2.0 | MIT |
| dmg-builder | 26.18.0 | MIT |
| dotenv | 16.6.1 | BSD-2-Clause |
| dotenv-expand | 11.0.7 | BSD-2-Clause |
| ejs | 3.1.10 | Apache-2.0 |
| electron | 45.1.0 | MIT |
| electron-builder | 26.18.0 | MIT |
| electron-builder-squirrel-windows | 26.18.0 | MIT |
| electron-publish | 26.18.0 | MIT |
| electron-to-chromium | 1.5.467 | ISC |
| electron-vite | 6.0.0 | MIT |
| electron-winstaller | 5.4.0 | MIT |
| emoji-regex | 8.0.0 | MIT |
| env-paths | 3.0.0 | MIT |
| err-code | 2.0.3 | MIT |
| es-module-lexer | 2.3.2 | MIT |
| es6-error | 4.1.1 | MIT |
| escalade | 3.2.0 | MIT |
| estree-walker | 3.0.3 | MIT |
| expect-type | 1.4.0 | Apache-2.0 |
| exponential-backoff | 3.1.3 | Apache-2.0 |
| fast-deep-equal | 3.1.3 | MIT |
| fast-uri | 3.1.9 | BSD-3-Clause |
| fdir | 6.5.0 | MIT |
| filelist | 1.0.6 | Apache-2.0 |
| form-data | 4.0.6 | MIT |
| fs-extra | 10.1.0 | MIT |
| fsevents | 2.3.3 | MIT |
| gensync | 1.0.0-beta.2 | MIT |
| get-caller-file | 2.0.5 | ISC |
| get-stream | 5.2.0 | MIT |
| global-agent | 3.0.0 | BSD-3-Clause |
| got | 11.8.6 | MIT |
| has-flag | 4.0.0 | MIT |
| hosted-git-info | 4.1.0 | ISC |
| html-encoding-sniffer | 4.0.0 | MIT |
| htmlparser2 | 8.0.2 | MIT |
| http-cache-semantics | 4.3.0 | BSD-2-Clause |
| http-proxy-agent | 7.0.2 | MIT |
| http2-wrapper | 1.0.3 | MIT |
| https-proxy-agent | 7.0.6 | MIT |
| is-fullwidth-code-point | 3.0.0 | MIT |
| is-potential-custom-element-name | 1.0.1 | MIT |
| isbinaryfile | 5.0.7 | MIT |
| isexe | 3.1.5 | BlueOak-1.0.0 |
| jake | 10.9.4 | Apache-2.0 |
| jiti | 2.7.0 | MIT |
| js-tokens | 4.0.0 | MIT |
| js-yaml | 4.3.2 | MIT |
| jsdom | 27.1.0 | MIT |
| jsesc | 3.1.0 | MIT |
| json-buffer | 3.0.1 | MIT |
| json-schema-traverse | 1.0.0 | MIT |
| json-stringify-safe | 5.0.1 | ISC |
| json5 | 2.2.3 | MIT |
| jsonfile | 6.2.1 | MIT |
| keyv | 4.5.4 | MIT |
| lazy-val | 1.0.5 | MIT |
| lightningcss | 1.33.0 | MPL-2.0 |
| lightningcss-android-arm64 | 1.33.0 | MPL-2.0 |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 |
| lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 |
| lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 |
| lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 |
| lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 |
| lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 |
| lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 |
| lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 |
| lodash | 4.18.1 | MIT |
| lowercase-keys | 2.0.0 | MIT |
| lru-cache | 5.1.1 | ISC |
| magic-string | 1.4.5 | MIT |
| matcher | 3.0.0 | MIT |
| mdn-data | 2.27.1 | CC0-1.0 |
| mime | 2.6.0 | MIT |
| mime-db | 1.52.0 | MIT |
| mime-types | 2.1.35 | MIT |
| mimic-response | 1.0.1 | MIT |
| minimatch | 10.2.6 | BlueOak-1.0.0 |
| minipass | 7.1.3 | BlueOak-1.0.0 |
| minizlib | 3.1.0 | MIT |
| ms | 2.1.3 | MIT |
| node-abi | 4.40.0 | MIT |
| node-api-version | 0.2.1 | MIT |
| node-gyp | 12.4.0 | MIT |
| node-int64 | 0.4.0 | MIT |
| node-releases | 2.0.60 | MIT |
| nopt | 9.0.0 | ISC |
| normalize-url | 6.1.0 | MIT |
| obug | 3.0.0 | MIT |
| p-cancelable | 2.1.1 | MIT |
| p-limit | 3.1.0 | MIT |
| parse5 | 8.0.1 | MIT |
| path-key | 3.1.1 | MIT |
| pe-library | 0.4.1 | MIT |
| picomatch | 4.0.7 | MIT |
| pkijs | 3.4.3 | BSD-3-Clause |
| playwright | 1.64.1 | Apache-2.0 |
| playwright-core | 1.64.1 | Apache-2.0 |
| plist | 3.1.0 | MIT |
| postject | 1.0.0-alpha.6 | MIT |
| proc-log | 6.1.0 | ISC |
| progress | 2.0.3 | MIT |
| promise-retry | 2.0.1 | MIT |
| proper-lockfile | 4.1.2 | MIT |
| pump | 3.0.4 | MIT |
| punycode | 2.3.1 | MIT |
| pvtsutils | 1.3.6 | MIT |
| pvutils | 1.2.0 | MIT |
| quick-lru | 5.1.1 | MIT |
| read-binary-file-arch | 1.0.6 | MIT |
| require-directory | 2.1.1 | MIT |
| require-from-string | 2.0.2 | MIT |
| resedit | 1.7.2 | MIT |
| resolve-alpn | 1.2.1 | MIT |
| responselike | 2.0.1 | MIT |
| retry | 0.12.0 | MIT |
| roarr | 2.15.4 | BSD-3-Clause |
| rolldown | 1.2.15 | MIT |
| sanitize-filename | 1.6.4 | WTFPL OR ISC |
| sax | 1.6.1 | BlueOak-1.0.0 |
| semver | 7.8.5 | ISC |
| semver-compare | 1.0.0 | MIT |
| serialize-error | 7.0.1 | MIT |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| signal-exit | 3.0.7 | ISC |
| simple-update-notifier | 2.0.0 | MIT |
| source-map | 0.6.1 | BSD-3-Clause |
| source-map-support | 0.5.21 | MIT |
| sprintf-js | 1.1.3 | BSD-3-Clause |
| stat-mode | 1.0.0 | MIT |
| std-env | 4.3.0 | MIT |
| string-width | 4.2.3 | MIT |
| strip-ansi | 6.0.1 | MIT |
| sumchecker | 3.0.1 | Apache-2.0 |
| supports-color | 7.2.0 | MIT |
| symbol-tree | 3.2.4 | MIT |
| tar | 7.5.22 | BlueOak-1.0.0 |
| temp | 0.9.4 | MIT |
| temp-file | 3.4.0 | MIT |
| tiny-async-pool | 1.3.0 | MIT |
| tinybench | 6.2.2 | MIT |
| tinyexec | 1.3.1 | MIT |
| tinyglobby | 0.2.17 | MIT |
| tldts | 7.4.19 | MIT |
| tldts-core | 7.4.20 | MIT |
| tmp-promise | 3.0.3 | MIT |
| tough-cookie | 6.0.2 | BSD-3-Clause |
| tr46 | 6.0.0 | MIT |
| truncate-utf8-bytes | 1.0.2 | WTFPL |
| tslib | 2.8.1 | 0BSD |
| type-fest | 0.13.1 | (MIT OR CC0-1.0) |
| typescript | 5.9.3 | Apache-2.0 |
| undici | 7.30.1 | MIT |
| undici-types | 6.21.0 | MIT |
| universalify | 2.0.1 | MIT |
| unzipper | 0.12.5 | MIT |
| update-browserslist-db | 1.3.4 | MIT |
| utf8-byte-length | 1.0.5 | (WTFPL OR MIT) |
| vite | 8.3.5 | MIT |
| vitest | 5.0.5 | MIT |
| w3c-xmlserializer | 5.0.0 | MIT |
| webcrypto-core | 1.9.2 | MIT |
| webidl-conversions | 8.0.1 | BSD-2-Clause |
| whatwg-encoding | 3.1.1 | MIT |
| whatwg-mimetype | 4.0.0 | MIT |
| whatwg-url | 15.1.0 | MIT |
| which | 5.0.0 | ISC |
| why-is-node-running | 3.2.1 | MIT |
| wrap-ansi | 7.0.0 | MIT |
| ws | 8.22.0 | MIT |
| xml-name-validator | 5.0.0 | Apache-2.0 |
| y18n | 5.0.8 | ISC |
| yallist | 3.1.1 | ISC |
| yargs | 17.7.3 | MIT |
| yargs-parser | 21.1.1 | ISC |
| yocto-queue | 0.1.0 | MIT |
