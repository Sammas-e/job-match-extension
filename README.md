# Job Match – Resume Keyword Scorer (Chrome extension, MV3)

Shows how well a job posting matches your resume as a keyword match percentage, in a small
badge in the bottom-right corner of the job page. Click the badge to see matched keywords (green),
missing keywords (red, most frequent first) and a **Copy missing keywords** button.

Everything runs locally in your browser. Your resume is stored in `chrome.storage.local`. The
extension makes no network requests, and pdf.js and mammoth.js are bundled in `lib/vendor/`.

---

## Install

1. Open `chrome://extensions` in Chrome (or Edge or Brave).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `job-match-extension` folder (the one containing `manifest.json`).
4. The options page opens from the extension's **Details → Extension options**, or from the ⚙ in the popup.
   Upload your resume (PDF, DOCX or TXT) or paste it, check the extracted text, and save.
5. Open a job posting. **Refresh tabs that were already open**, because Chrome only injects content scripts
   into pages loaded after installation.

Pin the extension (puzzle icon → pin) to see the score on the toolbar icon as well.

## Supported sites

| Site | Hosts |
|---|---|
| LinkedIn Jobs | `*.linkedin.com` (job pages under `/jobs/`) |
| Indeed | `*.indeed.com` (incl. `ae.indeed.com`, `sa.indeed.com`, …) |
| Glassdoor | `.com`, `.co.uk`, `.ca`, `.co.in` |
| Bayt | `*.bayt.com` |
| GulfTalent | `*.gulftalent.com` |
| Naukrigulf | `*.naukrigulf.com` |

**Any other site:** open the popup and click **Enable on this site**. Chrome asks for permission for
that one site only. From then on Job Match runs there automatically and detects job postings by:

1. JSON-LD `JobPosting` structured data (used by most career sites and ATSs for Google Jobs), or
2. at least two job-ad headings such as *Responsibilities*, *Requirements*, *Qualifications*,
   *About the role* or *What you'll do* (Arabic headings are also recognised).

Turning the switch off for an opt-in site unregisters the script and removes the permission.
For the built-in sites, the switch disables or enables the badge per hostname.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save your resume and keyword lists locally |
| `activeTab` | Let the popup read the current tab's URL to show the site toggle |
| `scripting` | Run on sites *you* opt into from the popup (dynamic content-script registration) |
| host permissions | Only the six job sites above |
| optional host permissions | Requested one site at a time, only when you click **Enable on this site** |

## Project structure

```
job-match-extension/
├── manifest.json
├── background.js          service worker: synonyms, toolbar badge, opt-in site registration
├── config/selectors.js    ← per-site CSS selectors (edit when sites change)
├── content/
│   ├── content.js         finds the job description, scores it, watches for SPA navigation
│   └── badge.js           floating badge + panel in a Shadow DOM (light/dark)
├── lib/
│   ├── matcher.js         tokenising, stemming, synonyms, n-grams, weighting, score
│   ├── stopwords.js       English stopwords + job-ad boilerplate words
│   ├── skill-terms.js     high-weight vocabulary (skills, licences, degrees, tools)
│   ├── synonyms.json      ← editable synonym groups
│   ├── resume-parser.js   PDF/DOCX/TXT → text (ES module, options page)
│   └── vendor/            pdf.js 4.10.38, mammoth.js 1.8.0 (bundled, no CDN)
├── popup/                 score + per-site toggle
├── options/               resume upload/paste, always-count & ignore keywords
├── ui/common.css          shared light/dark tokens
├── icons/
└── tests/
    ├── matcher.test.js    unit tests for the scoring function
    ├── test.html          runs matcher.test.js in the browser
    ├── parser.html        PDF/DOCX/TXT extraction test (needs http, see below)
    ├── demo-job.html      try the badge on a mock job page (stubbed chrome API)
    └── fixtures/          sample resume as PDF, DOCX and TXT
```

## Updating site selectors

Job sites change their HTML often. When the badge stops appearing on one of them:

1. Open a job posting on that site, right-click the job description → **Inspect**.
2. Find an element that wraps the whole description and has a stable-looking id, `data-*`
   attribute or class. Avoid hashed classes like `css-1x9abc`; partial matches like
   `[class*="JobDetails_jobDescription"]` are fine.
3. Add the selector to the **top** of that site's `description` list in `config/selectors.js`
   (selectors are tried in order; the first one with ≥150 characters of text wins).
   Do the same for `title` if the panel header shows the wrong title.
