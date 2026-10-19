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
- Huddles: `~/.a-coder/cli/office/huddles.json` + `huddles-data/<id>.log.jsonl` (append-only messages) and `huddles-data/<id>.state.json` (epoch, watermarks, holds, running, stranded). Legacy `huddles-data/<id>.json` files are read and migrated on the next write.
- Errands: `~/.a-coder/cli/office/errands.json`
- Coworker sessions: normal session files in each project's session dir (the pointer is stored per coworker per project cwd)

Set `A_CODER_CLI_OFFICE_DIR` to relocate the office root.

## Desktop

The **Office** panel is the third tab in the right sidebar (next to Files and Git). From there you can:

- Hire a coworker (name, role, mission, soul, face palette + shape, model override, TTS voice, autonomy)
- Seat huddles and watch them talk; @handle chips address specific coworkers
- DM any coworker from the roster
- Schedule errands — with **continuity**, each run happens in the coworker's own session, so scheduled agents learn between runs
- Answer supervised prompts (approvals/questions) inline
- Start a **voice call in a huddle or DM**: your speech is transcribed into a
  huddle message, the room's normal drive runs, and every new coworker reply
  is spoken in order with the speaker named first. The mic parks while the
  room talks; skip the current sentence, mute the mic, or end the call from
  the call bar. With `voiceBargeIn` enabled (Settings → Voice → Call mode),
  speaking over a reply takes the floor and redirects the room. The 1:1 voice
  call and a huddle call are mutually exclusive (one microphone). Huddles/DMs
  with activity since you last opened them show an unread dot in the roster.

**Floor view** (the building button): the 2D floor is the default and the 3D
scene is lazy-loaded. Both render the same shared floor state, so switching
views keeps every coworker where they were and does not replay the walk-in;
the chosen view is remembered. The legend names the status hues, and clicking
a face opens that coworker's DM. Errands show their next fire time in the
roster, and a running errand is never double-fired by the ticker.

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
- **Log cap**: 500 stored lines per huddle; older lines drop with every read pointer shifted, so a long-running room cannot grow without bound.

## Autonomy

| Mode         | Behavior                                                                        |
| ------------ | ------------------------------------------------------------------------------- |
| `supervised` | Tool approvals and questions route to you as office prompt cards; deny on timeout |
| `auto`       | Runs with the engine's auto permission mode — no prompts                         |

## RPC surface

The engine exposes the office to embedded clients (the desktop is one):

- Commands: `office_list`, `office_coworker_save` / `office_coworker_delete`, `office_huddle_save` / `office_huddle_delete`, `office_send`, `office_huddle_get`, `office_stop`, `office_respond`, `office_errand_save` / `office_errand_delete` / `office_errand_run`
- Events: `office_update` (roster snapshot: coworkers, statuses, huddle summaries, errands, pending prompts), `office_huddle` (full room log on first contact / after trimming), and `office_huddle_delta` (appended messages + live drive state)

See `docs/rpc.md` for the transport.

## Faces

Coworkers use a procedural face (shape + color) by default. The editor's **Upload photo** action center-crops to a square, downscales to 256px, and stores the data URL in `coworker.face.image`. Both floor views prefer the image: the 2D SVG face clips it to the shape and the 3D scene maps it onto the head. Removing the photo falls back to the procedural face. The image lives in the office store, so it survives restarts and project switches.

## Coworker details

The roster's stats button opens per-coworker details: turns, tokens, session count, last activity, and every canonical session for that coworker (per project cwd). **Open** routes through the normal session switch, so the transcript tab takes over. Stats are computed from the session entries (user messages = turns; assistant usage = tokens), not from a separate counter.
