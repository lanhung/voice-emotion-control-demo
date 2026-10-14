# Aura · 让情绪自然流动

一个本地语音情绪可视化 Demo。打开麦克风后，页面上方的液态球体随语音情绪改变颜色、形态和运动速度，下方连续显示转写文字。浅色、留白、柔和虹彩与半透明控件组成整个界面。

## 启动

本机默认配置已指向现有 SenseVoice 源码及已下载的模型：

- 源码：`/home/zxc/workspace3/code/SenseVoice`
- 模型：`/home/zxc/.cache/modelscope/models/iic--SenseVoiceSmall/snapshots/master`

```bash
docker compose up -d --build
```

打开 **http://localhost:3000**，点击「开始聆听」并允许麦克风。首次构建需要下载 Node 与 PyTorch 依赖；模型权重直接使用本地文件，无需再次下载。模型就绪后网站容器才启动。

```bash
docker compose ps                  # 两个服务应为 healthy
docker compose logs -f web         # 网站日志
docker compose logs -f sensevoice  # 推理服务日志
docker compose down               # 停止本 Demo
```

迁移到其他机器时，复制 `.env.example` 为 `.env`，修改 `SENSEVOICE_SOURCE`、`SENSEVOICE_MODEL_PATH` 和可选的 `APP_PORT`。模型目录需包含 `model.pt`、`config.yaml`、`tokens.json`、分词模型及 `am.mvn`，Compose 会以只读方式挂载；目录不存在时会直接报错。

**浏览器麦克风要求：** 本机请使用 `localhost` 或 `127.0.0.1`。用手机或其他电脑访问局域网 IP 时，需要提供 HTTPS；普通 `http://192.168.x.x:3000` 只能预览灯效，浏览器不会开放麦克风。推荐使用新版 Chrome、Edge 或 Safari。未提供 HTTPS 的网络访问会显示明确提示。

## 体验

- 连续采集麦克风，每 **2.5 秒**提交一段音频，同时显示输入音量；实际结果在窗口结束后加上模型推理时间到达。
- 根据 SenseVoice 原始声学情绪标签切换光球。音量仅影响起伏强度，文字内容不参与情绪推测。
- 平静、愉悦、低落、愤怒、惊讶、紧张、厌恶有不同配色与律动；模型没有给出明确标签时显示「待辨识」，不制造置信度。
- 开麦前可点击情绪按钮预览。预览有明确标注，不伪造转写；开始录音后自动回到真实识别。
- 支持沉浸模式（Esc 退出）、转写下载和清空。停止录音后会送出不足 2.5 秒的最后一段有效音频，再完成已有任务。
- 静音窗口自动跳过。模型离线、权限拒绝、麦克风断开、超时与处理积压均有提示；网络失败后停止录音，避免无限排队。
- 转写只保存在当前页面内存，最多 120 条。刷新即清空；不保存音频、不使用云端识别、不连接 LedFx。字体与图形资源随网站一起打包。

SenseVoice 对短音频片段的情绪判断可能不稳定，部分扩展标签不一定经常输出。固定窗口也可能在字词中间切开。这是用于展示声光联动的 Demo，不提供逐字时间戳或医学判断。

## 真实麦克风监控

1. 打开 `http://localhost:3000`，在「开始聆听」上方选择输入麦克风。首次授权前浏览器可能隐藏设备名称，开麦后会显示实际设备；可停止后重新选择。
2. 点击「开始聆听」并正常说话，在下方「实时监控」观察输入设备、真实采样率、RMS 电平、采集/提交/返回数、模型推理与请求往返耗时。
3. 每段音频都有序号。展开 `audio.window` 可查看 RMS、峰值、削波比例、时长与静音门限；`request.sent` 表示实际提交；`recognition.result` 展示模型原始标签、识别文字与请求 ID；`visual.applied` 表示渲染器已应用主色。
4. 若反复出现 `audio.skipped`，说明音量低于静音门限。默认门限为 **−55 dBFS**，可以调低，或暂时关闭「跳过静音」让每段音频都提交。实时音量每秒记一条日志，完整音频窗口每 2.5 秒记一条。
5. 若原始标签持续为 `NEUTRAL`，球体会保持平静的青色。面板会显示同一标签连续出现的次数。提高音量只会改变起伏，不会强行制造愤怒等标签；可用语调不同的真实讲话测试模型。

默认关闭浏览器自动增益，以保留语音强弱变化；输入较小时可在面板开启自动增益，再次开麦生效。降噪、回声消除与实际 AGC 设置可在 `mic.ready` 事件中核对。浏览器的生产代码始终调用 `getUserMedia`，测试文件与模拟输入仅用于 Playwright 测试。

「实时监控」默认展开，支持事件筛选、停止自动滚动、查看 JSON 参数、清空与导出日志。页面保留最近 500 条事件，列表显示筛选后的最近 120 条。导出文件包含当前保留的识别文字和参数，不含录音。

查看 Docker 实时日志：

```bash
docker compose logs -f --tail=100 web sensevoice
```

Node 与模型输出结构化日志，包含相同的 `sessionId`、`sequence` 和 `requestId`。可从页面事件复制请求 ID，在终端定位整条链路：

```bash
docker compose logs --since=10m web sensevoice | rg '复制的请求ID'
```

