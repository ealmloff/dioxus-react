// React app loaded via wasm-bindgen-wry.
// Native Rust functions are available on window.__native.
(function () {
  var h = React.createElement;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useCallback = React.useCallback;
  var useRef = React.useRef;

  // Helper: call a native Rust function and parse the JSON result
  function callNative(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    var result = window.__native[fn].apply(null, args);
    if (typeof result === "string") {
      try {
        return JSON.parse(result);
      } catch (_) {
        return result;
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Tab navigation
  // ---------------------------------------------------------------------------
  function Tabs(props) {
    return h(
      "div",
      { className: "tabs" },
      props.items.map(function (item) {
        return h(
          "button",
          {
            key: item,
            className: "tab" + (props.active === item ? " tab-active" : ""),
            onClick: function () {
              props.onSelect(item);
            },
          },
          item
        );
      })
    );
  }

  // ---------------------------------------------------------------------------
  // System Info panel
  // ---------------------------------------------------------------------------
  function SystemInfo() {
    var ref = useState(null);
    var info = ref[0],
      setInfo = ref[1];

    useEffect(function () {
      setInfo(callNative("getSystemInfo"));
    }, []);

    if (!info) return h("p", null, "Loading...");

    return h(
      "div",
      { className: "card" },
      h("h2", null, "System Information"),
      h(
        "table",
        { className: "info-table" },
        h(
          "tbody",
          null,
          Object.keys(info).map(function (key) {
            return h(
              "tr",
              { key: key },
              h("td", { className: "info-label" }, key),
              h("td", { className: "info-value" }, String(info[key]))
            );
          })
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Fibonacci calculator — runs in native Rust
  // ---------------------------------------------------------------------------
  function FibonacciCalc() {
    var ref1 = useState(10);
    var n = ref1[0],
      setN = ref1[1];
    var ref2 = useState(null);
    var result = ref2[0],
      setResult = ref2[1];
    var ref3 = useState(null);
    var elapsed = ref3[0],
      setElapsed = ref3[1];

    var calculate = useCallback(
      function () {
        var start = performance.now();
        var val = window.__native.fibonacci(n);
        var ms = (performance.now() - start).toFixed(3);
        setResult(val);
        setElapsed(ms);
      },
      [n]
    );

    return h(
      "div",
      { className: "card" },
      h("h2", null, "Native Fibonacci"),
      h("p", { className: "subtitle" }, "Computed in native Rust — not in JS."),
      h(
        "div",
        { className: "row" },
        h(
          "label",
          null,
          "n = ",
          h("input", {
            type: "number",
            min: 0,
            max: 93,
            value: n,
            onChange: function (e) {
              setN(Number(e.target.value));
            },
          })
        ),
        h("button", { className: "btn", onClick: calculate }, "Calculate")
      ),
      result !== null &&
        h(
          "div",
          { className: "result" },
          h("span", { className: "result-label" }, "Result: "),
          h("span", { className: "result-value" }, String(result)),
          h(
            "span",
            { className: "result-time" },
            " (" + elapsed + " ms)"
          )
        )
    );
  }

  // ---------------------------------------------------------------------------
  // File Explorer — reads the native filesystem via Rust
  // ---------------------------------------------------------------------------
  function FileExplorer() {
    var ref1 = useState(
      callNative("getSystemInfo").cwd || "."
    );
    var currentPath = ref1[0],
      setCurrentPath = ref1[1];
    var ref2 = useState([]);
    var entries = ref2[0],
      setEntries = ref2[1];
    var ref3 = useState(null);
    var error = ref3[0],
      setError = ref3[1];
    var ref4 = useState(null);
    var fileContent = ref4[0],
      setFileContent = ref4[1];
    var ref5 = useState(null);
    var viewingFile = ref5[0],
      setViewingFile = ref5[1];
    var inputRef = useRef(null);

    var loadDir = useCallback(
      function (path) {
        var res = callNative("readDir", path);
        if (res.error) {
          setError(res.error);
          setEntries([]);
        } else {
          setError(null);
          setEntries(res.entries || []);
          setCurrentPath(path);
        }
        setFileContent(null);
        setViewingFile(null);
      },
      []
    );

    useEffect(
      function () {
        loadDir(currentPath);
      },
      []
    );

    var openEntry = useCallback(
      function (entry) {
        var sep = currentPath.indexOf("\\") !== -1 ? "\\" : "/";
        var child = currentPath + sep + entry.name;
        if (entry.isDir) {
          loadDir(child);
        } else {
          var res = callNative("readFile", child);
          if (res.error) {
            setFileContent("Error: " + res.error);
          } else {
            setFileContent(res.content);
          }
          setViewingFile(entry.name);
        }
      },
      [currentPath, loadDir]
    );

    var goUp = useCallback(
      function () {
        var sep = currentPath.indexOf("\\") !== -1 ? "\\" : "/";
        var parts = currentPath.split(sep);
        if (parts.length > 1) {
          parts.pop();
          var parent = parts.join(sep) || sep;
          loadDir(parent);
        }
      },
      [currentPath, loadDir]
    );

    function formatSize(bytes) {
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
      return (bytes / 1048576).toFixed(1) + " MB";
    }

    return h(
      "div",
      { className: "card" },
      h("h2", null, "File Explorer"),
      h("p", { className: "subtitle" }, "Browse your native filesystem from React."),
      h(
        "div",
        { className: "row" },
        h("button", { className: "btn btn-sm", onClick: goUp }, "\u2191 Up"),
        h("input", {
          ref: inputRef,
          className: "path-input",
          value: currentPath,
          onChange: function (e) {
            setCurrentPath(e.target.value);
          },
          onKeyDown: function (e) {
            if (e.key === "Enter") loadDir(e.target.value);
          },
        }),
        h(
          "button",
          {
            className: "btn btn-sm",
            onClick: function () {
              loadDir(currentPath);
            },
          },
          "Go"
        )
      ),
      error && h("p", { className: "error" }, error),
      h(
        "div",
        { className: "file-list" },
        entries.map(function (entry) {
          return h(
            "div",
            {
              key: entry.name,
              className: "file-entry" + (entry.isDir ? " file-dir" : ""),
              onClick: function () {
                openEntry(entry);
              },
            },
            h(
              "span",
              { className: "file-icon" },
              entry.isDir ? "\uD83D\uDCC1" : "\uD83D\uDCC4"
            ),
            h("span", { className: "file-name" }, entry.name),
            !entry.isDir &&
              h("span", { className: "file-size" }, formatSize(entry.size))
          );
        })
      ),
      viewingFile &&
        h(
          "div",
          { className: "file-preview" },
          h("h3", null, viewingFile),
          h("pre", null, fileContent)
        )
    );
  }

  // ---------------------------------------------------------------------------
  // Counter — pure React state, proving React works in wry
  // ---------------------------------------------------------------------------
  function Counter() {
    var ref = useState(0);
    var count = ref[0],
      setCount = ref[1];

    return h(
      "div",
      { className: "card" },
      h("h2", null, "Counter"),
      h("p", { className: "subtitle" }, "Pure React state — no native calls."),
      h(
        "div",
        { className: "counter-row" },
        h(
          "button",
          {
            className: "btn",
            onClick: function () {
              setCount(count - 1);
            },
          },
          "\u2212"
        ),
        h("span", { className: "counter-value" }, count),
        h(
          "button",
          {
            className: "btn",
            onClick: function () {
              setCount(count + 1);
            },
          },
          "+"
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // App shell
  // ---------------------------------------------------------------------------
  var TAB_NAMES = ["System Info", "Fibonacci", "File Explorer", "Counter"];

  function App() {
    var ref = useState(TAB_NAMES[0]);
    var tab = ref[0],
      setTab = ref[1];

    var content;
    switch (tab) {
      case "System Info":
        content = h(SystemInfo);
        break;
      case "Fibonacci":
        content = h(FibonacciCalc);
        break;
      case "File Explorer":
        content = h(FileExplorer);
        break;
      case "Counter":
        content = h(Counter);
        break;
    }

    return h(
      "div",
      { className: "app" },
      h(
        "header",
        { className: "header" },
        h("h1", null, "dioxus-react"),
        h(
          "p",
          null,
          "React UI \u00B7 Native Rust \u00B7 Powered by ",
          h(
            "a",
            {
              href: "https://github.com/DioxusLabs/wasm-bindgen-wry",
              target: "_blank",
            },
            "wasm-bindgen-wry"
          )
        )
      ),
      h(Tabs, { items: TAB_NAMES, active: tab, onSelect: setTab }),
      h("main", { className: "main" }, content)
    );
  }

  // Mount
  var root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(h(App));
})();
