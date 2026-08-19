import { cn } from "../../lib/cn";

export function Card({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-lg bg-pi-surface-raised shadow-ring transition-smooth",
				className,
			)}
		>
			{children}
		</div>
	);
}

export function CardHeader({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"border-b border-pi-border px-4 py-3",
				className,
			)}
		>
			{children}
		</div>
	);
}

export function CardBody({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"p-4",
				className,
			)}
		>
			{children}
		</div>
	);
}

export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
}: {
	icon?: React.ComponentType<{ className?: string }>;
	title?: string;
	description?: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center gap-2 px-6 py-8 text-center">
			{Icon && (
				<div className="flex h-10 w-10 items-center justify-center rounded-full bg-pi-accent-soft text-pi-accent">
					<Icon className="h-5 w-5" />
				</div>
			)}
			{title && (
				<p className="text-xs font-medium text-pi-text">{title}</p>
			)}
			{description && (
				<p className="max-w-[16rem] text-2xs leading-relaxed text-pi-text-muted">
					{description}
				</p>
			)}
			{action}
		</div>
	);
}
