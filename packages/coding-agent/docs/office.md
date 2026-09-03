# Your Office

Your Office gives A-Coder a society of **named coworkers** — agents with their own faces, persistent memory, and a place to talk to each other. Coworkers chat in **huddles** (group conversations), take **errands** (scheduled jobs), and DM you directly. It is a team, not a toolbox: coworkers hold context across sessions, hand work to each other, and stay quiet ("pass") when they have nothing to add.

## Concepts

| Concept    | What it is                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| Coworker   | A named agent with a handle (`@atlas`), a role, a soul (persona), a face, and its own canonical session per project |
| Huddle     | A group conversation between coworkers and you (max 6 seated)                                                     |
| DM         | A coworker's 1:1 chat with you — the same huddle machinery with one member                                       |
| Errand     | A scheduled job for one coworker: every N minutes, daily at HH:MM, or once                                        |
| Soul       | The persona text pinned into a coworker's session at first contact (identity + collaboration protocol)             |
| Drive      | The bounded round-robin that runs a huddle after a user send                                                     |

## Where things live

- Roster: `~/.a-coder/cli/office/coworkers.json`
- Huddles: `~/.a-coder/cli/office/huddles.json` + `huddles-data/<id>.json` (the log)
- Errands: `~/.a-coder/cli/office/errands.json`
- Coworker sessions: normal session files in each project's session dir (the pointer is stored per coworker per project cwd)

Set `A_CODER_CLI_OFFICE_DIR` to relocate the office root.

## Desktop

The **Office** panel is the third tab in the right sidebar (next to Files and Git). From there you can:

- Hire a coworker (name, role, mission, soul, face palette + shape, model override, autonomy)
- Seat huddles and watch them talk; @handle chips address specific coworkers
- DM any coworker from the roster
- Schedule errands — with **continuity**, each run happens in the coworker's own session, so scheduled agents learn between runs
- Answer supervised prompts (approvals/questions) inline

## TUI

```
/office                        # roster overview
/office hire Atlas | Scout | Watches the repo
/office huddle "Launch room" @atlas @nova
/office tell @atlas <message>  # DM; prints the reply
/office say "Launch room" <message>
/office stop "Launch room"
```

`tell` and `say` wait (bounded) for the drive to settle and print what landed.

## How a huddle drive works

A user send triggers at most **3 rounds** over the seated roster (never parallel, no LLM router). Who speaks each round is a deterministic `@mention` parse of everything since the last user message — mentioned coworkers only, else everyone — rotated so a different coworker leads each round. Each coworker runs its turn in its **own** session and is fed only the messages new since its last turn. Rules travel in the turn prompt, so any existing coworker can join a huddle without a session migration:

- Reply with one message only when you have something new worth adding.
- Replying exactly `(pass)` (or nothing) is silence — passing is good.
- A round where everyone passed settles the room.

Extras:

- **Holds**: "stop @atlas" holds a coworker (no turns) until a direct mention or `@all` re-addresses them. Conservative by design: "don't stop @atlas" also holds.
- **Late work**: a turn that outlives its window is marked stranded; the reply is harvested into the room at the next boundary instead of being lost.
- **Redirects**: a user message landing mid-drive makes in-flight replies yield to you.
- **Caps**: 3 rounds, 10 messages, 24-line history window per turn, 20-minute hard turn cap.

## Autonomy

| Mode         | Behavior                                                                        |
| ------------ | ------------------------------------------------------------------------------- |
| `supervised` | Tool approvals and questions route to you as office prompt cards; deny on timeout |
| `auto`       | Runs with the engine's auto permission mode — no prompts                         |

## RPC surface

The engine exposes the office to embedded clients (the desktop is one):

- Commands: `office_list`, `office_coworker_save` / `office_coworker_delete`, `office_huddle_save` / `office_huddle_delete`, `office_send`, `office_huddle_get`, `office_stop`, `office_respond`, `office_errand_save` / `office_errand_delete` / `office_errand_run`
- Events: `office_update` (roster snapshot: coworkers, statuses, huddle summaries, errands, pending prompts) and `office_huddle` (a huddle's log changed)

See `docs/rpc.md` for the transport.