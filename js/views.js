import { supabase } from "./supabaseClient.js";
import { navigate } from "./router.js";
import { cacheGet, cacheSet } from "./offline.js";

const root = document.getElementById("app");

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function requireAuth() {
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user ?? null;
  if (!user) {
    navigate("/logowanie");
    return null;
  }
  return user;
}

function activeTab(path) {
  const p = (path || (location.hash || "#/").slice(1)) || "/";
  return p;
}

/* ---------- DB helpers ---------- */
async function fetchEntries(limit = 50) {
  // offline fallback
  if (!navigator.onLine) return cacheGet("wpisy_cache", []);

  const { data, error } = await supabase
    .from("wpisy")
    .select("id, data_wpisu, nastroj, opis, created_at, photo_path")
    .order("data_wpisu", { ascending: false })
    .limit(limit);

  if (error) throw error;
  cacheSet("wpisy_cache", data ?? []);
  return data ?? [];
}

async function insertEntry({ data_wpisu, nastroj, opis, photo_path }) {
  if (!navigator.onLine) throw new Error("Brak internetu – zapis do bazy niedostępny.");

  const { data: u, error: ue } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (ue || !userId) throw new Error("Brak użytkownika w sesji. Zaloguj się ponownie.");

  const payload = {
    user_id: userId,
    data_wpisu,
    nastroj,
    ...(opis ? { opis } : {}),
    ...(photo_path ? { photo_path } : {}),
  };

  const { error } = await supabase.from("wpisy").insert(payload);
  if (error) throw error;
}

// Helper do budowania URL zdjęcia (public / signed)
function getPhotoUrl(photo_path) {
  if (!photo_path) return null;

  // Jeśli bucket jest PUBLIC:
  const { data } = supabase.storage.from("wpisy-photos").getPublicUrl(photo_path);
  return data?.publicUrl || null;
}

// Helper do budowania URL avatara (public bucket)
function getAvatarUrl(avatar_path) {
  if (!avatar_path) return null;
  const { data } = supabase.storage.from("avatars").getPublicUrl(avatar_path);
  return data?.publicUrl || null;
}

// Helper do pobierania profilu bieżącego użytkownika
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

// Helper do uploadu avatara i zapisu do profiles
async function uploadAvatar(file) {
  if (!navigator.onLine) throw new Error("Brak internetu – upload avatara niedostępny offline.");

  const { data: u, error: ue } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (ue || !userId) throw new Error("Brak użytkownika w sesji.");

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const fileName = `${crypto.randomUUID()}.${ext}`;
  const path = `${userId}/${fileName}`;

  const { error: upErr } = await supabase
    .storage
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

/* ---------- Layout shell (po zalogowaniu) ---------- */
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

  root.querySelector("#logout").addEventListener("click", async () => {
    await supabase.auth.signOut();
    navigate("/logowanie");
  });
}

/* =========================
   PUBLIC: Landing / Auth
========================= */
// Zwraca HTML z logo PNG (icon-192.png)
function appLogoImg() {
  return `<img src="/assets/icon-192.png" alt="Logo" style="width:140px;height:140px;display:block;margin:32px auto 16px auto;box-shadow:0 2px 16px #0002;border-radius:32px;" />`;
}

export async function viewIndex() {
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

export async function viewLogowanie() {
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
      <p class="muted">Logowanie wymaga internetu.</p>
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

export async function viewRejestracja() {
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
      <p class="muted">Rejestracja wymaga internetu.</p>
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
        data: { first_name, last_name } // trafi do raw_user_meta_data
      }
    });

    if (error) {
      errEl.textContent = "Rejestracja nie powiodła się: " + error.message;
      errEl.hidden = false;
      return;
    }

    navigate("/logowanie");
  });
}

/* =========================
   PRIVATE: Start / New / History / Advice
========================= */

