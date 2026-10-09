# Lumi Browser AI

Lumi Browser AI is a Chrome Manifest V3 extension with a dark companion-style **Side Panel**, chat about the active web page, multiple LLM providers, and an existing Jev-powered browser automation engine.

> **Prototype / early development.** TypeScript checking, unit tests and Vite build have been exercised in the workspace. Real Chrome, AI-provider, and end-to-end browser control scenarios still need validation. Remote mobile chat has **not** been implemented yet.

## Features

- Page Q&A (summarize or ask questions about the current HTTP/HTTPS tab).
- Model selection: **Chrome Built-in Prompt API** (no API key when available), **Gemini**, **OpenAI**, **Ollama**, **vLLM**.
- Jev automation inherited from [chy4pro/jev-for-chrome](https://github.com/chy4pro/jev-for-chrome): inspect interactive DOM elements, take actions in the active tab, show progress and stop a run.
- Side Panel companion UI, with chat and Jev agent modes.
- Jev decisions require a **separate Jev provider** (TypeSafe, OpenRouter or Cloudflare Workers AI) and a text helper for typing. Selecting Chrome Built-in AI does **not** make Jev operation free.

## Cài đặt trên Windows

Cần có:

- **Node.js 22.12+** (khuyên dùng Node.js 22 LTS hoặc bản mới hơn), npm.
- Google Chrome phiên bản có hỗ trợ Side Panel.
- API key hoặc local model tùy chế độ sử dụng. Chrome Built-in AI chỉ chạy khi thiết bị tương thích.

Mở **PowerShell** và chạy:

```powershell
cd E:\MCP\codexpro-main\Extensions\lumi-browser-agent
node --version
npm --version

npm ci
npm run typecheck
npm test
npm run build
```

Nếu tải source từ GitHub vào thư mục khác, hãy `cd` tới thư mục vừa clone thay vì dùng đường dẫn cố định trên.

Hoặc clone từ GitHub sau khi dự án được đẩy lên:

```powershell
git clone https://github.com/minhquan130599/lumi-browser-agent.git
cd lumi-browser-agent
npm ci
npm run build
```

**Cài Chrome:** Truy cập `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục `dist` (nơi chứa `manifest.json`). Bấm icon **Lumi Browser AI** để mở Side Panel. Khi sửa code: chạy lại `npm run build`, rồi bấm **Reload** của extension.

Không phải chạy server Node để dùng extension đã build. Chrome tự tải các tệp trong `dist`.

## Dùng tính năng Chat

1. Mở một trang `https://...` bất kỳ.
2. Mở Lumi Side Panel và chọn **Trò chuyện**.
3. Vào bánh răng **Cấu hình AI**, chọn provider:
   - **Chrome Built-in AI:** bấm **Kiểm tra Chrome AI**. Nếu báo unavailable, hãy dùng provider khác. Built-in AI có thể tải model vào máy; tính năng phụ thuộc phiên bản Chrome, bộ nhớ, phần cứng và ngôn ngữ được hỗ trợ. Adapter prototype ưu tiên cấu hình English nên chất lượng tiếng Việt chưa được bảo đảm.
   - **Gemini:** lấy Gemini API key từ Google AI Studio; chọn Gemini, nhập model, base URL và key.
   - **OpenAI:** nhập OpenAI API key và model.
   - **Ollama:** cài [Ollama](https://ollama.com/), sau đó chọn Ollama trong Settings.
   - **vLLM:** sử dụng API server tương thích OpenAI trên máy tính; điền model ID và base URL.

Ollama ví dụ:

```powershell
ollama pull qwen3:8b
ollama serve
```

Nếu Ollama đang chạy ở nền, bỏ qua lệnh `ollama serve`.

Trong Lumi: provider `Ollama`, base URL `http://127.0.0.1:11434/v1`, model `qwen3:8b`. Nếu trình duyệt báo CORS, cần cấu hình Ollama chấp nhận origin của Chrome extension và khởi động lại Ollama, không tắt bảo vệ trình duyệt.

> Page Q&A chỉ đọc nội dung trang hiện tại. Prototype trích xuất tối đa khoảng 16.000 ký tự. Nội dung trang gửi tới cloud AI nếu bạn chọn provider cloud. Không dùng để xử lý bí mật hoặc thông tin riêng tư nếu chưa kiểm tra cách dữ liệu được chia sẻ.

## Dùng Jev để thao tác trang

1. Mở trang web cần thao tác.
2. Vào bánh răng → **Cài đặt Jev / Text helper**.
3. Chọn và cấu hình **Jev provider**, ví dụ OpenRouter hoặc TypeSafe; sau đó cấu hình **Text helper** có hỗ trợ OpenAI-compatible API.
4. Quay lại Side Panel → tab **Agent Jev** → nhập mục tiêu rồi gửi.
5. Theo dõi tiến trình và bấm **Dừng Agent** nếu cần.

Bật quyền Chrome Debugger cho input được tin cậy nếu bạn đồng ý với quyền này. Repo Jev gốc hỗ trợ các thao tác DOM như click, điền, select, scroll; chưa hỗ trợ mọi iframe, shadow DOM hoặc canvas. Người dùng phải xác nhận những thao tác nhạy cảm trước khi chạy và luôn kiểm tra kết quả.

### Swagger UI và BLOCKED 0/30

Nếu Jev trả `BLOCKED` trước khi thao tác dù còn nút tương tác, Lumi sẽ yêu cầu đánh giá lại ít nhất một lần. Với **mục tiêu khớp rõ một endpoint GET** trên Swagger UI, nếu Jev tiếp tục BLOCKED ở bước đầu, Lumi chỉ được phép **mở nhóm endpoint GET trong giao diện**, không tự ý bấm `Try it out`, `Execute`, không thực hiện HTTP request hoặc thao tác endpoint POST/PUT/DELETE. Agent có thể tiếp tục xử lý các bước sau theo yêu cầu của người dùng. Chức năng này là fallback bảo thủ, không bảo đảm hoàn thành mọi tác vụ Swagger.

Khi xảy ra lỗi, ở Agent Jev hãy mở **Chẩn đoán DOM: Jev đang nhìn thấy gì?** → **Sao chép chẩn đoán**, sau đó kiểm tra provider, model và các nhãn phần tử mà extension đọc được.

## Local Jev (tev1 / SystemOne on Ollama): HTTP 403 and token-limit HTTP 400

If Lumi calls `http://<LAN-IP>:11434/v1/systemone` and shows **HTTP 403** while a command-line `curl` without `Origin` works, the Ollama server is probably rejecting Chrome's `Origin: chrome-extension://<extension-id>` header. Confirm it with `curl -i -H 'Origin: chrome-extension://<extension-id>' ...` and compare without the header.

**Fix this on the computer running Ollama**, not the computer merely displaying Lumi:

1. Go to `chrome://extensions`, enable Developer mode, copy Lumi's exact ID.
2. On the Ollama host, configure `OLLAMA_ORIGINS` to `chrome-extension://<extension-id>`. On Windows, use Environment Variables or PowerShell: `[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS","chrome-extension://<extension-id>","User")`.
3. Quit the current Ollama process completely and start it again (existing processes don't inherit new environment variables).
4. Reload Lumi and click **Test TypeSafe API** again. The local SystemOne endpoint does not need a placeholder API key when it accepts anonymous local requests.

If Ollama runs as a Linux systemd service, use `sudo systemctl edit ollama`, add `[Service]` and `Environment="OLLAMA_ORIGINS=chrome-extension://<extension-id>"`, then `sudo systemctl daemon-reload && sudo systemctl restart ollama`.

Avoid `OLLAMA_ORIGINS=*`: that would enable requests from arbitrary web origins. Allowing the precise extension origin is safer. Keep Ollama on a trusted LAN/firewall, especially if it does not require authentication.

**Protocol compatibility:** Local SystemOne requests use flat string choice descriptions, and only 2–26 candidates are permitted per choice. Lumi now sends at most **10 goal-relevant targets** per choice (fewer after a context-limit retry), preserves the original browser-element IDs, and keeps the relevant controls (e.g. `GET /v1/voices`) even when they are late in the page. One-target questions are omitted because the browser runtime already knows the only possible target. Official TypeSafe and OpenRouter requests are unchanged.

**HTTP 400 — prompt exceeds 2050 tokens:** the local model cannot accept the full page and verbose instructions. Lumi compresses page text, element summaries, recent actions and repeated rules for local SystemOne only. If it still receives a specific "prompt N has X tokens; expected 1–2050" HTTP 400, it retries with two progressively smaller contexts. Other HTTP 400 errors are not retried. If even the smallest context cannot fit, use a more specific goal or a model with a larger context. This does not increase the model's actual context limit.

**Local inference timing:** `tev1` can take longer on a cold start than a cloud decision API, so local SystemOne uses an abortable 45-second inference timeout without automatic network retries. Cloud Jev retains its shorter 12-second request timeout.

See [Ollama FAQ — allowing additional web origins](https://github.com/ollama/ollama/blob/main/docs/faq.mdx#how-can-i-allow-additional-web-origins-to-access-ollama).

## Jev speed diagnostics

The Jev agent now reports a timing breakdown in **Agent Jev → Hiệu năng**: total elapsed time, decision API time, DOM observation, text-helper time, browser-action time, wait time, request payload size, and number of decision calls. Use **Sao chép chẩn đoán** to share those counters without sharing provider credentials. The displayed values are measured on your own Chrome installation.

For faster interactive control, **cloud** Jev requests are limited to **12 seconds**, with at most one retry after 250 ms. **Local** SystemOne requests may take up to 45 seconds to allow for model cold starts and do not retry transient network errors. Pending requests are cancelled when you stop the agent; these limits prevent indefinite hangs but do not increase model inference speed. Standard direct provider calls outside agent mode retain the previous retry settings.

The default Step Delay for new installations is now 75 ms (previously 300 ms). For an existing installation, open **Jev Settings → Agent Runtime Parameters → Step Delay (ms)**, change to **50**, then click **Save All Settings**. Existing saved settings are not silently overwritten. The overlay with numbered badges can also be disabled if large pages feel slow; trusted input is recommended for reliable clicks.

### Reproducible local benchmark (no cloud credentials)

Run `npm run build`, then `npx playwright install chromium` if Playwright Chromium is missing, and `npx tsx scripts/benchmark-agent.ts`. The benchmark launches an isolated temporary Chromium profile and a local mock Jev server. It tests one click followed by a DONE decision, comparing step delays of 300 ms, 75 ms and 0 ms. It does **not** measure OpenRouter/TypeSafe network performance or the installed Waifu Agent. You may set `CHROMIUM_PATH` to an existing Chromium-for-testing executable to avoid downloading another copy.

For provider-specific latency, open **Jev Settings**, click **Test OpenRouter Decisions API** or **Test TypeSafe API**, and compare the elapsed time. Use the same task and time window. Direct TypeSafe may respond faster depending on route and load, but results vary.

## Commands

| Command | Công dụng |
|---|---|
| `npm ci` | Cài đúng dependency theo lockfile |
| `npm run typecheck` | Kiểm tra TypeScript |
| `npm test` | Chạy unit tests |
| `npm run build` | Build extension vào `dist/` |
| `npm run check` | Typecheck + tests + build |
| `npm run package` | Tạo gói từ build nếu script upstream tương thích |

## Điện thoại từ xa

Chưa được xây dựng. Hướng triển khai: **mobile PWA → Tailscale Serve (HTTPS riêng tư) → gateway trên PC → extension trên Chrome**. Cần xác thực phiên/thiết bị, ghi nhật ký và phê duyệt riêng trước khi cho phép điều khiển web từ xa. **Không** mở trực tiếp Chrome Debugger hay Ollama trên Internet.

## Bảo mật và trạng thái

- Repo này **không** bao gồm API key cá nhân, token, tệp `.env`, `node_modules` hoặc `dist`. Hãy giữ API key ở local, không commit lên Git.
- Phiên bản prototype đang lưu cấu hình provider trong Chrome local storage. Không dùng cho môi trường nhiều người dùng hoặc dữ liệu rất nhạy cảm trước khi bổ sung một nơi lưu bí mật được bảo vệ.
- Cần kiểm thử riêng Chrome Built-in AI, các provider thực, trải nghiệm extension trong Chrome và luồng Jev hoàn chỉnh.
- Vòng lặp Jev gốc cung cấp guard/verification cơ bản nhưng chưa bảo đảm an toàn cho mọi thao tác; cần approval gates cho tài khoản, thanh toán, xóa dữ liệu hoặc gửi dữ liệu.
- Có thể còn cảnh báo từ `npm audit`; rà soát trước khi phát hành công khai.

## Nguồn và giấy phép

Project dựa trên [Jev for Chrome](https://github.com/chy4pro/jev-for-chrome) của chy4pro (MIT). Giữ lại [LICENSE](LICENSE) và [README của upstream](README_UPSTREAM.md) để đảm bảo ghi nhận tác giả. Lumi Browser AI không liên kết chính thức với TypeSafe AI, Google, OpenAI hay tác giả upstream.
