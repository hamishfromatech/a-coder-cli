# Remote Sessions Feature Implementation Plan

Based on analysis of this codebase and Claude Code's remote architecture, this document outlines how to implement a remote sessions feature similar to `claude --remote`.

## Claude Code Remote Reference

From Claude Code's documentation, the remote feature offers:

| Feature | Description |
|---------|-------------|
| **Persistence** | Tasks continue even if you close the app or shut down your computer |
| **Multi-repo support** | Work across multiple codebases simultaneously |
| **Cross-device access** | Monitor/interact via web interface or mobile app |
| **Background execution** | Long-running tasks (refactors, test suites, migrations) run unattended |

### Key Commands

```bash
# Start a remote session
claude --remote "Fix the authentication bug in src/auth/login.ts"

# Enable remote control for interactive sessions
claude --remote-control
```

---

## Current Architecture Overview

The a-coder codebase already has key infrastructure pieces:

| Component | Location | Status |
|-----------|----------|--------|
| **Session Management** | `packages/core/src/session/sessionManager.ts` | ✅ Ready - persists sessions to `~/.a-coder-cli/sessions/` |
| **HTTP Server Pattern** | `packages/vscode-ide-companion/src/ide-server.ts` | ✅ Ready - Express + MCP protocol on port 3000 |
| **MCP Client** | `packages/core/src/tools/mcp-client.ts` | ✅ Ready - supports SSE, HTTP, stdio transports |
| **Subagent/Process Isolation** | `packages/core/src/services/subagentManager.ts` | ✅ Ready - fork-based process management |
| **Task System** | `packages/core/src/tools/tasks.ts` | ✅ Ready - task creation/management |
| **Hook System** | `packages/core/src/hooks/hookExecutor.ts` | ✅ Ready - event-driven architecture |
| **CLI Arguments** | `packages/cli/src/config/config.ts` | ⚠️ Needs `--remote` and `--remote-control` flags |

---

## Architecture Design for Remote Sessions

```
┌─────────────────────────────────────────────────────────────────────┐
│                         REMOTE ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────┐    │
│  │   CLI Client │     │  Web Client  │     │  Mobile Client   │    │
│  │  (terminal)  │     │  (browser)   │     │    (app)         │    │
│  └──────┬───────┘     └──────┬───────┘     └────────┬─────────┘    │
│         │                    │                      │              │
│         └────────────────────┼──────────────────────┘              │
│                              │                                      │
│                              ▼                                      │
│              ┌───────────────────────────────┐                     │
│              │     Remote Session Server     │                     │
│              │    (Express + WebSocket/SSE)   │                     │
│              │                               │                     │
│              │  ┌─────────────────────────┐  │                     │
│              │  │   Session Manager       │  │                     │
│              │  │   - Create/Resume       │  │                     │
│              │  │   - Persist to cloud    │  │                     │
│              │  └─────────────────────────┘  │                     │
│              │                               │                     │
│              │  ┌─────────────────────────┐  │                     │
│              │  │   Task Queue            │  │                     │
│              │  │   - Background tasks    │  │                     │
│              │  │   - Status tracking     │  │                     │
│              │  └─────────────────────────┘  │                     │
│              │                               │                     │
│              │  ┌─────────────────────────┐  │                     │
│              │  │   Tool Executor         │  │                     │
│              │  │   - Shell, Read, etc.   │  │                     │
│              │  └─────────────────────────┘  │                     │
│              └───────────────────────────────┘                     │
│                              │                                      │
│                              ▼                                      │
│              ┌───────────────────────────────┐                     │
│              │    Cloud Storage Backend      │                     │
│              │    - Session persistence      │                     │
│              │    - User authentication      │                     │
│              └───────────────────────────────┘                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Components

### 1. New CLI Flags (`packages/cli/src/config/config.ts`)

```typescript
// Add to CliArgs interface:
interface CliArgs {
  // ... existing flags
  remote: boolean;           // Start session on remote server
  remoteControl: boolean;    // Allow remote control of local session
  remoteServer: string;      // URL of remote server
  remoteSessionId: string;   // Resume specific remote session
}

// Add to yargs configuration:
.option('remote', {
  alias: 'R',
  type: 'boolean',
  description: 'Run session on remote cloud infrastructure',
  default: false,
})
.option('remote-control', {
  type: 'boolean',
  description: 'Enable remote control for this session',
  default: false,
})
.option('remote-server', {
  type: 'string',
  description: 'Remote server URL (default: your-cloud-server.com)',
})
```

### 2. Remote Session Server (New: `packages/core/src/remote/server.ts`)

Based on the existing IDE server pattern:

```typescript
// packages/core/src/remote/server.ts
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { SessionManager, SessionData } from '../session/index.js';
import { Config } from '../config/config.js';
import { randomUUID } from 'crypto';

export interface RemoteSessionConfig {
  sessionId: string;
  userId?: string;
  projectPath: string;
  createdAt: Date;
}

