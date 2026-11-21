# Haechi at the Calgary Invitational – live schedule

A phone-friendly schedule for Haechi athletes at the UTTC Calgary Invitational (Sat Nov 21, 2026).

- `index.html` – the page. It loads `/api/schedule` every minute and falls back to a saved copy if Kihapp can't be reached.
- `netlify/functions/schedule.mjs` – reads the public Kihapp schedule, keeps divisions with Haechi athletes, and works out each athlete's possible finals and bronze matches. Netlify caches the result for 60 seconds.
- `netlify.toml` – tells Netlify where the page and the function are. No build command needed.

Source: https://www.kihapp.com/tournaments/27457-uttc-calgary-invitational/matches
