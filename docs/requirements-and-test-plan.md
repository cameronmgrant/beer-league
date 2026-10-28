# Beer Feed: Requirements, Test Plan and Data Model

*Draft v0.3 · October 28, 2026 · Personal portfolio project*

## 1. Purpose and scope

Beer Feed is an invite-only social feed where a small group of friends post a photo for each beer they drink. The app keeps one shared feed and counts beers per person per day, per month and per year. It is also a portfolio piece: it is built and tested the way a professional team would work, and a dedicated “How this is tested” section publishes the evidence (test plan, reports, performance baselines, defects found and fixed).

**In scope for v1:** invite-based sign-up, login, photo upload, shared feed, personal counts, leaderboard, deleting your own post, and the testing showcase page.

**Out of scope for v1:** likes, comments, notifications, public sign-up, mobile apps, and moderation tooling.

## 2. Assumptions and constraints

- Users are friends of legal drinking age. Sign-up needs an invite code and an age attestation.
- Stack: TypeScript end to end (Fastify, React with Vite, PostgreSQL with Drizzle, Vitest, Playwright, k6).
- Hosting budget is about $10 per month. Images live in S3-compatible storage.
- Soft target: v1 deployed around the end of 2026, with learning work continuing afterward.
- Available time: 5 to 10 hours per week.
- Development moves to GitHub Codespaces from the database phase onward, so PostgreSQL and Docker run on a standard Linux environment that matches CI.

## 3. Functional requirements

Each requirement has an ID so tests can be traced back to it.

- **FR-1 Sign-up.** A visitor with a valid, unused, unexpired invite code can create an account with a username, password and time zone. *Acceptance:* invalid, used or expired codes are rejected; duplicate usernames are rejected; passwords are stored hashed.
- **FR-2 Login.** A user can log in with username and password. *Acceptance:* valid credentials return a session token; invalid credentials return 401 without revealing which field was wrong; repeated failures are rate limited.
- **FR-3 Post a beer.** A logged-in user can upload one image (JPEG, PNG or WebP, max 5 MB) with an optional caption (max 140 characters) and the time it was drunk (defaulting to the photo’s EXIF “date taken” time, which the user can change; if the photo has none, the user must enter it). *Acceptance:* wrong file types and oversized files are rejected; a thumbnail is generated; the EXIF date, when present, pre-fills the time and stays visible even if the user changes it; a post with neither an EXIF date nor a manual time is rejected; the final time is validated against the counting rules in section 4; all metadata, including GPS location, is stripped from stored images and thumbnails; the daily count is updated in the same database transaction as the post.
- **FR-4 Feed.** All logged-in users see all posts, newest first, paged by cursor, 20 per page. *Acceptance:* no duplicates or gaps across pages even when new posts arrive or posts are deleted mid-scroll; posts are ordered by upload time, with the post id breaking ties; each post includes its author’s username and no password data is ever returned; deleted posts never appear.
- **FR-5 Personal counts.** A user can see their own count for today, this month and this year. *Acceptance:* totals follow the counting rules in section 4, and “today” resets at 5:00 am in the user’s time zone.
- **FR-6 Leaderboard.** A logged-in user can view everyone’s counts for day, month or year. *Acceptance:* ties share a rank and the next rank is skipped (counts of 5, 3, 3, 1 are ranked 1, 2, 2, 4); people with no posts in the period appear with a count of 0; results match the underlying posts.
- **FR-7 Delete.** A user can delete only their own posts. *Acceptance:* the post is soft-deleted, disappears from the feed, and the count for the post’s own day decreases by one; deleting the same post twice changes nothing (the second attempt is not found); deleting someone else’s post returns 403.
- **FR-8 Testing showcase.** A page viewable without login links to the test plan, latest reports, coverage, performance baselines and a write-up of defects found. *Acceptance:* the page is generated from the latest CI run, not edited by hand.
- **FR-9 Automation suite.** The repository contains an automation suite in the `automation/` folder that organizes the API, UI and performance tests as one framework. *Acceptance:* the suite has its own dependencies and a README explaining how to run it and how it is designed; tests are tagged so a smoke subset runs on every pull request, the full regression suite runs nightly, and a minimal read-only smoke subset runs against prod after each deploy; failed tests keep traces and screenshots; flaky tests follow a documented retry and quarantine policy; reports are published to GitHub Pages and feed the testing showcase page (FR-8).

## 4. Counting rules (proposed defaults)

