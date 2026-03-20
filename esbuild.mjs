import * as esbuild from "esbuild";

await esbuild.build({
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
});
