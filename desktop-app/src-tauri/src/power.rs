//! Keep-awake — hold one OS sleep inhibitor while an agent turn is running.
//!
//! The renderer owns the user's mode (off / while-working / always) and calls
//! `keep_awake_set` whenever the desired state changes. This module owns the
//! single native inhibitor. `while-working` is the default because a laptop
//! sleeping mid-turn freezes long local-model runs; `always` is the old
//! boolean toggle's meaning.
//!
//! Platform notes:
//! - macOS: `/usr/bin/caffeinate -i -w <pid>` prevents idle system sleep but
//!   still lets the display dim; the child exits when this process does.
//! - Linux: `systemd-inhibit` blocks idle/sleep for the lifetime of its child.
//!   A system without systemd gets no inhibitor rather than a crash.
//! - Windows: `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)`
//!   is per-thread, so a dedicated worker holds it until stopped.

use std::sync::Mutex;

pub struct KeepAwakeState {
	inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
	active: bool,
	guard: Option<platform::Guard>,
}

impl Default for KeepAwakeState {
	fn default() -> Self {
		Self {
			inner: Mutex::new(Inner::default()),
		}
	}
}

impl KeepAwakeState {
	pub fn set(&self, active: bool) -> Result<bool, String> {
		let mut inner = self
			.inner
			.lock()
			.map_err(|_| "keep-awake lock poisoned".to_string())?;
		if inner.active == active {
			return Ok(inner.active);
		}

		if active {
			inner.guard = Some(platform::Guard::start()?);
			inner.active = true;
		} else {
			// Dropping the guard releases the native inhibitor.
			inner.guard = None;
			inner.active = false;
		}

		Ok(inner.active)
	}

	pub fn is_active(&self) -> bool {
		self.inner.lock().map(|inner| inner.active).unwrap_or(false)
	}
}

#[tauri::command]
pub fn keep_awake_set(
	state: tauri::State<'_, KeepAwakeState>,
	active: bool,
) -> Result<bool, String> {
	state.set(active)
}

#[tauri::command]
pub fn keep_awake_status(state: tauri::State<'_, KeepAwakeState>) -> bool {
	state.is_active()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod platform {
	use std::process::{Child, Command, Stdio};

	pub struct Guard {
		child: Child,
	}

	impl Guard {
		pub fn start() -> Result<Self, String> {
			#[cfg(target_os = "macos")]
			let mut command = {
				let mut command = Command::new("/usr/bin/caffeinate");
				command.args(["-i", "-w", &std::process::id().to_string()]);
				command
			};

			#[cfg(target_os = "linux")]
			let mut command = {
				let mut command = Command::new("systemd-inhibit");
				command.args([
					"--what=idle:sleep",
					"--who=A-Coder Desktop",
					"--why=An agent turn is running",
					"--mode=block",
					"sleep",
					"infinity",
				]);
				command
			};

			command
				.stdin(Stdio::null())
				.stdout(Stdio::null())
				.stderr(Stdio::null());

			let child = command
				.spawn()
				.map_err(|error| format!("could not start keep-awake inhibitor: {error}"))?;
			Ok(Self { child })
		}
	}

	impl Drop for Guard {
		fn drop(&mut self) {
			let _ = self.child.kill();
			let _ = self.child.wait();
		}
	}
}

#[cfg(windows)]
mod platform {
	use std::sync::atomic::{AtomicBool, Ordering};
	use std::sync::Arc;
	use std::thread::{self, JoinHandle};
	use std::time::Duration;
	use windows_sys::Win32::System::Power::{
		SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
	};

	pub struct Guard {
		stop: Arc<AtomicBool>,
		handle: Option<JoinHandle<()>>,
	}

	impl Guard {
		pub fn start() -> Result<Self, String> {
			let stop = Arc::new(AtomicBool::new(false));
			let worker_stop = Arc::clone(&stop);
			let handle = thread::Builder::new()
				.name("keep-awake".to_string())
				.spawn(move || {
					while !worker_stop.load(Ordering::Relaxed) {
						// ES_CONTINUOUS | ES_SYSTEM_REQUIRED asks Windows to keep
						// the system available until this thread resets it.
						unsafe {
							SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
						}
						for _ in 0..30 {
							if worker_stop.load(Ordering::Relaxed) {
								break;
							}
							thread::sleep(Duration::from_millis(100));
						}
					}
					unsafe {
						SetThreadExecutionState(ES_CONTINUOUS);
					}
				})
				.map_err(|error| format!("could not start keep-awake thread: {error}"))?;

			Ok(Self {
				stop,
				handle: Some(handle),
			})
		}
	}

	impl Drop for Guard {
		fn drop(&mut self) {
			self.stop.store(true, Ordering::Relaxed);
			if let Some(handle) = self.handle.take() {
				let _ = handle.join();
			}
		}
	}
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
mod platform {
	pub struct Guard;

	impl Guard {
		pub fn start() -> Result<Self, String> {
			Ok(Self)
		}
	}
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
	use super::KeepAwakeState;

	#[test]
	fn toggles_the_native_inhibitor() {
		let state = KeepAwakeState::default();
		assert!(!state.is_active());
		assert!(state.set(true).expect("start caffeinate"));
		assert!(state.is_active());
		assert!(!state.set(false).expect("stop caffeinate"));
		assert!(!state.is_active());
	}
}
