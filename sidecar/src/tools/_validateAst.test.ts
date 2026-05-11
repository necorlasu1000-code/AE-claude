// D7 — adversarial golden set + positive cases.
// CLAUDE.md Validation Gate #1: 30+ injection attempts must all be blocked.
// New AE API patterns added to ALLOWED_GLOBALS as the project grows.

import { describe, it, expect } from "vitest";
import { validateExtendScript } from "./_validateAst.js";

// ─── BLOCKED: Direct deny-list identifiers ──────────────────────────

describe("D7 validator — direct deny-list", () => {
  const cases: Array<[string, string, string]> = [
    ["File", `var f = new File("/etc/passwd"); f.open("r");`, "File"],
    ["Folder", `var f = new Folder("/tmp"); f.create();`, "Folder"],
    ["Socket", `var s = new Socket(); s.open("evil.com:80");`, "Socket"],
    ["system.callSystem", `system.callSystem("rm -rf ~");`, "system"],
    ["eval", `eval("alert(1)");`, "eval"],
    ["Function constructor", `var fn = new Function("return 1");`, "Function"],
    ["arguments.callee", `(function(){ arguments.callee(); })();`, "arguments"],
    ["globalThis", `globalThis.File("x");`, "globalThis"],
    ["window.File", `window.File("x");`, "window"],
    ["self.File", `self.File("x");`, "self"],
    ["global.File", `global.File("x");`, "global"],
    ["ExternalObject", `var e = new ExternalObject("lib:foo"); e.do();`, "ExternalObject"],
  ];

  for (const [label, code, expectedIdent] of cases) {
    it(`blocks ${label}`, () => {
      const r = validateExtendScript(code);
      expect(r.ok).toBe(false);
      expect(r.findings.some((f) => f.identifier === expectedIdent)).toBe(true);
    });
  }
});

// ─── BLOCKED: Indirection / alias / computed access ─────────────────

describe("D7 validator — indirection bypass attempts", () => {
  const cases: Array<[string, string]> = [
    ["alias assignment", `var f = File; f("x.txt");`],
    ["delayed assignment", `var f; f = File; f("x.txt");`],
    ["sequence expression", `(0, File)("x.txt");`],
    ["computed member access this[]", `var x = "File"; this[x]("y");`],
    ["computed member access obj[]", `var o = {}; o["File"] = File; o["File"]("x");`],
    ["function return", `function bad() { return File; } bad()("x");`],
    ["array indirection", `var arr = [File]; arr[0]("x");`],
    ["IIFE return", `(function(){ return File; })()("x");`],
    ["with statement", `with (this) { File("x"); }`],
    ["constructor escape", `(0).constructor("return File")();`],
    ["Function.prototype.bind", `Function.prototype.bind.call(File, null, "x")();`],
    ["setTimeout with string", `setTimeout("File('x')", 0);`],
    ["setInterval with string", `setInterval("File('x')", 1000);`],
    ["__proto__ constructor escape", `({}).__proto__.constructor("alert(1)")();`],
  ];

  for (const [label, code] of cases) {
    it(`blocks ${label}`, () => {
      const r = validateExtendScript(code);
      expect(r.ok).toBe(false);
      expect(r.findings.length).toBeGreaterThan(0);
    });
  }
});

// ─── BLOCKED: ExtendScript preprocess directives ────────────────────

describe("D7 validator — preprocess directives", () => {
  it("blocks #include", () => {
    const r = validateExtendScript(`#include "evil.jsx"\nvar x = 1;`);
    expect(r.ok).toBe(false);
    expect(r.findings[0]?.reason).toContain("#include");
  });

  it("blocks #includepath", () => {
    const r = validateExtendScript(`#includepath "/tmp"\nvar x = 1;`);
    expect(r.ok).toBe(false);
  });

  it("blocks #target", () => {
    const r = validateExtendScript(`#target aftereffects\nvar x = 1;`);
    expect(r.ok).toBe(false);
  });

  it("blocks #engine", () => {
    const r = validateExtendScript(`#engine main\nvar x = 1;`);
    expect(r.ok).toBe(false);
  });
});

// ─── BLOCKED: Multi-line / wrapped attempts ─────────────────────────

describe("D7 validator — multi-line attacks", () => {
  it("blocks alias buried in function body", () => {
    const code = `
      var comp = app.project.activeItem;
      function helper(x) {
        var f = File;  // injected
        return f(x);
      }
      helper("/etc/passwd");
    `;
    const r = validateExtendScript(code);
    expect(r.ok).toBe(false);
  });

  it("blocks computed access in nested member chain", () => {
    const code = `app["pro" + "ject"].rootFolder;`;
    const r = validateExtendScript(code);
    expect(r.ok).toBe(false);
  });
});

// ─── ALLOWED: Valid AE API usage (positive cases) ───────────────────

