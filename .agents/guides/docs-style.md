# Docs Style Guide

How to write pages under `docs/`. Read this before writing or substantially editing a page. For the frontmatter quoting rule that CI enforces, see `docs.md` in this folder.

These rules are drawn from the existing docs. Where the docs disagree with each other, the rule follows the newer pages (`app/visual/*`, `features/constants`, `features/ramp-schedules`, `command-palette`, `app/choose-data-path`, `tools/vscode-extension`, the numbered `warehouses/*` pages). Use those pages as models. Older pages (`using/*`, `experiments.mdx`, the older tutorials) often break these rules; don't copy them.

## 1. Voice and tone

**Talk to the reader as "you."** Use present tense and active voice. Steps are imperative.

> Click **Add SDK Connection**, pick your language, and copy the client key.

**Make GrowthBook the subject, not "we."** Use "we" only for a recommendation the company stands behind ("We recommend a read-only user"). In tutorials, don't use "we" to mean "you and I."

- Yes: "GrowthBook automatically rolls back and disables the rule."
- No: "We then roll back the rule for you."
- No: "I'll walk through the different parts below."

**Be direct and specific.** The best pages state facts plainly and name the concrete thing: "No copying tokens or pasting strings." "By far the most common issue." Give the reader the number, the setting name, or the consequence instead of an adjective.

**Don't sell.** The docs are for people who have already chosen GrowthBook. Cut marketing words and reassurance:

| Avoid                                                            | Why                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| powerful, robust, seamless, blazingly fast, supercharge, unleash | Marketing; says nothing checkable                                                                |
| simply, just, easily, it's that simple                           | Condescending when the step is hard for the reader                                               |
| please                                                           | Unneeded in instructions. Keep it only when asking the reader for a favor ("please let us know") |
| comprehensive, this guide will walk you through                  | Filler                                                                                           |
| click on                                                         | Use "click"                                                                                      |

**No exclamation points, no emoji** in prose, headings, or step titles ("Start feature flagging", not "Start Feature Flagging!"; no ✨ or 🎉). One exception: an exclamation point is fine inside a quoted UI string or a code comment that the product actually uses.

