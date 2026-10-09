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
