import * as esbuild from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";

const watch = process.argv.includes("--watch");
const DRIVER_RUNTIME_VIRTUAL_ID = "virtual:driver-runtime-bootstrap";
const DRIVER_PLAYWRIGHT_INJECTED_SOURCE_VIRTUAL_ID = "virtual:driver-playwright-injected-source";
const DRIVER_RUNTIME_ENTRY = "crates/playwright-driver/src/runtime/bootstrap.ts";
const require = createRequire(import.meta.url);
const PLAYWRIGHT_CORE_ROOT = path.dirname(require.resolve("playwright-core/package.json"));
const PLAYWRIGHT_INJECTED_SOURCE_FILE = path.join(
  PLAYWRIGHT_CORE_ROOT,
  "lib",
  "generated",
  "injectedScriptSource.js"
);

function driverPlaywrightInjectedSourcePlugin() {
  return {
    name: "driver-playwright-injected-source",
    setup(build) {
      build.onResolve(
        { filter: /^virtual:driver-playwright-injected-source$/ },
        () => ({
          path: DRIVER_PLAYWRIGHT_INJECTED_SOURCE_VIRTUAL_ID,
          namespace: "driver-playwright-injected-source",
        })
      );

      build.onLoad(
        {
          filter: /^virtual:driver-playwright-injected-source$/,
          namespace: "driver-playwright-injected-source",
        },
        () => {
          const { source } = require(PLAYWRIGHT_INJECTED_SOURCE_FILE);
          return {
            contents: `export default ${JSON.stringify(source)};`,
            loader: "js",
            watchFiles: [PLAYWRIGHT_INJECTED_SOURCE_FILE],
          };
        }
      );
    },
  };
}

function driverRuntimeBootstrapPlugin() {
  let compiledSourcePromise = null;

  return {
    name: "driver-runtime-bootstrap",
    setup(build) {
      build.onStart(() => {
        compiledSourcePromise = null;
      });

      build.onResolve({ filter: /^virtual:driver-runtime-bootstrap$/ }, () => ({
        path: DRIVER_RUNTIME_VIRTUAL_ID,
        namespace: "driver-runtime-bootstrap",
      }));

      build.onLoad(
        { filter: /^virtual:driver-runtime-bootstrap$/, namespace: "driver-runtime-bootstrap" },
        async () => {
          compiledSourcePromise ??= esbuild
            .build({
              entryPoints: [DRIVER_RUNTIME_ENTRY],
              bundle: true,
              format: "iife",
              globalName: "__pwRuntimeBootstrap",
              platform: "browser",
              target: "es2022",
              write: false,
              sourcemap: false,
              legalComments: "none",
              metafile: true,
              plugins: [driverPlaywrightInjectedSourcePlugin()],
            })
            .then((result) => ({
              compiledSource: result.outputFiles[0].text,
              watchFiles: [...Object.keys(result.metafile.inputs), PLAYWRIGHT_INJECTED_SOURCE_FILE],
            }));

          const { compiledSource, watchFiles } = await compiledSourcePromise;
          return {
            contents: `export default ${JSON.stringify(compiledSource)};`,
            loader: "js",
            watchFiles,
          };
        }
      );
    },
  };
}

const builds = [
  {
    entryPoints: ["assets/src/App.tsx"],
    bundle: true,
    outfile: "assets/app.js",
    format: "iife",
    target: "es2018",
    // Use classic JSX transform so esbuild emits React.createElement calls
    // directly, which works with the vendored React globals.
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    plugins: [
      {
        name: "react-globals",
        setup(build) {
          // Redirect react/react-dom imports to the globals provided by
          // the vendored <script> tags.
          build.onResolve({ filter: /^react$/ }, () => ({
            path: "react",
            namespace: "react-global",
          }));
          build.onResolve({ filter: /^react-dom\/client$/ }, () => ({
            path: "react-dom/client",
            namespace: "react-global",
          }));
          build.onResolve({ filter: /^react-dom$/ }, () => ({
            path: "react-dom",
            namespace: "react-global",
          }));

          build.onLoad(
            { filter: /^react$/, namespace: "react-global" },
            () => ({
              contents: "module.exports = React;",
              loader: "js",
            })
          );
          build.onLoad(
            { filter: /^react-dom\/client$/, namespace: "react-global" },
            () => ({
              contents: "module.exports = ReactDOM;",
              loader: "js",
            })
          );
          build.onLoad(
            { filter: /^react-dom$/, namespace: "react-global" },
            () => ({
              contents: "module.exports = ReactDOM;",
              loader: "js",
            })
          );
        },
      },
    ],
  },
  {
    entryPoints: ["crates/playwright-driver/src/index.ts"],
    bundle: true,
    outfile: "tests/driver/dist/index.mjs",
    format: "esm",
    platform: "node",
    target: "node20",
    sourcemap: true,
    plugins: [driverRuntimeBootstrapPlugin()],
  },
];

if (watch) {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
