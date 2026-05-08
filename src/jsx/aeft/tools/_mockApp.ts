// Phase 3.3 -- test-only mock factories for AE Application + items.
//
// Used by per-tool handler.test.ts files. Phase 5 (30 tools) reuses the
// same factory shape -- extend fields here, not per-tool. Production jsx
// code never imports this (only tests do; bolt-cep build excludes via
// the shared *.test.ts pattern).

import type {
  JsxAppLike,
  JsxCompItem,
  JsxItemLike,
  JsxLayerLike,
  JsxProjectLike,
  JsxPropertyGroupLike,
  JsxPropertyLike,
} from "./_define";

// Phase 5.1.5 -- Layer subclass discriminator. Real AE returns
// "[object CameraLayer]" etc. from layer.toString(); mock fixtures
// override toString to match so impl.ts uses one reflection pattern
// for both environments. Production AE class names per
// types-for-adobe AE 22.0.
export type MockLayerType =
  | "AVLayer"
  | "CameraLayer"
  | "LightLayer"
  | "ShapeLayer"
  | "TextLayer";

export interface MockLayerOpts {
  type?: MockLayerType;
  index?: number;
  name?: string;
  matchName?: string;
  enabled?: boolean;
  locked?: boolean;
  inPoint?: number;
  outPoint?: number;
  /** Phase 5.1.6 -- effects PropertyGroup mock. When provided, the layer's
   *  property("ADBE Effect Parade") returns a JsxPropertyGroupLike whose
   *  property(i) iterates these. When undefined the property method
   *  itself is omitted (Camera/Light/Null layers in production AE throw on
   *  the lookup -- our mock omits the method to mirror that fail mode
   *  without inventing a custom exception type). */
  effects?: JsxPropertyLike[];
  /** Phase 5.1.7 -- direct matchName -> Property lookup map. Used by
   *  ae_get_expression (and future tools that resolve a single named
   *  property like "ADBE Position", "ADBE Anchor Point"). Coexists with
   *  effects -- effects parade is gated by matchName === "ADBE Effect
   *  Parade", and any other matchName is checked against this map. When
   *  the matchName is not in the map (and not Effect Parade), the mock
   *  throws to mirror production AE's "property not found" fail mode. */
  properties?: Record<string, JsxPropertyLike>;
}

export function makeMockLayer(opts?: MockLayerOpts): JsxLayerLike {
  var o = opts || {};
  var type: MockLayerType = o.type !== undefined ? o.type : "AVLayer";
  var effects = o.effects;
  var properties = o.properties;

  // Phase 5.1.6 -- when effects opts is provided, expose property(matchName)
  // that returns a guarded PropertyGroup mock for "ADBE Effect Parade".
  // Phase 5.1.7 -- properties map adds direct matchName -> Property lookup
  // for non-Effect-Parade names. Either fixture (or both) presence enables
  // the property method; absence keeps it omitted (production AE Camera/
  // Light/Null layer fail mode mirror).
  var propertyMethod: JsxLayerLike["property"];
  if (effects !== undefined || properties !== undefined) {
    propertyMethod = function (matchName: string): JsxPropertyGroupLike {
      if (matchName === "ADBE Effect Parade") {
        if (effects === undefined) {
          throw new Error("Mock layer.property: 'ADBE Effect Parade' not modeled (no effects opts)");
        }
        return makeMockEffectsParade(effects);
      }
      if (properties && Object.prototype.hasOwnProperty.call(properties, matchName)) {
        // Cast through unknown -- JsxPropertyLike does not extend
        // JsxPropertyGroupLike, but Layer.property() in real AE returns
        // _PropertyClasses (Property | PropertyGroup union). Tests that
        // probe expression fields read the JsxPropertyLike shape; the
        // shared signature lets us widen here without splitting return
        // types per-tool.
        return properties[matchName] as unknown as JsxPropertyGroupLike;
      }
      throw new Error("Mock layer.property: matchName '" + matchName + "' not modeled");
    };
  }

  var layer: JsxLayerLike = {
    index: o.index !== undefined ? o.index : 1,
    name: o.name !== undefined ? o.name : "MockLayer",
    matchName: o.matchName !== undefined ? o.matchName : "ADBE Mock Layer",
    enabled: o.enabled !== undefined ? o.enabled : true,
    locked: o.locked !== undefined ? o.locked : false,
    inPoint: o.inPoint !== undefined ? o.inPoint : 0,
    outPoint: o.outPoint !== undefined ? o.outPoint : 5,
    // Override toString so layer.toString() returns "[object CameraLayer]"
    // in the same shape production AE produces. impl.ts uses this for type
    // discrimination (Object.prototype.toString.call equivalent). Without
    // the override, vanilla JS toString returns "[object Object]" and the
    // regex extracts "Object" as the type -- mistakes #11 mock-vs-prod
    // family if we forgot. Production AE engine handles this internally;
    // mock must match the contract.
    toString: function () {
      return "[object " + type + "]";
    },
  };
  if (propertyMethod) layer.property = propertyMethod;
  return layer;
}

