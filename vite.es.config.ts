import fs from "fs";
import { rollup, watch, RollupOptions, OutputOptions } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import alias from "@rollup/plugin-alias";
import { jsxInclude, jsxBin, jsxPonyfill } from "vite-cep-plugin";
import { CEP_Config } from "vite-cep-plugin";
import json from "@rollup/plugin-json";
import path from "path";

const GLOBAL_THIS = "thisObj";

// Phase 5.1.0 (D-M): rollup alias entries for jsx bundle. Lets panel jsx layer
// import sidecar-collocated tool impls (`sidecar/src/tools/<ae>/impl.ts`) via
// `@aeTools/<ae>/impl` without 4-deep relative paths. Caller (vite.config.ts)
// resolves absolute paths from `__dirname` and passes here so this file stays
// cwd-independent.
export interface ExtendScriptAliasEntry {
  find: string;
  replacement: string;
}

export const extendscriptConfig = (
  extendscriptEntry: string,
  outPath: string,
  cepConfig: CEP_Config,
  extensions: string[],
  isProduction: boolean,
  isPackage: boolean,
  aliases: ExtendScriptAliasEntry[] = [],
) => {
  console.log(outPath);
  const config: RollupOptions = {
    input: extendscriptEntry,
    treeshake: true,
    output: {
      file: outPath,
      sourcemap: isPackage
        ? cepConfig.zxp.sourceMap
        : cepConfig.build?.sourceMap,
    },
    plugins: [
      // alias rewrite must run before nodeResolve so aliased paths get
      // rewritten to absolute filesystem locations before file lookup.
      alias({ entries: aliases }),
      json(),
      nodeResolve({
        extensions,
      }),
      babel({
        extensions,
        exclude: /node_modules/,
        babelrc: false,
        babelHelpers: "inline",
        presets: ["@babel/preset-env", "@babel/preset-typescript"],
        plugins: [
          "@babel/plugin-syntax-dynamic-import",
          "@babel/plugin-proposal-class-properties",
        ],
      }),
      jsxPonyfill(),
      jsxInclude({
        iife: true,
        globalThis: GLOBAL_THIS,
      }),
      jsxBin(isPackage ? cepConfig.zxp.jsxBin : cepConfig.build?.jsxBin),
    ],
  };

  async function build() {
    const bundle = await rollup(config);
    await bundle.write(config.output as OutputOptions);
    await bundle.close();
  }

  const triggerHMR = () => {
    // No built-in way to trigger Vite's HMR reload from outside the root folder
    // Workaround will read and save index.html file for each panel to triggger reload
    console.log("ExtendScript Change");
    cepConfig.panels.map((panel) => {
      const tmpPath = path.join(process.cwd(), "src", "js", panel.mainPath);
      if (fs.existsSync(tmpPath)) {
        const txt = fs.readFileSync(tmpPath, { encoding: "utf-8" });
        fs.writeFileSync(tmpPath, txt, { encoding: "utf-8" });
      }
    });
  };

  const watchRollup = async () => {
    const watcher = watch(config);
    watcher.on("event", ({ result }: any) => {
      if (result) {
        triggerHMR();
        result.close();
      }
    });
    // NOTE: no watcher.close() here — the template shipped one immediately
    // after subscribing, which tore the watcher down before the first change
    // event and silently killed dev-mode jsx rebuild/HMR (audit item).
    // The watcher lives for the duration of the dev process.
  };

  if (isProduction) {
    build();
  } else {
    watchRollup();
  }
};