/** Start: podsumowanie + ostatnie wpisy, albo karta "dodaj pierwszy wpis" */
export async function viewHome() {
  const user = await requireAuth();
  if (!user) return;

  let profile = null;
  try { profile = await fetchMyProfile(); } catch (e) { /* pokaż błąd */ }

  const firstName = profile?.first_name || "👋";
  const avatarUrl = getAvatarUrl(profile?.avatar_path);

  const helloCard = `
    <section class="card soft">
      <div class="profile-row">
        <div class="avatar">
          ${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="Avatar" />` : `<div class="avatar-fallback">🙂</div>`}
        </div>
        <div class="profile-meta">
          <div class="hello">Witaj, <strong>${escapeHtml(firstName)}</strong>!</div>
          <div class="muted">Możesz dodać zdjęcie profilowe.</div>
        </div>
      </div>

      <label class="file-label">
        <input id="avatarInput" type="file" accept="image/*" />
        <span class="btn">Ustaw zdjęcie profilowe</span>
      </label>

      <div id="avatarErr" class="error" hidden></div>
    </section>
  `;

  const weatherCard = `
    <section class="card soft">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <h2 style="margin:0;">Pogoda</h2>
        <button class="btn" id="weatherRefresh">Odśwież</button>
      </div>
      <p class="muted" id="weatherOut">Ładowanie…</p>
      <p class="muted" style="font-size:12px;margin-top:8px;">
        Wykorzystuje geolokalizację urządzenia (native) + cache 30 min.
      </p>
    </section>
  `;

  let entries = [];
  let loadError = "";

  try {
    entries = await fetchEntries(7);
  } catch (e) {
    loadError = e?.message || String(e);
    entries = [];
  }

  const hasEntries = entries.length > 0;

  const lastEntriesHtml = `
    <section class="card soft">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <h2 style="margin:0;">Ostatnie wpisy</h2>
        <button class="btn primary" id="goNewTop">Nowy wpis</button>
      </div>

      ${loadError ? `<p class="error">Błąd pobierania wpisów: ${escapeHtml(loadError)}</p>` : ""}

      ${!hasEntries ? `
        <p class="muted">Nie masz jeszcze wpisów.</p>
        <button class="btn primary" id="goNewEmpty">Dodaj pierwszy wpis</button>
      ` : `
        <div class="entries">
          ${entries.map((w) => {
            const photoUrl = getPhotoUrl(w.photo_path);
            return `
              <article class="entry">
                <div class="entry-top">
                  <div class="entry-date">${escapeHtml(w.data_wpisu)}</div>
                  <div class="mood-pill">Nastrój: <strong>${escapeHtml(w.nastroj)}</strong></div>
                </div>

                ${photoUrl ? `
                  <img class="entry-photo"
                       src="${escapeHtml(photoUrl)}"
                       alt="Zdjęcie wpisu"
                       loading="lazy">
                ` : ""}

                ${w.opis ? `<div class="entry-desc">${escapeHtml(w.opis)}</div>` : `<div class="muted">—</div>`}

                <div class="row" style="margin-top:10px;">
                  <button class="btn" data-go="history">Historia</button>
                </div>
              </article>
            `;
          }).join("")}
        </div>

        <div class="row" style="margin-top:10px;">
          <button class="btn" id="goHistory">Zobacz całą historię</button>
        </div>
      `}
    </section>
  `;

  const summaryHtml = helloCard + weatherCard + lastEntriesHtml;

  await renderShell({
    title: "Start",
    active: "home",
    contentHtml: summaryHtml,
  });

  async function paintWeather() {
    const out = root.querySelector("#weatherOut");
    if (!out) return;
    out.textContent = "Ładowanie…";
    const result = await getWeatherText();
    out.textContent = result.text + (result.fromCache ? " (cache)" : "");
  }

  root.querySelector("#weatherRefresh")?.addEventListener("click", () => {
    cacheSet("weather_cache", null);
    paintWeather();
  });

  paintWeather();

  root.querySelector("#goNewTop")?.addEventListener("click", () => navigate("/(tabs)/new"));
  root.querySelector("#goNewEmpty")?.addEventListener("click", () => navigate("/(tabs)/new"));
  root.querySelector("#goHistory")?.addEventListener("click", () => navigate("/(tabs)/history"));
  root.querySelectorAll('[data-go="history"]').forEach((b) =>
    b.addEventListener("click", () => navigate("/(tabs)/history"))
  );

  const avatarInput = root.querySelector("#avatarInput");
  const avatarErr = root.querySelector("#avatarErr");

  avatarInput?.addEventListener("change", async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;

    avatarErr.hidden = true;
    try {
      await uploadAvatar(file);
      navigate("/(tabs)/home"); // szybki refresh widoku
    } catch (e) {
      avatarErr.textContent = e?.message || String(e);
      avatarErr.hidden = false;
    }
  });
}

/** Nowy wpis: formularz */
export async function viewNewEntry() {
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
          <label>Opis (opcjonalnie)
            <textarea name="opis" rows="4" placeholder="Co się dziś wydarzyło?"></textarea>
          </label>
          <label>Zdjęcie (opcjonalnie)
            <input name="photo" id="photoInput" type="file" accept="image/*" capture="environment" />
          </label>
          <div id="photoPreviewWrap" hidden>
            <img id="photoPreview" class="photo-preview" alt="Podgląd zdjęcia" />
          </div>
          <div id="err" class="error" hidden></div>
          <button class="btn primary" type="submit">Zapisz</button>
        </form>
      </section>
    `,
  });

  const photoInput = root.querySelector("#photoInput");
  const previewWrap = root.querySelector("#photoPreviewWrap");
  const previewImg = root.querySelector("#photoPreview");

  photoInput.addEventListener("change", () => {
    const file = photoInput.files?.[0];
    if (!file) {
      previewWrap.hidden = true;
      return;
    }
    previewImg.src = URL.createObjectURL(file);
    previewWrap.hidden = false;
  });

  root.querySelector("#entryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = root.querySelector("#err");
    errEl.hidden = true;

    const fd = new FormData(e.currentTarget);
    const data_wpisu = String(fd.get("data_wpisu") || "").trim();
    const nastroj = Number(fd.get("nastroj"));
    const opis = String(fd.get("opis") || "").trim();

    if (!Number.isFinite(nastroj) || nastroj < 1 || nastroj > 10) {
      errEl.textContent = "Nastrój musi być liczbą 1–10.";
      errEl.hidden = false;
      return;
    }

    try {
      let photo_path = null;

      const file = photoInput.files?.[0];
      if (file) {
        if (!navigator.onLine) throw new Error("Brak internetu – upload zdjęcia niedostępny offline.");

        const { data: u, error: ue } = await supabase.auth.getUser();
        const userId = u?.user?.id;
        if (ue || !userId) throw new Error("Brak użytkownika w sesji.");

        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const fileName = `${crypto.randomUUID()}.${ext}`;
        const path = `${userId}/${fileName}`;

        const { error: upErr } = await supabase
          .storage
          .from("wpisy-photos")
          .upload(path, file, { upsert: false, contentType: file.type });

        if (upErr) throw new Error("Upload zdjęcia: " + upErr.message);

        photo_path = path;
      }

      // zapis wpisu (z photo_path)
      await insertEntry({ data_wpisu, nastroj, opis, photo_path });

      navigate("/(tabs)/home");
    } catch (e2) {
      errEl.textContent = e2?.message || String(e2);
      errEl.hidden = false;
    }
  });
}

