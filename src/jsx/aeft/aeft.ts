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

// Phase 3.3 — AE-Claude tools sub-namespace. Panel calls
// `ns.tools.<tool>(rawInput)` via CSInterface.evalScript.
import * as tools from "./tools";
export { tools };

export const helloWorld = () => {
  alert("Hello from After Effects!");
  app.project.activeItem;
};
