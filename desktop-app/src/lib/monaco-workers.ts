/**
 * Monaco web-worker constructors.
 *
 * Imports go through the `@monaco-editor-root` Vite alias (see vite.config.ts):
 * monaco's exports map breaks bare-specifier `?worker` queries, and a relative
 * node_modules path only fits ONE install layout (the workspace hoist). The
 * alias is resolved from monaco's actual install location at config time, so
 * it works both hoisted and in the CI standalone `npm ci --no-workspaces`
 * install. `vite/client` types cover the `?worker` module shape.
 */

import editorWorker from "@monaco-editor-root/esm/vs/editor/editor.worker.js?worker";
import jsonWorker from "@monaco-editor-root/esm/vs/language/json/json.worker.js?worker";
import cssWorker from "@monaco-editor-root/esm/vs/language/css/css.worker.js?worker";
import htmlWorker from "@monaco-editor-root/esm/vs/language/html/html.worker.js?worker";
import tsWorker from "@monaco-editor-root/esm/vs/language/typescript/ts.worker.js?worker";

export function getMonacoWorker(label: string): Worker {
	if (label === "typescript" || label === "javascript") return new tsWorker();
	if (label === "json") return new jsonWorker();
	if (label === "css" || label === "scss" || label === "less") return new cssWorker();
	if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
	return new editorWorker();
}