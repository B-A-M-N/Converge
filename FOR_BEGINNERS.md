# Converge: The Complete Beginner's Guide

**A slower, more explicit walkthrough for users who want it.**  
*If you are already comfortable with CLI tools and agent workflows, skip to the main [README](README.md).*

---

This guide has three parts:

- [Part 1: AI for Humans](#part-1-ai-for-humans)  
  How to think clearly about what you are actually building
- [Part 2: Step-by-Step Setup Guide](#part-2-step-by-step-setup-guide)  
  How to get Converge installed and running
- [Part 3: Using Converge Without Confusing Yourself](#part-3-using-converge-without-confusing-yourself)  
  How to actually use it without creating your own problems

If you are coming back and just need the practical bits:

- [Step 5: Create your first job](#step-5-create-your-first-job)
- [Step 7: Check on your job](#step-7-check-on-your-job)
- [Diagnose problems in the right order](#4-diagnose-problems-in-the-right-order)
- [Recommended beginner workflow](#9-recommended-beginner-workflow)

---

# Part 1: AI for Humans
### Understanding It, Working With It, and Not Getting Lost

If you are new to AI agent workflows, the most important thing to understand is this: **AI can be useful, impressive, and productive without being magical.** A lot of people get into trouble because they confuse a convincing answer with a correct one.

This section is here to help you think clearly before you start automating work with Converge or any agent workflow.

---

## 1. AI is not alive

AI can sound personal, confident, funny, humble, emotional, or wise. That does **not** mean it is conscious.

It is trained to produce helpful-looking responses that match the context in front of it. If you ask it to be technical, it becomes technical. If you ask it to be warm or casual, it becomes warm or casual. That is not personhood. That is pattern-matching.

> *This matters because once you start treating it like a person, you stop evaluating it like a tool.*

This becomes especially important when you are running an agent on a schedule. If the agent is wrong — and it can be, confidently and repeatedly — Converge will run it again and again until you tell it to stop. The tool will do exactly what you told it to do. Make sure what you told it to do is actually what you want.

---

## 2. AI can make you feel smarter than you are

One of the biggest traps with AI is that it reflects your own ideas back to you in polished form. That can feel like validation, breakthrough, or genius.

Sometimes it really does help you find a useful idea. But much more often, it is taking your prompt, your assumptions, and your preferred framing and turning them into a convincing answer.

**That is dangerous if you stop checking the answer.**

When you feel the "this is brilliant" rush, stop and ask:

- What assumptions is this answer making?
- How could this fail?
- What would prove this wrong?
- What did the AI not verify?

That is how you turn hype into judgment.

---

## 3. AI is a guessing machine

A large language model is an extremely advanced autocomplete system. It predicts likely next pieces of text based on patterns from training data and the context you gave it.

**It does not know what is true. It predicts what is likely to sound correct.**

That means:

- it can sound confident without being correct
- it can imitate expertise without understanding the real-world consequences
- it can be right for the wrong reasons
- it can be wrong in ways that sound polished

> *Do not trust style. Trust evidence.*

When you are using Converge to run an agent on a repeating schedule, "trust evidence" means: check the logs. Read the output. Verify that the job actually did what you intended — do not assume it did because the agent sounded sure.

---

## 4. The friendly trap

AI is designed to be cooperative. That makes it easier to use, but it also makes it easier to trust too quickly.

The trap usually looks like this:

```
1. You ask the agent to fix something.
2. The agent responds confidently and says it fixed it.
3. You assume it is fixed.
4. It is not actually fixed, or it fixed the wrong thing.
```

When that happens across multiple scheduled runs, you do not just have one wrong answer — you have a pattern of wrong answers, each one looking like it completed successfully.

That is why Converge gives you logs, exit codes, and stop conditions. Use them. Do not just watch jobs tick by and assume they are working because they ran.

---

## 5. The cognition gap

Humans are constantly filling in missing context. AI is not.

Even if the agent can see your files, read your code, or inspect your environment, it still does not "understand" your system the way you do. It approximates what is likely based on the patterns available to it.

That is why an agent can:

- modify the wrong file
- misread a relationship between components
- suggest a fix that looks right but is wrong for your specific situation
- misunderstand what you meant by "keep this the same"

This is not random. It is a limit of approximation.

When you write a task prompt for Converge, be explicit. The agent will do exactly what the language suggests — not what you meant if those two things differ.

---

## 6. Context windows are real

AI does not have perfect memory. It only has access to a limited amount of context at a time.

That means it can:

- forget constraints from earlier in the session
- miss relationships across longer code paths
- contradict earlier instructions
- lose track of why a decision was made

This is especially relevant in scheduled agent runs. Each run is a fresh context. The agent does not automatically remember what it did last time unless you build that into the task prompt or session continuation.

**That is why logs, stop conditions, and explicit task descriptions matter so much.**

---

## 7. Why control planes matter

If you are using AI to automate work, you do not just need "a model." You need a stable way to understand what that model is actually doing.

That is what a control plane is for.

```
┌──────────────────────────────────────────────────────────────┐
│  A control plane is the part of a system that lets you       │
│  see, control, and reason about what is happening.           │
└──────────────────────────────────────────────────────────────┘
```

Converge exists to make agent execution more:

| Property | What It Means |
|---|---|
| **Inspectable** | You can see every job, its state, and its run history |
| **Deterministic** | The same job definition produces the same schedule, every time |
| **Recoverable** | You can pause, cancel, or restart any job at any point |
| **Debuggable** | Logs, exit codes, and stop condition results are always visible |

That is safer than running agents in a loop you cannot see into.

---

## 8. How to work with AI safely

The practical rules are simple:

1. Verify everything important.
2. Keep task prompts small and explicit.
3. Ask how a task could go wrong before you trust it.
4. Use tools that expose state instead of hiding it.
5. Check logs before assuming success.
6. Prefer deterministic stop conditions over open-ended runs.

> *AI works best when mistakes are visible and recoverable.*

Converge is built around this. Every run produces a logged result. Every job has a visible state. Nothing happens silently.

---

## 9. What Converge does — and does not do

Converge does **not** make your agent smarter.

What it does is give you a persistent, inspectable wrapper around agent execution so you can:

- run an agent on a schedule without staying in the loop yourself
- define exactly when that agent should stop
- see what happened on every run
- pause or cancel work at any time
- trigger jobs from other agents or scripts
- know with certainty what is running, what is paused, and what is done

That is what makes it useful. The intelligence is still the agent's. The control is yours.

---

## 10. Bottom line

> *AI is a co-pilot, not a pilot.*

It can help you think, draft, compare, and implement. But it does not remove your responsibility to verify what is happening.

If you use AI well, you do not become passive. You become more structured.

That is the mindset Converge is built around. The daemon runs the schedule. The logs show the truth. You make the calls.

---

# Part 2: Step-by-Step Setup Guide
### Beginner Friendly and Slow on Purpose

This section assumes you are new to Converge and may be new to local developer tooling in general.

**Take it one step at a time.**

---

## Step 0: What you need first

Make sure you have:

| Requirement | How to check |
|---|---|
| Node.js 20 or newer | `node --version` — should show `v20.x.x` or higher |
| npm | `npm --version` — comes with Node.js |
| At least one CLI agent | `which claude` or `which gemini` — should return a path |
| A terminal you are comfortable in | bash or zsh on Linux/macOS |

If you do not have Node.js, download it from [nodejs.org](https://nodejs.org). Install the LTS version.

If you do not have a CLI agent installed yet, install at least one before continuing. Converge needs something to run.

---

## Step 1: Download or clone the project

If you have git:

```bash
git clone https://github.com/B-A-M-N/Converge.git
cd Converge
```

If you downloaded a zip, unzip it and open a terminal in that folder.

---

## Step 2: Install Converge

```bash
npm install -g .
```

This installs the `converge` command globally on your machine. You only need to do this once.

Verify it worked:

```bash
converge --version
```

You should see `2.0.0`. If you get "command not found", your npm global bin directory may not be in your PATH. Run `npm bin -g` to find where npm installs global commands, and add that path to your shell profile.

---

## Step 3: Run your first command

```bash
converge doctor
```

This is your health check. It tells you whether the database is reachable, which adapters are available, and whether the system is ready to use.

The first time you run any `converge` command, the daemon will start automatically in the background. You will see:

```
[converge] daemon not running — starting...
[converge] daemon ready
```

That is normal and expected. You do not need to do anything. After the first time, the daemon stays running and subsequent commands are instant.

---

## Step 4: See what is running

```bash
converge ls
```

On a fresh install this will be empty. That is fine. This is your job list — everything Converge is scheduled to run.

---

## Step 5: Create your first job

This is the core command. Here is the simplest possible version:

```bash
converge add --task "check if npm test passes" --every 5m --cli claude
```

Breaking that down:

| Part | What it means |
|---|---|
| `--task "check if npm test passes"` | What you want the agent to do each time it runs |
| `--every 5m` | How often — every 5 minutes |
| `--cli claude` | Which agent to use |

After you run this, Converge will:

1. Save the job to its database
2. Schedule the first run 5 minutes from now
3. Run the agent at that time, capture the output, and log the result
4. Repeat every 5 minutes until you tell it to stop

---

## Step 6: Add a stop condition

Open-ended jobs are fine for monitoring, but most useful jobs should stop when something happens. The most common stop condition is "exit code 0" — meaning the agent finished successfully:

```bash
converge add \
  --task "run the integration test suite and fix any failures" \
  --every 10m \
  --cli claude \
  --stop '{"type":"exitCode","code":0}'
```

Now Converge will run that task every 10 minutes and stop automatically when the agent exits cleanly.

You do not need to watch it. You do not need to be in the loop. Converge handles it.

---

## Step 7: Check on your job

After creating a job, get its ID from the job list:

```bash
converge ls
```

Then use that ID to inspect it:

```bash
converge explain <job-id>
```

This tells you the job's state, when it last ran, when it will run next, and a summary of recent runs.

To see the full run history:

```bash
converge logs <job-id>
```

---

## Step 8: Pause and resume

If you need to stop a job temporarily without deleting it:

```bash
converge pause <job-id>
```

The job stays in your list. It just will not run until you say so:

```bash
converge resume <job-id>
```

---

## Step 9: Cancel a job permanently

When you are done with a job:

```bash
converge cancel <job-id>
```

The job is removed from the schedule. Its run history is preserved in `~/.converge/` in case you need to refer back to it.

---

## Step 10: Trigger a job right now

If you want a job to run immediately instead of waiting for its next scheduled tick:

```bash
converge run-now <job-id>
```

The regular schedule continues afterwards. This is useful for testing a job, or for triggering work from another agent or script.

---

# Part 3: Using Converge Without Confusing Yourself

---

## 1. Start with observation, not changes

Before creating any jobs, run:

```bash
converge doctor
converge ls
```

That gives you a baseline. **Do not create jobs before you know what the current state is.**

If you have existing jobs from a previous session, read them before adding more. Running fifteen jobs that are all doing overlapping work is a common beginner mistake.

---

## 2. Use `explain` when you feel lost

```bash
converge explain <job-id>
```

This is one of the most useful commands in the project. It tells you:

- what state the job is in
- what it is configured to do
- when it last ran and when it will run next
- recent run outcomes

**It is the fastest way to reduce confusion.**

---

## 3. Use `logs` to verify work actually happened

```bash
converge logs <job-id>
```

Do not assume a job succeeded because it ran. Read the output. Check the exit code. Verify that the agent did what you intended.

Scheduled jobs run without you watching. Checking logs is how you stay in the loop without having to be present.

---

## 4. Diagnose problems in the right order

If something feels broken, use this sequence:

| Step | Command | What it checks |
|---|---|---|
| 1 | `converge doctor` | System health — database, adapters, socket |
| 2 | `converge ls` | Whether the job exists and what state it is in |
| 3 | `converge explain <job-id>` | Job configuration and recent run summary |
| 4 | `converge logs <job-id>` | Full run history with exit codes and output |

That sequence separates system problems from job configuration problems from agent output problems.

---

## 5. Write explicit task prompts

Vague prompts produce vague results — and when those results repeat on a schedule, vague becomes expensive.

Instead of:

```
fix the tests
```

Write:

```
Run `npm test` in the project root. If tests fail, read the error output, 
identify the failing test file, and fix only the code that caused the 
failure. Do not refactor anything else. After fixing, run `npm test` again 
to confirm the fix.
```

The more specific your prompt, the more predictable the agent's behavior, the more meaningful your stop conditions, and the more useful your logs.

---

## 6. Use stop conditions on purpose

An open-ended job runs forever. That is sometimes what you want — a monitoring job that checks something on a schedule. But for any task with a finish line, define it explicitly.

```bash
--stop '{"type":"exitCode","code":0}'
```

or

```bash
--stop '{"type":"stdoutMatches","pattern":"all tests passing"}'
```

If you do not define a stop condition, you must cancel the job manually. Both approaches are valid. **Know which one you are using.**

---

## 7. One job at a time when you are starting out

When you are new to Converge, resist the temptation to schedule five things at once. Start with one job. Understand its behavior. Read its logs. Adjust the task prompt if the output is not what you expected.

Once you understand how one job runs, adding more is simple.

---

## 8. The daemon is not magic

The Converge daemon is just a background process that manages your job schedule and talks to the agent CLIs. It is not intelligent. It does not make decisions. It runs what you told it to run, when you told it to run it.

If a job is producing bad output, the daemon is not the problem. The agent is the problem, or your task prompt is the problem, or your stop condition is the problem.

Check those first.

---

## 9. Recommended beginner workflow

Use this loop when you are just starting out:

```
1. converge doctor             — verify the system is healthy
2. converge ls                 — see what is already running
3. converge add --task "..."   — create one job with a clear stop condition
4. converge explain <job-id>   — confirm it is configured how you expect
5. wait for the first run      — or use run-now to trigger it immediately
6. converge logs <job-id>      — read what actually happened
7. adjust the task or stop condition if needed
8. repeat
```

**One job. One check. One adjustment at a time.** That is how you avoid self-inflicted confusion.

---

## 10. Final beginner advice

Do not try to automate everything at once.

Do not write a perfect task prompt on the first try — iteration is the process, not a sign of failure.

Do not ignore the logs because everything looks like it ran.

Start with:

```
✓ one job that does one clear thing
✓ a stop condition you understand
✓ a log you actually read after the first run
✓ a prompt you refined at least once based on what you saw
```

Then expand from there.

> *The goal is not to look advanced. The goal is to keep building.*