describe("D7 validator — valid AE scripts pass", () => {
  it("allows app.project access", () => {
    const r = validateExtendScript(`var p = app.project; var n = p.numItems;`);
    expect(r.ok).toBe(true);
  });

  it("allows comp + layer manipulation", () => {
    const code = `
      var comp = app.project.activeItem;
      for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        if (layer.selected) {
          layer.property("Position").setValue([100, 200]);
        }
      }
    `;
    const r = validateExtendScript(code);
    expect(r.ok).toBe(true);
  });

  it("allows keyframe interpolation type set", () => {
    const code = `
      var pos = app.project.activeItem.layer(1).property("Position");
      for (var k = 1; k <= pos.numKeys; k++) {
        pos.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER);
      }
    `;
    const r = validateExtendScript(code);
    expect(r.ok).toBe(true);
  });

  // Phase 3.3 — ae_get_active_comp pattern. Exercises every shape the
  // first read-only jsx tool uses: dot-access on app.project, typeName
  // string compare for type discrimination (instead of `instanceof
  // CompItem`), dot-read on numeric comp fields, and the h.fail throw
  // sentinel that defineJsxTool's catch branch converts to AEError.
  // Future jsx tools that share these shapes inherit coverage; truly
  // novel patterns (Phase 5) add their own case here.
  it("allows ae_get_active_comp pattern (typeName compare + h.fail throw sentinel)", () => {
    // Wrap in function — matches the real defineJsxTool(function(_input, ctx, h){...})
    // shape. Top-level return is parse-error per acorn (ECMA-262), so the
    // golden case must mirror the actual call-site wrap.
    const code = `
      function ae_get_active_comp(_input, ctx, h) {
        var item = ctx.app.project.activeItem;
        if (!item || item.typeName !== "Composition") {
          throw h.fail(
            "AENoActiveCompError",
            "활성 컴프 없음",
            "사용자에게 컴프 선택 제안"
          );
        }
        return {
          name: item.name,
          id: item.id,
          durationSec: item.duration,
          frameRate: item.frameRate,
          width: item.width,
          height: item.height,
          numLayers: item.numLayers
        };
      }
    `;
    const r = validateExtendScript(code);
    expect(r.ok).toBe(true);
  });

  // Phase 5.2.2 -- ae_create_comp pattern. First write tool. Exercises
  // sub-namespace member access (ctx.app.project.items.addComp), positional
  // arg passing, and writable bgColor property assignment. The HOF (not
  // shown -- runs outside fn body) handles app.beginUndoGroup/endUndoGroup
  // wrapping, so fn body itself stays linear without #include or other
  // forbidden patterns. Future destructive tools (5.3+) share the same
  // shape and inherit coverage from this case.
  it("allows ae_create_comp pattern (items.addComp + bgColor write)", () => {
    const code = `
      function ae_create_comp(input, ctx, _h) {
        var pixelAspect = typeof input.pixelAspect === "number" ? input.pixelAspect : 1;
        var items = ctx.app.project.items;
        var comp = items.addComp(
          input.name,
          input.width,
          input.height,
          pixelAspect,
          input.duration,
          input.frameRate
        );
        if (input.bgColor) {
          comp.bgColor = input.bgColor;
        }
        return {
          id: comp.id,
          name: comp.name,
          width: comp.width,
          height: comp.height,
          frameRate: comp.frameRate,
          duration: comp.duration
        };
      }
    `;
    const r = validateExtendScript(code);
    expect(r.ok).toBe(true);
  });

  it("allows array index access (literal number)", () => {
    const r = validateExtendScript(`var arr = [1, 2, 3]; var first = arr[0];`);
    expect(r.ok).toBe(true);
  });

  it("allows Math / Date / JSON usage", () => {
    const r = validateExtendScript(`var t = Math.floor(Date.now() / 1000); var s = JSON.stringify({t: t});`);
    expect(r.ok).toBe(true);
  });

  it("allows render queue (without calling start)", () => {
    const code = `
      var rq = app.project.renderQueue;
      var item = rq.items.add(app.project.activeItem);
      item.outputModule(1).file = null;
    `;
    // Note: rq.items.add returns RenderQueueItem; .file = null is a valid property set.
    // setValue on file property is the typical destructive op; this just inspects.
    const r = validateExtendScript(code);
    expect(r.ok).toBe(true);
  });
});

// ─── EDGE: Parse failures should be reported as findings ────────────

describe("D7 validator — malformed input", () => {
  it("reports parse error gracefully", () => {
    const r = validateExtendScript(`var x = ;;;`);
    expect(r.ok).toBe(false);
    expect(r.findings[0]?.reason).toContain("Parse error");
  });

  it("handles empty input", () => {
    const r = validateExtendScript(``);
    expect(r.ok).toBe(true);
  });

  it("handles whitespace-only input", () => {
    const r = validateExtendScript(`   \n\n  `);
    expect(r.ok).toBe(true);
  });
});
