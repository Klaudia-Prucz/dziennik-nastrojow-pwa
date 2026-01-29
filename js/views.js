export {
  viewIndex,
  viewLogowanie,
  viewRejestracja,
  viewOffline,
  view404,
  viewHome,
  viewNewEntry,
  viewHistory,
  viewAdvice
};
// --- Interpretation for advice ---
function interpret(entries, scoreAvg) {
  if (!entries?.length || typeof scoreAvg !== "number") {
    return {
      level: "Brak danych",
      msg: "Brak wystarczających danych do analizy."
    };
  }

  const avgStress =
    entries.reduce((s, e) => s + (e.stres ?? e.stress ?? 0), 0) / entries.length;

  const avgEnergy =
    entries.reduce((s, e) => s + (e.energia ?? e.energy ?? 0), 0) / entries.length;

  const avgMood =
    entries.reduce((s, e) => s + (e.nastroj ?? e.mood ?? 0), 0) / entries.length;

  if (avgStress >= 7) {
    return {
      level: "Przeciążenie",
      msg: "Stres jest wysoki i to on najbardziej obniża Twój dobrostan. Priorytet: obniżenie napięcia."
    };
  }

  if (avgEnergy <= 4) {
    return {
      level: "Niskie zasoby",
      msg: "Problemem nie jest motywacja, tylko brak energii. Skup się na odpoczynku."
    };
  }

  if (scoreAvg < 4) {
    return {
      level: "Trudniejszy czas",
      msg: "Ostatnio masz trudniejszy czas. Pamiętaj, że możesz poprosić o wsparcie."
    };
  }

  if (scoreAvg >= 7.5 && avgStress < 5) {
    return {
      level: "Super",
      msg: "Masz stabilny, dobry okres. Warto tylko pilnować regeneracji."
    };
  }

  return {
    level: "Średnio",
    msg: "Jest w miarę OK, ale widać obszar do drobnych korekt."
  };
}

// --- Aggregation for last 7 days ---
function score7Days(entries) {
  const last = entries.slice(0, 7); // pobieramy najnowsze 7, bo sort DESC
  if (!last.length) return null;
  // Only use entries with all 3 valid numbers
  const valid = last.filter(e => {
    const mood = e.nastroj ?? e.mood;
    const energy = e.energia ?? e.energy;
    const stress = e.stres ?? e.stress;
    return [mood, energy, stress].every(v => typeof v === 'number' && Number.isFinite(v));
  });
  if (!valid.length) return null;
  const daily = valid.map(e =>
    wellbeingScore({
      mood: e.nastroj ?? e.mood,
      energy: e.energia ?? e.energy,
      stress: e.stres ?? e.stress,
    })
  );
  if (!daily.length) return null;
  const avg = daily.reduce((a, b) => a + b, 0) / daily.length;
  return {
    avg,
    min: Math.min(...daily),
    max: Math.max(...daily),
    days: daily.length,
    daily,
  };
}

function normPos(v, min = 1, max = 10) {
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}

function normNeg(v, min = 1, max = 10) {
  return 1 - normPos(v, min, max);
}

function wellbeingScore({ mood, energy, stress }) {
  const m = normPos(mood);
  const e = normPos(energy);
  const s = normNeg(stress); // odwrócony stres


  let score = (0.35 * m) + (0.35 * e) + (0.30 * s);


  if (stress >= 8) score -= 0.15;
  if (stress >= 9) score -= 0.25;


  if (energy <= 3) score -= 0.1;

  return Math.max(0, Math.min(1, score)); // clamp 0..1
}
// views.js
import { supabase } from "./supabaseClient.js";
import { navigate } from "./router.js";
import { cacheGet, cacheSet } from "./offline.js";


// --- Helper: data dzisiaj w formacie YYYY-MM-DD (lokalna) ---
function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function escapeHtml(str) {
  if (typeof str !== "string") str = String(str ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- Helper: wymagaj autoryzacji, zwraca user lub przekierowuje do logowania ---
async function requireAuth() {
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) return data.session.user;
  navigate("/logowanie");
  return null;
}

const root = document.getElementById("app");

const VAPID_PUBLIC_KEY = "BP0kz7vkwdiIQ_uygSK2SIcA_nEoDoXFuwKlnXrszPyHLYQRjfCHZVQdbIiGxUhDwaxlvY8yc1ss3miaUzMeDUc";

// --- Web Push: enable --- nie działa
async function enableWebPush() {
  if (!("Notification" in window)) throw new Error("Brak Notification API.");
  if (!("serviceWorker" in navigator)) throw new Error("Brak Service Worker.");

  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Brak zgody na powiadomienia.");

  const reg = await navigator.serviceWorker.ready;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (!endpoint || !p256dh || !auth) throw new Error("Niepełna subskrypcja push.");

  const ua = navigator.userAgent;

  // UPSERT po endpoint (żeby nie dublować)
  const { data: u } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (!userId) throw new Error("Brak usera.");

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: userId,
        endpoint,
        p256dh,
        auth,
        user_agent: ua,
        last_seen_at: new Date().toISOString(),
        is_active: true,
      },
      { onConflict: "endpoint" }
    );
  
  if (error) throw error;

  return true;
}

// --- Web Push: disable ---
async function disableWebPush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;

  const endpoint = sub.endpoint;
  await sub.unsubscribe();

  // oznacz w DB jako nieaktywne
  const { error } = await supabase
    .from("push_subscriptions")
    .update({ is_active: false, last_seen_at: new Date().toISOString() })
    .eq("endpoint", endpoint);

  if (error) console.warn("DB disable push error:", error.message);
  return true;
}


// --- Helper do konwersji VAPID public key (Base64URL → Uint8Array) ---
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

// Cache klucz per-user (żeby nie mieszać wpisów między kontami)
async function cacheKeyEntries() {
  const { data: u } = await supabase.auth.getUser();
  const userId = u?.user?.id || "anon";
  return `wpisy_cache_${userId}`;
}

