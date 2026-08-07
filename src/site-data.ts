declare global {
  interface Window {
    clearSiteData(): Promise<void>;
  }
}

function clearCookies(): void {
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=", 1)[0]?.trim();
    if (!name) continue;
    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
  }
}

async function clearCaches(): Promise<void> {
  if (!("caches" in globalThis)) return;
  const names = await globalThis.caches.keys();
  await Promise.all(names.map((name) => globalThis.caches.delete(name)));
}

async function clearIndexedDatabases(): Promise<void> {
  if (!("indexedDB" in globalThis) || !globalThis.indexedDB.databases) return;
  const databases = await globalThis.indexedDB.databases();
  await Promise.all(databases.map(({ name }) => new Promise<void>((resolve, reject) => {
    if (!name) return resolve();
    const request = globalThis.indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  })));
}

export async function clearSiteData(): Promise<void> {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  clearCookies();
  await Promise.all([clearCaches(), clearIndexedDatabases()]);
  globalThis.location.reload();
}

globalThis.window.clearSiteData = clearSiteData;
