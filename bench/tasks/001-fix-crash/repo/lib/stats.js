export function sum(values) {
	return values.reduce((acc, v) => acc + v, 0);
}

export function mean(values) {
	if (values.length === 0) return 0;
	return sum(values) / values.length;
}