/* =========================
   Shell
========================= */
async function renderShell({ title, active, contentHtml }) {
  const { data } = await supabase.auth.getSession();
  const email = data?.session?.user?.email || cacheGet("lastUserEmail", "");

  root.innerHTML = `
    <section class="shell">
      <header class="app-header">
        <div>
          <div class="app-title">${escapeHtml(title)}</div>
          <div class="app-sub">${email ? "Zalogowano: " + escapeHtml(email) : ""}</div>
        </div>
        <button class="btn small" id="logout">Wyloguj</button>
      </header>

      <nav class="tabs">
        <a href="#/(tabs)/home" class="tab ${active === "home" ? "active" : ""}">Start</a>
        <a href="#/(tabs)/new" class="tab ${active === "new" ? "active" : ""}">Nowy wpis</a>
        <a href="#/(tabs)/history" class="tab ${active === "history" ? "active" : ""}">Historia</a>
        <a href="#/(tabs)/advice" class="tab ${active === "advice" ? "active" : ""}">Rada</a>
      </nav>

      <main class="shell-content">
        ${contentHtml}
      </main>
    </section>
  `;

  root.querySelector("#logout")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    navigate("/logowanie");
  });
}



async function fetchEntries(limit = 50) {
  const key = await cacheKeyEntries();

  // offline fallback
  if (!navigator.onLine) return cacheGet(key, []);

  const { data: u, error: ue } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (ue || !userId) throw new Error("Brak użytkownika w sesji. Zaloguj się ponownie.");

  const { data, error } = await supabase
    .from("wpisy")
    .select("id, user_id, data_wpisu, nastroj, energia, stres, opis, created_at, photo_path")
    .eq("user_id", userId)
    .order("data_wpisu", { ascending: false })
    .limit(limit);

  if (error) throw error;

  cacheSet(key, data ?? []);
  return data ?? [];
}

async function insertEntry({ data_wpisu, nastroj, energia, stres, opis, photo_path }) {
  if (!navigator.onLine) throw new Error("Brak internetu – zapis do bazy niedostępny.");

  const { data: u, error: ue } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (ue || !userId) throw new Error("Brak użytkownika w sesji. Zaloguj się ponownie.");

  const payload = {
    user_id: userId,
    data_wpisu,
    nastroj,
    energia,
    stres,
    opis: opis ? opis : null,
    photo_path: photo_path ? photo_path : null,
  };

  const { error } = await supabase.from("wpisy").insert(payload);
  if (error) throw error;
}

async function updateEntry(id, { data_wpisu, nastroj, energia, stres, opis, photo_path }) {
  if (!navigator.onLine) throw new Error("Brak internetu – edycja niedostępna offline.");

  const { data: u, error: ue } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (ue || !userId) throw new Error("Brak użytkownika w sesji. Zaloguj się ponownie.");

  const payload = {
    data_wpisu,
    nastroj,
    energia,
    stres,
    opis: opis ? opis : null,
    photo_path: photo_path ? photo_path : null,
  };

  const { error } = await supabase
    .from("wpisy")
    .update(payload)
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw error;
}

async function deleteEntry(id) {
  if (!navigator.onLine) throw new Error("Brak internetu – usuwanie niedostępne offline.");

  const { data: u, error: ue } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (ue || !userId) throw new Error("Brak użytkownika w sesji.");

  // pobierz photo_path (może nie istnieć jeśli brak zdjęcia)
  const { data: row, error: selErr } = await supabase
    .from("wpisy")
    .select("photo_path")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (selErr) throw selErr;

  const { error: delErr } = await supabase
    .from("wpisy")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (delErr) throw delErr;

  // usuń plik (opcjonalnie)
  if (row?.photo_path) {
    const { error: stErr } = await supabase.storage
      .from("wpisy-photos")
      .remove([row.photo_path]);

    if (stErr) console.warn("Storage remove error:", stErr.message);
  }
}

// URL zdjęcia (public bucket)
function getPhotoUrl(photo_path) {
  if (!photo_path) return null;
  const { data } = supabase.storage.from("wpisy-photos").getPublicUrl(photo_path);
  return data?.publicUrl || null;
}

// URL avatara (public bucket)
function getAvatarUrl(avatar_path) {
  if (!avatar_path) return null;
  const { data } = supabase.storage.from("avatars").getPublicUrl(avatar_path);
  return data?.publicUrl || null;
}

// Profil użytkownika
async function fetchMyProfile() {
  const { data: u } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email, avatar_path")
    .eq("id", userId)
    .single();

  if (error) throw error;
  return data;
}

// Upload avatara + zapis do profiles (na razie nie używane na Home)
async function uploadAvatar(file) {
  if (!navigator.onLine) throw new Error("Brak internetu – upload avatara niedostępny offline.");

  const { data: u, error: ue } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (ue || !userId) throw new Error("Brak użytkownika w sesji.");

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const path = `${userId}/${fileName}`;

  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });

  if (upErr) throw new Error("Upload avatara: " + upErr.message);

  const { error: dbErr } = await supabase
    .from("profiles")
    .update({ avatar_path: path })
    .eq("id", userId);

  if (dbErr) throw new Error("Zapis profilu: " + dbErr.message);

  return path;
}


function appLogoImg() {
  return `<img src="/assets/icon-192.png" alt="Logo" style="width:140px;height:140px;display:block;margin:32px auto 16px auto;box-shadow:0 2px 16px #0002;border-radius:32px;" />`;
}

