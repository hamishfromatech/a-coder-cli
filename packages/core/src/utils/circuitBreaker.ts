/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Circuit breaker states.
 *
 * - **Closed**: Normal operation — requests pass through.
 * - **Open**: Failure threshold exceeded — requests are rejected immediately.
 * - **HalfOpen**: Probing — a single request is allowed to test recovery.
 */
export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 3. */
  failureThreshold?: number;
  /** Duration in ms to stay open before transitioning to half-open. Default: 30000. */
  resetTimeoutMs?: number;
  /** Optional name for logging/debugging. */
  name?: string;
}

const DEFAULT_OPTIONS: Required<CircuitBreakerOptions> = {
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  name: 'unnamed',
};

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    this.failureThreshold = opts.failureThreshold;
    this.resetTimeoutMs = opts.resetTimeoutMs;
    this.name = opts.name;
  }

  /**
   * Returns true if the circuit allows a request through.
   */
  canExecute(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      // Check if enough time has passed to transition to half-open
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        return true;
      }
      return false;
    }

    // HALF_OPEN: allow one probe request
    return true;
  }

  /**
   * Records a successful execution.
   */
  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      // Probe succeeded — close the circuit
      this.state = CircuitState.CLOSED;
    }
    this.consecutiveFailures = 0;
  }

  /**
   * Records a failed execution. Opens the circuit if the failure threshold is exceeded.
   */
  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  /**
   * Returns the current circuit state.
   */
  getState(): CircuitState {
    // Auto-transition from OPEN to HALF_OPEN if timeout has passed
    if (
      this.state === CircuitState.OPEN &&
      Date.now() - this.lastFailureTime >= this.resetTimeoutMs
    ) {
      this.state = CircuitState.HALF_OPEN;
    }
    return this.state;
  }

  /**
   * Returns the number of consecutive failures.
   */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /**
   * Manually resets the circuit to closed state.
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
  }

  /**
   * Executes a function through the circuit breaker.
   * Returns the result on success, or throws a CircuitOpenError if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new CircuitOpenError(
        `Circuit "${this.name}" is open after ${this.consecutiveFailures} consecutive failures. ` +
        `Will retry in ${Math.max(0, this.resetTimeoutMs - (Date.now() - this.lastFailureTime))}ms.`,
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
}

/**
 * Error thrown when a circuit breaker is open and rejects a request.
 */
export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
