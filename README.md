# kkonrad.com

Konrad Urban — co-founder of Peanut. Writing on onchain payments, fintech, and other things.

Source for [kkonrad.com](https://kkonrad.com/), built with [Hugo](https://gohugo.io/) and the [PaperMod](https://github.com/adityatelange/hugo-PaperMod) theme.

## Run locally

```sh
hugo server
```

Then open <http://localhost:1313>.

## Build

```sh
hugo
```

Output goes to `public/`.

## Layout

- `content/` — posts and pages (markdown)
- `static/` — files served as-is (CNAME, images, etc.)
- `themes/PaperMod/` — vendored theme (git submodule, see `.gitmodules`)
- `hugo.toml` — site config

## Customizing visuals

See [documentation.md](documentation.md) for a reference on how PaperMod handles design tokens, typography, the dark/light toggle, and where to put CSS overrides without modifying the theme.