/* =========================
  Views
========================= */
async function viewIndex() {
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    navigate("/(tabs)/home");
    return;
  }

  root.innerHTML = `
    <section class="card" style="max-width:400px;margin:40px auto 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;min-height:calc(100dvh - 80px);box-shadow:none;background:none;">
      ${appLogoImg()}
      <div style="font-size:1.2rem;font-weight:600;margin-bottom:24px;">Dziennik nastrojów</div>
      <div class="row" style="flex-direction:column;align-items:stretch;width:100%;">
        <button class="btn primary" id="goLogin">Zaloguj się</button>
        <button class="btn" id="goRegister">Zarejestruj się</button>
      </div>
    </section>
  `;

  root.querySelector("#goLogin").addEventListener("click", () => navigate("/logowanie"));
  root.querySelector("#goRegister").addEventListener("click", () => navigate("/rejestracja"));
}

async function viewLogowanie() {
  root.innerHTML = `
    <section class="card" style="max-width:400px;margin:40px auto 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;min-height:calc(100dvh - 80px);box-shadow:none;background:none;">
      ${appLogoImg()}
      <div style="font-size:1.2rem;font-weight:600;margin-bottom:24px;">Logowanie</div>
      <form id="loginForm" class="form" style="width:100%;max-width:320px;">
        <label>Email <input name="email" type="email" autocomplete="email" required /></label>
        <label>Hasło <input name="password" type="password" autocomplete="current-password" required /></label>
        <div id="err" class="error" hidden></div>
        <button class="btn primary" type="submit">Zaloguj się</button>
        <button class="btn link" type="button" id="toRegister">lub zarejestruj się</button>
      </form>
    </section>
  `;

  root.querySelector("#toRegister").addEventListener("click", () => navigate("/rejestracja"));

  root.querySelector("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = root.querySelector("#err");
    errEl.hidden = true;

    if (!navigator.onLine) {
      errEl.textContent = "Brak internetu – logowanie niedostępne offline.";
      errEl.hidden = false;
      return;
    }

    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      errEl.textContent = "Logowanie nie powiodło się: " + error.message;
      errEl.hidden = false;
      return;
    }

    cacheSet("lastUserEmail", email);
    navigate("/(tabs)/home");
  });
}

async function viewRejestracja() {
  root.innerHTML = `
    <section class="card" style="max-width:400px;margin:40px auto 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;min-height:calc(100dvh - 80px);box-shadow:none;background:none;">
      ${appLogoImg()}
      <div style="font-size:1.2rem;font-weight:600;margin-bottom:24px;">Rejestracja</div>
      <form id="regForm" class="form" style="width:100%;max-width:320px;">
        <label>Imię
          <input name="first_name" type="text" required />
        </label>
        <label>Nazwisko
          <input name="last_name" type="text" required />
        </label>
        <label>Email <input name="email" type="email" autocomplete="email" required /></label>
        <label>Hasło <input name="password" type="password" minlength="6" autocomplete="new-password" required /></label>
        <div id="err" class="error" hidden></div>
        <button class="btn primary" type="submit">Zarejestruj się</button>
        <button class="btn link" type="button" id="toLogin">lub zaloguj się</button>
      </form>
    </section>
  `;

  root.querySelector("#toLogin").addEventListener("click", () => navigate("/logowanie"));

  root.querySelector("#regForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = root.querySelector("#err");
    errEl.hidden = true;

    if (!navigator.onLine) {
      errEl.textContent = "Brak internetu – rejestracja niedostępna offline.";
      errEl.hidden = false;
      return;
    }

    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");
    const first_name = String(fd.get("first_name") || "").trim();
    const last_name = String(fd.get("last_name") || "").trim();

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name, last_name },
      },
    });

    if (error) {
      errEl.textContent = "Rejestracja nie powiodła się: " + error.message;
      errEl.hidden = false;
      return;
    }

    navigate("/logowanie");
  });
}

