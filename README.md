# Produkcyjna wersja dostępna pod: [https://dziennik-nastrojow.netlify.app/](https://dziennik-nastrojow.netlify.app/)
# Dziennik Nastrojów PWA

Aplikacja Progressive Web App (PWA) do codziennego monitorowania nastroju, energii i stresu. Pozwala na szybkie dodawanie wpisów, analizę trendów oraz korzystanie offline. Wspiera powiadomienia push i synchronizację z Supabase.

## Funkcje
- Dodawanie i przeglądanie wpisów dziennika
- Analiza dobrostanu na podstawie wpisów
- Obsługa offline (cache, Service Worker)
- Powiadomienia push (Web Push API)
- Logowanie i rejestracja użytkowników (Supabase Auth)
- Przechowywanie danych w Supabase
- Obsługa avatarów użytkownika

## Struktura projektu
- `index.html` — główny plik HTML
- `manifest.webmanifest` — manifest PWA
- `sw.js` — Service Worker (cache, push)
- `css/` — style aplikacji
- `js/` — logika aplikacji:
  - `app.js` — inicjalizacja, routing
  - `router.js` — obsługa tras
  - `views.js` — widoki, logika UI
  - `offline.js` — cache, obsługa offline
  - `supabaseClient.js` — konfiguracja Supabase
- `supabase/` — funkcje edge, konfiguracja Supabase

## Instalacja i uruchomienie
1. Sklonuj repozytorium:
   ```sh
   git clone https://github.com/Klaudia-Prucz/dziennik-nastrojow-pwa.git
   cd dziennik-nastrojow-pwa
   ```
2. Zainstaluj zależności (jeśli są):
   ```sh
   npm install
   ```
3. Uruchom serwer developerski (np. live-server, http-server, Vite):
   ```sh
   npm start
   # lub
   npx live-server
   ```
4. Otwórz aplikację w przeglądarce: [http://localhost:8080](http://localhost:8080)

## Konfiguracja Supabase
- Skonfiguruj projekt w [Supabase](https://supabase.com/)
- Uzupełnij klucze w `js/supabaseClient.js`
- Upewnij się, że tabele `profiles`, `wpisy` oraz bucket `avatars` istnieją

## Budowa i wdrożenie
- Aplikacja działa jako statyczny PWA — można hostować np. na Netlify, Vercel, GitHub Pages
- Service Worker automatycznie cache'uje pliki i obsługuje offline

## Licencja
MIT

---
Autor: Klaudia Prucz
