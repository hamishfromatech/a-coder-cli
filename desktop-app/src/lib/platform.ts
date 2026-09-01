/**
 * Host-OS detection for window-chrome decisions. The Tauri webview reports
 * the host OS in navigator.userAgent, so "Macintosh" means macOS and the
 * window uses the native overlay traffic lights; every other platform
 * (including jsdom under vitest) renders the custom in-app window controls.
 */
export const isMacOS = /\bMacintosh\b/.test(navigator.userAgent);