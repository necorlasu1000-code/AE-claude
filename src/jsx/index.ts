// @include './_polyfills/json2.js'

import { ns } from "../shared/shared";

// IMPORTANT: named imports + manual object literal, NOT `import * as aeft`
// — rollup synthesizes namespace imports as `{ __proto__: null, ...members }`
// which ExtendScript SpiderMonkey throws on when setting prototype to null
// (mistakes.md #11 third face / CLAUDE.md Validation Gate §11). Adding a
// new aeft export = one named import + one object-literal entry.
import {
  helloError,
  helloStr,
  helloNum,
  helloArrayStr,
  helloObj,
  helloVoid,
  helloWorld,
  tools,
} from "./aeft/aeft";
const aeft = {
  helloError,
  helloStr,
  helloNum,
  helloArrayStr,
  helloObj,
  helloVoid,
  helloWorld,
  tools,
};

//@ts-ignore
const host = typeof $ !== "undefined" ? $ : window;

// A safe way to get the app name since some versions of Adobe Apps broken BridgeTalk in various places (e.g. After Effects 24-25)
// in that case we have to do various checks per app to deterimine the app name

const getAppNameSafely = (): ApplicationName | "unknown" => {
  const compare = (a: string, b: string) => {
    return a.toLowerCase().indexOf(b.toLowerCase()) > -1;
  };
  const exists = (a: any) => typeof a !== "undefined";
  const isBridgeTalkWorking =
    typeof BridgeTalk !== "undefined" &&
    typeof BridgeTalk.appName !== "undefined";

  if (isBridgeTalkWorking) {
    return BridgeTalk.appName;
  } else if (app) {
    //@ts-ignore
    if (exists(app.name)) {
      //@ts-ignore
      const name: string = app.name;
      if (compare(name, "photoshop")) return "photoshop";
      if (compare(name, "illustrator")) return "illustrator";
      if (compare(name, "audition")) return "audition";
      if (compare(name, "bridge")) return "bridge";
      if (compare(name, "indesign")) return "indesign";
    }
    //@ts-ignore
    if (exists(app.appName)) {
      //@ts-ignore
      const appName: string = app.appName;
      if (compare(appName, "after effects")) return "aftereffects";
      if (compare(appName, "animate")) return "animate";
    }
    //@ts-ignore
    if (exists(app.path)) {
      //@ts-ignore
      const path = app.path;
      if (compare(path, "premiere")) return "premierepro";
    }
    //@ts-ignore
    if (exists(app.getEncoderHost) && exists(AMEFrontendEvent)) {
      return "ame";
    }
  }
  return "unknown";
};

switch (getAppNameSafely()) {
  case "aftereffects":
  case "aftereffectsbeta":
    host[ns] = aeft;
    break;

  default:
    // Phase 3.7 follow-up — fail-safe registration for AE-only project.
    // bolt-cep boilerplate's switch assumes getAppNameSafely() returns
    // exactly "aftereffects" / "aftereffectsbeta". Real production
    // returns vary: BridgeTalk.appName can be versioned (e.g.
    // "aftereffects-22.0") on host versions where BridgeTalk is intact;
    // the literal-match cases would miss those. Since this project is
    // AE-only (D2 hold scope), always register here as the fallback so
    // `$[ns].tools.<tool>(...)` never lookups undefined. See
    // mistakes.md #11 "jsx host 등록 면" for the trap detail.
    host[ns] = aeft;
    break;
  }

const empty = {};
// prettier-ignore
export type Scripts = typeof empty
  & typeof aeft 
  ;

// https://extendscript.docsforadobe.dev/interapplication-communication/bridgetalk-class.html?highlight=bridgetalk#appname
type ApplicationName =
  | "aftereffects"
  | "aftereffectsbeta"
  | "ame"
  | "amebeta"
  | "audition"
  | "auditionbeta"
  | "animate"
  | "animatebeta"
  | "bridge"
  | "bridgebeta"
  // | "flash"
  | "illustrator"
  | "illustratorbeta"
  | "indesign"
  | "indesignbeta"
  // | "indesignserver"
  | "photoshop"
  | "photoshopbeta"
  | "premierepro"
  | "premiereprobeta";
