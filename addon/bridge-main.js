// Packaged as main.js. The legacy chat entry point is not loaded.
JSB.newAddon = function () {
  JSB.require('config');
  JSB.require('network');
  JSB.require('tools');
  JSB.require('bridge');
  var scenes = [];
  var sequence = 0;
  function selectScene() {
    MNAgentBridge.stop();
    if (!scenes.length) return;
    MNAgentBridge.start(scenes[0]);
    MNAgentBridge.sceneCount = scenes.length;
  }
  return JSB.defineClass('MarginNoteAgentAddon : JSExtension', {
    sceneWillConnect: function () {
      if (scenes.indexOf(self) < 0) {
        self.mnBridgeWindowId = 'window-' + (++sequence);
        scenes.push(self);
      }
      selectScene();
    },
    sceneDidDisconnect: function () {
      var index = scenes.indexOf(self);
      if (index >= 0) scenes.splice(index, 1);
      selectScene();
    },
    queryAddonCommandStatus: function () { return null; }
  }, {});
};
