# MTLE Reviewer

A daily study site for Marren's Medical Technologist Licensure Examination (PRC, March 2027). It asks one question at a time, explains every answer and every wrong option, and schedules each question to come back just before it would be forgotten, with the gaps getting shorter as the exam gets closer. It works on her iPhone in Safari and on a laptop. There's nothing to install.

- **Website:** plain HTML, CSS and JavaScript, served by GitHub Pages. No build step.
- **Data:** the questions are JSON files in `data/`. Her answers are saved in her browser. They're also copied to a private Google Sheet once the backend is set up.
- **Backend (optional, recommended):** a Google Apps Script web app (`apps-script/Code.gs`) that keeps the copy in the Sheet. This means Safari clearing the site's data, or a new phone, loses nothing.
- **Scheduling:** [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (MIT), copied into `vendor/`.
- **Font:** Atkinson Hyperlegible Next, self-hosted (SIL Open Font License).
- **Design:** the same "signage rules" as the Classes Hub and the other hubs.

Nothing private lives in this repository. The access code and her answers are only in Script properties and the Sheet.

## What's on the site

| Page | What it does |
|---|---|
| Diagnostic | Shown once, right after the access code is entered (and on Today until it's taken or skipped): 18 questions, 3 per subject, with explanations. The results show where she stands by subject and which topic to start with, and the 18 questions join her review schedule. |
| Today | The question of the day (2 questions fixed for the day), then today's session: reviews that are due plus up to 15 new questions, spread across subjects by exam weight. Also shows her progress bars (overall, weighted by exam share, and one per subject), a weekly goal (days, not a streak), and the road to exam day with the current phase. |
| Practice | Mixed practice (weakest first, missed, never seen, flagged), Learn a topic (one TOS topic at a time), Image drill (46 CDC parasite images, look-alikes mixed), Lab math (worked example, then a similar problem), and Mock exam. |
| Mock exam | Paper-style, like the MTLE: a question booklet plus a separate answer sheet with bubbles, timed at 1.2 minutes per question, with no feedback until it's handed in. Scored against the passing rule (75% weighted average, no subject below 50%). |
| Progress | Study phases to the exam date, a readiness check ("On track" or "Not yet"), mastery by subject and by TOS topic, answers per day for the last 2 weeks, her diagnostic result, and how often she's right when sure vs. not sure. |
| More | Settings (exam date, new questions per day, round size, weekly goal, break reminder, keyboard shortcuts), sync and backup, removing test answers, My questions (optional), flagged questions, two short exam-nerves exercises, how it works, credits. |

### How a question works

1. She picks an answer, then taps **Check · I'm sure** or **Check · Not sure**. On a laptop: A–D or 1–4, then S or N.
2. The result shows right under the question, with a shape and a word as well as colour: blue check = Correct, orange cross = Incorrect. Under each option is why it's right or why it's wrong.
3. The question is scheduled:
   - a miss comes back tomorrow;
   - a confident miss comes back within 2 days;
   - a right-but-unsure answer comes back sooner than a sure one;
   - no gap is longer than about 15% of the days left before the exam (at most 21 days);
   - in the last 2 weeks there are no new questions, only reviews.
4. "Mastered" means 2 correct answers in a row. For images it means 2 correct answers in under 10 seconds each.

The research behind each choice is summarized on the site under More > How it works, and in the research doc.

## Publish it (about 2 minutes)

1. In this repository: **Settings > Pages > Build and deployment > Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
2. After a minute the site is at **https://gregor-posadas.github.io/MTLE-Reviewer/**.
3. On her iPhone, open it in Safari. Optionally, use **Share > Add to Home Screen** for a one-tap shortcut.

The site works right away without the backend, but then her answers live only in that one browser. Safari deletes a site's stored data after 7 days without a visit, so set up the Sheet below. Until then, she can save a file from **More > Sync and backup > Download a backup file**.

## Set up the Sheet (about 10 minutes, once)

1. Create a new Google Sheet, for example "MTLE Reviewer data".
2. Open **Extensions > Apps Script**. Replace the contents of `Code.gs` with `apps-script/Code.gs` from this repository.
3. Open **Project Settings**, tick **Show "appsscript.json" manifest file in editor**, and replace that file's contents with `apps-script/appsscript.json`.
4. Back in the editor, choose `setup` in the function menu and click **Run**. Approve the permissions. The execution log prints the **access code** (for example `giemsa-4821`).
5. Click **Deploy > New deployment**, choose type **Web app**, then set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy** and copy the URL that ends in `/exec`.
6. Paste that URL into `assets/config.js` as `apiUrl`, then publish the change (see Publishing changes below).
7. Open the site on each device and enter the access code once.

### Updating the backend

When `apps-script/Code.gs` changes in this repository, paste the new version into the Apps Script editor, save, then **Deploy > Manage deployments > (pencil) Edit > Version: New version > Deploy**. The `/exec` URL stays the same, so the site needs no change. Run `setup` again only if a new tab is missing (it never touches existing data).

### Removing test answers

Open the site in the browser you tested with and go to **More > Sync and backup > Remove test answers**. That removes every answer made in that browser, here and in the Sheet, and the other devices drop them on their next sync. Deleting rows in the Sheet by hand isn't enough, because the devices keep their own copies.

### If "Anyone" is not offered

Some Google Workspace accounts only allow "Anyone within [organization]". Use a personal Gmail account for the Sheet instead.

### Script properties

| Property | What it is |
|---|---|
| `ACCESS_CODE` | The code the site asks for. Change it here to lock out old devices; each device then asks for the new one. |
| `SHEET_ID` | Set by `setup`. Leave it alone. |

### The Sheet's tabs

| Tab | What's in it |
|---|---|
| Reviews | One row per answer: id, question id, time (UTC), option chosen, right (1/0), sure (1/0), mode, time taken (ms), device. Rows are only ever added. |
| Flags | Questions she flagged. Set `status` to `fixed` after fixing one, and the site shows it as fixed. |
| MyQuestions | Her own questions, if she turns that on (More > My questions). They never go into the public repository. |
| Settings | Exam date, new questions per day and similar, so both devices agree. |
| Removed | Ids of answers removed with More > Remove test answers. The Sheet deletes those rows and won't accept them again, and other devices drop them on their next sync. |
| Log | Sync activity. |

## The questions

All questions are original, written for this site and mapped to the Board's Table of Specifications (Board of Medical Technology Res. No. 13, s. 2023). None are copied from reviewers, review centers, books or past-exam "recalls". The site marks them **"Unreviewed draft"** until a licensed RMT checks them.

Every item was drafted by an AI writer and then checked by a separate AI reviewer, which recomputed the math and checked the laws against the statute text. That review changed 3 items in the first batch and 6 in the second. Treat it as a first pass, not as RMT review.

The second batch was aimed at the subtopics with the fewest questions, so the bank now follows the Table of Specifications proportions at about 66 items per subject.

| File | Items |
|---|---|
| `data/questions/CC.json` | Clinical Chemistry, 68 (12 lab math) |
| `data/questions/MP.json` | Microbiology & Parasitology, 68 |
| `data/questions/CM.json` | Clinical Microscopy, 60 (5 lab math) |
| `data/questions/HE.json` | Hematology, 66 (9 lab math) |
| `data/questions/BB.json` | Blood Banking & Serology, 66 (4 lab math) |
| `data/questions/HL.json` | Histopath, MT Laws & Ethics, 60 (2 lab math) |
| `data/images.json` + `data/morphology.json` | 46 CDC DPDx parasite images in 34 categories, plus identification notes. Image questions are built from these automatically. |
| `data/tos.json` | The TOS: 6 subjects × 100 items, every topic and subtopic. Taken from a text extraction of the PRC PDF; still `"verified": false` until someone checks it against the PDF by eye. |

That's 434 questions (388 written, 46 image) against a 600-item exam, enough for about 4 weeks of new questions at 15 a day. After that the daily session is reviews only until more questions are added.

### Adding or fixing a question

Each question looks like this (`answer` and the `whyNot` keys are 0-based option positions; options are shuffled on screen):

```json
{
  "id": "HE-0031", "tos": "HE-E.2", "type": "mcq", "difficulty": "moderate",
  "stem": "…", "options": ["…", "…", "…", "…"], "answer": 2,
  "why": "Why the answer is right, with the **key finding** in bold.",
  "whyNot": { "0": "…", "1": "…", "3": "…" },
  "ref": "Rodak's Hematology 7e, coagulation chapter"
}
```

- `type` is `mcq`, or `math` with a `worked` example (`{"problem", "steps": [], "result"}`) shown first in Lab math.
- Use a new id; never reuse one, because her history is keyed by id.
- To mark a file as checked by an RMT, add `"reviewed": true` at the top of that file.
- Run the tests, then publish.

## Files in this repository

| Path | What it is |
|---|---|
| `index.html` | The page shell |
| `assets/app.js` | Everything on screen: Today, sessions, practice, mock exam, progress, settings, sync |
| `assets/engine.js` | The study engine: scheduling, picking questions, progress. No page code, so the tests can run it. |
| `assets/store.js` | Saving on the device (IndexedDB, falling back to localStorage) |
| `assets/styles.css` | All styles. The top half is the shared hub stylesheet. |
| `assets/config.js` | `apiUrl` and the exam date |
| `apps-script/` | The optional Google Sheet backend |
| `data/` | The TOS, questions, images and morphology notes |
| `vendor/ts-fsrs.umd.js` | The FSRS scheduler (MIT, license beside it) |
| `fonts/` | Atkinson Hyperlegible Next and its license |
| `tests/` | Engine, data and backend tests |
| `scripts/stamp-version.sh` | Cache-busting version stamp |

## Publishing changes

Run from the repository root before each commit:

```sh
sh scripts/stamp-version.sh
```

Open copies of the site notice the new version and offer a reload.

## Tests

```sh
node --test tests/engine.test.js tests/backend.test.js
```

These check that the TOS adds up and every question is well formed. They also check the scheduling rules (gap caps, confident misses, image fluency, the last 2 weeks), today's question mix, merging two devices, and the Sheet backend (against a stand-in for Google's services).

## When PRC publishes the 2027 schedule

Expected around November 2026. Change `examDate` in `assets/config.js` and set `examDateConfirmed: true`, or change it on the site under **More > Settings** (it syncs to both devices).

## Credits and licenses

- **Parasite images:** [CDC DPDx](https://www.cdc.gov/dpdx/), public domain, loaded from CDC's site. Use does not imply endorsement by CDC.
- **Exam blueprint and laws:** PRC / Board of Medical Technology Res. No. 13, s. 2023; RA 5527 and related laws. Philippine government works have no copyright (RA 8293 Sec. 176).
- **ts-fsrs:** MIT License.
- **Atkinson Hyperlegible Next:** Braille Institute, SIL Open Font License.
