# Homebrew installation and service management

MarginNote Agent is distributed as a source formula. The formula is kept in
this repository under `Formula/`; publish it in a Homebrew tap before sharing
the install command with other users.

## Prerequisites

- macOS with MarginNote 4 installed.
- Homebrew.
- Node.js 20 or newer (installed by the formula).
- Xcode Command Line Tools only if you rebuild the add-on or use local PDF OCR.

## Install

Choose one of these supported development layouts.

### Tap (recommended for distribution)

Create a tap whose repository contains the formula under `Formula/`, then:

```sh
brew install <owner>/<tap>/marginnote-agent
```

For a tap named `homebrew-marginnote`, Homebrew normally resolves the short
formula name:

```sh
brew install <owner>/marginnote/marginnote-agent
```

The formula in this repository is a template. Its `url` and `revision` must
identify a published commit that contains this implementation. Update the
formula in a separate commit or release workflow after that source commit
exists; a formula cannot reference its own containing commit.

### Local checkout after publishing

Homebrew fetches the source identified by the Formula's `url` and `revision`;
it does not install an uncommitted worktree. After committing the
implementation, updating the Formula to that commit, and making the commit
fetchable, install the Formula from a local copy:

```sh
brew install --build-from-source ./Formula/marginnote-agent.rb
```

For day-to-day development, test the JavaScript and run `mn-agent serve`
directly instead of installing a dirty source tree.

## Start the managed service

```sh
brew services start marginnote-agent
marginnote-agent status
marginnote-agent dashboard
```

The service is one foreground supervisor owned by `brew services`. It:

- listens on `127.0.0.1:42117` for the MarginNote add-on;
- serves the management page on `http://127.0.0.1:42118`;
- starts and stops its own bridge child as MarginNote starts and stops;
- never kills an unrelated process already using port 42117.

Useful commands:

```sh
brew services restart marginnote-agent
brew services stop marginnote-agent
marginnote-agent logs --follow
```

`start`, `stop`, and `restart` delegate to `brew services`. If you are
running `mn-agent serve` in the foreground, use Ctrl-C instead.

## Install the MarginNote add-on

The Homebrew formula installs the packaged add-on, but it cannot install into
MarginNote on your behalf:

```sh
marginnote-agent status
open "$(brew --prefix)/opt/marginnote-agent/share"
```

If no built package is present, the formula's bundled package is at
`$(brew --prefix)/opt/marginnote-agent/share/marginnote-agent.mnaddon`.
Install that `.mnaddon` in MarginNote 4, enable the extension, then open one
study window. The dashboard reports whether its manifest is detected in the
standard MarginNote data locations.

You can also use the dashboard's **Build add-on package** button after
installing Xcode Command Line Tools. That writes a rebuilt archive under the
user state directory and does not modify the Cellar.

## Connect the MCP client

MCP stdio is started by Codex, Claude, Claudian, or another MCP client. It is
not a second background service. Print the configuration snippet with:

```sh
marginnote-agent mcp-config
```

When installed through Homebrew, the snippet points at the stable link:

```text
$(brew --prefix)/bin/marginnote-agent-mcp
```

That link survives `brew upgrade`. Configuration pointing directly into a
versioned `Cellar/.../libexec` directory does not.

## Upgrade

Host/CLI 0.9.3 fixes dashboard detection of extracted add-ons installed in
`MarginNote Extensions/<addonid>/`. It checks `mnaddon.json` rather than
requiring a `.mnaddon` directory suffix. The bundled/installed Add-on can
remain at 0.9.2; no Add-on reinstall or MCP command change is required.

```sh
brew update
brew upgrade marginnote-agent
brew services restart marginnote-agent
```

Runtime state is intentionally outside the Cellar:

The manual Host, service, and build scripts resolve helper paths through the
same configuration. Set `MN_AGENT_STATE_DIR` to change the state root or
`MN_AGENT_HELPER_DIR` to override just the helper directory. Card OCR needs
the native helper produced by `marginnote-agent build-addon`; compilation
errors stop that build and are reported instead of silently publishing a
package without the helper. The bundled add-on is checked against its source
files in the test suite and must be regenerated after add-on source changes.

| Data | Location |
| --- | --- |
| Settings | `~/Library/Application Support/MarginNote Agent/host-control.json` |
| Rebuilt add-on | `~/Library/Application Support/MarginNote Agent/marginnote-agent.mnaddon` |
| Helper binaries | `~/Library/Application Support/MarginNote Agent/bin/` |
| Build staging | `~/Library/Application Support/MarginNote Agent/build/` |
| Homebrew service logs | `$(brew --prefix)/var/log/marginnote-agent*.log` |