/** Historia: pełna lista */
export async function viewHistory() {
  const user = await requireAuth();
  if (!user) return;

  let entries = [];
  let errorMsg = "";
  try {
    entries = await fetchEntries(100);
  } catch (e) {
    errorMsg = e?.message || String(e);
  }

  await renderShell({
    title: "Historia",
    active: "history",
    contentHtml: `
      <section class="card soft">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <h2 style="margin:0;">Historia wpisów</h2>
          <button class="btn primary" id="goNew">Nowy wpis</button>
        </div>

        ${errorMsg ? `<p class="error">${escapeHtml(errorMsg)}</p>` : ""}

        ${entries.length === 0 ? `
          <p class="muted">Brak wpisów. Dodaj pierwszy wpis.</p>
        ` : `
          <div class="entries">
            ${entries
              .map((w) => {
                const photoUrl = getPhotoUrl(w.photo_path);
                return `
                  <article class="entry">
                    <div class="entry-top">
                      <div class="entry-date">${escapeHtml(w.data_wpisu)}</div>
                      <div class="mood-pill">Nastrój: <strong>${escapeHtml(w.nastroj)}</strong></div>
                    </div>

                    ${photoUrl ? `
                      <img
                        class="entry-photo"
                        src="${escapeHtml(photoUrl)}"
                        alt="Zdjęcie wpisu"
                        loading="lazy">
                    ` : ""}

                    ${w.opis ? `<div class="entry-desc">${escapeHtml(w.opis)}</div>` : `<div class="muted">—</div>`}

                    <div class="muted" style="font-size:12px;margin-top:6px;">${escapeHtml(w.created_at ? new Date(w.created_at).toLocaleString("pl-PL") : "")}</div>
                  </article>
                `;
              })
              .join("")}
          </div>

          <div class="row" style="margin-top:10px;">
            <button class="btn" id="goHistory">Zobacz całą historię</button>
          </div>
        `}
      </section>
    `,
  });

  root.querySelector("#goNew").addEventListener("click", () => navigate("/(tabs)/new"));
}

