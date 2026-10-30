/**
 * Monaco web-worker constructors.
 *
 * Imports are RELATIVE into node_modules on purpose: monaco's exports map
 * breaks Vite's bare-specifier `?worker` query resolution (the query rides
 * along into the exports key). Relative file paths skip exports resolution.
 * `vite/client` types cover the `?worker` module shape.
 */

import editorWorker from "../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker";
import jsonWorker from "../../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js?worker";
import cssWorker from "../../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js?worker";
import htmlWorker from "../../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js?worker";
import tsWorker from "../../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";

export function getMonacoWorker(label: string): Worker {
	if (label === "typescript" || label === "javascript") return new tsWorker();
	if (label === "json") return new jsonWorker();
	if (label === "css" || label === "scss" || label === "less") return new cssWorker();
	if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
	return new editorWorker();
}