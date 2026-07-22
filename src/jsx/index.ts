// @include './_polyfills/json2.js'

import { ns } from "../shared/shared";

// IMPORTANT: named imports + manual object literal, NOT `import * as aeft`
// -- rollup synthesizes namespace imports as a null-prototype object literal
// (proto set to null), which ExtendScript SpiderMonkey throws on when it tries
// to set the prototype to null (mistakes.md #11 third face / CLAUDE.md
// Validation Gate section 11). Adding a new aeft export = one named import
// + one object-literal entry.
import { tools } from "./aeft/aeft";
const aeft = { tools };

//@ts-ignore
const host = typeof $ !== "undefined" ? $ : window;

// AE-only project (D2 hold scope): register unconditionally. The bolt-cep
// boilerplate branched on getAppNameSafely() to pick a per-host object, but
// every branch here resolved to `aeft`, and production BridgeTalk.appName can
// be versioned (e.g. "aftereffects-22.0") which a literal switch would miss.
// A single unconditional assignment is both the fail-safe and the only case
// we need, so `$[ns].tools.<tool>(...)` never looks up undefined
// (mistakes.md #11 "jsx host registration face" / CLAUDE.md gate section 10).
host[ns] = aeft;

const empty = {};
// prettier-ignore
export type Scripts = typeof empty
  & typeof aeft
  ;