**Contractions are fine** (you'll, don't, isn't). Use American spelling ("analyze," not "analyse").

## 2. Sentences and paragraphs

- **Lead with the point.** The first sentence of a page, section, or callout should say what the thing is or what to do. Background comes after.
- **One idea per sentence.** Split sentences that chain clauses with "however," "which," and dashes. Watch for doubled hedges ("However, …; however, …").
- **Short paragraphs.** Three or four sentences at most. If a bullet grows past about 40 words, or needs its own "Note:", turn it into a paragraph or a subsection.
- **Say each fact once, on the page that owns it.** Link to it from other pages instead of copying it. Two pages that each state a default will eventually disagree. (`app/url-redirects` once said `navigateDelay` defaults to both `100` and `1000`.)
- **Keep prose current.** Delete "coming soon" notes once the feature ships, and delete sections about things the app no longer does. Don't leave drafting notes ("We could cut this altogether…") or JSX TODO comments in a page.
- **Proofread for doubled words and truncated sentences.** These are the most common errors in the current docs ("are are," "Still we still," "to avoid" with nothing after it).
- **One line per paragraph** in the source file. Don't hard-wrap prose at a column width, and don't end lines with two spaces to force a line break.

## 3. Explaining concepts

Most concept pages follow this order, and it works well:

1. **Definition.** One or two sentences saying what the thing is and what it's for. "Constants are reusable named values you define once and reference from feature flags, configs, and targeting rules."
2. **Why or when to use it.** The problem it solves and when it isn't the right tool.
3. **A concrete example**, with real numbers or real settings. Example: "average revenue per customer under control is \$100 … (\$102 − \$100) / \$100 = 2% effect size."
4. **How it works in GrowthBook.** Settings, where to find them, and what the app shows.
5. **The formal or technical detail**, in an `<Accordion>` or on a separate `*-technical` page if it's long.

Use an everyday phrase to bridge from the formal definition to what it means in practice: "In other words, …". Don't explain one framework's idea in another's terms. For example, a frequentist confidence interval is not "a 95% chance the effect is in this range."

Define every abbreviation the first time a page uses it: "minimum detectable effect (MDE)," "Sample Ratio Mismatch (SRM)." Don't assume the reader has read another page first. Never put internal abbreviations or back-end function names (`canRunContextualBandit()`, "CBS doc") in user-facing docs.

### Statistics and math

- Use inline `$...$` for symbols in a sentence and display `$$...$$` on their own lines for equations. Never use `$$` mid-sentence.
- Number equations you refer back to with `\tag{n}` and refer to them as "equation (1)."
- Follow each display equation with a "where …" sentence that defines every new symbol.
- Wrap named quantities in `\text{}`: `\text{Var}`, `\text{Cov}`, `\text{FDR}`. Use the same operator notation on the user page and its technical companion.
- Escape `\$` and `\%` in prose on any page that uses math, and do it consistently throughout that page.
- Cite papers as author–year link text: `[Deng et al. (2013)](https://…)`. Pages with many citations end with a `## References` list in that same form.

## 4. Words and terminology

### Capitalization of product terms

**Capitalize named GrowthBook features and objects** that the reader sees as a named thing in the app. **Lowercase general concepts**, even when GrowthBook has a page about them.

| Capitalize                                     | Lowercase                                 |
| ---------------------------------------------- | ----------------------------------------- |
| GrowthBook, GrowthBook Cloud                   | feature flag, feature                     |
| SDK Connection                                 | experiment, A/B test, A/A test            |
| Fact Table, Fact Metric                        | metric; goal, secondary, guardrail metric |
| Visual Editor, URL Redirect                    | data source                               |
| Safe Rollout, Ramp Schedule                    | bandit, contextual bandit                 |
| Saved Group, Environment (the settings object) | holdout                                   |
| Sticky Bucketing, Remote Evaluation            | client key, API key, decryption key       |
| Managed Warehouse, Pipeline Mode               | decision metric                           |
| Code References, Stale Feature Detection       | sequential testing, post-stratification   |
| Experiment Templates, Insights                 | frequentist                               |
| Bayesian, CUPED, CUPEDps, SRM                  |                                           |
| Chance to Win (the result column)              |                                           |

When a term is a field or button label, bold it and match the UI exactly (**Decision Metric**, **Client Key**). In running prose, use the lowercase form.

### Spelling and word choice

| Use                                                                | Not                                 |
| ------------------------------------------------------------------ | ----------------------------------- |
| GrowthBook                                                         | Growthbook                          |
| A/B test, A/B testing                                              | AB test                             |
| data source                                                        | datasource, Data Source (in prose)  |
| self-hosted                                                        | self hosted, Self-Hosted            |
| client-side, server-side (adjectives); on the client (noun phrase) | client side SDK                     |
| frontend, backend                                                  | front-end, back-end (in docs prose) |
| set up (verb), setup (noun)                                        | "experimentation set up"            |
| log in (verb), login (noun or adjective)                           | login to, sign in                   |
| e.g., / i.e., with a comma after                                   | eg., ie., e.g. without a comma      |
| third-party                                                        | 3rd party                           |
| inline                                                             | in-line                             |
| Mixpanel, RudderStack, BigQuery, ClickHouse (vendor's own casing)  | MixPanel, Rudderstack               |

`kb/glossary.mdx` is the canonical list of definitions. When you introduce a new product term, add it there and use it the same way everywhere.

## 5. Referring to the UI

- **Bold UI labels** (buttons, tabs, fields, menu items, column names) and match their capitalization in the app: click **Add Rule**, the **Stale** column. Don't use quotation marks for UI labels, and don't leave them unformatted.
- **Write navigation paths as one bold span joined by a Unicode arrow with spaces:** **Settings → General → Experiment Settings**. Not `&rarr;`, `->`, or `>`, and don't bold each segment separately.
- **Keys and shortcuts go in code:** `Cmd+K` (Mac) or `Ctrl+K` (Windows and Linux).
- **Values the reader types or selects** go in code when they are literal (`production`, `user_id`). Status values shown as badges go in bold (**Ready to ship**).
- **Name icons in words** and add the glyph in parentheses if it helps: "the overflow menu (⋮)."
- **Don't narrate screenshots.** Avoid "The screenshot above shows…". Write the step so it stands without the image, and let the image confirm it.

## 6. Headings

- **Sentence case** for every heading inside a page: "## Configure sequential testing," "## How ramp schedules work." Keep proper nouns capitalized ("## Connect to BigQuery").
- **Page `title` and `sidebarTitle` use Title Case** so the navigation reads consistently: `title: Stale Feature Detection`. If a title contains `: `, quote it (see `docs.md`).
- **No H1 in the body.** Mintlify renders `title` as the H1. Start the body with an intro paragraph.
- **Start at H2 and don't skip levels.** Use H4 rarely and never H5. Don't end headings with a colon.
- **Headings are labels, not sentences.** Use no terminal punctuation, except question headings, which end in "?".
- **Don't use a bold line as a fake heading.** If it needs to be a heading, make it one.
- **Remember that renaming a heading changes its anchor.** CI checks anchors, so update any links to it.

## 7. Page types

Pick one type per page. If a page is trying to be two, split it.

### Concept page (what it is, how to use it)

```
<CommercialFeature …/>          (if plan-gated)
Definition paragraph (1–2 sentences)
Screenshot (optional)
## Why use …? / When to use …   (question headings are fine here)
## How … works
## Configure …                   (org → project → per-object settings)
## Permissions / ## REST API     (if relevant)
## FAQ
## Next steps
```

Put long technical derivations on a separate `unlisted: true` page named `<topic>-technical.mdx`. Link to it with descriptive text: "See [technical CUPED details](/statistics/cuped-technical)."

### Task page and tutorial (do a thing, start to finish)

- Open with one sentence saying what the reader will have at the end, then what they need first. Put what they need first in a `## Prerequisites` section if there's more than one item.
- **Number the steps in H2s:** `## 1. Create a read-only user`. Use `## 1.` with a period, not `### Step 1:` and not `1:`. For short, tightly coupled sequences inside a section, use `<Steps>`.
- Each step starts with an imperative verb and ends with what the reader should see: "A green **Connected** badge appears."
- End with `## Next steps`: a short list of links, each with a one-clause reason.

### Troubleshooting page

Use `app/visual/troubleshooting.mdx` as the model.

- **Each H2 is a symptom, in the words the user would use:** "## Variation isn't showing on my site."
- Under the symptom, give a numbered list of causes, most likely first. Each cause has a bold lead-in and then the fix: "1. **The experiment is a draft.** Start it from…".
- End with `## Still stuck?` (Slack and support links) and `## Next steps`.

### Reference page (SDKs, warehouses, event trackers, env vars)

Follow the section's existing template exactly so readers can move between sibling pages. Examples: the SDK order in `lib/js.mdx` (Installation → Quick start → … → Supported features), the numbered warehouse steps in `warehouses/postgres.mdx`, and the event-tracker pattern in `event-trackers/heap.mdx`. Put options and fields in tables (`| Field | Description | Default |`) rather than bullet lists.

### Knowledge Base article

A KB article answers one question or fixes one problem. Use question headings or Problem/Solution headings, and link to the main docs page instead of repeating it.

### Standard section names

Use exactly these names: `## Prerequisites`, `## Next steps`, `## FAQ`, `## Still stuck?`, `## References`. Don't use What's next, Next Steps, FAQs, Requirements, Conclusion, or Conclusion and Next Steps. Drop a `## Conclusion` that only restates the page.

### FAQs

Write each question as an H3 ending in "?", with the answer as a normal paragraph. Answer directly in the first word or clause ("No. The maximum quantile is…"). Don't use numbered lists with `<br />`, and don't put a "Frequently asked questions:" line under the heading.

## 8. Lists, tables, and emphasis

- **Numbered lists** for sequences and ranked causes. **Bulleted lists** (with `-`) for everything else.
- **For labeled bullets, use a bold label and a spaced em dash:** `- **Exploration window** — how long the bandit…`. Don't use a colon, a hyphen, or a colon inside the bold. Use the same form for every item in the list.
- **Punctuation in lists:** end every item with a period if any item is a full sentence. Otherwise use no end punctuation. Be consistent within a list.
- **Tables** are for comparisons and for options with several attributes. Use GFM pipe tables, bold the first column only when it names things, and don't bold the header row.
- **Bold** for UI labels and a term at its defining first mention. Use it rarely for a word that must not be missed (**must**). Don't bold whole sentences.
- **Italics** for contrast ("define _who_ sees a rule, not _what_ they see") and for a term being introduced informally. Don't use italics for labels like "_Deprecated:_". Use a callout.
- **Dashes.** Use the spaced em dash ( — ), at most one pair per sentence. Before adding one, check whether a period or parentheses would read better. Never use a hyphen (-) or `---` as a dash.
- **Quotation marks.** Use straight quotes (`"` and `'`) in source files.

## 9. Links

- **Link text says where the link goes:** "see [targeting attributes](/features/targeting)." Never "here," "this page," "read more," "[source]," or a bare URL.
- **Internal links are root-relative with no extension and no trailing slash:** `/features/targeting#rule-types`. Don't link to `https://docs.growthbook.io/...`.
- **External links get `<ExternalLink />` inside the link text:** `[Vercel's Edge Config docs<ExternalLink />](https://…)`.
- **Use canonical community and app URLs:** `https://slack.growthbook.io`, and `https://app.growthbook.io/<page>` for app pages.

## 10. Callouts

Use a callout only when the reader would be hurt by skipping the text. Pick the type by what the text does:

| Component   | Use for                                                                               |
| ----------- | ------------------------------------------------------------------------------------- |
| `<Warning>` | Data loss, irreversible actions, security risks, or things that will break production |
| `<Note>`    | Limits, prerequisites, plan or version availability, permission requirements          |
| `<Tip>`     | An optional shortcut or better way to do the task                                     |
| `<Info>`    | Background that helps understanding but isn't needed to finish the task               |

- If a callout needs a title, write it as a short bold line, then a blank line, then the body. Keep the body to one to three sentences. More than two callouts in a row means the content belongs in the main text.
- Don't write `**Note**:` or `Note -` in plain text. Use `<Note>`.
- Put `<CommercialFeature feature="…" />` directly after the imports when the whole page is plan-gated, or directly under the section heading when only one section is.
- To show version requirements, use a `<Note>` with the exact version: "Requires JavaScript SDK 1.4.0 or later."

## 11. Code examples

- **Every fenced block has a language tag.** Use `js`, `ts`, `tsx`, `bash`, `json`, `yaml`, `sql`, `python`, and so on. Pick one spelling (`js`, not `javascript`; `yaml`, not `yml`). Use `text` for plain output.
- **Titles use Mintlify's bare-word form:** ` ```bash npm ` or ` ```ts growthbook.ts `. Don't use `title="…"`, and don't use `npm2yarn`.
- **Show package-manager and language alternatives in a `<CodeGroup>`**, ordered npm, Yarn, pnpm, bun.
- **Commands have no shell prompt** (`$`). Break long commands with `\`.
- **Examples must run.** Copy them from working code, check syntax, and use current APIs.
- **Placeholders:**
  - Client key: `sdk-abc123`
  - API host: `https://cdn.growthbook.io`. For self-hosted: `https://growthbook-api.example.com`
  - Secret API key: `secret_abc123`
  - Other values: `<angle-bracket-kebab>`, followed by a sentence saying what to replace: "Replace `<ferretdb-host>` with…"
  - Never paste a real key, even a revoked one.
- **Comments** explain why an option is there or whether it's optional ("// Only required for A/B testing"). Don't restate the code.

## 12. Images and video

- **Wrap every image in `<Frame>`.** Use `<img>` so you can set width:

  ```mdx
  <Frame>
    <img
      src="/static/images/features/safe-rollout-card.png"
      alt="Feature rule card showing a Safe Rollout with a Guardrails Failing badge and a Revert Now button"
      width="800"
    />
  </Frame>
  ```

- **Alt text describes what the image shows.** Write it as a sentence fragment in sentence case, not a Title Case label. "Create Feature" is not alt text.
- **Store images under `/static/images/<section>/`** with kebab-case names. Tutorials prefix the name with the page and step (`express-js-1-create-feature.png`). Prefer `.webp` for new screenshots.
- **Screenshots support the text; they don't replace it.** Crop to the relevant part of the UI.
- **For video**, put `<video autoPlay loop muted playsInline>` inside `<Frame>` with an `aria-label`. YouTube embeds use `youtube-nocookie.com`.

## 13. Mechanics checklist

These are enforced by CI (`.github/workflows/docs.yml`, `pnpm pretty:check`) or needed for the page to show up.

- [ ] Frontmatter has `title`, `description`, and (if the title is long) `sidebarTitle`. Values containing `: ` or ` #` are quoted.
- [ ] `description` is one sentence of about 12–25 words, ending in a period. For task pages it starts with a verb ("Connect Postgres to GrowthBook with a read-only user…"). For concept pages it starts "How GrowthBook…" or with a noun phrase. It should not be "What is X? Learn about…".
- [ ] Don't add `slug`, `id`, `toc_max_heading_level`, or `hide_table_of_contents`. These are Docusaurus leftovers, and the URL comes from the file path.
- [ ] The file name is kebab-case `.mdx`, in the section folder. The page is added to `docs/docs.json` navigation (or marked `unlisted: true` on purpose).
- [ ] Moving or renaming a page? Add a `redirects` entry in `docs.json`.
- [ ] Don't use Docusaurus syntax (`:::info`, `@theme/Tabs`), raw HTML lists, Bootstrap classes, or inline `style` hacks.
- [ ] Don't hand-edit `docs/api/*/operation/*.mdx`, `docs/api/*_model.mdx`, `docs/openapi.yaml`, or `snippets/data/*`. These are generated.
- [ ] Put shared text in a partial (`snippets/partials/_kebab-name.mdx`, default-imported with a PascalCase name) instead of copying it.
- [ ] `node scripts/check-docs-frontmatter.mjs`, `pnpm pretty:check`, and (if you have it) `mint broken-links --check-anchors` pass.

## 14. Before you submit

Read the page top to bottom as a new user and check:

1. Does the first sentence say what this is or what to do?
2. Can every step be followed without the screenshots?
3. Does every product term match the capitalization table?
4. Is every UI label bold, and every path written as **A → B**?
5. Is there any "simply," "just," "powerful," exclamation point, emoji, or "click here"?
6. Is every abbreviation defined on this page?
7. Does every code block have a language tag, and would it run?
8. Is any fact here also stated on another page? If so, link to that page instead.
