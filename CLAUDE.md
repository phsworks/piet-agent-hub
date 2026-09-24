@AGENTS.md

# Piet's Brain — personal multi-agent assistant

## Context
Piet is a first-year HBO-ICT student (HvA), working as an AI developer, with several side projects. This is a personal, local-only platform where a central "brain" agent knows him, learns over time, and routes to specialized agents organized as a tree: School, Work, Projects (each with sub-agents). This is for Piet only — not a product. Keep it simple: no agent frameworks (no LangChain/CrewAI), direct Anthropic API calls with tool use.

## Stack
- Local-only app, runs on localhost (bind to 127.0.0.1). No user auth / login.
- Next.js 16 (App Router, TypeScript), Tailwind CSS v4, shadcn/ui
- Postgres + pgvector in Docker (image: `pgvector/pgvector`) via docker-compose, Drizzle ORM
- Google OAuth only as a one-time "Connect Google" button in Settings (Drive + Calendar scopes, offline access); store the refresh token in the local DB
- No separate file storage: uploads are processed locally and stored in Google Drive
- Anthropic API (model name in one config constant, default the latest Sonnet)
- Embeddings: local, via `@xenova/transformers` running `Xenova/all-MiniLM-L6-v2` (384-dim) — no external embedding API/key needed
- Scheduled jobs with node-cron while the app runs; on startup, catch up on missed syncs/briefings
- Secrets in `.env.local`, never committed
- Package manager: npm

## Core concepts
1. **Agents are data, not code.** Table `agents` (id, parent_id, name, branch, description, system_prompt, allowed_tools[], icon, position). The tree UI and routing both read from this table. Seed: Brain (root) → School (Deadlines, Study Coach, one agent per course), Work (Tasks, Notes), Projects (one agent per project).
2. **Central memory ("the brain").** Table `memories` (id, content, category, branch, source, embedding vector(384), created_at, updated_at). After every assistant reply, the Brain extracts durable facts and saves/updates them (dedupe via cosine similarity search before insert). Viewable/editable/deletable on a Memories page.
3. **Routing.** Messages go to the Brain by default; it answers itself or delegates to the best agent via a `delegate_to_agent` tool. Piet can also click an agent to chat with it directly. Agents get relevant context through `memory_search`.
4. **Tools (Anthropic tool use):** memory_search, memory_save, drive_search, drive_read, drive_upload, calendar_list_events, calendar_create_event, school_get_deadlines, delegate_to_agent. Each agent only gets its `allowed_tools`.
5. **Uploads.** Drag & drop anywhere → Brain classifies the file (branch + course/project) → uploads to Google Drive under `/PietBrain/<Branch>/<Subfolder>` → extracts text, summarizes, stores embeddings so Piet can ask questions about it later.
6. **Brightspace (school).** No scraping, no unofficial API. Ingest the Brightspace calendar via its iCal subscription URL (stored in Settings), sync every few hours into a `school_events` table. Design it so an email-forwarding ingest can be added later.
7. **Calendar.** Calendar page merging Google Calendar + school events. Agents can propose events; creating one requires Piet's confirmation in the UI.
8. **Proactive suggestions.** Daily briefing by the Brain (upcoming deadlines, open tasks, suggestions), shown on the home screen.

## UI
- Home = "constellation" view: the Brain as the glowing center node, branches radiating out, sub-agents as nodes on each branch (d3-force or react-force-graph-2d). Dark deep-purple theme, thin lines, subtle glow. Click a node → side panel chat with that agent.
- Other pages: Chat history, Memories, Calendar, Files/Uploads, Settings (Connect Google, iCal URL, agents editor).
- Responsive layout.

## How to work
- Propose the database schema and folder structure, and ask clarifying questions BEFORE writing code for each phase.
- Build in phases and stop after each phase so Piet can test:
  1. Next.js + docker-compose Postgres/pgvector + Drizzle setup, Brain chat with streaming + memory (save/search/extract) + Memories page
  2. Agents table, seed tree, delegation, constellation UI
  3. "Connect Google" in Settings, Drive tools + upload flow
  4. Brightspace iCal sync + Calendar page + Google Calendar tools
  5. Daily briefing (node-cron + catch-up on startup)
- Currently on Phase 1.

## Notes
- This project runs on Next.js 16, which differs from older Next.js versions in training data (e.g. Cache Components). See `@AGENTS.md` and `node_modules/next/dist/docs/` before assuming App Router behavior. Cache Components are NOT enabled in `next.config.ts`, so standard dynamic-by-default rendering applies.
