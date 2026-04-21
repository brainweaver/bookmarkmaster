// Chrome MV3 service worker — handles toolbar click and context menu

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-bookmark",
    title: "Save to BookmarkMaster",
    contexts: ["page", "link"],
  });
});

// Open the full manager page, passing the current tab's info as URL params.
// Skip prefill for internal browser pages and the extension itself.
function isSaveable(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

chrome.action.onClicked.addListener((tab) => {
  const url = new URL(chrome.runtime.getURL("index.html"));
  if (isSaveable(tab.url)) {
    url.searchParams.set("from", tab.url!);
    if (tab.title) url.searchParams.set("title", tab.title);
    if (tab.favIconUrl) url.searchParams.set("favicon", tab.favIconUrl);
  }
  chrome.tabs.create({ url: url.toString() });
});

// Right-click "Save to BookmarkMaster" on a page or link
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const targetUrl = info.linkUrl ?? info.pageUrl ?? "";
  const url = new URL(chrome.runtime.getURL("index.html"));
  url.searchParams.set("from", targetUrl);
  if (!info.linkUrl && tab?.title) url.searchParams.set("title", tab.title);
  if (!info.linkUrl && tab?.favIconUrl) url.searchParams.set("favicon", tab.favIconUrl);
  chrome.tabs.create({ url: url.toString() });
});
