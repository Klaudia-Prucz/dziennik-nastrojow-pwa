import { initRouter, registerRoute, navigate } from "./router.js";
import { bindOfflineBanner } from "./offline.js";
import { supabase } from "./supabaseClient.js";

import {
  viewIndex,
  viewLogowanie,
  viewRejestracja,
  viewOffline,
  view404,

  // private
  viewHome,
  viewNewEntry,
  viewHistory,
  viewAdvice,
} from "./views.js";

const root = document.getElementById("app");
if (!root) throw new Error("Brak elementu #app w index.html");

let isLoggedIn = null;

function renderLoading() {
  root.innerHTML = `
    <section class="card" style="display:flex;align-items:center;gap:12px;">
      <div class="spinner"></div>
      <div>Ładowanie…</div>
    </section>
  `;
}

async function checkSession() {
  const { data } = await supabase.auth.getSession();
  isLoggedIn = !!data?.session?.user;
}

function isPrivate(path) {
  return path.startsWith("/(tabs)/");
}

async function guard(path) {
  if (isLoggedIn === null) {
    renderLoading();
    return false;
  }
  if (isPrivate(path) && !isLoggedIn) {
    navigate("/logowanie");
    return false;
  }
  if (!isPrivate(path) && isLoggedIn && (path === "/" || path === "/logowanie" || path === "/rejestracja")) {
    navigate("/(tabs)/home");
    return false;
  }
  return true;
}

function mountRoutes() {
  // public
  registerRoute("/", async () => (await guard("/")) && viewIndex());
  registerRoute("/logowanie", async () => (await guard("/logowanie")) && viewLogowanie());
  registerRoute("/rejestracja", async () => (await guard("/rejestracja")) && viewRejestracja());
  registerRoute("/offline", async () => (await guard("/offline")) && viewOffline());
  registerRoute("/404", view404);

  // private
  registerRoute("/(tabs)/home", async () => (await guard("/(tabs)/home")) && viewHome());
  registerRoute("/(tabs)/new", async () => (await guard("/(tabs)/new")) && viewNewEntry());
  registerRoute("/(tabs)/history", async () => (await guard("/(tabs)/history")) && viewHistory());
  registerRoute("/(tabs)/advice", async () => (await guard("/(tabs)/advice")) && viewAdvice());
}

async function main() {
  bindOfflineBanner();
  renderLoading();

  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    isLoggedIn = !!session?.user;
    if (isLoggedIn) navigate("/(tabs)/home");
    else navigate("/logowanie");
    setHeaderForAuth(isLoggedIn); // aktualizacja nagłówka po zmianie auth
  });

  await checkSession();
  mountRoutes();
  await initRouter();

  const path = (location.hash || "#/").slice(1);
  if (isLoggedIn && (path === "/" || path === "/logowanie" || path === "/rejestracja")) {
    navigate("/(tabs)/home");
  }

  window.addEventListener("beforeunload", () => listener?.subscription?.unsubscribe?.());

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    setHeaderForAuth(false);
    navigate("/");
  });
}

function setHeaderForAuth(isLoggedIn) {
  const guestNav = document.querySelector(".guest-nav");
  const logoutBtn = document.getElementById("logoutBtn");

  if (!guestNav || !logoutBtn) return;

  if (isLoggedIn) {
    guestNav.style.display = "none";
    logoutBtn.hidden = false;
  } else {
    guestNav.style.display = "flex";
    logoutBtn.hidden = true;
  }
}

main().catch((e) => {
  console.error(e);
  root.innerHTML = `<section class="card"><h2>Błąd</h2><pre class="pre">${String(e?.stack || e)}</pre></section>`;
});