/** Rada: prosta logika + offline */
export async function viewAdvice() {
  const user = await requireAuth();
  if (!user) return;

  const tips = [
    "Zrób 10-minutowy spacer bez telefonu.",
    "Zapisz 3 rzeczy, za które jesteś wdzięczna.",
    "Wypij wodę i zjedz coś białkowego — to stabilizuje energię.",
    "Zrób 5 głębokich oddechów (4 sek wdech, 6 sek wydech).",
    "Napisz jedną małą rzecz, którą możesz dziś domknąć.",
  ];

  const idx = Math.floor((Date.now() / (1000 * 60 * 60 * 24)) % tips.length); // “rady dnia”
  const tip = tips[idx];

  await renderShell({
    title: "Rada na dziś",
    active: "advice",
    contentHtml: `
      <section class="card soft">
        <h2>Rada na dziś</h2>
        <p class="quote">${escapeHtml(tip)}</p>
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
export async function viewOffline() {
  const cachedEntries = cacheGet("wpisy_cache", []);
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

export async function view404() {
  root.innerHTML = `<section class="card"><h1>404</h1><p>Nie znaleziono widoku.</p></section>`;
}

function isFresh(ts, maxAgeMs) {
  return typeof ts === "number" && Date.now() - ts < maxAgeMs;
}

async function getWeatherText() {
  const cached = cacheGet("weather_cache", null);
  if (cached?.text && Date.now() - cached.ts < 30 * 60 * 1000) {
    return { text: cached.text, fromCache: true };
  }

  if (!navigator.onLine) {
    if (cached?.text) return { text: cached.text, fromCache: true };
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
    `&current=temperature_2m&timezone=auto`;

  const weatherRes = await fetch(weatherUrl);
  if (!weatherRes.ok) return { text: "Błąd pobierania pogody.", fromCache: false };

  const weatherData = await weatherRes.json();
  const temp = weatherData?.current?.temperature_2m;

  const city = guessCityFromTimezone();
  const text = `${city}: ${temp ?? "—"}°C`;

  cacheSet("weather_cache", { ts: Date.now(), text });
  return { text, fromCache: false };
}

function guessCityFromTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    // np. "Europe/Warsaw" → "Warsaw"
    const city = tz.split("/").pop()?.replaceAll("_", " ");
    return city || "Twoja okolica";
  } catch {
    return "Twoja okolica";
  }
}
