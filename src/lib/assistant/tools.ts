import type Anthropic from "@anthropic-ai/sdk";
import { desc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, fileChunks, files } from "@/lib/db/schema";
import { searchMemories, saveMemory } from "@/lib/memory/store";
import { searchFiles } from "@/lib/files/search";
import { extractText } from "@/lib/files/extract";
import { searchDrive, getDriveFile, downloadDriveFile } from "@/lib/google/drive";
import { GoogleNotConnectedError } from "@/lib/google/auth";
import { getEvent, listEvents } from "@/lib/calendar/feeds";
import { addDays, dayKey, timeKey, zonedDate, DAY_PATTERN, TIME_PATTERN } from "@/lib/dates";
import { completeTask, createTask, findList, listTasks } from "@/lib/ticktick/client";
import { TickTickNotConnectedError } from "@/lib/ticktick/auth";
import { createICloudEvent, deleteICloudEvent, moveICloudEvent } from "@/lib/icloud/caldav";
import { COACH_CALENDAR, SPORT_CALENDAR } from "@/lib/config";
import { describeGoal, isDayPart, progressLine, removeGoal, saveGoal, weekProgress } from "@/lib/coach/goals";
import { findSlots, formatSlot } from "@/lib/coach/slots";
import { getCoachPrefs, setCoachPrefs, type CoachPrefs } from "@/lib/coach/prefs";
import { isCoachPaused, setCoachPaused } from "@/lib/coach/prompts";
import { addFeedback } from "@/lib/feedback";
import { allProgress, findProject, progressDetail, progressSummary, projectDeadlines, projectProgress } from "@/lib/gitlab/progress";
import { GitLabNotConfiguredError } from "@/lib/gitlab/client";
import { findSchoolItem, isStatus, updateSchoolItem } from "@/lib/school/roadmap";
import { lastImport, portflowReport, reportText } from "@/lib/school/portflow";
import { focusLine, goalsLine, itemForAssistant, schoolPicture, themeLine } from "@/lib/school/priorities";
import { createDocument, DOCUMENT_FOLDERS, isDocumentFolder } from "@/lib/documents/create";