/** Start: podsumowanie + ostatnie wpisy */
async function viewHome() {
  const user = await requireAuth();
  if (!user) return;

  let profile = null;
  try {
    profile = await fetchMyProfile();
  } catch {
    // ignoruj, pokaż fallbacki
  }

  const metaFirst = user?.user_metadata?.first_name;
  const firstName =
    profile?.first_name?.trim()
      ? profile.first_name.trim()
      : metaFirst?.trim()
        ? String(metaFirst).trim()
        : "użytkowniku";

  const avatarUrl = getAvatarUrl(profile?.avatar_path);

  const helloCard = `
    <div class="card profile-card profile-welcome">
      <div class="profile-row" style="display:flex;gap:14px;align-items:center;">
        <div class="avatar" style="width:64px;height:64px;border-radius:18px;overflow:hidden;flex:0 0 auto;">
          ${
            avatarUrl
              ? `<img src="${escapeHtml(avatarUrl)}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;" />`
              : `<div class="avatar-fallback" style="width:100%;height:100%;display:grid;place-items:center;background:#f2f4f7;">🙂</div>`
          }
        </div>

        <div style="flex:1;min-width:0;">
          <div class="hello" style="font-size:16px;">
            Witaj, <strong>${escapeHtml(firstName)}</strong>!
          </div>

          <!-- Pogoda w tej samej ramce -->
          <div class="row" style="justify-content:space-between;align-items:center;margin-top:6px;gap:10px;">
            <div class="muted" id="weatherOut" style="display:flex;align-items:center;gap:8px;min-width:0;">
              <span id="weatherIcon" aria-hidden="true">⛅</span>
              <span id="weatherText" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Ładowanie…</span>
            </div>
            <button class="btn small" id="weatherRefresh" type="button">Odśwież</button>
          </div>

          <div class="muted" style="font-size:12px;margin-top:6px;">

          </div>

          <div class="row" style="margin-top:10px;gap:10px;">
            <button class="btn small" id="enablePush" type="button">Włącz powiadomienia</button>
            <button class="btn small" id="disablePush" type="button">Wyłącz powiadomienia</button>
          </div>
        </div>
      </div>
    </div>
  `;



  let entries = [];
  let loadError = "";
  try {
    entries = await fetchEntries(30); // żeby mieć dużą szansę złapać "dziś"
  } catch (e) {
    loadError = e?.message || String(e);
    entries = [];
  }


  const hasEntries = entries.length > 0;

  // --- Karta DZIŚ ---
  const today = todayISO();
  const todayEntry = entries.find((e) => String(e.data_wpisu) === String(today));

  const todayCard = (() => {
    if (!todayEntry) {
      return `
        <section class="card soft today-card">
          <div class="today-head">
            <div class="today-badge"><span class="today-dot"></span> DZIŚ</div>
            <div class="muted" style="font-size:12px;">${escapeHtml(today)}</div>
          </div>

          <p class="muted" style="margin-top:10px;">
            Nie dodałaś jeszcze dziś wpisu.
          </p>

          <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px;">
            <button class="btn primary" id="goNewToday">Dodaj wpis</button>
          </div>
        </section>
      `;
    }

    const photoUrl = getPhotoUrl(todayEntry.photo_path);

    return `
      <section class="card soft today-card">
        <div class="today-head">
          <div class="today-badge"><span class="today-dot"></span> DZIŚ</div>
          <div class="muted" style="font-size:12px;">${escapeHtml(todayEntry.data_wpisu)}</div>
        </div>

        ${photoUrl ? `
          <div class="entry-media" style="margin-top:10px;">
            <img class="entry-photo"
                 src="${escapeHtml(photoUrl)}"
                 alt="Zdjęcie wpisu"
                 loading="lazy">
          </div>
        ` : ""}

        <div class="entry-metrics" style="margin-top:10px;">
          <span class="pill">Nastrój: <strong>${escapeHtml(todayEntry.nastroj ?? "—")}</strong></span>
          <span class="pill">Energia: <strong>${escapeHtml(todayEntry.energia ?? "—")}</strong></span>
          <span class="pill">Stres: <strong>${escapeHtml(todayEntry.stres ?? "—")}</strong></span>
        </div>

        ${todayEntry.opis ? `<div class="entry-desc" style="margin-top:10px;">${escapeHtml(todayEntry.opis)}</div>` : ""}

        <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:12px;">
          <button class="btn" id="goHistoryToday">Zobacz w historii</button>
          <button class="btn primary" id="goNewToday">Dodaj kolejny wpis</button>
        </div>
      </section>
    `;
  })();

  // --- Ostatnie wpisy (max 7) ---
  const lastEntriesHtml = `
    <section class="card soft">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <h2 style="margin:0;">Ostatnie wpisy</h2>
      </div>

      ${loadError ? `<p class="error">Błąd pobierania wpisów: ${escapeHtml(loadError)}</p>` : ""}

      ${
        !hasEntries
          ? `
            <p class="muted">Nie masz jeszcze wpisów.</p>
            <button class="btn primary" id="goNewEmpty">Dodaj pierwszy wpis</button>
          `
          : `
            <div class="entries" id="homeEntries">
              ${entries.slice(0, 7)
                .map((w) => {
                  const photoUrl = getPhotoUrl(w.photo_path);
                  return `
                    <article class="entry entry--feed" data-id="${escapeHtml(w.id)}">
                      <div class="entry-head">
                        <div class="entry-date">${escapeHtml(w.data_wpisu)}</div>
                        <button class="icon-btn" type="button" data-action="delete" aria-label="Usuń wpis" title="Usuń wpis">🗑️</button>
                      </div>

                      ${photoUrl ? `
                        <div class="entry-media">
                          <img class="entry-photo"
                               src="${escapeHtml(photoUrl)}"
                               alt="Zdjęcie wpisu"
                               loading="lazy">
                        </div>
                      ` : ""}

                      <div class="entry-metrics">
                        <span class="pill">Nastrój: <strong>${escapeHtml(w.nastroj)}</strong></span>
                        <span class="pill">Energia: <strong>${escapeHtml(w.energia ?? "—")}</strong></span>
                        <span class="pill">Stres: <strong>${escapeHtml(w.stres ?? "—")}</strong></span>
                      </div>

                      ${w.opis ? `<div class="entry-desc">${escapeHtml(w.opis)}</div>` : ""}
                    </article>
                  `;
                })
                .join("")}
            </div>
          `
      }
    </section>
  `;

  const summaryHtml = helloCard + todayCard + lastEntriesHtml;


  await renderShell({
    title: "Start",
    active: "home",
    contentHtml: summaryHtml,
  });

  // --- eventy Home (po renderShell!) ---
  root.querySelector("#goNewToday")?.addEventListener("click", () => navigate("/(tabs)/new"));
  root.querySelector("#goHistoryToday")?.addEventListener("click", () => navigate("/(tabs)/history"));

  // Web Push eventy
  root.querySelector("#enablePush")?.addEventListener("click", async () => {
    try { await enableWebPush(); alert("Powiadomienia włączone ✅"); }
    catch (e) { alert(e?.message || String(e)); }
  });
  root.querySelector("#disablePush")?.addEventListener("click", async () => {
    try { await disableWebPush(); alert("Powiadomienia wyłączone."); }
    catch (e) { alert(e?.message || String(e)); }
  });

  // --- eventy Home (po renderShell!) ---
  root.querySelector("#goNewTop")?.addEventListener("click", () => navigate("/(tabs)/new"));
  root.querySelector("#goNewEmpty")?.addEventListener("click", () => navigate("/(tabs)/new"));

  // kosz: delegacja na root, ale tylko dla widoku Home
  // (podpinamy raz na render widoku)
  const homeEntries = root.querySelector("#homeEntries");
  if (homeEntries) {
    homeEntries.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action='delete']");
      if (!btn) return;

      const article = btn.closest("article[data-id]");
      const id = article?.getAttribute("data-id");
      if (!id) return;

      const ok = confirm("Usunąć ten wpis? Tej operacji nie da się cofnąć.");
      if (!ok) return;

      try {
        await deleteEntry(id);
        article.remove();
      } catch (err) {
        alert(err?.message || String(err));
      }
    });
  }

  async function paintWeather() {
    const out = root.querySelector("#weatherOut");
    const iconEl = root.querySelector("#weatherIcon");
    const textEl = root.querySelector("#weatherText");
    if (!out || !iconEl || !textEl) return;

    textEl.textContent = "Ładowanie…";
    iconEl.textContent = "⛅";

    const result = await getWeatherText();
    textEl.textContent = result.text + (result.fromCache ? " (cache)" : "");
    iconEl.textContent = result.icon || "🌡️";
  }

  root.querySelector("#weatherRefresh")?.addEventListener("click", () => {
    cacheSet("weather_cache", null);
    paintWeather();
  });

  paintWeather();
}

