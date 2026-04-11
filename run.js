application.start("gpu");

const mainWindow = new Window({
  url: __DIR__ + "index.htm",
  type: Window.TOOL_WINDOW,
  state: Window.WINDOW_SHOWN,
  alignment: 5,
});

mainWindow.on("close", () => application.quit(0));

application.run();