4. On `chrome://extensions`, click the reload icon for Job Match, then refresh the job page.

To add a new built-in site, add an entry to `SITES` in `config/selectors.js` **and** add its URL
pattern to both `host_permissions` and `content_scripts[0].matches` in `manifest.json`. Or skip
that and use **Enable on this site** from the popup.

If a site's selectors match nothing, the generic JSON-LD and heading detectors are tried, so the
badge often keeps working while you fix the selectors.

## How the scoring works

Both texts go through the same pipeline (`lib/matcher.js`):

1. **Clean.** Lower-case, normalise quotes, `B.Sc` → `bsc`, `bachelor's` → `bachelor`.
2. **Segment.** Split on sentence and list punctuation (`. , ; : • ( )` and new lines). Phrases never
   cross these boundaries.
3. **Tokenise.** Keep words (including `c++` and `c#`), strip other punctuation, and note
   **acronyms** (2–5 capital letters like `DHA`, `BLS`; `UAE`/`KSA` etc. are excluded).
4. **Stem.** Light suffix stripping, so *therapies/therapy*, *licensed/license* and
   *managing/managed/manage* match.
5. **Synonyms.** Longest-match replacement with the canonical form from `lib/synonyms.json`
   (`MSK` → musculoskeletal, `rehab` → rehabilitation, `Dubai Health Authority` → DHA,
   `physical therapist` → physiotherapy).
6. **Stopwords.** English stopwords and job-ad boilerplate (*candidate, excellent, salary,
   responsibilities, years, …*) are removed, and they also break phrases.
7. **Terms.** Single words plus 2- and 3-word phrases from each run of remaining words.

**Which job-description terms count**

* Every remaining single word.
* A 2–3 word phrase only if it is in the skills vocabulary or a synonym canonical, is a
  **qualification** (contains *license, certification, degree, bachelor, registration…*, e.g.
  "DHA license", "BLS certification"), is acronym + word, or appears **at least twice**.
* Generic words inside a counted phrase aren't counted again ("manual" in "manual therapy"),
  but skill words and acronyms are ("DHA" in "DHA license"). A resume that has DHA but not the
  exact phrase still gets partial credit.

**Weights**

| Term type | Base weight |
|---|---|
| Skills vocabulary, synonym canonicals, acronyms, qualifications, your *Always count* list | 3 |
| Other repeated phrases | 2 |
| Other single words | 1 |

Each term's weight = base × (1 + log₂(occurrences in the job description)). A term mentioned 4 times
counts 3× as much as one mentioned once.

**Score**

```
score = Σ weight of job terms found in the resume / Σ weight of all job terms × 100
```

A term is "found" when the resume contains the same stemmed, synonym-normalised word sequence.
The badge is **red** below 40%, **amber** from 40% to 70%, and **green** above 70%.

**Your keyword lists (options page)**

* **Always count:** when one of these appears in a job description, it is counted with skill
  weight, even if it spans stopwords ("return to work"). If it isn't in the job description, it
  isn't counted.
* **Ignore:** removed from every job description. Any term containing it is removed too.

**Customising**

* Synonyms: edit `lib/synonyms.json`. The first entry in each group is the name shown on chips.
  Reload the extension afterwards.
* High-value vocabulary: edit `SKILLS` / `QUALIFICATION_MARKERS` in `lib/skill-terms.js`.
* Boilerplate words: edit `JD_NOISE` in `lib/stopwords.js`.

## Tests

**In the browser, with nothing installed:** open `tests/test.html` in Chrome (double-click it).
It runs the matcher unit tests and shows pass/fail.

**With Node 18+:**

```bash
node --test tests/
```

**Parser test (PDF/DOCX/TXT):** `tests/parser.html` imports ES modules, so it must be served over
http from the extension folder (any static server, e.g. `npx http-server`), not opened as a file.
It applies the same script policy as an MV3 extension page, so it would also catch
`eval`-related breakage in the vendored libraries.

**Badge demo:** serve the folder the same way and open `tests/demo-job.html`. It loads the real
content scripts with a stubbed `chrome` API and a sample resume, and has a button that simulates
single-page-app navigation to another job.

## Limitations

* Keyword matching, not semantic understanding. "Led a team of 5" won't match "leadership"
  unless you add a synonym.
* Scanned (image-only) PDFs have no text. Paste the resume text instead.
* LinkedIn, Indeed and Glassdoor change their markup frequently; see *Updating site selectors*.