/** Nowy wpis: formularz */
async function viewNewEntry() {
  const user = await requireAuth();
  if (!user) return;

  await renderShell({
    title: "Nowy wpis",
    active: "new",
    contentHtml: `
      <section class="card soft">
        <h2>Dodaj wpis</h2>
        <form id="entryForm" class="form">
          <label>Data
            <input name="data_wpisu" type="date" value="${todayISO()}" required />
          </label>
          <label>Nastrój (1–10)
            <input name="nastroj" type="number" min="1" max="10" step="1" required />
          </label>
          <label>Energia (1–10)
            <input name="energia" type="number" min="1" max="10" step="1" required />
          </label>
          <label>Stres (1–10)
            <input name="stres" type="number" min="1" max="10" step="1" required />
          </label>
          <label>Opis (opcjonalnie)
            <textarea name="opis" rows="4" placeholder="Co się dziś wydarzyło?"></textarea>
          </label>

          <div class="row" style="gap:10px;flex-wrap:wrap;">
            <button class="btn" type="button" id="pickFromGallery">Dodaj z galerii</button>
            <button class="btn" type="button" id="takePhoto">Zrób zdjęcie</button>

            <input id="photoGalleryInput" type="file" accept="image/*" hidden />
            <input id="photoCameraInput" type="file" accept="image/*" capture="environment" hidden />
          </div>

          <div id="photoCropWrap" hidden style="margin-top:10px;">
            <div id="cropFrame"
                 style="width:100%; aspect-ratio:16/9; border-radius:14px; overflow:hidden; background:#0001; position:relative;">
              <img id="cropImg"
                   alt="Podgląd"
                   style="position:absolute; left:0; top:0; transform-origin:0 0; user-select:none; touch-action:none; will-change:transform;" />
            </div>

            <div class="row" style="margin-top:10px;gap:10px;flex-wrap:wrap; align-items:center;">
              <label class="muted" style="font-size:12px;">
                Zoom
                <input id="zoomRange" type="range" min="1" max="3" step="0.01" value="1" />
              </label>

              <label class="muted" style="font-size:12px;">
                Rozmiar
                <select id="outSize">
                  <option value="1280x720">1280×720</option>
                  <option value="1920x1080" selected>1920×1080</option>
                  <option value="2560x1440">2560×1440</option>
                </select>
              </label>

              <button class="btn" type="button" id="removePhoto">Usuń zdjęcie</button>
            </div>

            <p class="muted" style="font-size:12px;margin-top:8px;">
              Przeciągnij zdjęcie palcem/myszką, ustaw kadr 16:9.
            </p>
          </div>

          <div id="err" class="error" hidden></div>
          <button class="btn primary" type="submit">Zapisz</button>
        </form>
      </section>
    `,
  });

  // Cropper
  const galleryBtn = root.querySelector("#pickFromGallery");
  const cameraBtn = root.querySelector("#takePhoto");
  const galleryInput = root.querySelector("#photoGalleryInput");
  const cameraInput = root.querySelector("#photoCameraInput");

  const cropWrap = root.querySelector("#photoCropWrap");
  const cropFrame = root.querySelector("#cropFrame");
  const cropImg = root.querySelector("#cropImg");
  const zoomRange = root.querySelector("#zoomRange");
  const outSizeSel = root.querySelector("#outSize");
  const removeBtn = root.querySelector("#removePhoto");

  let selectedFile = null;
  let imgNaturalW = 0;
  let imgNaturalH = 0;

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  function setTransform() {
    cropImg.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }

  function clampOffsets() {
    const frameW = cropFrame.clientWidth;
    const frameH = cropFrame.clientHeight;

    const minScaleX = frameW / imgNaturalW;
    const minScaleY = frameH / imgNaturalH;
    const minScale = Math.max(minScaleX, minScaleY);

    if (scale < minScale) scale = minScale;

    const scaledW = imgNaturalW * scale;
    const scaledH = imgNaturalH * scale;

    const maxOffsetX = 0;
    const maxOffsetY = 0;
    const minOffsetX = frameW - scaledW;
    const minOffsetY = frameH - scaledH;

    if (offsetX > maxOffsetX) offsetX = maxOffsetX;
    if (offsetY > maxOffsetY) offsetY = maxOffsetY;
    if (offsetX < minOffsetX) offsetX = minOffsetX;
    if (offsetY < minOffsetY) offsetY = minOffsetY;
  }

  async function loadFileToCropper(file) {
    selectedFile = file;
    const url = URL.createObjectURL(file);

    cropImg.onload = () => {
      imgNaturalW = cropImg.naturalWidth;
      imgNaturalH = cropImg.naturalHeight;

      const frameW = cropFrame.clientWidth;
      const frameH = cropFrame.clientHeight;
      const minScale = Math.max(frameW / imgNaturalW, frameH / imgNaturalH);

      zoomRange.value = "1";
      scale = minScale;

      const scaledW = imgNaturalW * scale;
      const scaledH = imgNaturalH * scale;
      offsetX = (frameW - scaledW) / 2;
      offsetY = (frameH - scaledH) / 2;

      clampOffsets();
      setTransform();
      cropWrap.hidden = false;
    };

    cropImg.src = url;
  }

  galleryBtn?.addEventListener("click", () => galleryInput.click());
  cameraBtn?.addEventListener("click", () => cameraInput.click());

  galleryInput?.addEventListener("change", async () => {
    const f = galleryInput.files?.[0];
    if (!f) return;
    await loadFileToCropper(f);
  });

  cameraInput?.addEventListener("change", async () => {
    const f = cameraInput.files?.[0];
    if (!f) return;
    await loadFileToCropper(f);
  });

  zoomRange?.addEventListener("input", () => {
    if (!imgNaturalW) return;

    const frameW = cropFrame.clientWidth;
    const frameH = cropFrame.clientHeight;
    const minScale = Math.max(frameW / imgNaturalW, frameH / imgNaturalH);

    const z = Number(zoomRange.value);
    const prevScale = scale;
    scale = minScale * z;

    const cx = frameW / 2;
    const cy = frameH / 2;
    offsetX = cx - (cx - offsetX) * (scale / prevScale);
    offsetY = cy - (cy - offsetY) * (scale / prevScale);

    clampOffsets();
    setTransform();
  });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  cropFrame?.addEventListener("pointerdown", (e) => {
    if (!imgNaturalW) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    cropFrame.setPointerCapture?.(e.pointerId);
  });

  cropFrame?.addEventListener("pointermove", (e) => {
    if (!dragging) return;

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    offsetX += dx;
    offsetY += dy;

    clampOffsets();
    setTransform();
  });

  cropFrame?.addEventListener("pointerup", () => { dragging = false; });
  cropFrame?.addEventListener("pointercancel", () => { dragging = false; });

  removeBtn?.addEventListener("click", () => {
    selectedFile = null;
    imgNaturalW = 0;
    imgNaturalH = 0;
    cropImg.src = "";
    cropWrap.hidden = true;
    galleryInput.value = "";
    cameraInput.value = "";
  });

  root.querySelector("#entryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = root.querySelector("#err");
    errEl.hidden = true;

    const fd = new FormData(e.currentTarget);
    const data_wpisu = String(fd.get("data_wpisu") || "").trim();
    const nastroj = Number(fd.get("nastroj"));
    const energia = Number(fd.get("energia"));
    const stres = Number(fd.get("stres"));
    const opis = String(fd.get("opis") || "").trim();

    if (!Number.isFinite(nastroj) || nastroj < 1 || nastroj > 10) {
      errEl.textContent = "Nastrój musi być liczbą 1–10.";
      errEl.hidden = false;
      return;
    }
    if (!Number.isFinite(energia) || energia < 1 || energia > 10) {
      errEl.textContent = "Energia musi być liczbą 1–10.";
      errEl.hidden = false;
      return;
    }
    if (!Number.isFinite(stres) || stres < 1 || stres > 10) {
      errEl.textContent = "Stres musi być liczbą 1–10.";
      errEl.hidden = false;
      return;
    }

    try {
      async function makeCroppedBlob16x9() {
        if (!selectedFile || !imgNaturalW) return null;

        const [outW, outH] = String(outSizeSel.value || "1920x1080")
          .split("x")
          .map((n) => Number(n));

        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Brak kontekstu canvas.");

        const frameW = cropFrame.clientWidth;
        const frameH = cropFrame.clientHeight;

        const srcX = (0 - offsetX) / scale;
        const srcY = (0 - offsetY) / scale;
        const srcW = frameW / scale;
        const srcH = frameH / scale;

        ctx.drawImage(cropImg, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

        const blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.9)
        );

        if (!blob) throw new Error("Nie udało się wygenerować pliku zdjęcia.");
        return blob;
      }

      let photo_path = null;

      if (selectedFile) {
        if (!navigator.onLine) throw new Error("Brak internetu – upload zdjęcia niedostępny offline.");

        const { data: u, error: ue } = await supabase.auth.getUser();
        const userId = u?.user?.id;
        if (ue || !userId) throw new Error("Brak użytkownika w sesji.");

        const blob = await makeCroppedBlob16x9();
        const fileName = `${crypto.randomUUID()}.jpg`;
        const path = `${userId}/${fileName}`;

        const { error: upErr } = await supabase.storage
          .from("wpisy-photos")
          .upload(path, blob, { upsert: false, contentType: "image/jpeg" });

        if (upErr) throw new Error("Upload zdjęcia: " + upErr.message);

        photo_path = path;
      }


      await insertEntry({ data_wpisu, nastroj, energia, stres, opis, photo_path });

      navigate("/(tabs)/home");
    } catch (e2) {
      errEl.textContent = e2?.message || String(e2);
      errEl.hidden = false;
    }
  });
}

