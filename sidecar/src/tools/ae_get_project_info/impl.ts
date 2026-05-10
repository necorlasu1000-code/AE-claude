// Phase 5.2.1 -- ae_get_project_info ExtendScript impl (read-only,
// comp lane 1/3, 5.2 entry).
//
// Project metadata snapshot. No active comp dependency -- works on any
// project state including empty/unsaved (no AENoActiveCompError throw
// path). Reads app.version + 5 Project class fields.
//
// Field source mapping (types-for-adobe AE 22.0):
//   file               <- app.project.file (File | null; null when unsaved)
//   numItems           <- app.project.numItems
//   bitsPerChannel     <- app.project.bitsPerChannel
//   expressionEngine   <- app.project.expressionEngine
//   displayStartFrame  <- app.project.displayStartFrame
//   hostVersion        <- app.version (Application class, sourced separately)
//
// Mistakes #17 -- no detached method calls. file.fsName / file.name are
// properties (not methods), so receiver guard isn't applicable to them;
// they're read directly. No comp.layer/project.item/layer.property calls
// in this tool (no candidate for the receiver-guard pattern).
//
// Mistakes #18 -- not relevant (no display-name lookup; Project fields
// are direct property access).
//
// AST validator (D7) compliance: dot-notation only.

import {
  defineJsxTool,
  type JsxFileLike,
} from "../../../../src/jsx/aeft/tools/_define";

export interface AeGetProjectInfoInput {
  // intentionally empty
}

export interface AeGetProjectInfoOutput {
  file: { path: string; name: string } | null;
  numItems: number;
  bitsPerChannel: number;
  expressionEngine: "extendscript" | "javascript-1.0";
  displayStartFrame: number;
  hostVersion: string;
}

export const ae_get_project_info = defineJsxTool<AeGetProjectInfoInput, AeGetProjectInfoOutput>(
  function (_input, ctx, _h) {
    var project = ctx.app.project;

    // ---- Project file (saved state) -------------------------------------
    // file is null when project is unsaved (production AE returns null on
    // new untitled project). Treat undefined the same as null (mock
    // fixtures may omit the field entirely).
    var fileOut: { path: string; name: string } | null = null;
    var rawFile: JsxFileLike | null | undefined = project.file;
    if (rawFile) {
      // fsName / name are properties (not methods); direct read.
      fileOut = {
        path: typeof rawFile.fsName === "string" ? rawFile.fsName : "",
        name: typeof rawFile.name === "string" ? rawFile.name : "",
      };
    }

    // ---- Numeric / enum / string fields ---------------------------------
    // Defensive defaults preserve a valid output shape when an older
    // mock fixture omits a field. Production AE always populates these;
    // defaults only fire in vitest.
    var numItems = typeof project.numItems === "number" ? project.numItems : 0;
    var bitsPerChannel = typeof project.bitsPerChannel === "number" ? project.bitsPerChannel : 8;
    var expressionEngine: "extendscript" | "javascript-1.0" =
      project.expressionEngine === "extendscript" ? "extendscript" : "javascript-1.0";
    var displayStartFrame = typeof project.displayStartFrame === "number" ? project.displayStartFrame : 0;
    var hostVersion = typeof ctx.app.version === "string" ? ctx.app.version : "";

    return {
      file: fileOut,
      numItems: numItems,
      bitsPerChannel: bitsPerChannel,
      expressionEngine: expressionEngine,
      displayStartFrame: displayStartFrame,
      hostVersion: hostVersion,
    };
  },
);
