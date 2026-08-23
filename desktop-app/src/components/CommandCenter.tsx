/**
 * CommandCenter — centralized admin panel for A-Coder Desktop.
 *
 * Four sections:
 * - Sessions: search, pin, export, delete sessions
 * - System: gateway status, restart/update, logs viewer
 * - Usage: daily token charts, top models, top skills
 * - Maintenance: various maintenance tools
 *
 * Inspired by Hermes Desktop's command-center.
 */

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from './ui/Button';
import {
	Activity,
	BarChart3,
	Download,
	MessageCircle,
	Search,
	Settings,
	Trash2,
	Wrench,
	X,
} from 'lucide-react';

type Section = 'sessions' | 'system' | 'usage' | 'maintenance';

interface CommandCenterProps {
	open: boolean;
	onClose: () => void;
	sessions?: Array<{
		id: string;
		name: string;
		lastActive: number;
		messageCount: number;
	}>;
	onOpenSession?: (id: string) => void;
	onDeleteSession?: (id: string) => Promise<void>;
	onExportSession?: (id: string) => Promise<void>;
	stats?: {
		totalSessions: number;
		totalApiCalls: number;
		totalInputTokens: number;
		totalOutputTokens: number;
		daily?: Array<{
			day: string;
			inputTokens: number;
			outputTokens: number;
		}>;
		topModels?: Array<{ model: string; tokens: number }>;
	};
	logs?: string[];
	onRestartGateway?: () => Promise<void>;
	onUpdate?: () => Promise<void>;
}

const SECTION_CONFIG: { id: Section; label: string; icon: typeof Activity }[] = [
	{ id: 'sessions', label: 'Sessions', icon: MessageCircle },
	{ id: 'system', label: 'System', icon: Activity },
	{ id: 'usage', label: 'Usage', icon: BarChart3 },
	{ id: 'maintenance', label: 'Maintenance', icon: Wrench },
];

export function CommandCenter({
	open,
	onClose,
	sessions = [],
	onOpenSession,
	onDeleteSession,
	onExportSession,
	stats,
	logs = [],
	onRestartGateway,
	onUpdate,
}: CommandCenterProps) {
	const [section, setSection] = useState<Section>('sessions');
	const [query, setQuery] = useState('');
	const [logQuery, setLogQuery] = useState('');
	const [logLevel, setLogLevel] = useState<'ALL' | 'INFO' | 'WARNING' | 'ERROR'>('ALL');

	// Filter sessions by query.
	const filteredSessions = useMemo(() => {
		if (!query.trim()) return sessions;
		const needle = query.trim().toLowerCase();
		return sessions.filter(
			(s) => s.name.toLowerCase().includes(needle) || s.id.toLowerCase().includes(needle),
		);
	}, [sessions, query]);

	// Filter logs by level and query.
	const filteredLogs = useMemo(() => {
		let result = logs;
		if (logLevel !== 'ALL') {
			result = result.filter((line) => line.toUpperCase().includes(logLevel));
		}
		if (logQuery.trim()) {
			const needle = logQuery.trim().toLowerCase();
			result = result.filter((line) => line.toLowerCase().includes(needle));
		}
		return result;
	}, [logs, logLevel, logQuery]);

	// Format timestamp.
	const formatTimestamp = (ts: number) => {
		const date = new Date(ts);
		return date.toLocaleString();
	};

	// Compact number formatter.
	const compactNumber = (n: number) => {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
		return String(n);
	};

	// Max tokens for chart.
	const maxDailyTokens = useMemo(() => {
		if (!stats?.daily?.length) return 1;
		return stats.daily.reduce(
			(acc, d) => Math.max(acc, d.inputTokens + d.outputTokens),
			1,
		);
	}, [stats?.daily]);

	if (!open) return null;

	return createPortal(
		<div
			className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
		>
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
				onClick={onClose}
			/>

			{/* Panel */}
			<div
				className="relative flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[var(--pi-border)] bg-[var(--pi-surface-overlay)] shadow-2xl"
			>
				{/* Header */}
				<div className="flex items-center justify-between border-b border-[var(--pi-border)] px-4 py-3">
					<h2 className="text-sm font-semibold text-[var(--pi-text)]">Command Center</h2>
					<button
						onClick={onClose}
						className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--pi-text-muted)] transition-colors hover:bg-[var(--pi-surface-raised)] hover:text-[var(--pi-text)]"
					>
						<X className="size-4" />
					</button>
				</div>

				{/* Body */}
				<div className="flex min-h-0 flex-1">
					{/* Sidebar */}
					<aside className="w-48 shrink-0 border-r border-[var(--pi-border)] bg-[var(--pi-bg)]">
						<nav className="flex flex-col gap-0.5 p-2">
							{SECTION_CONFIG.map(({ id, label, icon: Icon }) => (
								<button
									key={id}
									className={`
										flex items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium
										${section === id
											? 'bg-[var(--pi-accent-soft)] text-[var(--pi-accent)]'
											: 'text-[var(--pi-text-muted)] hover:bg-[var(--pi-surface-raised)] hover:text-[var(--pi-text)]'
										}
									`}
									onClick={() => setSection(id)}
								>
									<Icon className="size-4" />
									{label}
								</button>
							))}
						</nav>
					</aside>

					{/* Main content */}
					<main className="min-w-0 flex-1 overflow-auto p-4">
						{section === 'sessions' && (
							<SessionsSection
								sessions={filteredSessions}
								query={query}
								onQueryChange={setQuery}
								onOpen={onOpenSession}
								onDelete={onDeleteSession}
								onExport={onExportSession}
								formatTimestamp={formatTimestamp}
							/>
						)}

						{section === 'system' && (
							<SystemSection
								logs={filteredLogs}
								logQuery={logQuery}
								logLevel={logLevel}
								onLogQueryChange={setLogQuery}
								onLogLevelChange={setLogLevel}
								onRestart={onRestartGateway}
								onUpdate={onUpdate}
							/>
						)}

						{section === 'usage' && stats && (
							<UsageSection
								stats={stats}
								maxDailyTokens={maxDailyTokens}
								compactNumber={compactNumber}
							/>
						)}

						{section === 'maintenance' && <MaintenanceSection />}
					</main>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between border-t border-[var(--pi-border)] px-4 py-2 text-[0.6875rem] text-[var(--pi-text-faint)]">
					<span>⌘K to open</span>
					<span>Esc to close</span>
				</div>
			</div>
		</div>,
		document.body,
	);
}

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

