import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

// Bundle Monaco locally — no CDN dependency at runtime.
// The SPA becomes fully offline-capable (self-hosted appliance requirement).
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

// Navy code surface used in both themes (design-tokens.json: dark.codeBackground).
monaco.editor.defineTheme("orchestrator-navy", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "7f95ab", fontStyle: "italic" },
  ],
  colors: {
    "editor.background": "#0c2033",
    "editorGutter.background": "#0c2033",
    "editorLineNumber.foreground": "#5d7a96",
  },
});