// Caps keep a single question cheap: a whole document is ~5k tokens at most.
const READ_MAX_CHARS = 20_000;
const PASSAGE_MAX_CHARS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Tasks without a date can pile up; the assistant only needs the first few.
const MAX_UNDATED_TASKS = 15;
const DEFAULT_EVENT_MINUTES = 60;

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search",
    description:
      "Search Piet's saved notes and the contents of his indexed files (school documents, feedback, notes, project code). Returns matching notes and passages with file name, folder, file id and Drive link. Use this first for 'where is…' and 'what did … say' questions.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, phrased like the content you expect." },
      },
      required: ["query"],
    },
  },
  {
    name: "drive_search",
    description:
      "Search all of Piet's Google Drive by file name and full text, for files that aren't indexed in search. Returns ids and links.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to search for." } },
      required: ["query"],
    },
  },
  {
    name: "read_document",
    description:
      "Read the text of one document: a file_id from search, or a Drive id from drive_search. Only read when the passages from search aren't enough to answer.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "list_deadlines",
    description:
      "Piet's agenda (iCloud calendars, school timetable and other feeds) plus his open TickTick tasks and GitLab deadlines (active milestones, his own open issues with a due date), from today on. Overdue tasks and issues are included. Times are local (Europe/Amsterdam). Events with an id can be moved or deleted.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days ahead (default 7, max 60)." },
      },
    },
  },
  {
    name: "create_reminder",
    description:
      "Add a task to Piet's TickTick, which notifies his phone. Use when he asks to be reminded or mentions something he must not forget. Without a time it's an all-day task with a reminder at 9:00.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short and actionable, in Dutch." },
        due_date: { type: "string", description: "YYYY-MM-DD, if there is a date." },
        due_time: { type: "string", description: "HH:mm, if there is a time." },
        list: { type: "string", description: "TickTick list name, e.g. School or Werk. Leave out for the inbox." },
        notes: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_task",
    description: "Tick off a TickTick task (task_id from list_deadlines).",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
    },
  },
  {
    name: "create_event",
    description: `Put something in Piet's iCloud calendar, e.g. a sport session or a block to work on a deadline. Sport goes in "${SPORT_CALENDAR}", other planning in "${COACH_CALENDAR}" (the default). Only plan things Piet asked for or agreed to; check list_deadlines first for clashes.`,
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "In Dutch." },
        date: { type: "string", description: "YYYY-MM-DD" },
        start_time: { type: "string", description: "HH:mm. Leave out for an all-day event." },
        end_time: { type: "string", description: `HH:mm. Default: ${DEFAULT_EVENT_MINUTES} minutes after the start.` },
        calendar: { type: "string", description: `"${COACH_CALENDAR}" (default), "${SPORT_CALENDAR}", or another of his calendars.` },
        location: { type: "string" },
        notes: { type: "string" },
      },
      required: ["title", "date"],
    },
  },
  {
    name: "move_event",
    description: "Move an event (event_id from list_deadlines) to another date and/or time; its duration stays the same.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        start_time: { type: "string", description: "HH:mm. Leave out to keep the current time." },
      },
      required: ["event_id", "date"],
    },
  },
  {
    name: "delete_event",
    description: "Delete an event (event_id from list_deadlines). Only when Piet explicitly asks for it.",
    input_schema: {
      type: "object",
      properties: { event_id: { type: "string" } },
      required: ["event_id"],
    },
  },
  {
    name: "project_progress",
    description:
      "Progress of Piet's GitLab projects (e.g. Kova, school projects), from synced data: commits (his own and the team's), merged MRs, closed issues, active milestones with done/total and deadline, his open issues. Without project: a one-line summary of every followed project.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name or part of it, e.g. Kova." },
        days: { type: "number", description: "Look-back window in days (default 7, max 90)." },
      },
    },
  },
  {
    name: "school_status",
    description:
      "Piet's school roadmap (HvA propedeuse semester 2: side quests and products per theme, which go into Portflow as evidence) and where he stands: status per item (todo, bezig, klaar, in_portflow), progress per theme, a focus suggestion computed from what's started, deadlines in his agenda/TickTick, GitLab activity and lagging themes, and what's done but not yet in Portflow. Use for 'waar moet ik aan werken voor school?', 'wat heb ik nog niet gedaan?', 'hoe sta ik ervoor?'. With item: any roadmap item in full: a side quest, product or assignment (text, linked products, learning outcomes with their criteria, knowledge articles, deadline, GitLab activity, evidence), a knowledge article (the HvA explanation, e.g. 'Abstractie in software'; use it for school-related tech questions) or a learning outcome with its criteria.",
    input_schema: {
      type: "object",
      properties: {
        item: { type: "string", description: "Title or part of it, e.g. retrospective, CI/CD." },
      },
    },
  },
  {
    name: "portflow_check",
    description:
      "What's in Piet's Portflow (from the screenshots of 'Mijn bewijs' he sent) and what's missing for the previous and current sprint: the sprint events (Retrospective, Sprint Review, coachingsreview, technical review), evidence per learning outcome (OR, PL, AA, MS) and per theme, pieces without a collection or goal, duplicates, missing feedback. Use for 'wat mist er in mijn Portflow?', 'hoe sta ik ervoor voor sprint 2?'. If there is no data or it's old, tell him to send /portflow with screenshots; for a Sprint Review or Retrospective draft point to /sprintreview and /retro.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "update_school_item",
    description:
      "Update Piet's progress on a roadmap side quest or product when he says he started, finished or submitted it ('retrospective is af', 'CI/CD staat in Portflow'). Status in_portflow means the evidence is in Portflow. Also stores an evidence link, a note, or match words (words in his GitLab commits/issues that mean he's working on this item).",
    input_schema: {
      type: "object",
      properties: {
        item: { type: "string", description: "Title or part of it." },
        status: { type: "string", enum: ["todo", "bezig", "klaar", "in_portflow"] },
        evidence_url: { type: "string", description: "Link to the evidence (repo file, MR, document)." },
        note: { type: "string" },
        match: { type: "array", items: { type: "string" }, description: "Replaces the GitLab match words." },
      },
      required: ["item"],
    },
  },
  {
    name: "list_goals",
    description: "Piet's goals and fixed routines (e.g. hardlopen 2× per week) with this week's progress.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "set_goal",
    description: `Create or update a goal/routine the coach keeps track of (same title = update). With duration_minutes the coach finds free time and suggests planning it in the calendar; without it Piet ticks it off in the evening check (e.g. "dagelijks 20 min Duolingo" can be either; ask if unclear). Sport goes in "${SPORT_CALENDAR}", the rest in "${COACH_CALENDAR}".`,
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, in Dutch, e.g. Hardlopen, Gym, Duolingo." },
        times_per_week: { type: "number", description: "1-7 (7 = daily)." },
        duration_minutes: { type: "number", description: "Length of a session, if it needs calendar time." },
        preferred: { type: "string", enum: ["morning", "afternoon", "evening", "any"] },
        calendar: { type: "string" },
        days: {
          type: "array",
          items: { type: "number" },
          description: "Preferred weekdays, 1 = Monday … 7 = Sunday (e.g. [1,2] for Monday and Tuesday).",
        },
        remind_at: {
          type: "string",
          description: "HH:mm. For routines without calendar time: a 'time for…?' message at this time on those days, plus an occasional tip on other free evenings.",
        },
        match: {
          type: "array",
          items: { type: "string" },
          description: "Extra words; calendar events containing one count as a session (e.g. workout, fitness for Gym).",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "remove_goal",
    description: "Stop tracking a goal/routine (by title). Only when Piet asks.",
    input_schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  },
  {
    name: "find_free_time",
    description: "Free slots in Piet's calendar for something of a given length, found by code (respects his events with a margin). Use before proposing when to plan something.",
    input_schema: {
      type: "object",
      properties: {
        duration_minutes: { type: "number" },
        from_date: { type: "string", description: "YYYY-MM-DD, default today." },
        days: { type: "number", description: "How many days to search (default 7)." },
        preferred: { type: "string", enum: ["morning", "afternoon", "evening", "any"] },
      },
      required: ["duration_minutes"],
    },
  },
  {
    name: "coach_settings",
    description:
      "Read or change how the coach behaves. Call without arguments to read. Use when Piet's feedback is about these: pause everything, fewer/no suggestions per day, no deadline nudges, no daily 'what do you want to work on' focus suggestion, no morning tech fact, no GitLab project nudges, no school/Portflow reminders, no Portflow screenshot reminders, days that must stay free of planning ('woensdag is Compagnon').",
    input_schema: {
      type: "object",
      properties: {
        paused: { type: "boolean", description: "true = no check-ins or suggestions at all." },
        max_nudges_per_day: { type: "number", description: "Deadline + goal suggestions per day (default 2, 0 = none)." },
        deadline_nudges: { type: "boolean" },
        focus_suggestion: { type: "boolean" },
        tech_fact: { type: "boolean" },
        project_nudges: { type: "boolean", description: "'No commits on Kova in 3 days and a milestone is coming, plan a block?'" },
        school_nudges: { type: "boolean", description: "School focus in the check-ins and 'done but not in Portflow yet' reminders." },
        portflow_reminders: { type: "boolean", description: "'Sprint ends soon, send a Portflow screenshot' reminders and Portflow in the weekly review." },
        no_plan_days: { type: "array", items: { type: "number" }, description: "ISO weekdays (1 = maandag … 7 = zondag) on which the coach never plans or suggests anything. Replaces the list; default [3] (woensdag, Compagnon)." },
      },
    },
  },
  {
    name: "log_feedback",
    description:
      "Save feedback about the hub itself (something that bothers Piet, a bug, a wish for how the bot or coach should work). Always call this for such feedback. If you already fixed it with another tool (e.g. coach_settings, set_goal), set applied=true and say what you changed in resolution; otherwise it is picked up in the next coding session.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The feedback in Piet's words, made self-contained (what happened, what he wants)." },
        applied: { type: "boolean" },
        resolution: { type: "string", description: "What you changed, if applied." },
      },
      required: ["text"],
    },
  },
  {
    name: "recent_files",
    description:
      "The files Piet sent or uploaded most recently and what happened to each (queued, processing, ready with its folder and link, or failed with the reason). Use when he asks whether his files arrived, what was processed, or says to stop processing: tell him exactly which files are done, still waiting or failed. Processing can't be cancelled.",
    input_schema: { type: "object", properties: { limit: { type: "number", description: "Default 10, max 30." } } },
  },
  {
    name: "create_document",
    description:
      "Write a document for Piet and save it as a Google Doc in /PietBrain/Gemaakt/<folder>: a plan van aanpak, reflection, onderbouwing, report, summary, letter, README, ... Use when he asks you to make or write something he'll keep, hand in or put in Portflow ('maak een reflectie op sprint 3', 'schrijf een plan van aanpak voor de API-opdracht'). It reads his notes and files and, with item, the roadmap assignment with its learning-outcome criteria. Pass in extra anything relevant you already know from the conversation. Takes about half a minute. Reply with the link, the folder, and how many [aanvullen] spots he still has to fill in.",
    input_schema: {
      type: "object",
      properties: {
        request: { type: "string", description: "What to write, in Piet's words plus anything he specified (length, audience, structure)." },
        title: { type: "string", description: "Short file title, e.g. 'Plan van aanpak API-opdracht'." },
        folder: { type: "string", enum: [...DOCUMENT_FOLDERS], description: "School for anything HvA, Werk for his job, Overig otherwise." },
        item: { type: "string", description: "Roadmap side quest or product it's for (title or part), if any." },
        extra: { type: "string", description: "Relevant facts from this conversation or earlier tool results." },
      },
      required: ["request", "title", "folder"],
    },
  },
  {
    name: "save_note",
    description:
      "Save a note or fact so Piet can find it later (e.g. 'onthoud dat…', a locker code, a decision, an idea). Similar existing notes are updated instead of duplicated.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The note as a standalone statement, in Piet's language." },
      },
      required: ["content"],
    },
  },
];

