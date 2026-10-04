var MNAgentBridge = {
  addon: null,
  generation: 0,
  busy: false,
  sceneCount: 1,

  recordStage: function (stage, detail) {
    try {
      var value = String(stage) + (detail ? ": " + String(detail) : "");
      var defaults = NSUserDefaults.standardUserDefaults();
      defaults.setObjectForKey(value, "marginnote_agent_last_bridge_stage");
      defaults.synchronize();
    } catch (error) {}
  },

  start: function (addon) {
    this.stop();
    this.addon = addon;
    this.recordStage("started", MN_AGENT_ADDON_VERSION);
    this.connect();
    this.schedulePoll(this.generation);
  },

  stop: function () {
    this.generation += 1;
    this.busy = false;
    this.addon = null;
  },

  schedulePoll: function (generation) {
    var bridge = this;
    NSTimer.scheduledTimerWithTimeInterval(0.5, false, function () {
      if (bridge.generation !== generation || !bridge.addon) return;
      bridge.poll();
      bridge.schedulePoll(generation);
    });
  },

  connect: function () {
    MNAgentHTTP.post(
      "/api/marginnote/connect",
      {
        clientId: MN_AGENT_CLIENT_ID,
        metadata: { version: MN_AGENT_ADDON_VERSION, platform: "macOS", app: "MarginNote" },
      },
      function () {},
    );
  },

  poll: function () {
    if (this.busy || !this.addon) return;
    this.busy = true;
    var bridge = this;
    var path =
      "/api/marginnote/next?clientId=" +
      encodeURIComponent(MN_AGENT_CLIENT_ID) +
      "&version=" +
      encodeURIComponent(MN_AGENT_ADDON_VERSION);
    var generation = this.generation;
    MNAgentHTTP.get(path, function (error, payload) {
      if (generation !== bridge.generation) return;
      if (error) {
        bridge.recordStage("poll-error", error.message || error);
        bridge.busy = false;
        return;
      }
      var request = payload && payload.request;
      if (!request) {
        bridge.busy = false;
        return;
      }

      bridge.recordStage("executing", request.tool);
      try {
        if (bridge.sceneCount > 1) {
          var ambiguous = new Error("Multiple study windows are connected");
          ambiguous.code = "AMBIGUOUS_CONTEXT";
          throw ambiguous;
        }
        if (["get_context", "search_notes", "get_note", "get_current_pdf", "list_notebooks", "get_library_page", "create_card", "append_comment", "create_framework", "promote_excerpt_to_title", "preview_reorganization", "apply_reorganization"].indexOf(request.tool) < 0) {
          var unsupported = new Error("Tool is not enabled in this bridge");
          unsupported.code = "INVALID_ARGUMENT";
          throw unsupported;
        }
        var result = MNAgentTools.execute(bridge.addon, request.tool, request.arguments || {});
        if (request.tool === "get_context") result.windowId = bridge.addon.mnBridgeWindowId || null;
        bridge.recordStage("executed", request.tool);
        bridge.postResult(request.requestId, true, result, null);
      } catch (toolError) {
        bridge.recordStage("tool-error", toolError.code || "RPC_FAILURE");
        bridge.postResult(request.requestId, false, null, String(toolError.message || toolError), toolError.code);
      }
    });
  },

  postResult: function (requestId, success, result, error, errorCode) {
    var bridge = this;
    var generation = this.generation;
    bridge.recordStage("posting-result", success ? "success" : "failure");
    try {
      MNAgentHTTP.post(
        "/api/marginnote/result",
        { requestId: requestId, success: success, result: result, error: error, errorCode: errorCode || null },
        function (postError) {
          if (generation !== bridge.generation) return;
          bridge.busy = false;
          if (postError) {
            var defaults = NSUserDefaults.standardUserDefaults();
            defaults.setObjectForKey(
              String(postError.message || postError),
              "marginnote_agent_last_bridge_error",
            );
            defaults.synchronize();
            bridge.recordStage("post-error", postError.message || postError);
          } else {
            bridge.recordStage("result-posted", requestId);
          }
        },
      );
    } catch (postError) {
      bridge.busy = false;
      var defaults = NSUserDefaults.standardUserDefaults();
      defaults.setObjectForKey(
        String(postError.message || postError),
        "marginnote_agent_last_bridge_error",
      );
      defaults.synchronize();
      bridge.recordStage("post-threw", postError.message || postError);
    }
  },
};
