import { clampCount } from "./utils.js";
import * as tabs from "./tabs.js";
import { toggleBookmark } from "./bookmarks.js";
import { suggest, search } from "./suggest.js";

export { clampCount };

export const handlers = {
  createTab: tabs.createTab,
  openIncognitoTab: tabs.openIncognitoTab,
  navigate: tabs.navigate,
  closeTab: tabs.closeTab,
  restoreTab: tabs.restoreTab,
  previousTab: tabs.previousTab,
  nextTab: tabs.nextTab,
  moveTabToWindow: tabs.moveTabToWindow,
  moveTabIntoWindow: tabs.moveTabIntoWindow,
  moveTabLeft: tabs.moveTabLeft,
  goToFirstTab: tabs.goToFirstTab,
  goToLastTab: tabs.goToLastTab,
  moveTabRight: tabs.moveTabRight,
  duplicateTab: tabs.duplicateTab,
  togglePin: tabs.togglePin,
  toggleMute: tabs.toggleMute,
  reloadTab: tabs.reloadTab,
  goBack: tabs.goBack,
  goForward: tabs.goForward,
  listTabs: tabs.listTabs,
  suggest,
  search,
  activateTab: tabs.activateTab,
  zoomBy: tabs.zoomBy,
  openInBackgroundTab: tabs.openInBackgroundTab,
  openInForegroundTab: tabs.openInForegroundTab,
  captureScreenshot: tabs.captureScreenshot,
  toggleBookmark,
  openSettings: tabs.openSettings,
  openExtensions: tabs.openExtensions,
};