export const TOOL_LABELS: Record<string, string> = {
  search: "Zoeken…",
  drive_search: "Zoeken in Drive…",
  read_document: "Document lezen…",
  list_deadlines: "Agenda bekijken…",
  create_reminder: "Taak maken…",
  complete_task: "Afvinken…",
  create_event: "Inplannen…",
  move_event: "Verplaatsen…",
  delete_event: "Verwijderen…",
  save_note: "Opslaan…",
  list_goals: "Doelen bekijken…",
  set_goal: "Doel opslaan…",
  remove_goal: "Doel verwijderen…",
  find_free_time: "Vrije tijd zoeken…",
  coach_settings: "Coach instellen…",
  log_feedback: "Feedback noteren…",
  project_progress: "Projecten bekijken…",
  school_status: "Roadmap bekijken…",
  update_school_item: "Voortgang bijwerken…",
  portflow_check: "Portflow nakijken…",
  create_document: "Document schrijven…",
  recent_files: "Bestanden nakijken…",
};

export async function executeTool(name: string, input: Record<string, unknown>, source: string) {
  try {
    return await runTool(name, input, source);
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) {
      return { error: "Google Drive isn't connected. Piet can connect it in Settings." };
    }
    if (err instanceof TickTickNotConnectedError || err instanceof GitLabNotConfiguredError) return { error: err.message };
    console.error(`Tool ${name} failed`, err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function runTool(name: string, input: Record<string, unknown>, source: string) {
  switch (name) {
    case "search": {
      const query = String(input.query ?? "");
      const [notes, passages] = await Promise.all([
        searchMemories(query, 5),
        searchFiles(query, { limit: 6 }),
      ]);
      return {
        notes: notes.filter((n) => n.similarity > 0.3).map((n) => n.content),
        passages: passages.map((p) => ({
          file_id: p.fileId,
          file: p.path ? `${p.file} › ${p.path}` : p.file,
          folder: p.agent,
          link: p.driveUrl,
          text: p.content.slice(0, PASSAGE_MAX_CHARS),
        })),
      };
    }
    case "drive_search": {
      const results = await searchDrive(String(input.query ?? ""), 8);
      return { results: results.map((r) => ({ id: r.id, name: r.name, link: r.webViewLink, modified: r.modifiedTime })) };
    }
    case "read_document":
      return readDocument(String(input.id ?? ""));
    case "list_deadlines": {
      const days = Math.min(Math.max(Number(input.days) || 7, 1), 60);
      const now = new Date();
      const until = new Date(now.getTime() + days * 86_400_000);
      const today = dayKey(now);
      const lastDay = dayKey(until);
      const [events, tasks, gitlab] = await Promise.all([
        listEvents(now, until),
        // The agenda still answers when TickTick isn't connected.
        listTasks().catch((err: Error) => err),
        projectDeadlines(lastDay, today),
      ]);
      const taskList = tasks instanceof Error ? [] : tasks;
      const undated = taskList.filter((t) => !t.dueDay);
      return {
        today,
        events: events.map((e) => ({
          id: e.editable ? e.id : undefined,
          title: e.title,
          calendar: e.feed ?? undefined,
          start: e.allDay ? dayKey(new Date(e.startsAt)) : localStamp(new Date(e.startsAt)),
          end: e.allDay ? undefined : timeKey(new Date(e.endsAt)),
          all_day: e.allDay || undefined,
          recurring: e.recurring || undefined,
          location: e.location ?? undefined,
        })),
        tasks: taskList
          .filter((t) => t.dueDay && t.dueDay <= lastDay)
          .map((t) => ({
            id: t.id,
            title: t.title,
            list: t.list,
            due: t.dueTime ? `${t.dueDay} ${t.dueTime}` : t.dueDay,
            overdue: t.dueDay! < today || undefined,
            notes: t.notes?.slice(0, 200) ?? undefined,
          })),
        undated_tasks: undated.slice(0, MAX_UNDATED_TASKS).map((t) => ({ id: t.id, title: t.title, list: t.list })),
        more_undated: undated.length > MAX_UNDATED_TASKS ? undated.length - MAX_UNDATED_TASKS : undefined,
        tasks_error: tasks instanceof Error ? tasks.message : undefined,
        project_deadlines: gitlab.length
          ? gitlab.map((d) => ({ project: d.project, type: d.type, title: d.title, due: d.dueOn, overdue: d.dueOn < today || undefined }))
          : undefined,
      };
    }
    case "create_reminder": {
      const dueDay = input.due_date ? String(input.due_date) : null;
      const dueTime = input.due_time ? String(input.due_time) : null;
      if (dueDay && !DAY_PATTERN.test(dueDay)) return { error: "due_date must be YYYY-MM-DD" };
      if (dueTime && !TIME_PATTERN.test(dueTime)) return { error: "due_time must be HH:mm" };
      if (dueTime && !dueDay) return { error: "due_time needs a due_date" };
      let listId: string | null = null;
      if (input.list) {
        const list = await findList(String(input.list));
        if ("missing" in list) return { error: `No list "${input.list}". Lists: ${list.lists.map((l) => l.name).join(", ")}` };
        listId = list.id;
      }
      const task = await createTask({
        title: String(input.title ?? ""),
        notes: input.notes ? String(input.notes) : null,
        dueDay,
        dueTime,
        listId,
      });
      return { created: true, title: task.title, list: task.list, due: task.dueTime ? `${task.dueDay} ${task.dueTime}` : task.dueDay };
    }
    case "complete_task":
      await completeTask(String(input.task_id ?? ""));
      return { done: true };
    case "create_event": {
      const date = String(input.date ?? "");
      const startTime = input.start_time ? String(input.start_time) : null;
      const endTime = input.end_time ? String(input.end_time) : null;
      if (!DAY_PATTERN.test(date)) return { error: "date must be YYYY-MM-DD" };
      if ((startTime && !TIME_PATTERN.test(startTime)) || (endTime && !TIME_PATTERN.test(endTime))) {
        return { error: "times must be HH:mm" };
      }
      const start = zonedDate(date, startTime ?? "00:00");
      let end = endTime ? zonedDate(date, endTime) : new Date(start.getTime() + DEFAULT_EVENT_MINUTES * 60_000);
      if (end <= start) end = new Date(end.getTime() + 86_400_000); // ends after midnight
      const result = await createICloudEvent({
        calendar: input.calendar ? String(input.calendar) : COACH_CALENDAR,
        title: String(input.title ?? ""),
        start,
        end,
        allDayRange: startTime ? undefined : { first: date, afterLast: addDays(date, 1) },
        location: input.location ? String(input.location) : null,
        notes: input.notes ? String(input.notes) : null,
        alarmMinutes: startTime ? 15 : null,
      });
      return { created: true, calendar: result.calendar, when: startTime ? `${date} ${startTime}–${timeKey(end)}` : date };
    }
    case "move_event": {
      const date = String(input.date ?? "");
      const startTime = input.start_time ? String(input.start_time) : null;
      if (!DAY_PATTERN.test(date)) return { error: "date must be YYYY-MM-DD" };
      if (startTime && !TIME_PATTERN.test(startTime)) return { error: "start_time must be HH:mm" };
      const current = UUID.test(String(input.event_id)) ? await getEvent(String(input.event_id)) : null;
      if (!current) return { error: "No event with that id; call list_deadlines again." };
      const oldStart = new Date(current.startsAt);
      const duration = new Date(current.endsAt).getTime() - oldStart.getTime();
      const start = zonedDate(date, startTime ?? (current.allDay ? "00:00" : timeKey(oldStart)));
      const result = await moveICloudEvent(current.id, start, new Date(start.getTime() + duration));
      return { moved: true, title: result.title, to: current.allDay ? date : localStamp(start) };
    }
    case "delete_event": {
      const result = await deleteICloudEvent(String(input.event_id ?? ""));
      return { deleted: true, title: result.title, calendar: result.calendar };
    }
    case "project_progress": {
      const days = Math.min(Math.max(Number(input.days) || 7, 1), 90);
      if (!input.project) {
        const all = await allProgress(days);
        return all.length ? { projects: all.map(progressSummary) } : { error: "No GitLab projects followed yet; Piet picks them in Settings." };
      }
      const project = await findProject(String(input.project));
      if (!project) return { error: `No (single) followed project matches "${input.project}". Call without project to see them all.` };
      return { progress: progressDetail(await projectProgress(project, days)) };
    }
    case "school_status": {
      const picture = await schoolPicture();
      if (picture.tracked.length === 0) return { error: "The roadmap hasn't been synced yet." };
      if (input.item) {
        const { item, candidates } = await findSchoolItem(String(input.item), true);
        if (!item) return { error: `No single match for "${input.item}".`, candidates: candidates.map((c) => c.title) };
        return { item: itemForAssistant(item, picture) };
      }
      return {
        themes: picture.themes.map(themeLine),
        evidence_per_goal: goalsLine(picture),
        sprint: picture.sprint,
        team_issues_to_help_with: picture.help.map((i) => `${i.title} (${i.project})${i.url ? ` ${i.url}` : ""}`),
        focus: picture.focus.map(focusLine),
        done_not_in_portflow: picture.portflow.map((i) => i.title),
        items: picture.tracked.map((i) => `${i.title} (${i.kind === "product" ? "product" : "side quest"}, ${i.theme ?? "-"}): ${i.status}`),
      };
    }
    case "portflow_check": {
      const report = await portflowReport();
      const last = await lastImport();
      return { report: reportText(report), last_screenshot: last ? dayKey(last) : null };
    }
    case "update_school_item": {
      const { item, candidates } = await findSchoolItem(String(input.item ?? ""));
      if (!item) return { error: `No single match for "${input.item}".`, candidates: candidates.map((c) => c.title) };
      if (input.status !== undefined && !isStatus(input.status)) return { error: "status must be todo, bezig, klaar or in_portflow" };
      const updated = await updateSchoolItem(item.id, {
        status: isStatus(input.status) ? input.status : undefined,
        evidenceUrl: input.evidence_url === undefined ? undefined : String(input.evidence_url) || null,
        note: input.note === undefined ? undefined : String(input.note) || null,
        match: Array.isArray(input.match) ? input.match.map(String) : undefined,
      });
      return { updated: updated.title, status: updated.status, evidence_url: updated.evidenceUrl };
    }
    case "list_goals": {
      const progress = await weekProgress();
      return {
        goals: progress.map((p) => ({ setting: describeGoal(p.goal), this_week: progressLine(p), still_to_plan: p.remaining })),
      };
    }
    case "set_goal": {
      const times = input.times_per_week === undefined ? undefined : Math.round(Number(input.times_per_week));
      if (times !== undefined && !(times >= 1 && times <= 7)) return { error: "times_per_week must be 1-7" };
      const duration = input.duration_minutes === undefined ? undefined : Math.round(Number(input.duration_minutes)) || null;
      if (input.preferred !== undefined && !isDayPart(input.preferred)) return { error: "preferred must be morning, afternoon, evening or any" };
      const { goal, action } = await saveGoal({
        title: String(input.title ?? ""),
        timesPerWeek: times,
        durationMinutes: duration,
        preferred: isDayPart(input.preferred) ? input.preferred : undefined,
        calendar: input.calendar ? String(input.calendar) : undefined,
        match: Array.isArray(input.match) ? input.match.map(String) : undefined,
        days: Array.isArray(input.days) ? input.days.map(Number).filter((d) => d >= 1 && d <= 7) : undefined,
        remindAt: input.remind_at === undefined ? undefined : TIME_PATTERN.test(String(input.remind_at)) ? String(input.remind_at) : null,
      });
      return { saved: action, goal: describeGoal(goal) };
    }
    case "remove_goal": {
      const goal = await removeGoal(String(input.title ?? ""));
      return goal ? { removed: goal.title } : { error: "No goal with that title; see list_goals." };
    }
    case "find_free_time": {
      const fromDay = input.from_date ? String(input.from_date) : dayKey();
      if (!DAY_PATTERN.test(fromDay)) return { error: "from_date must be YYYY-MM-DD" };
      const slots = await findSlots({
        fromDay,
        days: Math.min(Math.max(Number(input.days) || 7, 1), 21),
        durationMinutes: Math.max(Number(input.duration_minutes) || DEFAULT_EVENT_MINUTES, 15),
        preferred: isDayPart(input.preferred) ? input.preferred : "any",
      });
      return { slots: slots.map((s) => ({ date: dayKey(new Date(s.start)), start: timeKey(new Date(s.start)), end: timeKey(new Date(s.end)), label: formatSlot(s) })) };
    }
    case "coach_settings": {
      if (typeof input.paused === "boolean") await setCoachPaused(input.paused);
      const changes: Partial<CoachPrefs> = {};
      if (input.max_nudges_per_day !== undefined) changes.maxNudgesPerDay = Math.max(0, Math.round(Number(input.max_nudges_per_day) || 0));
      if (typeof input.deadline_nudges === "boolean") changes.deadlineNudges = input.deadline_nudges;
      if (typeof input.focus_suggestion === "boolean") changes.focusSuggestion = input.focus_suggestion;
      if (typeof input.tech_fact === "boolean") changes.techFact = input.tech_fact;
      if (typeof input.project_nudges === "boolean") changes.projectNudges = input.project_nudges;
      if (typeof input.school_nudges === "boolean") changes.schoolNudges = input.school_nudges;
      if (typeof input.portflow_reminders === "boolean") changes.portflowReminders = input.portflow_reminders;
      if (Array.isArray(input.no_plan_days)) changes.noPlanDays = [...new Set(input.no_plan_days.map(Number).filter((d) => d >= 1 && d <= 7))];
      const prefs = Object.keys(changes).length ? await setCoachPrefs(changes) : await getCoachPrefs();
      return { paused: await isCoachPaused(), ...prefs };
    }
    case "log_feedback": {
      const text = String(input.text ?? "").trim();
      if (!text) return { error: "text is empty" };
      const row = await addFeedback({
        text,
        status: input.applied ? "applied" : "open",
        resolution: input.resolution ? String(input.resolution) : null,
        source,
      });
      return { saved: true, status: row.status };
    }
    case "recent_files": {
      const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 30);
      const rows = await db
        .select({ name: files.name, status: files.status, error: files.error, source: files.source, folder: agents.name, link: files.driveUrl, at: files.createdAt })
        .from(files)
        .leftJoin(agents, eq(agents.id, files.agentId))
        .where(ne(files.kind, "code"))
        .orderBy(desc(files.createdAt))
        .limit(limit);
      return {
        files: rows.map((r) => ({
          name: r.name,
          received: `${dayKey(r.at)} ${timeKey(r.at)}`,
          via: r.source,
          status: r.status,
          folder: r.folder,
          link: r.link,
          error: r.error,
        })),
      };
    }
    case "create_document": {
      const folder = isDocumentFolder(input.folder) ? input.folder : "Overig";
      return createDocument({
        request: String(input.request ?? ""),
        title: String(input.title ?? "Document").slice(0, 120),
        folder,
        item: input.item ? String(input.item) : null,
        extra: input.extra ? String(input.extra) : null,
      });
    }
    case "save_note": {
      const result = await saveMemory({ content: String(input.content ?? ""), category: "note", source });
      return { saved: true, action: result.action };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function readDocument(id: string) {
  // An id from search points at our own index; anything else is a Drive id.
  if (UUID.test(id)) {
    const [file] = await db
      .select({ name: files.name, kind: files.kind, driveFileId: files.driveFileId, driveUrl: files.driveUrl, folder: agents.name })
      .from(files)
      .leftJoin(agents, eq(agents.id, files.agentId))
      .where(eq(files.id, id));
    if (!file) return { error: "No file with that id." };
    // The indexed text is already here: no Drive download, and no second
    // (paid) image description for photos.
    const chunks = await db
      .select({ path: fileChunks.path, content: fileChunks.content })
      .from(fileChunks)
      .where(eq(fileChunks.fileId, id))
      .orderBy(fileChunks.chunkIndex);
    if (chunks.length > 0 || !file.driveFileId) {
      const text = chunks.map((c) => (c.path ? `--- ${c.path}\n${c.content}` : c.content)).join("\n\n");
      return { name: file.name, folder: file.folder, link: file.driveUrl, ...capped(text) };
    }
    id = file.driveFileId;
  }

  const meta = await getDriveFile(id);
  const download = await downloadDriveFile(meta);
  const text = download ? await extractText(download.buffer, download.name) : null;
  if (!text) return { name: meta.name, link: meta.webViewLink, text: null, note: "No readable text in this file." };
  return { name: meta.name, link: meta.webViewLink, ...capped(text) };
}

function localStamp(date: Date) {
  return `${dayKey(date)} ${timeKey(date)}`;
}

function capped(text: string) {
  return { text: text.slice(0, READ_MAX_CHARS), truncated: text.length > READ_MAX_CHARS || undefined };
}
