import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import { areExperimentalFeaturesEnabled } from "../../../core/experimental.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { theme } from "../theme/theme.ts";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts for compact footer display.
 */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

/**
 * Shorten from the middle so the leaf directory stays visible — the start of a
 * path is the least informative part once it is too wide for the footer.
 */
function truncateMiddle(text: string, width: number): string {
	if (width <= 1 || visibleWidth(text) <= width) return text;
	const keep = width - 1;
	// Bias the visible remainder toward the tail: the leaf directory is what
	// identifies the project, while the leading path is predictable.
	const left = Math.max(1, Math.floor(keep * 0.3));
	const right = keep - left;
	const chars = [...text];
	return `${chars.slice(0, left).join("")}…${right > 0 ? chars.slice(-right).join("") : ""}`;
}

interface FooterSegment {
	key: string;
	/** Styled text (may contain its own color, e.g. the context percentage). */
	text: string;
	/** Unstyled text used for width calculations. */
	plain: string;
	/** Higher survives longer when the footer is narrow. */
	priority: number;
	/** Apply the dim base color (off for segments that carry their own emphasis). */
	dim: boolean;
}

function segmentsWidth(segments: FooterSegment[]): number {
	return segments.reduce((sum, segment) => sum + visibleWidth(segment.plain), 0) + Math.max(0, segments.length - 1);
}

/** Drop the lowest-priority segment until the line fits; the context meter always survives. */
function fitSegments(segments: FooterSegment[], maxWidth: number): FooterSegment[] {
	const fitted = [...segments];
	while (fitted.length > 1 && segmentsWidth(fitted) > maxWidth) {
		let dropIndex = 0;
		for (let i = 1; i < fitted.length; i++) {
			if (fitted[i].priority < fitted[dropIndex].priority) dropIndex = i;
		}
		if (fitted[dropIndex].key === "context") break;
		fitted.splice(dropIndex, 1);
	}
	return fitted;
}