1. Every post stores `consumed_at` (a UTC instant) and `local_date`, calculated at post time in the time zone where the photo was taken (see Photo time below), with each day starting at 5:00 am local time.
2. Day, month and year are all based on `local_date`, so a beer logged at 11:50 pm counts for that same day. The day starts at 5:00 am, so a beer at 4:59 am still counts for the previous day and one at 5:00 am starts a new day. The same cutoff applies to months and years, so a beer at 2:00 am on January 1 counts toward December 31.
3. Changing a user’s time zone affects future posts only. Existing `local_date` values never change.
4. Deleting a post decrements the count for its `local_date`. Deleted posts are soft-deleted and never counted.
5. `consumed_at` cannot be more than 5 minutes in the future (a tolerance for phone clock drift) and cannot be more than 7 days in the past, whether the time came from the photo or a manual edit.
6. Month and year totals are sums of daily counts over the `local_date` range.
7. Daylight saving changes (23-hour and 25-hour days) must not drop or double-count posts, and the 5:00 am day boundary must hold on those days.

**Photo time:** `consumed_at` defaults to the photo’s EXIF “date taken” time, which the user can change while the EXIF time stays visible. If the photo has no EXIF date, the user must enter a time, and the post is rejected without one. EXIF times carry no time zone, so the text is read using the file’s offset if it has one, otherwise the time zone worked out from the photo’s GPS location, otherwise the poster’s account time zone. The day is counted in the zone where the photo was taken: the photo’s GPS zone if there is one, otherwise the zone given by the EXIF offset, otherwise the poster’s account time zone. A manual time is counted in the same zone. The final time must pass rule 5.

## 5. Non-functional requirements

**Performance targets (starting hypotheses, to be revised after the first baseline):**

- Feed page: p95 under 500 ms with 50 concurrent users and 50,000 posts in the database.
- Stats and leaderboard: p95 under 300 ms under the same load.
- Upload: server-side processing p95 under 2 s for a 5 MB image.
- Error rate under 1% during load tests.

**Security:** hashed passwords (argon2 or bcrypt), HTTPS only, upload type and size validation, rate limiting on login and upload, no secrets in the repository.

**Privacy:** photos are visible only to logged-in members. Image URLs must not be guessable or publicly listable (signed URLs or an authenticated proxy), and all photo metadata, including GPS location, is removed from stored images and thumbnails. GPS coordinates are read only to work out the time zone and are never stored; only the zone name is kept.

**Reliability:** daily database backups, and the app restarts cleanly after a crash.

**Accessibility:** keyboard navigation for core flows and alt text on images.

## 6. Architecture and environments

A React single-page app calls a Fastify API, which uses PostgreSQL for data and an S3-compatible bucket for images. Thumbnails are generated on upload.

| Environment | Where it runs | Data | Used for |
| --- | --- | --- | --- |
| Dev | Docker Compose in GitHub Codespaces | Small seed fixtures | Day-to-day building |
| Test | Ephemeral Compose stack in GitHub Actions, one per pull request | Small seeded set | Unit, integration, API and E2E tests |
| Perf | Separate Compose stack with fixed CPU and memory limits | About 50,000 generated posts | Load, stress and spike tests |
| Prod | Small cloud host, managed Postgres, object storage | Real data | Friends using the app |

Shared CI runners and laptops produce noisy numbers, so performance results are reported as relative change (before and after a fix) rather than absolute capacity.

**Automation suite layout (inside the same repository)**

```text
beer-feed/
├── .github/workflows/   # CI pipelines
├── backend/             # API code, with unit and integration tests alongside
├── frontend/            # React app
├── automation/
│   ├── api/             # API tests and OpenAPI schema checks
│   ├── ui/              # Playwright tests, page objects, fixtures
│   ├── perf/            # k6 scripts and recorded baselines
│   ├── support/         # test data factories, auth helpers, seed and cleanup scripts
│   ├── config/          # per-environment settings
│   └── README.md        # how to run it and how it is designed
├── docs/
├── docker-compose.yml
└── README.md
```

The `automation/` folder has its own `package.json` so its dependencies stay separate from the app’s, and the suite can be run on its own. Framework features such as tagging, sharding, reporting, flaky-test quarantine and accessibility scans are added only when a real test needs them.

**CI schedule (proposed)**

