# kkonrad.com — project tracker

Live: https://kkonrad.com/ (GitHub Pages, custom domain, DNS cutover done)
Stack: Hugo + PaperMod, deployed via GitHub Actions to GitHub Pages.
Deploys: push to `master`, manual dispatch, or the **daily 05:23 UTC cron** (keeps the build-time Substack feed fresh).

---

## Done — 2026-07-12 site overhaul

- [x] **Substack feed is now build-time.** `layouts/partials/substack-feed.html` fetches the public RSS with `resources.GetRemote` at build; no client JS, no Apps Script proxy. Falls back to a plain Substack link if the fetch fails. Freshness via daily cron in `deploy.yml`.
- [x] **Writing section rebuilt.** 16 external-essay stubs (frontmatter `externalURL` → kkonrad.substack.com, real dates from the Substack API) across onchain-payments (9), fintech (5), cofounder-search (2). List rows link straight out (marked ↗) via `layouts/partials/writing-entry.html`; category pages render their own posts; the Substack block appears only on `/writing/` itself. Categories ordered by `weight` in each `_index.md`.
- [x] **Home: curated "Selected writing"** from `data/selected_writing.yaml` (edit that file to change the picks) instead of the live feed.
- [x] **Old URLs restored**: the four pre-April stub paths are back as files; the moved banking article has an `aliases:` entry for its old `/writing/fintech/` URL.
- [x] **Dead links fixed** (knitvideo → Wayback, radowid → Wayback, Honey Honey Blues → Wayback, Oko i Ucho → Wayback, WalletUncon CFP → Wayback, joinef what-does-ef-look-for → Wayback, Vimeo *manage* URL → public URL, peanut.to → peanut.me).
- [x] **Favicon set** (`static/favicon.ico` + PNGs + apple-touch-icon, generated from pfp.jpg) and **default OG image** (`static/og-card.png`, wired via `[params] images`). Regenerate the card by editing the HTML snippet in the repo history (commit that added it) or ask an agent.
- [x] **Bitter self-hosted** (`static/fonts/*.woff2`, variable font, latin + latin-ext; `@font-face` in `assets/css/extended/custom.css`). Google Fonts removed (perf + GDPR).
- [x] **HTTPS enforced** on GitHub Pages (http:// now 301s to https://).
- [x] Search placeholder, talks/misc meta descriptions, dates on writing rows.

## To do

- [ ] **Analytics**: create a free account at goatcounter.com, then uncomment `goatcounter = "..."` in `hugo.toml` `[params]` — the script renders only when set (`layouts/partials/extend_head.html`).
- [ ] Verify estimated dates on the in-repo philosophy/policy articles (conformism 2017-10, super-mary 2020-01, european-banks 2016-01). Substack-stub dates are real (pulled from the Substack API).
- [ ] Curate `data/selected_writing.yaml` to taste — current picks: wen-p2p, wrench attacks, network-vs-ecosystem, fat wallet, link-based transfer abstraction, EF/Antler guide.
- [ ] Skim the EF/Antler article — a few list items had merged content from Google Sites HTML patched by hand; might still have a rough spot.

## Future / open decisions

- [ ] Whether to mirror Substack essays in-repo for SEO (current: external stubs + build-time feed; single source of truth stays Substack)
- [ ] Whether to keep the `0xkkonrad.github.io` repo name or rename (cosmetic)
- [ ] Three.js background animation sitewide — scoped, light-touch ambient effect behind content (not a full WebGL takeover)

## Will not do

- **Pretext-rendered hero + dragon-physics canvas** ([0xNyk/pretext-playground](https://github.com/0xNyk/pretext-playground) style, scoped to the home `<h1>`). Evaluated 2026-04-30:
  - Bloat: ~30–45KB gzipped on `/` only (pretext ~25–30KB + trimmed dragon engine ~5–10KB + glue). Acceptable.
  - Complexity is the blocker: requires a new esbuild/Vite step in the Hugo pipeline, custom rewrite of `dragon.ts` to operate on a bounded canvas (the playground assumes fullscreen), `document.fonts.ready` gating to avoid Bitter FOUT snap, dark/light theme reactivity on canvas glyphs, mobile/touch fallback (cursor physics doesn't translate), and an `aria-hidden` overlay pattern to keep the real `<h1>` for SEO/screen readers.
  - Realistic cost: ~half a day prototype, 1–2 days to production-quality, plus ongoing maintenance — every font/theme/headline tweak now also touches a canvas.
  - Verdict: not worth the build-pipeline + maintenance tax for a hero flourish. Three.js ambient background (above) achieves a similar "site feels alive" goal at lower coupling.

## Done — April 2026 migration (history)

- Migrated from al-folio/Google Sites to Hugo + PaperMod (submodule), GH Actions deploy, CNAME kkonrad.com.
- Consolidated films/blues into /misc, merged Substack into /writing/, home redesign with pfp + bio.
- DNS cutover completed (apex A records + www CNAME, verified live).

## Repo layout (for reference)

```
.
├── hugo.toml                       # site config (menu, params, og image, goatcounter hook)
├── data/
│   └── selected_writing.yaml       # home-page "Selected writing" picks
├── content/
│   ├── _index.md                   # → /            (homeInfoParams in hugo.toml drives the bio)
│   ├── search.md                   # → /search/     (PaperMod fuse.js search)
│   ├── talks.md                    # → /talks/
│   ├── misc.md                     # → /misc/       (blues, film, journalism)
│   └── writing/
│       ├── _index.md               # → /writing/    (categories + build-time Substack feed)
│       ├── onchain-payments/       # 9 external stubs → Substack
│       ├── fintech/                # 5 external stubs → Substack
│       ├── cofounder-search/       # EF/Antler guide (in-repo) + 2 stubs
│       ├── policy/                 # european-banks (in-repo, alias from old fintech URL)
│       └── philosophy/             # 2 in-repo papers
├── layouts/
│   ├── partials/substack-feed.html # build-time RSS fetch + render
│   ├── partials/writing-entry.html # one list row (externalURL-aware)
│   ├── partials/home_info.html     # bio + Selected writing
│   ├── partials/extend_head.html   # font preload + GoatCounter hook
│   └── writing/list.html           # /writing/ + category pages
├── assets/css/extended/custom.css  # fonts, dark palette, feed/selected styles
├── static/
│   ├── CNAME                       # kkonrad.com
│   ├── fonts/                      # Bitter variable woff2 (latin, latin-ext)
│   ├── og-card.png                 # default social share card
│   └── favicon.ico + PNG set      # generated from pfp.jpg
├── themes/PaperMod/                # git submodule
└── .github/workflows/deploy.yml    # push + daily-cron build → GitHub Pages
```

## Local dev

```sh
git clone --recurse-submodules <repo>   # or: git submodule update --init
hugo server -D                          # http://localhost:1313
```

To add an article: `content/writing/<category>/<slug>.md` with `title`, `date`, `summary`, `tags` — or an external stub with `externalURL` in frontmatter (see any onchain-payments file). Push to master; the Action rebuilds in ~40s.
