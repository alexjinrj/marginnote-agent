class MarginnoteAgent < Formula
  desc "Local MarginNote MCP bridge with a Homebrew-managed service console"
  homepage "https://github.com/alexjinrj/marginnote-agent"
  url "https://github.com/alexjinrj/marginnote-agent.git",
      revision: "157b4e2e2898f0da0a438ce744ccec087118e987"
  version "0.9.2"
  # This fork does not currently include a license file, so the formula does
  # not assert one. Add a license to the repository before publishing a tap.

  depends_on "node"
  depends_on "pnpm" => :build

  # This formula intentionally installs the source tree so the dashboard can
  # rebuild the add-on when the user explicitly requests it.
  def caveats
    <<~EOS
      Start the managed bridge and dashboard:
        brew services start marginnote-agent

      Open the dashboard:
        marginnote-agent dashboard

      The MarginNote add-on is installed separately:
        marginnote-agent status
        open "$(brew --prefix)/opt/marginnote-agent/share"

      The MCP stdio server is launched by your MCP client; it is not a
      background service. Print the Codex configuration with:
        marginnote-agent mcp-config
    EOS
  end

  def install
    # The service runs from an immutable libexec tree. State, logs, helper
    # binaries, and generated add-on packages are kept outside the Cellar.
    libexec.install Dir["*"]
    cd libexec do
      system "pnpm", "install",
             "--prod",
             "--frozen-lockfile",
             "--ignore-scripts"
    end

    bin.install_symlink libexec/"bin/marginnote-agent"
    bin.install_symlink libexec/"bin/marginnote-agent-mcp"
    bin.install_symlink libexec/"bin/mn-agent"
  end

  service do
    run [opt_bin/"mn-agent", "serve"]
    keep_alive true
    working_dir var
    log_path var/"log/marginnote-agent.log"
    error_log_path var/"log/marginnote-agent.err.log"
    environment_variables PATH: std_service_path_env,
                          MN_AGENT_SERVICE_MODE: "Homebrew service"
  end

  test do
    assert_equal "0.9.2", shell_output("#{bin}/mn-agent --version").strip
    assert_predicate libexec/"share/marginnote-agent.mnaddon", :exist?
    assert_predicate libexec/"mcp/src/index.mjs", :exist?
    assert_predicate bin/"marginnote-agent-mcp", :exist?
    assert_match "marginnote-agent-mcp", shell_output("#{bin}/mn-agent mcp-config")
  end
end
