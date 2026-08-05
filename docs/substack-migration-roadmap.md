# Roadmap: make kkonrad.com the publication of record

Status: planned, not started
Owner: Konrad
Last updated: 2026-08-05

## Goal

Move the writing archive and publishing workflow away from Substack without breaking existing links, losing subscribers, or turning the site into a heavy publishing stack.

The desired end state is:

- `kkonrad.com` holds the complete, canonical copy of every essay.
- New essays are written once and published to the site first.
- Email is a distribution channel, not the permanent home of the content.
- Existing Substack readers and links continue to work during a staged transition.
- Search engines see substantive article pages, accurate metadata, and a small, intentional sitemap.
- The site keeps its current static, fast, low-maintenance character.

## Current problems to remove

- Sixteen article URLs on `kkonrad.com` are five-word, indexable stubs that meta-refresh to Substack.
- Those stubs return `200`, self-canonicalize, and emit `BlogPosting` schema even though the article body is not present.
- The site search index and sitemap include the thin stubs.
- All pages use the same generic social card.
- The homepage identifies Konrad as an `Organization` rather than a `Person` or `ProfilePage`.
- Utility and thin archive pages are eligible for indexing even when they offer little standalone value.
- The build-time Substack feed adds an external dependency and requires a daily rebuild to remain current.

## Principles

1. Preserve URLs before preserving tools.
2. Migrate content before migrating email delivery.
3. Keep one canonical copy of each essay.
4. Do not delete or redirect a working URL until its replacement has been tested.
5. Keep the Hugo site deployable even if the newsletter provider is unavailable.
6. Do not import subscribers into a new sender until consent, unsubscribe state, and suppression lists are preserved.

## Phase 0 — Inventory and backups

- [ ] Export all Substack posts, subscriber data, publication settings, and analytics available to the owner.
- [ ] Store the raw export outside the public repository; subscriber data must never enter Git.
- [ ] Generate an inventory with one row per post:
  - title
  - original Substack URL
  - intended kkonrad.com URL
  - publication and update dates
  - tags/section
  - subtitle/summary
  - hero and inline media
  - current inbound links, if known
  - migration status
- [ ] Record all current kkonrad.com stub URLs before changing front matter.
- [ ] Save a production crawl containing status, canonical, title, description, headings, schema type, word count, and sitemap membership.
- [ ] Export or screenshot current subscriber and post-level performance baselines.

Exit condition: every post, URL, image, and subscriber export is accounted for and backed up.

## Phase 1 — Make article content local

- [ ] Define the canonical Hugo article front matter:

```yaml
title: "..."
date: 2026-01-01
lastmod: 2026-01-01
description: "A useful, page-specific description."
summary: "One-sentence archive and social summary."
tags: [payments]
originalURL: "https://kkonrad.substack.com/p/..."
draft: false
```

- [ ] Convert exported posts to clean Markdown.
- [ ] Download first-party article images into the site and replace transient CDN URLs.
- [ ] Preserve captions, alt text, links, embeds, footnotes, and section headings.
- [ ] Put each full essay at its existing kkonrad.com stub path wherever possible.
- [ ] Remove `externalURL` and meta-refresh behavior after the full body is present.
- [ ] Run an editorial pass for malformed export HTML, duplicated subscribe prompts, and broken links.
- [ ] Add a visible “originally published” note only where it helps readers; do not make it the main page description.

Rollout order:

1. Migrate three representative essays: short, long, and image-heavy.
2. Verify rendering, metadata, search, RSS, and redirects.
3. Migrate the remaining high-value payment and fintech essays.
4. Migrate the long tail.

Exit condition: all selected essays render in full at kkonrad.com and no migrated page depends on Substack to be readable.

## Phase 2 — Canonicals and redirects

- [ ] Make each complete kkonrad.com essay self-canonical.
- [ ] Confirm Substack's current canonical/redirect capabilities before choosing the external-URL strategy.
- [ ] Where editable, add a short notice to the old Substack copy pointing readers to the canonical site article.
- [ ] Do not create redirect chains between old kkonrad.com paths, new kkonrad.com paths, and Substack.
- [ ] Keep a version-controlled redirect map for every URL that changes.
- [ ] Test HTTP status and final destination for all historical links.
- [ ] Leave the old Substack publication accessible until search traffic and subscriber delivery have stabilized.

Exit condition: every essay has one declared canonical URL and every historical site URL reaches useful content in one hop.

## Phase 3 — Replace Substack as an email sender

Choose an email provider only after the local archive is complete. Evaluate candidates on:

- subscriber and suppression-list import
- confirmed unsubscribe preservation
- custom sending domain
- SPF, DKIM, and DMARC support
- RSS-to-email or API-based sending
- Markdown/HTML template control
- double opt-in and privacy tooling
- exportability and API access
- pricing at the current and expected list size
- webhook support for local subscription forms