The stable `bin` links and the dashboard URL do not change on upgrade. The
add-on itself is versioned separately; reinstall it when its version changes.

## Uninstall and data cleanup

Stop the managed service before removing the formula:

```sh
brew services stop marginnote-agent
brew uninstall marginnote-agent
```

`brew services stop` stops the supervisor/dashboard and its managed Host,
and unregisters login startup. Do not rely on `brew uninstall` to stop an
already running service. A Host or supervisor started manually in Terminal
must be stopped separately with Ctrl-C; the managed service does not own it.

Also uninstall the add-on in MarginNote's extension manager. Remove or
disable the MarginNote MCP entry in each client and close its existing MCP
connection; the stdio process is owned by the client, not by `brew services`.

### What remains after uninstall

The formula removes its installed program and command links. It deliberately
keeps user state outside the Cellar, so a later reinstall can reuse settings
and generated files. Retained files are not running processes and need no
routine cleanup.

| Retained data | When to remove it | Effect of removal |
| --- | --- | --- |
| `~/Library/Application Support/MarginNote Agent/host-control.json` | Reset saved pause/write settings, or uninstall permanently | The next supervisor launch uses its startup defaults instead of the saved settings |
| `~/Library/Application Support/MarginNote Agent/bin/` | Rebuild OCR helpers during troubleshooting, or uninstall permanently | Card OCR needs `marginnote-agent build-addon` again; the PDF helper is rebuilt on next use and needs Command Line Tools |
| `~/Library/Application Support/MarginNote Agent/build/` | Reclaim build staging space | A later build recreates it |
| `~/Library/Application Support/MarginNote Agent/marginnote-agent.mnaddon` | Remove an old generated installer, or uninstall permanently | Rebuild it or use the bundled package; this does not uninstall the add-on already installed in MarginNote |
| `$(brew --prefix)/var/log/marginnote-agent.log` and `marginnote-agent.err.log` | Reclaim space after stopping the service, or uninstall permanently | Old diagnostic history is lost; later service runs can create new logs |

Before resetting settings or removing helpers, stop the Host/supervisor and
close MCP connections so files are not in use. For a reset rather than a full
uninstall, remove only the relevant item above, then restart your usual Host
or service. Preserve files if you want to keep them for a later reinstall.

To remove all default user state and Homebrew service logs after stopping and
uninstalling, these optional commands delete only this project's listed paths:

```sh
rm -rf "$HOME/Library/Application Support/MarginNote Agent"
rm -f "$(brew --prefix)/var/log/marginnote-agent.log" \
      "$(brew --prefix)/var/log/marginnote-agent.err.log"
```

If you used path overrides such as `MN_AGENT_STATE_DIR`, `MN_AGENT_HELPER_DIR`
or `MN_AGENT_LOG_DIR`, inspect those configured locations separately. Source
checkouts normally log under `~/Library/Logs/MarginNote Agent/`. The state
directory is not the MarginNote note database: do not remove MarginNote's
application container or original PDFs as part of this cleanup. The Desktop
source checkout is also separate and is not removed by `brew uninstall`.

Optionally remove the tap when you no longer want its formula source:

```sh
brew untap alexjinrj/marginnote-agent
```

This removes Homebrew's tap checkout, not your Desktop repository.

## Troubleshooting

```sh
brew services list
marginnote-agent status --json
curl http://127.0.0.1:42117/health
curl http://127.0.0.1:42118/health
```

- **Port 42117 already in use:** stop the manually started bridge. The
  supervisor deliberately leaves unrelated listeners alone.
- **Dashboard is up but the bridge is stopped:** open MarginNote 4. The
  supervisor follows MarginNote rather than keeping the bridge alive forever.
- **Add-on not detected:** first upgrade the Host/CLI to at least 0.9.3 and
  restart the service. Use `marginnote-agent status`, check MarginNote's
  extension manager, or set `MN_AGENT_ADDON_PATH` to the extracted directory
  containing `mnaddon.json` (for example, `MarginNote Extensions/com.marginnote.agent.host`).
- **MCP reports a different installation:** regenerate `mcp-config` after
  upgrading and reconnect the client.
- **Logs are empty:** confirm the log path with `marginnote-agent status
  --json`; Homebrew-owned logs are under `$(brew --prefix)/var/log`.

The legacy LaunchAgent installer is disabled by default because two
supervisors can conflict on port 42117. Do not re-enable it unless you are
recovering an old installation.