// Phase 5.1.6 -- helpers for effects parade fixtures. makeMockEffect
// builds a single PropertyBase entry; makeMockEffectsParade wraps an
// array into a JsxPropertyGroupLike with numProperties + property(i)
// receiver-guarded (mistakes #17 pattern).
export interface MockEffectOpts {
  matchName?: string;
  name?: string;
  enabled?: boolean;
}

export function makeMockEffect(opts?: MockEffectOpts): JsxPropertyLike {
  var o = opts || {};
  return {
    matchName: o.matchName !== undefined ? o.matchName : "ADBE Mock Effect",
    name: o.name !== undefined ? o.name : "Mock Effect",
    enabled: o.enabled !== undefined ? o.enabled : true,
  };
}

// Phase 5.1.7 -- general-purpose PropertyLike fixture for expression-
// bearing leaf properties (transforms, effect controls, etc.). Distinct
// from makeMockEffect (which models PropertyGroup-shaped effect entries
// without expression fields) so the test author opts into expression
// semantics explicitly.
export interface MockPropertyOpts {
  matchName?: string;
  name?: string;
  enabled?: boolean;
  expression?: string;
  expressionEnabled?: boolean;
}

export function makeMockProperty(opts?: MockPropertyOpts): JsxPropertyLike {
  var o = opts || {};
  return {
    matchName: o.matchName !== undefined ? o.matchName : "ADBE Mock Property",
    name: o.name !== undefined ? o.name : "Mock Property",
    enabled: o.enabled !== undefined ? o.enabled : true,
    expression: o.expression !== undefined ? o.expression : "",
    expressionEnabled: o.expressionEnabled !== undefined ? o.expressionEnabled : false,
  };
}

export function makeMockEffectsParade(effects: JsxPropertyLike[]): JsxPropertyGroupLike {
  var group: JsxPropertyGroupLike;
  group = {
    matchName: "ADBE Effect Parade",
    name: "Effects",
    enabled: true,
    numProperties: effects.length,
    property: function (this: unknown, index: number) {
      if (this !== group) {
        throw new Error(
          "Mock this-binding violation: effectsParade.property called with " +
          "wrong receiver. ExtendScript SpiderMonkey throws on detached " +
          "calls. Use group.property(i) directly. See mistakes.md #17."
        );
      }
      return effects[index - 1] as JsxPropertyLike;
    },
  };
  return group;
}

export interface MockCompOpts {
  name?: string;
  id?: number;
  duration?: number;
  frameRate?: number;
  width?: number;
  height?: number;
  numLayers?: number;
  /** Phase 5.1.5 -- LayerCollection mock. layers[0] becomes layer(1)
   *  (1-based per ExtendScript convention); numLayers auto-derived from
   *  layers.length when provided (overrides numLayers field). */
  layers?: JsxLayerLike[];
}