function renderSegments(segments: FooterSegment[]): string {
	return segments
		.map((segment) => (segment.dim ? theme.fg("dim", segment.text) : segment.text))
		.join(theme.fg("dim", " "));
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private autoCompactEnabled = true;
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
		this.session = session;
		this.footerData = footerData;
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	render(width: number): string[] {
		const state = this.session.state;

		// Calculate cumulative usage from ALL session entries (not just post-compaction messages)
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;
		let latestCacheHitRate: number | undefined;

		for (const entry of this.session.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				totalInput += entry.message.usage.input;
				totalOutput += entry.message.usage.output;
				totalCacheRead += entry.message.usage.cacheRead;
				totalCacheWrite += entry.message.usage.cacheWrite;
				totalCost += entry.message.usage.cost.total;

				const latestPromptTokens =
					entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite;
				latestCacheHitRate =
					latestPromptTokens > 0 ? (entry.message.usage.cacheRead / latestPromptTokens) * 100 : undefined;
			}
		}

		// Calculate context usage from session (handles compaction correctly).
		// After compaction, tokens are unknown until the next LLM response.
		const contextUsage = this.session.getContextUsage();
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

		// Location line: path first, decorations dropped as width shrinks.
		const basePwd = formatCwdForFooter(
			this.session.sessionManager.getCwd(),
			process.env.HOME || process.env.USERPROFILE,
		);
		const branch = this.footerData.getGitBranch();
		const sessionName = this.session.sessionManager.getSessionName();
		const withBranch = branch ? `${basePwd} (${branch})` : basePwd;
		const fullLocation = sessionName ? `${withBranch} • ${sessionName}` : withBranch;
		let locationText: string;
		if (visibleWidth(fullLocation) <= width) locationText = fullLocation;
		else if (visibleWidth(withBranch) <= width) locationText = withBranch;
		else if (visibleWidth(basePwd) <= width) locationText = basePwd;
		else locationText = truncateMiddle(basePwd, width);
		const pwdLine = theme.fg("dim", locationText);

		// Stats line: whole segments with drop priorities; the model stays pinned right.
		const segments: FooterSegment[] = [];
		const addSegment = (key: string, plain: string, priority: number, text = plain) => {
			if (plain) segments.push({ key, text, plain, priority, dim: true });
		};
		if (totalInput) addSegment("input", `↑${formatTokens(totalInput)}`, 55);
		if (totalOutput) addSegment("output", `↓${formatTokens(totalOutput)}`, 54);
		if (totalCacheRead) addSegment("cacheRead", `R${formatTokens(totalCacheRead)}`, 30);
		if (totalCacheWrite) addSegment("cacheWrite", `W${formatTokens(totalCacheWrite)}`, 29);
		if ((totalCacheRead > 0 || totalCacheWrite > 0) && latestCacheHitRate !== undefined) {
			addSegment("cacheHit", `CH${latestCacheHitRate.toFixed(1)}%`, 28);
		}

		// Show cost with "(sub)" indicator if using OAuth subscription
		const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;
		if (totalCost || usingSubscription) {
			addSegment("cost", `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`, 70);
		}

		// Colorize context percentage based on usage. This segment is never dropped.
		const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
		const contextPercentDisplay =
			contextPercent === "?"
				? `?/${formatTokens(contextWindow)}${autoIndicator}`
				: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
		let contextPercentStr: string;
		if (contextPercentValue > 90) {
			contextPercentStr = theme.fg("error", contextPercentDisplay);
		} else if (contextPercentValue > 70) {
			contextPercentStr = theme.fg("warning", contextPercentDisplay);
		} else {
			contextPercentStr = contextPercentDisplay;
		}
		segments.push({
			key: "context",
			text: contextPercentStr,
			plain: contextPercentDisplay,
			priority: 100,
			// Dim at normal usage; keep the warning/error color intact when high.
			dim: contextPercentValue <= 70,
		});
		if (areExperimentalFeaturesEnabled()) {
			addSegment("xp", "• xp", 10, `${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`);
		}

		// Right side: model, thinking level, and provider when there is room.
		const modelName = state.model?.id || "no-model";
		let rightSideWithoutProvider = modelName;
		if (state.model?.reasoning) {
			const thinkingLevel = state.thinkingLevel || "off";
			rightSideWithoutProvider =
				thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
		}
		let rightSide = rightSideWithoutProvider;
		if (this.footerData.getAvailableProviderCount() > 1 && state.model) {
			const withProvider = `(${state.model.provider}) ${rightSideWithoutProvider}`;
			if (visibleWidth(withProvider) <= Math.max(18, Math.floor(width * 0.45))) {
				rightSide = withProvider;
			}
		}
		const rightMax = Math.max(8, Math.min(visibleWidth(rightSide), Math.floor(width * 0.5)));
		const rightTrimmed = truncateToWidth(rightSide, rightMax, "…");
		const rightWidth = visibleWidth(rightTrimmed);
		const minPadding = rightWidth > 0 ? 2 : 0;
		const leftBudget = Math.max(1, width - rightWidth - minPadding);

		let statsLeft = renderSegments(fitSegments(segments, leftBudget));
		if (visibleWidth(statsLeft) > leftBudget) {
			statsLeft = truncateToWidth(statsLeft, leftBudget, "…");
		}
		const statsLeftWidth = visibleWidth(statsLeft);
		const totalNeeded = statsLeftWidth + minPadding + rightWidth;

		let statsLine: string;
		if (totalNeeded <= width) {
			statsLine = statsLeft + " ".repeat(width - statsLeftWidth - rightWidth) + theme.fg("dim", rightTrimmed);
		} else {
			const availableForRight = Math.max(0, width - statsLeftWidth - minPadding);
			const trimmedRight = availableForRight > 0 ? truncateToWidth(rightTrimmed, availableForRight, "") : "";
			const trimmedWidth = visibleWidth(trimmedRight);
			statsLine =
				statsLeft + " ".repeat(Math.max(0, width - statsLeftWidth - trimmedWidth)) + theme.fg("dim", trimmedRight);
		}

		const lines = [pwdLine, statsLine];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
