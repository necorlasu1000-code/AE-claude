import {
  helloVoid,
  helloError,
  helloStr,
  helloNum,
  helloArrayStr,
  helloObj,
} from "../utils/samples";
export { helloError, helloStr, helloNum, helloArrayStr, helloObj, helloVoid };
import { dispatchTS } from "../utils/utils";

// Phase 3.3 -- AE-Claude tools sub-namespace. Panel calls
// `ns.tools.<tool>(rawInput)` via CSInterface.evalScript.
//
// IMPORTANT: named imports + object literal, NOT `import * as tools` --
// rollup builds namespace imports as `{ __proto__: null, ...members }`
// which throws in ExtendScript SpiderMonkey when it tries to set the
// prototype to null (mistakes.md #11 third face). Phase 5 30-tool
// authors add one named import + one object-literal entry per tool.
import {
  ae_get_active_comp,
  ae_list_comps,
  ae_get_layers,
  ae_list_effects,
  ae_get_expression,
  ae_get_keyframes,
  ae_get_project_info,
} from "./tools";
export const tools = {
  ae_get_active_comp,
  ae_list_comps,
  ae_get_layers,
  ae_list_effects,
  ae_get_expression,
  ae_get_keyframes,
  ae_get_project_info,
};

export const helloWorld = () => {
  alert("Hello from After Effects!");
  app.project.activeItem;
};
