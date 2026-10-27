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
- **Add-on not detected:** use `marginnote-agent status`, check MarginNote's
  extension manager, or set `MN_AGENT_ADDON_PATH` to the installed
  `.mnaddon` directory.
- **MCP reports a different installation:** regenerate `mcp-config` after
  upgrading and reconnect the client.
- **Logs are empty:** confirm the log path with `marginnote-agent status
  --json`; Homebrew-owned logs are under `$(brew --prefix)/var/log`.

The legacy LaunchAgent installer is disabled by default because two
supervisors can conflict on port 42117. Do not re-enable it unless you are
recovering an old installation.