interface SessionsSectionProps {
	sessions: CommandCenterProps['sessions'];
	query: string;
	onQueryChange: (q: string) => void;
	onOpen?: (id: string) => void;
	onDelete?: (id: string) => Promise<void>;
	onExport?: (id: string) => Promise<void>;
	formatTimestamp: (ts: number) => string;
}

function SessionsSection({
	sessions,
	query,
	onQueryChange,
	onOpen,
	onDelete,
	onExport,
	formatTimestamp,
}: SessionsSectionProps) {
	return (
		<div className="flex h-full flex-col gap-3">
			{/* Search */}
			<div className="flex items-center gap-2">
				<Search className="size-4 text-[var(--pi-text-muted)]" />
				<input
					className="h-7 flex-1 rounded-md border border-[var(--pi-border)] bg-transparent px-2 text-xs text-[var(--pi-text)] outline-none focus:border-[var(--pi-accent)]"
					onChange={(e) => onQueryChange(e.target.value)}
					placeholder="Search sessions..."
					value={query}
				/>
			</div>

			{/* List */}
			<div className="min-h-0 flex-1 overflow-auto">
				{(sessions?.length ?? 0) === 0 ? (
					<div className="flex h-32 items-center justify-center text-xs text-[var(--pi-text-muted)]">
						{query ? 'No sessions found' : 'No sessions yet'}
					</div>
				) : (
					<ul className="space-y-1">
						{sessions?.map((session) => (
							<li
								key={session.id}
								className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-[var(--pi-surface-raised)]"
							>
								<button
									className="min-w-0 flex-1 text-left"
									onClick={() => onOpen?.(session.id)}
								>
									<div className="truncate text-xs font-medium text-[var(--pi-text)]">
										{session.name || 'Untitled session'}
									</div>
									<div className="truncate text-[10px] text-[var(--pi-text-muted)]">
										{formatTimestamp(session.lastActive)} · {session.messageCount} messages
									</div>
								</button>
								<div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
									<Button
										size="sm"
										variant="ghost"
										onClick={() => onExport?.(session.id)}
									>
										<Download className="size-3" />
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => onDelete?.(session.id)}
									>
										<Trash2 className="size-3" />
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

interface SystemSectionProps {
	logs: string[];
	logQuery: string;
	logLevel: 'ALL' | 'INFO' | 'WARNING' | 'ERROR';
	onLogQueryChange: (q: string) => void;
	onLogLevelChange: (level: 'ALL' | 'INFO' | 'WARNING' | 'ERROR') => void;
	onRestart?: () => Promise<void>;
	onUpdate?: () => Promise<void>;
}

function SystemSection({
	logs,
	logQuery,
	logLevel,
	onLogQueryChange,
	onLogLevelChange,
	onRestart,
	onUpdate,
}: SystemSectionProps) {
	return (
		<div className="flex h-full flex-col gap-3">
			{/* Actions */}
			<div className="flex items-center gap-2">
				{onRestart && (
					<Button size="sm" variant="secondary" onClick={onRestart}>
						Restart gateway
					</Button>
				)}
				{onUpdate && (
					<Button size="sm" onClick={onUpdate}>
						Check for updates
					</Button>
				)}
			</div>

			{/* Logs */}
			<div className="flex min-h-0 flex-1 flex-col gap-2">
				<div className="flex items-center gap-2">
					<span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--pi-text-faint)]">
						Recent logs
					</span>
					<select
						className="h-6 rounded border border-[var(--pi-border)] bg-transparent px-1.5 text-[10px] text-[var(--pi-text-muted)]"
						onChange={(e) => onLogLevelChange(e.target.value as typeof logLevel)}
						value={logLevel}
					>
						<option value="ALL">all</option>
						<option value="INFO">info</option>
						<option value="WARNING">warning</option>
						<option value="ERROR">error</option>
					</select>
					<input
						className="h-6 flex-1 rounded border border-[var(--pi-border)] bg-transparent px-2 text-[10px] text-[var(--pi-text-muted)] outline-none"
						onChange={(e) => onLogQueryChange(e.target.value)}
						placeholder="Filter logs..."
						value={logQuery}
					/>
				</div>
				<div className="min-h-0 flex-1 overflow-auto rounded-md border border-[var(--pi-border)] bg-[var(--pi-bg)] p-2 font-mono text-[10px] text-[var(--pi-text-muted)]">
					{logs.length === 0 ? (
						<div className="flex h-20 items-center justify-center">No logs</div>
					) : (
						logs.slice(0, 200).map((line, i) => (
							<div key={i} className="whitespace-pre-wrap">
								{line}
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);
}

interface UsageSectionProps {
	stats: NonNullable<CommandCenterProps['stats']>;
	maxDailyTokens: number;
	compactNumber: (n: number) => string;
}

function UsageSection({ stats, maxDailyTokens, compactNumber }: UsageSectionProps) {
	return (
		<div className="flex h-full flex-col gap-4 overflow-auto">
			{/* Totals */}
			<div className="grid grid-cols-3 gap-4">
				<StatCard label="Sessions" value={compactNumber(stats.totalSessions)} />
				<StatCard label="API calls" value={compactNumber(stats.totalApiCalls)} />
				<StatCard
					label="Tokens"
					value={`${compactNumber(stats.totalInputTokens)} / ${compactNumber(stats.totalOutputTokens)}`}
				/>
			</div>

			{/* Daily chart */}
			{stats.daily && stats.daily.length > 0 && (
				<section>
					<div className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--pi-text-faint)]">
						Daily tokens
					</div>
					<div className="flex h-20 items-end gap-px rounded-md border border-[var(--pi-border)] bg-[var(--pi-bg)] p-2">
						{stats.daily.map((day) => {
							const inputH = Math.round(((day.inputTokens / maxDailyTokens) * 100) * 0.8);
							const outputH = Math.round(((day.outputTokens / maxDailyTokens) * 100) * 0.8);
							return (
								<div
									key={day.day}
									className="relative flex h-full min-w-0 flex-1 flex-col justify-end"
									title={`${day.day}: ${compactNumber(day.inputTokens)} in / ${compactNumber(day.outputTokens)} out`}
								>
									<div
										className="w-full rounded-t-[1px] bg-[var(--pi-accent)]/50"
										style={{ height: Math.max(inputH, day.inputTokens > 0 ? 2 : 0) }}
									/>
									<div
										className="w-full bg-emerald-500/60"
										style={{ height: Math.max(outputH, day.outputTokens > 0 ? 2 : 0) }}
									/>
								</div>
							);
						})}
					</div>
					<div className="mt-1 flex justify-between text-[8px] text-[var(--pi-text-faint)]">
						<span>{stats.daily[0]?.day}</span>
						<span>{stats.daily[stats.daily.length - 1]?.day}</span>
					</div>
				</section>
			)}

			{/* Top models */}
			{stats.topModels && stats.topModels.length > 0 && (
				<section>
					<div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--pi-text-faint)]">
						Top models
					</div>
					<ul className="space-y-1">
						{stats.topModels.slice(0, 6).map((m) => (
							<li key={m.model} className="flex items-center justify-between text-[10px]">
								<span className="truncate font-mono text-[var(--pi-text)]">{m.model}</span>
								<span className="text-[var(--pi-text-muted)]">{compactNumber(m.tokens)}</span>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

function StatCard({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border border-[var(--pi-border)] bg-[var(--pi-bg)] px-3 py-2">
			<div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--pi-text-faint)]">
				{label}
			</div>
			<div className="mt-0.5 text-sm font-semibold text-[var(--pi-text)]">{value}</div>
		</div>
	);
}

function MaintenanceSection() {
	return (
		<div className="flex h-full items-center justify-center text-xs text-[var(--pi-text-muted)]">
			<div className="flex flex-col items-center gap-2">
				<Settings className="size-8 text-[var(--pi-text-faint)]" />
				<span>Maintenance tools coming soon</span>
			</div>
		</div>
	);
}