// public/js/router.js
const routes = new Map();

export function registerRoute(path, renderFn) {
  // path musi być w formacie "/coś"
  routes.set(path, renderFn);
}

export function navigate(path) {
  if (!path.startsWith("/")) path = "/" + path;
  location.hash = "#" + path;
}

function getPathFromHash() {
  // akceptuje: "#/login", "#login", "" -> "/"
  const raw = location.hash || "#/";
  let p = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!p.startsWith("/")) p = "/" + p;
  return p;
}

export async function initRouter() {
  async function handle() {
    const path = getPathFromHash();
    const view = routes.get(path) || routes.get("/404");

    console.log("[router] path =", path, "has view:", !!view);

    if (!view) return;
    await view();
  }

  window.addEventListener("hashchange", handle);

  // kluczowe: render na starcie
  await handle();
}
