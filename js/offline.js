export function bindOfflineBanner() {
  const banner = document.getElementById("offlineBanner");
  if (!banner) return;

  const update = () => {
    banner.hidden = navigator.onLine;
  };

  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

export function cacheSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function cacheGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