| Trigger | What runs | Purpose |
| --- | --- | --- |
| Every pull request | Lint, unit and integration tests, plus the automation smoke subset | Fast feedback, and the required checks on main |
| Merge to main | Full API suite and E2E regression against the test environment | Confirm main is healthy |
| Nightly | Full regression across browsers, accessibility scans, and the report published to GitHub Pages | Catch slow regressions and keep the showcase current |
| Weekly | k6 load scenario in the perf environment, with results recorded | Track performance trends |
| After each deploy to prod | Minimal read-only smoke subset against prod | Confirm the release works |

## 7. Data model

```sql
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  time_zone     TEXT NOT NULL,            -- IANA name, e.g. 'Europe/London'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invites (
  code        TEXT PRIMARY KEY,
  created_by  BIGINT REFERENCES users(id),   -- null when an admin script created the invite
  used_by     BIGINT REFERENCES users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE TABLE beer_posts (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id),
  image_key    TEXT NOT NULL,
  thumb_key    TEXT NOT NULL,
  caption      TEXT CHECK (char_length(caption) <= 140),
  consumed_at  TIMESTAMPTZ NOT NULL,
  time_source  TEXT NOT NULL CHECK (time_source IN ('exif', 'manual')),
  time_zone    TEXT NOT NULL,            -- zone the day was counted in, e.g. 'Asia/Tokyo' or 'UTC+09:00'
  local_date   DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

CREATE TABLE daily_counts (
  user_id     BIGINT NOT NULL REFERENCES users(id),
  local_date  DATE NOT NULL,
  count       INT NOT NULL CHECK (count >= 0),
  PRIMARY KEY (user_id, local_date)
);

-- Feed: keyset pagination over live posts
CREATE INDEX beer_posts_feed_idx
  ON beer_posts (created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- Reconciliation and per-user queries
CREATE INDEX beer_posts_user_date_idx
  ON beer_posts (user_id, local_date);
```

**Design notes:**

- `daily_counts` is updated in the same transaction as every insert or soft delete, so reading a month or year is a small indexed sum instead of a scan over posts.
- A reconciliation test recomputes counts from `beer_posts` and compares them with `daily_counts`. Any mismatch is a defect. The check reads both tables in one snapshot, so it never raises a false alarm while posts are being made, and it only reports problems, never repairs them.
- Feed pagination uses the cursor `(created_at, id)`, not offsets, so pages stay stable and fast as data grows.

**Day boundary:** `local_date` is computed when a post is saved, as the date of `consumed_at` in the post’s time zone (the zone where the photo was taken, stored in time\_zone) after subtracting 5 hours, calculated by the application with `getLocalDate(consumed_at, time_zone)`. A post at 4:59 am therefore belongs to the previous day and one at 5:00 am starts a new day. The same cutoff drives the “today” totals shown in the app. Stored zones are place names such as Asia/Tokyo or fixed offsets such as UTC+09:00, so the day is always calculated by the application, never in SQL.

**Time source:** `consumed_at` defaults to the photo’s EXIF date and is replaced by the user’s manual time when they change it or when the photo has none, and `time_source` records which. `created_at` always stays the real upload time.

## 8. API outline

| Method and path | Purpose | Auth |
| --- | --- | --- |
| POST /auth/register | Create account with invite code | None |
| POST /auth/login | Obtain session token | None |
| GET /feed?cursor= | Next page of posts | Required |
| POST /beers | Upload image and create a post | Required |
| DELETE /beers/:id | Soft-delete own post | Required |
| GET /stats/me | Day, month and year counts | Required |
| GET /stats/leaderboard?period=day\|month\|year | Everyone’s counts | Required |
| GET /health | Liveness and readiness check | None |

The API publishes an OpenAPI specification, which the API tests validate responses against.

## 9. Test strategy

**Levels and tools**

- **Unit (Vitest):** counting logic, date and time zone handling, validation, cursor encoding.
- **Integration (Vitest with a real Postgres container):** database queries, transactions, the daily-count update.
- **API (Playwright API tests or Supertest, plus a Postman and Newman collection):** every endpoint for success, validation errors, authentication, authorization and rate limits; response schema checks against OpenAPI.
- **End to end (Playwright):** sign up, log in, upload, see the post in the feed, see counts change, delete.
- **Performance (k6):** see section 10.
- **Security basics:** dependency audit in CI, an OWASP ZAP baseline scan, upload abuse cases.
- **Automation suite:** the API, UI and performance tests above are organized as one framework in `automation/` (see section 6 and FR-9), with tagging, parallel runs, failure artifacts and published reports.

**Entry and exit criteria**

