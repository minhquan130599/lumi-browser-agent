# Lumi Hybrid Browser Agent v0.2.1 — P0 through P3

The extension now separates understanding, execution, and outcome verification. Existing Jev and chat provider configurations are preserved.

## v0.2.1: contextual YouTube music search fix

A spoken request like "bật bài lối nhỏ của đen vấu" on an **already open YouTube tab** is now recognized as a **search and play** task, even without saying "mở YouTube" again. Lumi uses the YouTube results URL (functionally equivalent to entering the search box and submitting) with the normalized query "lối nhỏ Đen Vâu". It distinguishes the song title "Lối Nhỏ" from the artist "Đen Vâu" (including the reported typo) before choosing a visible video.

The search path ignores unrelated channel/profile links and wrong-artist songs, attempts limited scrolling while results render and reports BLOCKED rather than choosing a random link. DONE requires the actual video title, the artist from the title/channel, and a playing media element. An unrelated DOM change never satisfies a playback command.

If the optional Chat AI Planner fails to return a plan, its error is retained in diagnostics as plannerFailure and a PLAN (fallback) trace entry. This distinguishes provider/timeout/model-format failures from action failures. The normal YouTube search fast path does not require the Planner or a Jev decision.

## P0 — deterministic media controls and independent verification

On a YouTube watch page, explicit commands such as "chuyển bài tiếp", "sang bài khác", "next song", "tạm dừng" or "tiếp tục phát" are routed to the YouTube site skill without first asking Jev. The skill reads the current video ID and playback state, clicks the visible player control (prefer trusted input) or uses the official next/previous keyboard shortcut when a trusted input session is available. It then checks the state again.

A next/previous task is DONE only when the video ID changes and the new video is playing. Pause/resume requires the requested playback state. If the page has not changed, Lumi reports BLOCKED instead of claiming success.

For other tasks, Jev's DONE is a proposal, not proof. A generic verifier checks that an actual browser action produced a visible change; API tasks also require evidence of a response/status on the page. This generic check is a conservative minimum, NOT a proof of every semantic goal. Unsupported or high-impact actions require user review.

## P1 — Chat AI Intent Planner, micro-goals, ReAct, session memory

The optional Hybrid Intent Planner (ON by default) reuses the configured Chat AI provider, model and API key. It asks the model for a strictly validated JSON plan with 1 to 3 short, verifiable subgoals. Jev receives only the active subgoal. Lumi cycles through observation, decision, action and outcome checks, advancing to the next micro-goal only after verification.

If a planned task is BLOCKED, at most one safe replan is attempted. If the Chat model is unavailable, unable to produce valid JSON or Chrome Built-in AI is unavailable, the extension falls back to the existing Jev route.

Task summaries are held in Chrome session storage per tab for up to six hours. Screenshots, raw page content and field values are not stored by the task-memory module. The short prior goal may contain information typed by the user, so avoid inserting secrets into prompts. Previous tasks provide context only; they are not treated as new instructions.

## P2 — observed-element tools and consented vision fallback

The browser execution layer supports explicit navigation, observed DOM click/fill/scroll and dedicated YouTube media controls. Model-proposed targets are never executed as scripts, arbitrary URLs or coordinates.

Vision fallback is OFF by default. If explicitly enabled in Jev Settings, Lumi may send a screenshot of the active tab to the configured Chat AI vision-capable model after Jev gets stuck. Screenshots may contain personal/private on-screen information and can leave your device if a remote model provider is selected. They are not persisted by Lumi. Returned action IDs must match currently observed safe DOM targets and reach a minimum confidence threshold. Built-in Chrome text-only AI does not act as an image-capable fallback here.

## P3 — reproducible regression benchmark

Run:

    npm run benchmark:agent

This executes 22 offline deterministic cases covering Vietnamese/English media commands, tab navigation, exact song titles, API response validation and false-DONE prevention. Use:

    npm run benchmark:agent -- --output docs/benchmarks/latest.json

Results are JSON and the command exits non-zero when any regression fixture fails. These are PURE deterministic-router/verifier measurements, not Jev/LLM model accuracy or real-world task-success statistics. Latency reported by this benchmark does not include browser rendering, network, model inference, or human verification.

For extension integration run:

    npm run check
    npm run e2e:hybrid
    npx tsx scripts/e2e-shared-helper.ts

The Playwright Chromium hybrid test uses mocked YouTube pages and a mock Jev server (not the public YouTube website). It verifies searching music, exact requested track, the P0 next-video ID transition, playback status and overlay cleanup. Set CHROMIUM_PATH when Chromium for Playwright is outside its default location.

For opt-in analysis of actual task diagnostics, save one or more JSON exports from the Side Panel into a JSON array file and run:

    npm run benchmark:traces -- --input docs/benchmarks/example-traces.json

An example dataset is included for demonstration. The trace analyzer prints aggregate statuses, verified completion coverage, step-0 DONE, provider calls, replans and latency p50/p95 without printing individual goals, URLs, prompts or page contents. You must still classify genuinely successful tasks manually; verified DONE is not equivalent to user satisfaction. Do not commit real user trace exports or screenshots to a public repository.

For production, measure verified completion, false DONE, replans, successful actions, model-call latency and user-confirmed correctness on live sites; do not advertise an offline fixture score as live performance.

## Installation

1. In the project directory, run npm install if dependencies are missing, then npm run check.
2. In chrome://extensions, Load unpacked from the dist directory. For an installed version, Reload and reopen the Side Panel.
3. Confirm extension version 0.2.1.
4. Configure Chat AI for planning, Jev/tev1 for DOM decisions, and optionally explicitly enable Vision fallback under Jev Settings.
5. Open any YouTube watch video and ask "chuyển bài tiếp". The diagnostics should show MEDIA_NEXT, zero Jev decisions, and actual verification of a changed video ID plus playback.

## Known limitations

This is a practical hybrid-agent implementation, not a universal computer-use system. Many websites have iframe/canvas, complex state, anti-bot protections or workflows whose semantic completion cannot be verified from DOM alone. Media control support is currently dedicated to YouTube watch pages. Vision depends on a separate image-capable model and explicit consent. Sensitive operations are constrained rather than silently executed. Live YouTube and actual third-party providers need further field testing before claiming accuracy or reliability.
