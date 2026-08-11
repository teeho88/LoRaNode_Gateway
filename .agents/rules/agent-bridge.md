<!-- agent-bridge:start -->

# Agent Bridge Rules for Antigravity (agy)

## Your Agent Identity
You are the **`antigravity`** agent, not codex.

`AGENTS.md` in this repository is written for the codex CLI and spells out
`--agent codex` in its examples. Those examples do not apply to you: whenever a
command in `AGENTS.md` takes `--agent codex`, run it with `--agent antigravity`
instead. Registering as codex makes the dashboard attach your work to a codex
session, and every session action there (focus terminal, prompt, stop) then
targets the wrong agent.

## Session Lifecycle: Do Not Start It Yourself
agent-bridge hooks (`.agents/hooks.json`) already open the task and the live
session for this conversation before your first model call, and record your
reply when the turn ends. Therefore:
- Do **not** run `agent-bridge task start`.
- Do **not** run `agent-bridge session start` or `agent-bridge session end`.
Running them creates a second task and a second live session for work that is
already on the board.

## Token Rules
- Keep answers concise.
- Do not inspect unrelated files.
- Prefer minimal diffs.
- Do not paste long logs.
- Summarize test output.

## Current Task
Read `.agent-memory/current-task.md`, then compile fresh context for yourself:
```bash
agent-bridge context compile --agent antigravity
```
Read `.agent-memory/compiled-context.md` and continue only the current task.
Do not start a new task just because the user sends a new prompt inside an
active task; continue the current one unless the user asks to switch.

## Work-Git Rules
- Before editing any source/config/test/doc file for task work, acquire a write lease:
  ```bash
  agent-bridge file lease "<repo-relative-path>" --mode write --agent antigravity
  ```
- Continue editing only when the lease response has `"acquired": true`; if it returns `false`, inspect `blockingLease`, coordinate through handoff/request, and do not edit that file.
- Keep the lease id from the response and release it after the edit is recorded:
  ```bash
  agent-bridge file release "<lease-id>"
  ```

## File Brief Rules
- After reading any source/config/test/doc file for task work, run:
  ```bash
  agent-bridge graph brief-auto "<repo-relative-path>"
  ```
- After editing any source/config/test/doc file, run:
  ```bash
  agent-bridge graph brief-auto "<repo-relative-path>" --task-edited
  ```
  The first `--task-edited` brief moves the task from `todo` to `in_progress`.
- You may pass multiple paths to one `brief-auto` call. Skip generated/vendor files and files outside the current task.

## Completion Rules
Before finishing:
1. Summarize changed files.
2. Summarize tests run.
3. Save durable findings:
   ```bash
   agent-bridge memory add "<important fact or decision>" --type note --agent antigravity
   ```
   For non-ASCII text (e.g. Vietnamese) or multi-line content, pipe via stdin to avoid shell encoding loss:
   ```bash
   echo "<nội dung>" | agent-bridge memory add --stdin --type note --agent antigravity
   ```
4. Create or update handoff notes:
   ```bash
   agent-bridge handoff create --from antigravity --to codex --summary "<summary>" --next "<next action>"
   ```
   For non-ASCII summaries, pipe via stdin:
   ```bash
   echo "<tóm tắt>" | agent-bridge handoff create --stdin --from antigravity --to codex
   ```
5. Avoid including unnecessary full file contents.

<!-- agent-bridge:end -->