export function makeMockComp(opts?: MockCompOpts): JsxCompItem {
  var o = opts || {};
  var layers = o.layers || [];
  // Phase 5.1.5 (mistakes #17) -- comp.layer(i) receiver guard mirrors
  // makeMockProject.item. Detached calls (var fn = comp.layer; fn(i))
  // fail at unit-test layer instead of riding through to production AE
  // throw "Function global.layer() cannot work with this class".
  var comp: JsxCompItem;
  comp = {
    typeName: "Composition",
    name: o.name !== undefined ? o.name : "MockComp",
    id: o.id !== undefined ? o.id : 1,
    duration: o.duration !== undefined ? o.duration : 5,
    frameRate: o.frameRate !== undefined ? o.frameRate : 30,
    width: o.width !== undefined ? o.width : 1920,
    height: o.height !== undefined ? o.height : 1080,
    numLayers: o.layers !== undefined ? layers.length : (o.numLayers !== undefined ? o.numLayers : 0),
    layer: function (this: unknown, index: number) {
      if (this !== comp) {
        throw new Error(
          "Mock this-binding violation: comp.layer called with wrong " +
          "receiver. ExtendScript SpiderMonkey throws 'Function global." +
          "layer() cannot work with this class' on detached calls. " +
          "Use comp.layer(i) directly, NOT var fn = comp.layer; fn(i). " +
          "See mistakes.md #17."
        );
      }
      return layers[index - 1] as JsxLayerLike;
    },
  };
  return comp;
}

/** Non-comp item (Folder, Footage) for negative path tests. */
export function makeMockNonCompItem(typeName: "Folder" | "Footage", opts?: { name?: string; id?: number }): JsxItemLike {
  var o = opts || {};
  return {
    typeName: typeName,
    name: o.name !== undefined ? o.name : "MockItem",
    id: o.id !== undefined ? o.id : 99,
  };
}

export interface MockProjectOpts {
  activeItem?: JsxItemLike | null;
  /** Phase 5.1.4 — ItemCollection mock. items[0] becomes item(1) (1-based
   *  per ExtendScript convention); numItems = items.length. ae_list_comps
   *  test fixtures pass [] for empty project, [comp] for single comp,
   *  [comp, footage] for filter validation. */
  items?: JsxItemLike[];
}

export function makeMockProject(opts?: MockProjectOpts): JsxProjectLike {
  var o = opts || {};
  var items = o.items || [];
  // Phase 5.1.4 fix (mistakes #17) -- enforce method receiver identity
  // so detached method calls (var fn = project.item; fn(i)) fail at the
  // unit-test layer. Production ExtendScript SpiderMonkey throws
  // "Function global.item() cannot work with this class" on the same
  // pattern; vanilla vitest JS does not enforce, so without this guard
  // the bug rides through unit tests and only surfaces in real AE.
  // Apply the same guard to every method we add to this mock.
  var project: JsxProjectLike;
  project = {
    activeItem: o.activeItem !== undefined ? o.activeItem : null,
    numItems: items.length,
    item: function (this: unknown, index: number) {
      if (this !== project) {
        throw new Error(
          "Mock this-binding violation: project.item called with wrong " +
          "receiver. ExtendScript SpiderMonkey throws 'Function global." +
          "item() cannot work with this class' on detached calls. " +
          "Use project.item(i) directly, NOT var fn = project.item; fn(i). " +
          "See mistakes.md #17."
        );
      }
      // 1-based; production AE throws on out-of-range. Tests don't
      // exercise out-of-range so we return the array slot unchecked.
      return items[index - 1] as JsxItemLike;
    },
    // Phase 5.1.5 -- itemByID mock. Production AE's itemByID throws
    // when no item matches; we mirror that contract so try/catch in
    // impl.ts exercises both paths consistently.
    itemByID: function (this: unknown, id: number) {
      if (this !== project) {
        throw new Error(
          "Mock this-binding violation: project.itemByID called with wrong " +
          "receiver. See mistakes.md #17."
        );
      }
      for (var i = 0; i < items.length; i++) {
        if (items[i] && items[i].id === id) return items[i] as JsxItemLike;
      }
      throw new Error("Mock itemByID: no item with id " + id);
    },
  };
  return project;
}

export interface MockAppOpts {
  /** activeItem default = null (no comp selected). Pass `makeMockComp()`
   *  for happy path or `makeMockNonCompItem("Folder")` for negative path. */
  activeItem?: JsxItemLike | null;
  /** Phase 5.1.4 — see MockProjectOpts.items. */
  items?: JsxItemLike[];
}

export function makeMockApp(opts?: MockAppOpts): JsxAppLike {
  var o = opts || {};
  return {
    project: makeMockProject({
      activeItem: o.activeItem,
      items: o.items,
    }),
  };
}