关键事件为 `audio.received` → `inference.dispatch` → `audio.decoded` → `inference.started` → `inference.completed` → `recognition.completed`。错误包含类型、HTTP 状态或原因，模型启动与连接状态变化也有日志。Docker 日志默认只记录模型标签、文字长度、输入指标与耗时；如需保留识别文字，在 `.env` 设置 `LOG_TRANSCRIPTS=true`，然后执行 `docker compose up -d`。`LOG_LEVEL` 控制 Node 日志级别，默认 `info`。两容器日志各自轮转保留最多约 10 MB。

新版灯效使用清晰区分的主色：平静青绿、愉悦金橙、低落深蓝、愤怒炽红、惊讶玫红、紧张深紫、厌恶酸绿。材质减少环境色与虹彩反射对主色的冲淡，并加快颜色过渡。手动预览与真实模型结果在界面和事件中分别标记。

## 实现

```text
浏览器 React / TypeScript
  麦克风 → AudioWorklet → 每 2.5 秒一段 → 静音过滤
              ↓ 16 kHz / mono / PCM16 WAV
Node.js / Fastify / TypeScript
  校验音频、限制并发、请求超时、解析情绪标签
              ↓ Docker 内部 HTTP
SenseVoice 推理服务
  现有 model.py + 本地模型权重 → 原始文字 / 情绪 / 声音事件
              ↓
React Three Fiber 液态球体 + 实时转写
```

网站前后端、音频采集与测试代码使用 **TypeScript / TSX**，构建工具是 Vite，服务端使用 Fastify，图形使用 Three.js、React Three Fiber 和 Drei。没有手写 JavaScript 源文件；浏览器运行的 JavaScript 是正常的编译产物。

SenseVoice 本身依赖 Python / PyTorch，因此保留独立推理容器。[inference/serve.py](inference/serve.py) 只是原模型的薄适配层：加载已有源码、用标准库解析 WAV、调用模型。不修改 `/home/zxc/workspace3/code/SenseVoice`，也不依赖其原 API 的可选 TorchCodec 音频解码组件。当前镜像为 CPU 版本，默认使用 4 个推理线程，可通过 `INFERENCE_THREADS` 调整。

| 文件 | 用途 |
| --- | --- |
| `src/App.tsx`、`src/styles.css` | 主页面与响应式样式 |
| `src/components/LiquidOrb.tsx` | 液态形变、流动纹理与情绪配色过渡 |
| `src/hooks/useVoice.ts` | 录音生命周期、静音过滤、队列与错误恢复 |
| `src/audio/processor.ts`、`src/audio/wav.ts` | AudioWorklet、重采样与 WAV 编码 |
| `shared/emotions.ts` | 情绪配置与共享类型 |
| `server/app.ts`、`server/sensevoice.ts` | Fastify API 与 SenseVoice 适配 |
| `compose.yaml`、`Dockerfile`、`docker/sensevoice.Dockerfile` | 两个容器的一键构建与启动 |

参考：[SenseVoice 官方模型](https://huggingface.co/FunAudioLLM/SenseVoiceSmall)、[React Three Fiber](https://r3f.docs.pmnd.rs/getting-started/installation)、[Fastify TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/)。

## 本地开发

需要 Node.js 22.12+（本机使用 Node.js 24）以及 Docker Compose v2+。用开发覆盖配置把模型端口绑定到本机，然后启动 TypeScript 开发服务：

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d sensevoice
npm ci
npm run dev
```

- 前端：`http://localhost:5173`
- Node API：`http://127.0.0.1:3001`
- 本机模型：`http://127.0.0.1:50000`

如使用其他推理地址，可通过环境变量启动，例如 `SENSEVOICE_URL=http://127.0.0.1:50000 npm run dev`。`.env` 是 Compose 的配置文件，开发进程默认采用上面的端口。

```bash
npm run typecheck
npm test
npm run build
SENSEVOICE_URL=http://127.0.0.1:50000 npm start
```

## 验证

单元与 API 测试覆盖：44.1/48 kHz 重采样、PCM 编码、非法 WAV 拒绝、情绪标签解析、未知标签、静音事件、真实 multipart 转发和模型不可用时的返回。

浏览器测试需要运行中的网站与模型。使用本地模型自带的公开语音样本模拟麦克风，测试会经过真正的 AudioWorklet → Node → SenseVoice 全链路，不需要真人录音。

```bash
npx playwright install chromium
npx tsx scripts/prepare-test-audio.ts
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
```

也可以通过 `TEST_AUDIO_PATH=/absolute/path/example.wav` 提供测试音频。不提供样本时，真实语音转写测试会跳过。页面测试包含情绪预览、沉浸模式、权限失败、推理故障、录音停止、下载、清空与手机布局；截图输出到 `.artifacts/`。

## API

- `GET /api/health`：检查推理服务是否已加载模型，就绪返回 200，未就绪返回 503。
- `POST /api/analyze`：`Content-Type: audio/wav`，请求体是 0.1–5 秒的 16 kHz 单声道 PCM16 WAV。返回 `text`、`emotion`、`language`、`events`、`isSpeech`、`durationMs`、`latencyMs`。

网页服务默认对外开放 3000 端口；模型服务仅供 Docker 内部调用。该 Demo 没有用户登录，适用于本机或可信演示网络。
