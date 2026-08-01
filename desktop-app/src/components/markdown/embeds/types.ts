// Shared prop contract for fenced-block renderers (mermaid, svg).
export interface RichFenceProps {
	code: string;
	/** True while the surrounding message is still streaming. Renderers that
	 *  can throw on partial input (e.g. mermaid) defer until this is false. */
	streaming?: boolean;
}