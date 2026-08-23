# OpenCode Workspace Management Comparison

## Key Patterns

### 1. Home Dashboard
OpenCode has a unified home view with:
- **Projects sidebar** — All projects with server health indicators, expand/collapse
- **Sessions list** — Grouped by time (today, yesterday, older)
- **Session search** — Search across all sessions
- **Utility nav** — Settings, help

### 2. Session Grouping by Time
```typescript
// home-sessions-controller.tsx
const groups = groupSessions(records, language)
// Returns: [{ id: "today", title: "Today", sessions }, { id: "yesterday", ... }, { id: "older", ... }]
```

### 3. Closed Tabs Stack
```typescript
// closed-tabs.ts
type ClosedTab = { tab: SessionTab; index: number }
const CLOSED_TAB_LIMIT = 25

pushClosedTab(stack, tab, index)  // When closing a tab
takeClosedTab(stack, tabs)       // When re-opening (Ctrl+Shift+T)
```

### 4. Draft Sessions
```typescript
// tabs.tsx
type DraftTab = {
  type: "draft"
  draftID: string
  server: ServerConnection.Key
  directory: string
  worktree?: string
}
```
Draft tabs are in-memory sessions that haven't been saved yet. Can be opened as background tabs.

### 5. Session Preloading
```typescript
// Preload markdown for faster session open
void ctx.sync.session.sync(sessionId).then(() =>
  Promise.all(messages.flatMap(m => 
    parts.filter(p => p.type === "text").map(p => preloadMarkdown(p.text, p.id))
  ))
)
```

### 6. Multi-Server Architecture
- Local sidecar
- WSL connection
- Remote HTTP servers
- Each server has its own project list and sessions

## Priority for A-Coder Desktop

| Feature | Impact | Effort | Priority |
|---------|--------|--------|----------|
| Session grouping (today/yesterday/older) | High | Small | **P1** |
| Closed tabs stack (Ctrl+Shift+T) | High | Small | **P1** |
| Home dashboard (projects + sessions) | High | Medium | **P2** |
| Session search | Medium | Small | **P2** |
| Draft sessions | Medium | Medium | **P3** |
| Multi-server support | Low | Large | **P4** |
| Worktree management | Medium | Large | **P4** |