- A pull request merges only when lint, unit, integration and API tests pass.
- A release to prod requires a green E2E suite and no open critical or high defects.
- Coverage target: 80% on business logic, with 100% of the counting rules covered by named tests.

**Key counting test cases**

- Posts at 4:59 am and 5:00 am land on different days, while posts at 11:59 pm and 12:01 am land on the same day.
- Posts across a month boundary and across New Year land in the right month and year, including a 2:00 am post on the 1st counting toward the previous month or year.
- Two photos from different time zones taken at the same instant can get different `local_date` values.
- Changing time zone does not alter past counts.
- Deleting a post decrements the right day; deleting twice does not decrement twice.
- Daylight saving transition days are counted correctly.
- Two simultaneous uploads from one user produce the correct total.
- Reconciliation: counts always match the posts.

**Photo time and metadata**

- A photo with a past EXIF date pre-fills the time, and the post counts for that date, not the upload date.
- A photo with no EXIF date is rejected unless the user enters a time; once entered, it is recorded with `time_source` set to manual.
- An EXIF date more than 5 minutes in the future, or more than 7 days old, is rejected unless the user changes it to a valid time.
- EXIF times just before and just after 5:00 am in the photo’s zone land on different days.
- An EXIF time with no offset is read in the photo’s GPS zone when there is one, otherwise in the poster’s account zone, never the server’s.
- An EXIF time with an explicit offset fixes the exact moment, and the day is counted in the photo’s GPS zone when there is one, otherwise in the offset’s own zone.
- A user editing the suggested time produces a post with `time_source` set to manual.
- A photo containing GPS data has all metadata removed from the stored image and the thumbnail, checked by re-reading the stored files.
- The day is counted in the photo’s zone, not the account zone: a photo whose moment is January 15 in Tokyo and January 14 in New York counts for January 15 when its GPS zone is Tokyo.
- A manual time is counted in the photo’s GPS zone when there is one, otherwise in the zone from the EXIF offset, otherwise in the account zone.
- GPS coordinates of exactly 0, 0, or a failed location lookup, count as no location.

**Defect handling:** defects are GitHub Issues with severity and area labels, a reproduction, expected versus actual results, and a linked fix. The best ones become write-ups on the showcase page.

## 10. Performance test plan

- **Seed data:** about 50,000 posts across 12 months and 10 to 20 users, with realistic image sizes.
- **Load:** ramp to 50 concurrent users mixing feed reads (70%), stats (20%) and uploads (10%), held for 10 minutes.
- **Stress:** keep increasing load until error rate or latency breaks the targets, and record the breaking point and the bottleneck.
- **Spike:** sudden jump from 5 to 100 users, observing recovery.
- **Soak (optional):** 1 hour at moderate load to catch leaks.
- **Method:** run each scenario three times, compare medians, change one thing at a time, and record results in the repository.
- **Metrics:** p50, p95 and p99 latency, throughput, error rate, plus CPU, memory and database query time.

## 11. Milestones

1. Requirements, test plan and schema agreed; repository and CI skeleton running.
2. Auth, upload and feed working with unit and integration tests.
3. Counting logic complete and fully tested; frontend slice working.
4. Automation suite skeleton in CI with the API and E2E suites running in it; v1 deployed to prod.
5. Perf environment, baseline, one fixed bottleneck, and a before-and-after report.
6. Showcase page live; README, architecture diagram and write-ups finished.

## 12. Risks and open decisions

**Risks**

- Time zone and “what is a day” bugs. *Mitigation:* the rules in section 4 and boundary tests.
- Scope creep. *Mitigation:* freeze v1 scope and keep a backlog.
- Large images slowing the feed or exceeding storage. *Mitigation:* size limits, resizing, thumbnails, pagination.
- Noisy performance numbers. *Mitigation:* resource limits, repeated runs, relative reporting.
- Misuse if the app becomes public. *Mitigation:* stay invite-only until rate limiting, upload validation, reporting and age gating are in place.
- Over-engineering the automation suite before there are tests to justify it. *Mitigation:* add each framework feature only when a real test needs it.

**Open decisions**

- Is the 5:00 am day boundary fixed for everyone, or should it be configurable per user?
- Should the user be able to edit a post’s time after posting? Current proposal: no, delete and repost.
- Session mechanism: short-lived JWT with refresh, or server-side sessions?
- Hosting provider for the app and database, after checking current pricing.
- Future feature: users pick their current location at upload, and it becomes the default zone for their uploads until they change it.
