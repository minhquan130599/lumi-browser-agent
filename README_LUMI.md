# Lumi Browser AI (prototype)
Workspace: `E:\MCP\codexpro-main\Extensions\lumi-browser-agent`

Fork of [chy4pro/jev-for-chrome](https://github.com/chy4pro/jev-for-chrome), MIT. The original Jev action loop, Chrome Debugger/CDP executor, provider settings and tests remain.

## Added
- Side Panel React UI named Lumi, with chat/agent tabs, live task progress and stop control.
- Q&A about the active HTTP(S) tab by extracting visible-ish page text (16,000 character cap); it does not access passwords or inputs.
- Model choices: Chrome on-device Prompt API, OpenAI, Gemini OpenAI-compatible endpoint, Ollama, vLLM.
- Chrome built-in AI readiness probe and error messages when absent. This is a **chat model only**, not a replacement for Jev. Current Jev action mode still needs a configured Jev provider and the original text-helper service.
- Active Jev run is started using the original agent engine.
- Toolbar icon opens Chrome Side Panel.

## Setup
1. Install Node.js 22.12+ (prefer Node 22 LTS or newer) and Chrome desktop.
2. In this directory run `npm ci`, then `npm run typecheck`, `npm test`, `npm run build`.
3. Open `chrome://extensions`, enable Developer mode and select **Load unpacked**, choose the `dist` directory.
4. Click Lumi toolbar icon. For action mode, open settings (gear -> Jev config) and configure Jev + text helper.
5. For Q&A, choose your model. Ollama must run on the computer hosting Chrome. For Ollama, use `ollama serve` and `ollama pull qwen3:8b` (choose a supported model as appropriate). vLLM usually exposes the /v1 Chat Completions endpoint.

## Chrome built-in AI caveats
- Chrome Prompt API is available on supported Chrome versions, desktop OS/hardware and language configurations; the model may need downloading.
- The current adapter requests English input/output, because Vietnamese availability is not guaranteed. Vietnamese answers may be unreliable in Chrome Built-in AI mode. Use Gemini/OpenAI/Ollama/vLLM for Vietnamese production needs.
- Chrome built-in mode does not call cloud model APIs or require their API keys; local model download and resource requirements still apply.
- See https://developer.chrome.com/docs/ai/prompt-api

## Remote phone chat architecture (not implemented yet)
Recommended: a local Node/FastAPI Gateway with authenticated HTTPS via Tailscale Serve (tailnet only), a mobile-friendly PWA, and a WebSocket or long-poll link to a **persistent desktop extension client**.

Phone PWA -> Tailnet HTTPS -> localhost gateway -> Desktop extension -> authorized active tab -> model -> gateway -> phone.

Security: user login, per-device tokens, origin checks, message size limits, audit logs and explicit approval on the desktop before remote actions. Do **not** expose Chrome debugger, extension endpoints, or local Ollama directly to the public internet. Keep the gateway bound to 127.0.0.1 and let Tailscale Serve handle HTTPS access control. Remote chat can be enabled first; remote page actions should require local approval.

## Current implementation status
The repository was cloned and the Side Panel/UI and LLM adapters were added. Running the toolchain with Node.js 22 succeeded: TypeScript typecheck passed, Vite produced `dist/`, and all 88 existing unit tests passed. This does NOT prove the extension works end-to-end in a real Chrome installation or that the new chat providers and Chrome built-in AI run successfully on your machine. The npm audit reported one high-severity dependency finding that needs review. No phone gateway service has been deployed yet; remote access is an architecture plan, not a running feature.