export class RemoteSessionServer {
  private app: express.Application;
  private wss: WebSocketServer;
  private sessions: Map<string, RemoteSession> = new Map();
  private sessionManager: SessionManager;

  constructor(port: number = 3001) {
    this.app = express();
    this.sessionManager = new SessionManager();
    this.setupRoutes();
    this.setupWebSocket(port);
  }

  private setupRoutes() {
    this.app.use(express.json());

    // Session management endpoints
    this.app.post('/sessions', this.createSession.bind(this));
    this.app.get('/sessions', this.listSessions.bind(this));
    this.app.get('/sessions/:id', this.getSession.bind(this));
    this.app.delete('/sessions/:id', this.deleteSession.bind(this));

    // Task endpoints (like Claude Code)
    this.app.post('/tasks', this.createTask.bind(this));
    this.app.get('/tasks', this.listTasks.bind(this));
    this.app.get('/tasks/:id', this.getTaskOutput.bind(this));
    this.app.post('/tasks/:id/stop', this.stopTask.bind(this));

    // Streaming events via SSE
    this.app.get('/sessions/:id/events', this.streamEvents.bind(this));
  }

  private setupWebSocket(port: number) {
    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', (ws, req) => {
      // Handle real-time session control
      ws.on('message', async (data) => {
        const msg = JSON.parse(data.toString());
        await this.handleWebSocketMessage(ws, msg);
      });
    });
  }

  async createSession(req: express.Request, res: express.Response) {
    const session: RemoteSessionConfig = {
      sessionId: randomUUID(),
      projectPath: req.body.projectPath || process.cwd(),
      createdAt: new Date(),
    };

    // Spawn a remote session (similar to subagentManager pattern)
    const remoteSession = new RemoteSession(session, req.body.prompt);
    this.sessions.set(session.sessionId, remoteSession);

    res.json({ sessionId: session.sessionId, status: 'created' });
  }
}
```

### 3. Remote Session Client (`packages/core/src/remote/client.ts`)

```typescript
// packages/core/src/remote/client.ts
import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface RemoteClientConfig {
  serverUrl: string;
  sessionId?: string;
}

export class RemoteSessionClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private sessionId: string | null = null;

  constructor(config: RemoteClientConfig) {
    super();
    this.serverUrl = config.serverUrl;
    this.sessionId = config.sessionId || null;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${this.serverUrl}/ws`);

      this.ws.on('open', () => {
        this.emit('connected');
        resolve();
      });

      this.ws.on('message', (data) => {
        const event = JSON.parse(data.toString());
        this.emit('event', event);
      });

      this.ws.on('error', reject);
    });
  }

  async sendPrompt(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const taskId = randomUUID();

      this.ws!.send(JSON.stringify({
        type: 'prompt',
        taskId,
        prompt,
      }));

      const handler = (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString());
        if (msg.taskId === taskId && msg.type === 'result') {
          this.ws!.off('message', handler);
          resolve(msg.result);
        }
        if (msg.taskId === taskId && msg.type === 'error') {
          this.ws!.off('message', handler);
          reject(new Error(msg.error));
        }
      };

      this.ws!.on('message', handler);
    });
  }

  async getTaskOutput(taskId: string): Promise<any> {
    const response = await fetch(`${this.serverUrl}/tasks/${taskId}`);
    return response.json();
  }
}
```

### 4. Session Persistence for Remote (`packages/core/src/remote/storage.ts`)

Extend the existing `SessionManager` to support cloud storage:

```typescript
// packages/core/src/remote/storage.ts
import { SessionData } from '../session/types.js';

export interface RemoteStorageConfig {
  endpoint: string;  // Your cloud storage endpoint
  apiKey: string;
}

export class RemoteSessionStorage {
  constructor(private config: RemoteStorageConfig) {}

  async uploadSession(session: SessionData): Promise<string> {
    const response = await fetch(`${this.config.endpoint}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(session),
    });
    return response.json();
  }

  async downloadSession(sessionId: string): Promise<SessionData> {
    const response = await fetch(
      `${this.config.endpoint}/sessions/${sessionId}`,
      {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      }
    );
    return response.json();
  }

  async listSessions(userId: string): Promise<SessionData[]> {
    const response = await fetch(
      `${this.config.endpoint}/sessions?userId=${userId}`,
      {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      }
    );
    return response.json();
  }
}
```

### 5. Remote Mode Entry Point (`packages/cli/src/remote.ts`)

```typescript
// packages/cli/src/remote.ts
import { RemoteSessionClient } from '@a-coder/core';
import { SessionManager } from '@a-coder/core';

export async function runRemoteMode(
  config: Config,
  prompt: string,
  serverUrl: string
): Promise<void> {
  const client = new RemoteSessionClient({ serverUrl });

  try {
    await client.connect();
    console.log(`Connected to remote server: ${serverUrl}`);

    // Start session
    const result = await client.sendPrompt(prompt);
    console.log(result);

    // Session persists on server even if client disconnects
  } catch (error) {
    console.error('Remote session error:', error);
    process.exit(1);
  }
}

