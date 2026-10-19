# Usage

[Documentation](README.md)

## Start a lesson

| Host        | Teach                                         | Get the link              |
| ----------- | --------------------------------------------- | ------------------------- |
| Pi          | `/teach <topic>`                              | `/classroom`              |
| Claude Code | `/studens:teach <topic>`                      | `/studens:classroom`      |
| Codex       | Ask to learn a topic or use the `teach` skill | Ask to open the classroom |

Omit the topic to continue. In Pi, `/classroom <name>` opens one classroom,
`/classroom list` lists saved material, and `/classroom status` reports the server.
Links are returned to you; commands do not launch a browser.

On the lesson page, highlight text to ask a question and use its card for follow-ups.
Submit quizzes for per-question feedback. Reply to teacher questions below the
quiz. Return to the initiating chat when you want new material.

The classroom page offers reviews of due ideas. Failed requests show their specific
error and require an explicit retry. Quiz answers, grades, question threads, and
unsent drafts survive reloads. Rewriting a highlighted sentence may leave its card
unanchored. Question identifiers must stay stable after submission.

Use **New folder** and **Move to folder** to group classrooms. Deleting a folder
returns its classrooms to **Unfiled** and keeps their lessons and links.

## Teacher service

Pi's HTTP server runs in its live session and stops with that session. Use
`/classroom start` or `/classroom stop` to control it. The status widget shows its port.

Claude Code and Codex use a persistent service with one dedicated teacher per
classroom. Closing the initiating chat leaves it running. Use `classroom_service`
with action `start`, `status`, or `stop`, or run these commands from the package:

```sh
npm run service -- start
npm run service -- status
npm run service -- stop
```

Status reports the owner process, package path, root, port, and log. The default
address is `127.0.0.1:43123`; set `PI_CLASSROOM_SERVICE_PORT` to change it. Unix
local sockets are required. A conflicting port, package path, version, or classroom
backend causes an error. Stop the old service explicitly before replacing it.
Set `PI_CLASSROOM_TEACHER=codex` or `claude` when the initiating host is unknown.

Requests and plans are saved before writes. Recovery completes saved plans without
another model call or duplicate grade. Interrupted calls and authentication errors
appear on the page; resolve the cause and select **Retry request**.

## Updating Studens

Release installs use a `v<version>` tag, not the latest checkout. Existing local-path
installs must be removed from the host's configuration before switching to the
release install commands in the README. For Pi, remove the local package with
`pi remove /absolute/path/to/studens`. In Claude Code, stop passing `--plugin-dir`
for the development checkout. In Codex, remove a checkout-backed marketplace and
add the GitHub marketplace shown in the README.

For Pi, install the tag of the release you want, for example
`pi install git:github.com/max-miller1204/studens@v0.11.1`, then use `/reload`.
Repeating `pi install` with a different tag changes the pinned version. General
package updates keep that tag instead of following the default branch.

For Claude Code, run `claude plugin marketplace update studens`, then
`claude plugin update studens@studens`. For Codex, run
`codex plugin marketplace upgrade studens`, then `codex plugin add studens@studens`.
The refreshed catalog selects a named release; it does not install untagged code
from `main`. Start a new host session after changing the installed plugin.

Before changing releases, finish active teacher work. Stop the persistent service
explicitly with `classroom_service` action `stop` (or `npm run service -- stop`
from its installed package), then start the new release. Pi's server belongs to
its session; `/reload` reloads the extension in that session. Classrooms and saved
learner state keep their existing locations.

## Phone and remote links

While Tailscale is connected, classroom commands create tailnet-only HTTPS links.
HTTP stays on loopback. Tailnet members allowed by your policy can read pages and
submit requests. Without a connected tailnet, links use `127.0.0.1`.

The service uses HTTPS port 8443 and Pi uses 8444. Change these or disable tailnet
links in [configuration](CONFIGURATION.md). Route errors are explicit: occupied
ports and Funnel-enabled ports are rejected, and unrelated Serve routes stay intact.
Service stop removes its route; Pi stop or session end removes Pi's route.
A disconnected node cannot remove a route, so its ownership record is retained.

## Upgrading from pi-teach

1. Stop the old persistent service with `classroom_service` action `stop`, or
   `npm run service -- stop` from its package directory. End old Pi teaching sessions.
2. Remove the old installation: `pi remove git:github.com/max-miller1204/pi-teach`,
   `claude plugin uninstall pi-teach@pi-teach`, or `codex plugin remove pi-teach@pi-teach`.
3. Follow the [Studens install commands](../README.md#install). Use `studens@studens`
   for the plugin identifier and `/studens:teach` in Claude Code.

Existing classrooms, `PI_CLASSROOM_*` settings, and `~/.pi/agent/classroom.json`
keep their locations and names. The private `.pi-teach-service/` and `.pi-teach-pi/`
folders and local socket name are retained so both versions find the same owner and
saved recovery state. Do not run both installations against one classroom root.
