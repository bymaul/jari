export const COMMAND_CATALOG = {

  scrollDown: { category: "scrolling", label: "Scroll down", repeatable: true },
  scrollUp: { category: "scrolling", label: "Scroll up", repeatable: true },
  scrollLeft: { category: "scrolling", label: "Scroll left", repeatable: true },
  scrollRight: { category: "scrolling", label: "Scroll right", repeatable: true },
  scrollTop: { category: "scrolling", label: "Scroll to top" },
  scrollBottom: { category: "scrolling", label: "Scroll to bottom" },
  scrollPageDown: { category: "scrolling", label: "Scroll page down", repeatable: true },
  scrollPageUp: { category: "scrolling", label: "Scroll page up", repeatable: true },
  scrollHalfPageDown: { category: "scrolling", label: "Scroll half page down", repeatable: true },
  scrollHalfPageUp: { category: "scrolling", label: "Scroll half page up", repeatable: true },
  cycleScrollArea: { category: "scrolling", label: "Cycle nested scroll areas" },
  resetScrollArea: { category: "scrolling", label: "Reset to page scroll" },
  showScrollArea: { category: "scrolling", label: "Show scroll area" },

  zoomIn: { category: "view", label: "Zoom in" },
  zoomOut: { category: "view", label: "Zoom out" },

  newTab: { category: "tabs", label: "New tab" },
  closeTab: { category: "tabs", label: "Close tab", repeatable: true },
  restoreTab: { category: "tabs", label: "Reopen closed tab", repeatable: true },
  pasteOpen: { category: "tabs", label: "Open clipboard URL in current tab" },
  pasteOpenBackground: { category: "tabs", label: "Open clipboard URL in background tab" },
  previousTab: { category: "tabs", label: "Previous tab", repeatable: true },
  nextTab: { category: "tabs", label: "Next tab", repeatable: true },
  firstTab: { category: "tabs", label: "Jump to first tab" },
  lastTab: { category: "tabs", label: "Jump to last tab" },
  tabSearch: { category: "tabs", label: "Tab search" },
  omnibar: { category: "tabs", label: "Open URL or search" },

  splitTab: { category: "tabActions", label: "Move tab to new window" },
  splitOrMergeTab: { category: "tabActions", label: "Split tab / merge window" },
  moveTabLeft: { category: "tabActions", label: "Move tab left" },
  moveTabRight: { category: "tabActions", label: "Move tab right" },
  duplicateTab: { category: "tabActions", label: "Duplicate tab" },
  togglePin: { category: "tabActions", label: "Pin/unpin tab" },
  toggleMute: { category: "tabActions", label: "Mute/unmute tab" },

  historyBack: { category: "history", label: "Go back in history" },
  historyForward: { category: "history", label: "Go forward in history" },

  reloadTab: { category: "page", label: "Reload" },
  hardReload: { category: "page", label: "Reload (bypass cache)" },
  goUp: { category: "page", label: "Go to parent path" },
  goToRoot: { category: "page", label: "Go to site root" },
  editUrl: { category: "page", label: "Edit current URL" },

  copyUrl: { category: "clipboard", label: "Copy URL" },
  copyTitleUrl: { category: "clipboard", label: "Copy title + URL" },

  toggleIgnore: { category: "modes", label: "Ignore mode" },
  passthrough: { category: "modes", label: "Passthrough keys (timed)" },
  toggleDisabled: { category: "modes", label: "Enable/disable on this site" },

  showHelp: { category: "help", label: "Show keybindings" },
  openOptions: { category: "help", label: "Open settings" },
};
