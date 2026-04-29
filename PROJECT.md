# kkonrad.com — project tracker

Live preview: https://0xkkonrad.github.io/
Final domain (post-cutover): https://kkonrad.com/
Stack: Hugo + PaperMod, deployed via GitHub Actions to GitHub Pages.

---

## Done

- [x] Check environment (hugo installed locally? — no; git clean; on master)
- [x] Create `migrate-to-hugo` branch
- [x] Wipe al-folio scaffolding (300+ files: layouts, includes, _projects, _bibliography, 9 GH workflows, Docker, Gemfile, etc.)
- [x] Scaffold Hugo + add PaperMod as git submodule under `themes/PaperMod`
- [x] Write `hugo.toml` (auto theme, ToC, breadcrumbs, search, RSS, JSON output, taxonomies, homeInfoParams bio)
- [x] Build content tree: home, talks, films, blues, writing index, 4 category sections (onchain-payments, cofounder-search, fintech, philosophy)
- [x] Migrate Google Sites pages — talks/films/blues as plain markdown
- [x] Migrate 7 external articles as redirect stubs (meta refresh + fallback link)
- [x] Fetch & convert the EF/Antler honest guide → in-repo page bundle at `content/writing/cofounder-search/ef-antler-honest-guide/`
- [x] Add `deploy.yml` (Hugo extended → upload-pages-artifact → deploy-pages)
- [x] Add `static/CNAME` (`kkonrad.com`)
- [x] Add `.gitignore` (Hugo style, ignore `.claude/`)
- [x] Push to master, fix Hugo version (0.142 → 0.150 — PaperMod requires ≥0.146), build green in 40s

---

## To do — DNS cutover (manual, in order)

- [ ] **GitHub** — repo Settings → Pages → set Custom domain to `kkonrad.com` and save
- [ ] **DNS registrar** for `kkonrad.com`:
  - [ ] Apex: four `A` records → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
  - [ ] `www`: `CNAME` → `0xkkonrad.github.io.`
- [ ] Wait for DNS propagation (5–60 min)
- [ ] **GitHub** — Settings → Pages → tick **Enforce HTTPS** once cert is provisioned
- [ ] Verify `https://kkonrad.com` end-to-end (home, /writing/, /talks/, sample article)
- [ ] **Google Sites** — unpublish kkonrad.com from Google Sites (only after step above passes)

---

## To do — polish (non-blocking)

- [ ] Update article dates in frontmatter — currently estimates:
  - `content/writing/onchain-payments/wen-p2p-electronic-cash-system.md` — 2024-11-15
  - `content/writing/onchain-payments/link-based-transfer-abstraction.md` — 2024-09-01
  - `content/writing/onchain-payments/sidestep-onchain-identity.md` — 2024-07-01
  - `content/writing/cofounder-search/cofounder-fit-questions.md` — 2020-06-01
  - `content/writing/cofounder-search/ef-antler-honest-guide/index.md` — 2022-09-01
  - `content/writing/fintech/european-banks-not-fixed-yet.md` — 2018-01-01
  - `content/writing/philosophy/conformism-locating-disagreement.md` — 2019-06-01
  - `content/writing/philosophy/super-mary-mission-impossible.md` — 2019-06-01
- [ ] Skim the EF/Antler article — a few list items had merged content from Google Sites HTML that I patched by hand; might still have a rough spot
- [ ] Adjust the `summary` field on each external-article stub to taste (mine, not yours)
- [x] `LICENSE` replaced with the Unlicense (public domain dedication)
- [ ] Edit `[params.homeInfoParams].Content` in `hugo.toml` to refine the home-page bio
- [ ] Decide if the substack `Wen p2p…` URL slug is right (currently guessed `/p/wen-p2p-electronic-cash-system`) — update if needed

---

## Future / open decisions

- [ ] Whether `/writing/` should show category cards or a flat chronological list — pick after using it
- [ ] Whether to mirror Substack articles into the repo for SEO, or keep redirect stubs (current approach: stubs, single source of truth in Substack)
- [ ] Whether to keep the `0xkkonrad.github.io` repo name or rename (cosmetic, no functional impact)
- [ ] Add a favicon / OG image (currently empty in `[params.assets]`)
- [ ] Add Google Analytics or alternative if you want stats — just set `googleAnalytics = "G-XXX"` in `hugo.toml`
- [ ] If you want fancier typography (justified Knuth-Plass line breaks etc.), layer [chenglou/pretext](https://github.com/chenglou/pretext) via PaperMod's `extend_head.html` partial — purely additive, can be done anytime

---

## Repo layout (for reference)

```
.
├── hugo.toml                       # site config
├── archetypes/                     # Hugo's new-content templates (currently empty)
├── content/
│   ├── _index.md                   # → /            (homeInfoParams in hugo.toml drives the bio)
│   ├── search.md                   # → /search/     (PaperMod fuse.js search)
│   ├── talks.md                    # → /talks/
│   ├── films.md                    # → /films/
│   ├── blues.md                    # → /blues/
│   └── writing/
│       ├── _index.md               # → /writing/
│       ├── onchain-payments/
│       │   ├── _index.md
│       │   └── *.md                # redirect stubs
│       ├── cofounder-search/
│       │   ├── _index.md
│       │   ├── cofounder-fit-questions.md
│       │   └── ef-antler-honest-guide/
│       │       └── index.md        # full in-repo article (page bundle)
│       ├── fintech/
│       └── philosophy/
├── static/
│   └── CNAME                       # kkonrad.com
├── themes/
│   └── PaperMod/                   # git submodule
└── .github/workflows/deploy.yml    # Hugo build → GitHub Pages
```

## Local dev (when you want it)

```sh
# install Hugo extended (Windows)
winget install Hugo.Hugo.Extended

# clone with submodule
git clone --recurse-submodules <repo>
# or, in an existing clone:
git submodule update --init --recursive

# run dev server
hugo server -D     # http://localhost:1313, hot reload
```

To add a new article: `cd content/writing/<category>/`, create `<slug>.md` with frontmatter (`title`, `date`, `summary`, `tags`), write markdown, `git push`. The Action rebuilds in ~40s.