Implementation checklist:

- [ ] Set up a dedicated sending subdomain.
- [ ] Configure SPF, DKIM, DMARC, and reply handling.
- [ ] Import a small internal test segment first.
- [ ] Build an email template that links to the canonical site article rather than reproducing a second uncontrolled archive.
- [ ] Add a progressively enhanced subscribe form to kkonrad.com with a no-JavaScript fallback.
- [ ] Preserve source, consent date, unsubscribe state, and suppression status during subscriber migration.
- [ ] Send test campaigns to major inbox providers and check text, dark mode, link tracking, and accessibility.
- [ ] Announce the sending-domain change before the final cutover.
- [ ] Run at least one controlled parallel or test send before disabling Substack delivery.

Exit condition: new posts publish locally and reach the migrated list reliably from the new sender.

## Phase 4 — Discoverability cleanup

### Indexing and sitemap

- [ ] Remove all five-word redirect stubs by replacing them with full content or a real redirect.
- [ ] Exclude `/search/`, 404, empty categories, and thin tag archives from the sitemap and mark them `noindex` where appropriate.
- [ ] Keep substantive topic hubs indexable only when they include a useful introduction and enough content.
- [ ] Ensure sitemap `lastmod` changes when a local article is materially updated.
- [ ] Submit the cleaned sitemap to Google Search Console and Bing Webmaster Tools.

### Metadata and structured data

- [ ] Use `Person` plus `ProfilePage` structured data on the homepage.
- [ ] Populate `sameAs` with LinkedIn, Twitter, and the active newsletter profile.
- [ ] Use `BlogPosting` only for real article pages.
- [ ] Remove year-0001 publication dates from utility and standalone pages.
- [ ] Give every flagship article a specific title, description, and social image.
- [ ] Generate social cards from article title, section, and author rather than sharing the generic site card.

### Information architecture

- [ ] Keep exactly one descriptive H1 per page.
- [ ] Use H2 for writing categories and preserve heading order.
- [ ] Add “Start here,” related articles, and previous/next links based on subject rather than chronology alone.
- [ ] Add one-line summaries to archive and search results.
- [ ] Distinguish external destinations consistently.
- [ ] Update internal links so flagship essays reinforce the relevant topic hubs.

### Trust and maintenance

- [ ] Add `last reviewed` notices to time-sensitive articles.
- [ ] Add a prominent 2022-data notice and editorial update to the EF/Antler guide.
- [ ] Run a scheduled internal/external link check.
- [ ] Fix or remove broken citations before each migrated article ships.
- [ ] Keep claims and Peanut proof points linked to maintainable sources or note when they were last verified.

Exit condition: a crawl reports no indexable thin pages, invalid dates, self-canonical redirect stubs, duplicate H1s, or generic descriptions on flagship articles.

## Phase 5 — Remove the old integration

Only after the local archive and new sender are stable:

- [ ] Remove the homepage/writing-page Substack feed partial and shortcode.
- [ ] Remove the daily Substack-fetch step and cron-only rebuild if nothing else needs it.
- [ ] Remove `assets/substack.rss.xml` and `assets/substack.json` fallbacks.
- [ ] Remove the Apps Script dependency after confirming no other project uses it.
- [ ] Replace remaining “Read on Substack” links with local canonical URLs.
- [ ] Keep the raw migration export in secure private storage according to a defined retention policy.

## Validation checklist

Run before and after each phase:

- [ ] `hugo --gc --minify`
- [ ] Crawl every sitemap URL and alias.
- [ ] Check for broken internal links and unexpected external redirects.
- [ ] Validate canonical, robots, title, description, OG/Twitter metadata, and schema.
- [ ] Test RSS output and site search with migrated article body text.
- [ ] Visually inspect representative desktop, 390px, and 320px pages in light and dark mode.
- [ ] Run Lighthouse and an automated WCAG A/AA scan.
- [ ] Verify the old top landing pages in Search Console after deployment.
- [ ] Compare indexed-page count, clicks, impressions, and newsletter delivery against the Phase 0 baseline.

## Suggested success measures

- Zero indexable five-word article stubs.
- Every migrated essay has exactly one canonical URL.
- All historical kkonrad.com article URLs return useful content or one-hop redirects.
- Search can find terms from the full body of migrated essays.
- No material loss of newsletter subscribers during the sender migration.
- No sustained decline in organic clicks to migrated essays after the settling period.
- The homepage remains lightweight and usable without client-side JavaScript.

## Open decisions for Konrad

- Should emails contain the full essay or an excerpt linking to kkonrad.com?
- Which Substack posts belong in the permanent site archive, including travel notes?
- Should replies go to a personal address or a publication-specific inbox?
- Is the existing newsletter name retained after the move?
- Which three essays should be migrated first?
- How long should the old Substack publication remain active after cutover?
