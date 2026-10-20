@AGENTS.md

# Piet's Brain: personal automation hub

## Context
Piet is an HBO-ICT student (HvA), working as an AI developer, with several side projects. This is a personal, single-user platform (not a product). Since 2026-10-20 it is an **automation hub with one assistant that thinks along**, not a multi-agent tree: it gathers deadlines and info from many places, sends reminders to his phone, and lets him save things and find them again. **The phone comes first** (Telegram bot). **Keep token use low:** ingest, reminders and search run without an LLM; the assistant only runs when Piet asks something. No agent frameworks: direct Anthropic SDK calls with tool use.

## Stack
- Next.js 16 (App Router, TS), Tailwind v4, shadcn/ui (Base UI). Runs as a launchd production build on 127.0.0.1:3210 (`npm run service update` after code changes) until the VPS move; after it `npm run deploy`. Tailscale for phone access to the web UI.
- Postgres + pgvector (Docker), Drizzle ORM. Local embeddings (`@huggingface/transformers`, all-MiniLM-L6-v2, 384-dim).
- Anthropic: `ASSISTANT_MODEL` (Haiku 5.5) by default, `DEEP_MODEL` (Sonnet 5.5) on request (`/diep`), `FAST_MODEL_NAME` (Haiku) for filing and summarizing files. All in `src/lib/config.ts`.
- Google OAuth (Drive + Calendar) via Settings; uploads are stored in Drive under /PietBrain/...
- Telegram Bot API over long polling (no public URL): `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env.local`.
- node-cron for jobs, with catch-up on startup. Secrets in `.env.local`. npm.

## Core concepts
1. **One assistant** (`src/lib/assistant/`): tools search, drive_search, read_document, list_deadlines, create_reminder, save_note. Short history (`ASSISTANT_HISTORY_MESSAGES`), plain-text answers in Dutch. No memory extraction after every reply: notes are saved only on request (`save_note`, or `/n` without AI).
2. **Telegram** (`src/lib/telegram/`): text → assistant; photo/document → file pipeline (caption = note) → message once it's filed; commands /n, /diep, /nieuw, /help. Only answers `TELEGRAM_CHAT_ID`.
3. **Files**: the `agents` table is now just the **folder tree** (School › Semester 3 › project, Work, ...). The worker classifies each file (Haiku), uploads it to Drive, extracts the text and embeds it.
4. **Calendar**: iCal feeds (iCloud timetable, later Brightspace) → `calendar_events`.
5. **Agenda = iCloud** (CalDAV; Google Calendar doesn't sync iCloud well for Piet), **tasks/reminders = TickTick** (its app sends notifications), **notes stay in the hub** (local embeddings). Notion dropped. The hub is the **coach** that plans and nudges; the apps are where Piet sees things.
6. **Hosting:** the hub moves to a small VPS (always online, independent of the Mac). So no Mac-only APIs (EventKit/Apple Reminders).

## Phases (pivot)
1. ✅ Slim down + Telegram bot + Haiku assistant (+ "back online" message)
2. 🧪 (built 2026-10-20, Piet testing) Agenda + taken: iCloud via CalDAV (`src/lib/icloud/`, app-specific password, ctag-skipping sync every 15 min, writes to "Coach"/"Sport") + **TickTick** Open API (`src/lib/ticktick/`, OAuth in Settings, read live with 60s cache; v1 has no habits/tags). Tools create_reminder/complete_task/create_event/move_event/delete_event; Telegram /t (chrono-node, no AI), /vandaag, /week, plus a persistent reply keyboard (`src/lib/telegram/keyboard.ts`: 📅 Vandaag, 🗓 Week, ➕ Taak, 📝 Notitie). Apple Reminders is NOT reachable via CalDAV (upgraded reminders).
3. 🧪 (built 2026-10-20, Piet testing) Coach (`src/lib/coach/`): `goals` table (times/week, optional duration → calendar planning, preferred day part, match words so existing events count) + `coach_prompts` (every message with buttons, unique dedup_key, doubles as routine log). Free-slot finder in code (`slots.ts`). `coachTick` every 10 min with time windows (morning 07:30–11:00 with 1 Haiku call, evening 21:00 no AI, Sunday 19:00 review with 1 Haiku call + "Alles inplannen"), nudges hourly (deadline ≤3 days without a Coach block, goal behind), max 2/day. Inline buttons handled in `src/lib/telegram/callbacks.ts`. /doelen, /coach aan|uit|nu, assistant tools set_goal/list_goals/remove_goal/find_free_time. Goals can have preferred `days` + `remind_at` (`routines.ts`: reminder on those days, max 1 tip/week on another free evening). Seeded: Hardlopen 2× morning, Gym 2× evening, Lezen 2× (ma/di, random 23:00–23:30).
4. ✅ (live 2026-10-20) VPS move: Hetzner CAX11 (Arm64), host piet-brain.tail4b403a.ts.net, public SSH closed + Tailscale (`tailscale serve` → https://piet-brain.<tailnet>.ts.net, no public ports). `Dockerfile` (node 24, full node_modules, embedding model baked in, pg_dump 17), `docker-compose.prod.yml`, `scripts/vps-setup.sh` (Docker/Tailscale/ufw/swap; `lock` closes public SSH), `npm run deploy` (rsync + compose build/up; creates `.env.production` on first run), `scripts/migrate-db.sh` (one-time cutover Mac → VPS, then `BACKGROUND_JOBS=off` in .env.local so dev doesn't run bot/jobs). Nightly backup to Drive /PietBrain/Backups (`src/lib/jobs/backup.ts`, only with BACKUP_TO_DRIVE=true, keeps 14).
5. Simple mobile web overview
Stop after each phase so Piet can test. Propose the schema and folder structure before writing code.

## Notes
- This project runs on Next.js 16, which differs from older Next.js versions in training data (e.g. Cache Components). See `@AGENTS.md` and `node_modules/next/dist/docs/` before assuming App Router behavior. Cache Components are NOT enabled in `next.config.ts`, so standard dynamic-by-default rendering applies.