export async function resumeRemoteSession(
  sessionId: string,
  serverUrl: string
): Promise<void> {
  const client = new RemoteSessionClient({ serverUrl, sessionId });
  // Resume from cloud-stored session
  await client.connect();
  // ... resume logic
}
```

### 6. Modify Main Entry Point (`packages/cli/src/gemini.tsx`)

```typescript
// In main() function, after parsing arguments:
if (argv.remote) {
  const serverUrl = argv.remoteServer || process.env.A_CODER_REMOTE_URL || 'https://your-cloud-server.com';
  await runRemoteMode(config, input, serverUrl);
  return;
}

if (argv.remoteControl) {
  // Start local session with remote control enabled
  // Use existing IDE server pattern but with remote control capabilities
  const remoteControl = new RemoteControlServer(config);
  await remoteControl.start();
  // ... continue with normal interactive session
}
```

---

## Key Implementation Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/remote/index.ts` | **Create** | Export remote module |
| `packages/core/src/remote/server.ts` | **Create** | Express + WebSocket server |
| `packages/core/src/remote/client.ts` | **Create** | Client for connecting to remote |
| `packages/core/src/remote/storage.ts` | **Create** | Cloud session persistence |
| `packages/core/src/remote/types.ts` | **Create** | TypeScript interfaces |
| `packages/cli/src/config/config.ts` | **Modify** | Add `--remote`, `--remote-control` flags |
| `packages/cli/src/remote.ts` | **Create** | Remote mode entry point |
| `packages/cli/src/gemini.tsx` | **Modify** | Add remote mode handling |
| `packages/core/src/index.ts` | **Modify** | Export remote module |

---

## Authentication Strategy

Leverage the existing OAuth2 infrastructure (`packages/core/src/code_assist/oauth2.ts`):

```typescript
// Extend for remote authentication
export async function getRemoteAuthToken(): Promise<string> {
  const oauth2Client = getOauthClient(); // Your existing OAuth2 client
  const credentials = await oauth2Client.getAccessToken();
  return credentials.token;
}
```

---

## Deployment Options

1. **Self-hosted**: Deploy the remote server on your own infrastructure
2. **Cloud Provider**: Use Google Cloud Run, AWS Lambda, or similar
3. **Edge**: Use Cloudflare Workers for low-latency global distribution

---

## SSH Session Support (Alternative Approach)

For connecting to remote servers you own (similar to Claude's SSH sessions):

```typescript
// packages/core/src/remote/ssh.ts
import { Client } from 'ssh2';

export interface SSHSessionConfig {
  host: string;
  port: number;
  username: string;
  identityFile?: string;
  workingDir?: string;
}

export class SSHSessionManager {
  private conn: Client | null = null;

  async connect(config: SSHSessionConfig): Promise<void> {
    this.conn = new Client();
    return new Promise((resolve, reject) => {
      this.conn!.on('ready', () => resolve());
      this.conn!.on('error', reject);
      this.conn!.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        privateKey: config.identityFile
          ? require('fs').readFileSync(config.identityFile)
          : undefined,
      });
    });
  }

  async executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.conn!.exec(command, (err, stream) => {
        if (err) return reject(err);
        let output = '';
        stream.on('data', (data) => output += data);
        stream.on('close', () => resolve(output));
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.conn) {
      this.conn.end();
      this.conn = null;
    }
  }
}
```

---

## API Endpoints Reference

### Session Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sessions` | Create a new remote session |
| `GET` | `/sessions` | List all sessions for user |
| `GET` | `/sessions/:id` | Get session details |
| `DELETE` | `/sessions/:id` | Delete a session |
| `GET` | `/sessions/:id/events` | SSE stream of session events |

### Task Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/tasks` | Create a new task |
| `GET` | `/tasks` | List all tasks |
| `GET` | `/tasks/:id` | Get task output |
| `POST` | `/tasks/:id/stop` | Stop a running task |

---

## Implementation Phases

### Phase 1: CLI Flags & Client
- Add `--remote` and `--remote-control` flags to CLI
- Implement `RemoteSessionClient` for connecting to remote servers
- Basic HTTP-based session creation/resumption

### Phase 2: Remote Server
- Create `RemoteSessionServer` with Express + WebSocket
- Implement session persistence to cloud storage
- Add task queue for background execution

### Phase 3: Real-time Communication
- WebSocket-based real-time updates
- SSE for event streaming
- Mobile/web client support

### Phase 4: Advanced Features
- Multi-repository support
- Session handoff between devices
- Remote control mode with local execution

---

## Security Considerations

1. **Authentication**: Use OAuth2 tokens for all remote requests
2. **Authorization**: Validate user has access to session/project
3. **Encryption**: All WebSocket traffic over WSS (TLS)
4. **Rate Limiting**: Implement per-user rate limits
5. **Sandbox**: Run remote sessions in isolated containers
6. **Secrets Management**: Never expose API keys in session storage