/** Historia: lista + filtrowanie po dacie + ed**

/** Historia: lista + filtrowanie po dacie + edycja + usuwanie */
async function viewHistory() {
  const user = await requireAuth();
  if (!user) return;

  let entries = [];
  let errorMsg = "";
  try {
    entries = await fetchEntries(200);
  } catch (e) {
    errorMsg = e?.message || String(e);
  }

  await renderShell({
    title: "Historia",
    active: "history",
    contentHtml: `
      <section class="card soft">
        <div class="history-toolbar">
          <div class="history-title">
            <h2>Historia wpisów</h2>
          </div>

          <div class="history-actions">
            <button class="btn primary" id="goNew">Nowy wpis</button>
          </div>

          <div class="history-filters">
            <div class="field">
              <label for="dateFrom">Od:</label>
              <input id="dateFrom" type="date" />
            </div>

            <div class="field">
              <label for="dateTo">Do:</label>
              <input id="dateTo" type="date" />
            </div>

            <button class="btn" id="applyFilter">Filtruj</button>
            <button class="btn" id="clearFilter">Wyczyść</button>
          </div>
        </div>

        ${errorMsg ? `<p class="error">${escapeHtml(errorMsg)}</p>` : ""}

        <div id="historyErr" class="error" hidden></div>
        <div id="entriesWrap"></div>
      </section>
    `,
  });

  root.querySelector("#goNew").addEventListener("click", () => navigate("/(tabs)/new"));

  const wrap = root.querySelector("#entriesWrap");
  const errEl = root.querySelector("#historyErr");

  function applyDateFilter(list, from, to) {
    if (!from && !to) return list;
    return list.filter((e) => {
      const d = e.data_wpisu; // YYYY-MM-DD
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }

  function renderEntries(list) {
    if (!wrap) return;

    if (!list || list.length === 0) {
      wrap.innerHTML = `<p class="muted">Brak wpisów${entries.length ? " w tym zakresie dat." : "."}</p>`;
      return;
    }

    wrap.innerHTML = `
      <div class="entries">
        ${list
          .map((w) => {
            const photoUrl = getPhotoUrl(w.photo_path);
            return `
              <article class="entry" data-id="${escapeHtml(w.id)}">
                <div class="entry-head">
                  <div class="entry-date">${escapeHtml(w.data_wpisu)}</div>
                  <button class="icon-btn" type="button" data-action="delete" aria-label="Usuń wpis" title="Usuń wpis">🗑️</button>
                </div>

                ${photoUrl
                  ? `
                  <div class="entry-photo-wrap"
                       style="width:100%; aspect-ratio:16/9; border-radius:14px; overflow:hidden; background:#0001;">
                    <img class="entry-photo"
                         src="${escapeHtml(photoUrl)}"
                         alt="Zdjęcie wpisu"
                         loading="lazy"
                         style="width:100%; height:100%; object-fit:contain; display:block;" />
                  </div>
                `
                  : ""}

                <div class="entry-metrics">
                  <span class="pill">Nastrój: <strong>${escapeHtml(w.nastroj ?? "—")}</strong></span>
                  <span class="pill">Energia: <strong>${escapeHtml(w.energia ?? "—")}</strong></span>
                  <span class="pill">Stres: <strong>${escapeHtml(w.stres ?? "—")}</strong></span>
                </div>

                ${w.opis ? `<div class="entry-desc">${escapeHtml(w.opis)}</div>` : `<div class="muted">—</div>`}

                <div class="muted" style="font-size:12px;margin-top:6px;">
                  ${escapeHtml(w.created_at ? new Date(w.created_at).toLocaleString("pl-PL") : "")}
                </div>

                <div class="row" style="margin-top:10px;gap:10px;flex-wrap:wrap;">
                  <button class="btn" data-action="edit">Edytuj</button>
                  <button class="btn" data-action="delete">Usuń</button>
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  // pierwszy render
  renderEntries(entries);

  root.querySelector("#applyFilter")?.addEventListener("click", () => {
    const from = root.querySelector("#dateFrom")?.value || "";
    const to = root.querySelector("#dateTo")?.value || "";
    const filtered = applyDateFilter(entries, from, to);
    renderEntries(filtered);
  });

  root.querySelector("#clearFilter")?.addEventListener("click", () => {
    const df = root.querySelector("#dateFrom");
    const dt = root.querySelector("#dateTo");
    if (df) df.value = "";
    if (dt) dt.value = "";
    renderEntries(entries);
  });

  // delegacja klików dla edit/delete
  wrap?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const article = e.target.closest("article[data-id]");
    const id = article?.getAttribute("data-id");
    if (!id) return;

    const action = btn.getAttribute("data-action");
    errEl.hidden = true;

    const entry = entries.find((x) => String(x.id) === String(id));
    if (!entry) return;

    try {
      if (action === "delete") {
        const ok = confirm("Na pewno usunąć ten wpis? Tej operacji nie da się cofnąć.");
        if (!ok) return;

        await deleteEntry(id);

        entries = entries.filter((x) => String(x.id) !== String(id));
        // utrzymaj sort po dacie malejąco
        entries.sort((a, b) => (a.data_wpisu < b.data_wpisu ? 1 : -1));

        renderEntries(entries);

        const key = await cacheKeyEntries();
        cacheSet(key, entries);
        return;
      }

      if (action === "edit") {

        const newDate = prompt("Data (YYYY-MM-DD):", entry.data_wpisu) || entry.data_wpisu;
        const newMoodStr = prompt("Nastrój (1-10):", String(entry.nastroj)) || String(entry.nastroj);
        const newDesc = prompt("Opis:", entry.opis || "") ?? (entry.opis || "");

        const newMood = Number(newMoodStr);
        if (!Number.isFinite(newMood) || newMood < 1 || newMood > 10) {
          throw new Error("Nastrój musi być liczbą 1–10.");
        }

        await updateEntry(id, {
          data_wpisu: newDate,
          nastroj: newMood,
          opis: newDesc.trim(),
          photo_path: entry.photo_path, // bez zmiany zdjęcia w tej wersji
        });

        entries = entries.map((x) =>
          String(x.id) === String(id)
            ? { ...x, data_wpisu: newDate, nastroj: newMood, opis: newDesc.trim() }
            : x
        );

        entries.sort((a, b) => (a.data_wpisu < b.data_wpisu ? 1 : -1));
        renderEntries(entries);

        const key = await cacheKeyEntries();
        cacheSet(key, entries);
      }
    } catch (err) {
      errEl.textContent = err?.message || String(err);
      errEl.hidden = false;
    }
  });
}

/** Rada */
async function viewAdvice() {
  const user = await requireAuth();
  if (!user) return;



  // --- New wellbeing model integration ---
  const tips = [
    "Zrób 10-minutowy spacer bez telefonu.",
    "Zapisz 3 rzeczy, za które jesteś wdzięczna.",
    "Wypij wodę i zjedz coś białkowego — to stabilizuje energię.",
    "Zrób 5 głębokich oddechów (4 sek wdech, 6 sek wydech).",
    "Napisz jedną małą rzecz, którą możesz dziś domknąć.",
  ];
  const idx = Math.floor((Date.now() / (1000 * 60 * 60 * 24)) % tips.length);
  const tip = tips[idx];

  let summaryHtml = "";
  let entries = [];
  try {
    entries = await fetchEntries(7);
  } catch {}
  const score = entries.length ? score7Days(entries) : null;
  if (score && typeof score.avg === "number") {
    const percent = Math.round(score.avg * 100);
    const interp = interpret(score, entries);
    summaryHtml = `
      <div class=\"muted\" style=\"font-size:15px;margin-bottom:6px;\">
        Wynik dobrostanu: <strong>${percent}</strong> / 100
        <span style=\"font-size:12px;color:#888;\">(${score.days} dni)</span>
      </div>
      <div class=\"quote\" style=\"color:#1a7f37;\"><strong>${escapeHtml(interp.level)}</strong>: ${escapeHtml(interp.msg)}</div>
    `;
  }

  await renderShell({
    title: "Rada na dziś",
    active: "advice",
    contentHtml: `
      <section class="card soft">
        <h2>Rada na dziś</h2>
        ${summaryHtml || `<p class="quote">${escapeHtml(tip)}</p>`}
        <p class="muted">To prosta sugestia – nie diagnoza. Jeśli czujesz, że jest źle przez dłuższy czas, warto porozmawiać ze specjalistą.</p>
        <div class="row">
          <button class="btn" id="backHome">Wróć na Start</button>
          <button class="btn primary" id="newEntry">Dodaj wpis</button>
        </div>
      </section>
    `,
  });

  root.querySelector("#backHome").addEventListener("click", () => navigate("/(tabs)/home"));
  root.querySelector("#newEntry").addEventListener("click", () => navigate("/(tabs)/new"));
}

/* =========================
  OFFLINE / 404
========================= */
async function viewOffline() {
  const key = await cacheKeyEntries();
  const cachedEntries = cacheGet(key, []);
  root.innerHTML = `
    <section class="card">
      <h1>Tryb offline</h1>
      <p class="muted">Status: <strong>${navigator.onLine ? "ONLINE" : "OFFLINE"}</strong></p>

      <h2>Wpisy (cache)</h2>
      <pre class="pre">${escapeHtml(JSON.stringify(cachedEntries, null, 2) || "brak")}</pre>

      <div class="row">
        <button class="btn" id="back">Wróć</button>
      </div>
    </section>
  `;
  root.querySelector("#back").addEventListener("click", () => navigate("/"));
}

async function view404() {
  root.innerHTML = `<section class="card"><h1>404</h1><p>Nie znaleziono widoku.</p></section>`;
}

/* =========================
  Weather
========================= */

// --- Ikony pogody (WMO → emoji) ---
function weatherIcon(code, isDay = true) {
  const day = !!isDay;

  // WMO weather codes (Open-Meteo używa standardu WMO)
  if (code === 0) return day ? "☀️" : "🌙";                // clear
  if (code === 1) return day ? "🌤️" : "🌙";               // mainly clear
  if (code === 2) return "⛅";                              // partly cloudy
  if (code === 3) return "☁️";                              // overcast

  if (code === 45 || code === 48) return "🌫️";            // fog

  if (code === 51 || code === 53 || code === 55) return "🌦️"; // drizzle
  if (code === 56 || code === 57) return "🌧️";            // freezing drizzle

  if (code === 61 || code === 63 || code === 65) return "🌧️"; // rain
  if (code === 66 || code === 67) return "🌧️";            // freezing rain

  if (code === 71 || code === 73 || code === 75) return "🌨️"; // snow
  if (code === 77) return "🌨️";                            // snow grains

  if (code === 80 || code === 81 || code === 82) return "🌧️"; // rain showers
  if (code === 85 || code === 86) return "🌨️";            // snow showers

  if (code === 95) return "⛈️";                             // thunderstorm
  if (code === 96 || code === 99) return "⛈️";             // thunderstorm + hail

  return "🌡️"; // fallback
}

async function getWeatherText() {
  const cached = cacheGet("weather_cache", null);
  if (cached?.text && Date.now() - cached.ts < 30 * 60 * 1000) {
    return { text: cached.text, icon: cached.icon, code: cached.code, isDay: cached.isDay, fromCache: true };
  }

  if (!navigator.onLine) {
    if (cached?.text) return { text: cached.text, icon: cached.icon, code: cached.code, isDay: cached.isDay, fromCache: true };
    return { text: "Offline: brak danych o pogodzie.", fromCache: true };
  }

  if (!("geolocation" in navigator)) {
    return { text: "Geolokalizacja niedostępna.", fromCache: false };
  }

  const pos = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
  }).catch((e) => ({ error: e }));

  if (pos?.error) {
    return {
      text: pos.error.code === 1 ? "Brak zgody na lokalizację." : "Nie udało się pobrać lokalizacji.",
      fromCache: false,
    };
  }

  const { latitude, longitude } = pos.coords;

  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${encodeURIComponent(latitude)}` +
    `&longitude=${encodeURIComponent(longitude)}` +
    `&current=temperature_2m,weather_code,is_day&timezone=auto`;

  const weatherRes = await fetch(weatherUrl);
  if (!weatherRes.ok) return { text: "Błąd pobierania pogody.", fromCache: false };

  const weatherData = await weatherRes.json();
  const temp = weatherData?.current?.temperature_2m;
  const code = weatherData?.current?.weather_code;
  const isDay = weatherData?.current?.is_day === 1;

  const city = guessCityFromTimezone();
  const icon = weatherIcon(code, isDay);
  const text = `${city}: ${temp ?? "—"}°C`;

  cacheSet("weather_cache", { ts: Date.now(), text, icon, code, isDay });
  return { text, icon, code, isDay, fromCache: false };
}

function guessCityFromTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const city = tz.split("/").pop()?.replaceAll("_", " ");
    return city || "Twoja okolica";
  } catch {
    return "Twoja okolica";
  }
}


