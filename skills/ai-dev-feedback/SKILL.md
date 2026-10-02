---
name: ai-dev-feedback
description: Give the user evidence-based feedback on how they develop with AI coding agents, from their own Claude Code and Codex logs and git history (fix requests repeated without a guess at the cause, the same instruction repeated across sessions, tests that check nothing, secrets pasted into chat), as a local HTML report with sources. Use when the user asks for feedback on their AI development habits, how to get better at working with AI agents, or says "ai-dev-feedback" / "AI 개발 피드백" / "내 AI 개발 습관 돌아봐줘".
---

# ai-dev-feedback

The CLI does all the analysis. Your job: ask what to look at, run it, relay its short summary. Never read the report HTML or the logs yourself; that wastes tokens and the report is written for the user to read.

`AF` below = `npx -y github:HwangSlater/ai-dev-feedback` (if the current repo is ai-dev-feedback itself, use `node bin/ai-dev-feedback.js`).

## 1. Scan (no AI, a few seconds)

Run `AF scan --json`. It returns:
- `backend`: `cli` | `api` | `codex` | `null` (null: no AI classification; only the secrets and test-check feedback can be shown — say so)
- `windows["7"|"30"]`: `sessions`, `prompts`, `tokens` (estimated tokens for AI classification), `unlabeled`
- `projects[]`: `name`, `prompts`, `last`, `git` (true when the folder is a git repository), most active first
- `last`: choices from the previous run, or null

## 2. Ask with AskUserQuestion

Write questions in the user's language. Put the short explanation in parentheses after each question, as below — the user should understand what each choice changes.

If `last` is not null, ask one question first: "Same as last time (<days> days)" (Recommended) vs "Choose again". Same → go to step 3 with `--yes` and no other flags.

Otherwise ask these at once:
1. Period: 30 days (Recommended) / 7 days. Descriptions: message count for that window.
2. Projects: All (Recommended) / Pick. If Pick, a follow-up multiSelect with the top 4 projects (the user can type others).
3. Read git history? (reads commits and test files to see things like whether tests check results; nothing leaves the machine): Yes (Recommended; list the git projects) / No — test and commit feedback is skipped.
4. Use AI for short-message classification? (an AI labels each of your messages — a fix request, a "why?", the same request again — and only short, masked snippets are sent): Yes (Recommended; ~N tokens from `windows[days].tokens`, only new messages next time) / No — the repeated-fix and repeated-request feedback is skipped. Skip this question if `backend` is null.
5. Anything you especially want to look at? (that feedback comes first): Let it decide (Recommended) / When I get stuck / How I check that work is done / How I hand work over / Rules and automatic checks.

## 3. Run

`AF --yes --days <7|30> [--project a,b] [--no-git] [--no-ai] [--focus stuck|verify|delegate|harness]`

Use a 10-minute timeout. The first run with AI over 30 days takes one to three minutes; later runs reuse the cache.

## 4. Reply

Relay the CLI's summary lines as they are and say the report opened in the browser (the path is in the output). Do not add your own judgement of the user's habits — the report carries the evidence and sources. If it failed, show the error line and suggest a longer period or `--no-ai`.
