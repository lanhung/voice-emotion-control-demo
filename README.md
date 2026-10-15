# Aura · 让情绪自然流动

一个本地语音情绪可视化 Demo。打开麦克风后，页面上方的液态球体或 8 × 64 灯光矩阵随语音情绪改变颜色和律动，下方连续显示转写文字。浅色、留白、柔和虹彩与半透明控件组成整个界面。

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
- 点击灯效上方的「液态光球 / 灯光矩阵」切换显示方式；矩阵为 **8 行 × 64 列，共 512 颗灯珠**，支持手机与沉浸模式。录音时也可切换，转写不中断。
- 根据 SenseVoice 原始声学情绪标签切换灯效配色。音量影响光球起伏或矩阵光带的宽度与亮度，文字内容不参与情绪推测。矩阵遵循系统的减少动态效果设置，并在页面隐藏时暂停动画。
- 平静、愉悦、低落、愤怒、惊讶、紧张、厌恶有不同配色与律动；模型没有给出明确标签时显示「待辨识」，不制造置信度。
- 开麦前可点击情绪按钮预览。预览有明确标注，不伪造转写；开始录音后自动回到真实识别。
- 支持沉浸模式（Esc 退出）、转写下载和清空。停止录音后会送出不足 2.5 秒的最后一段有效音频，再完成已有任务。
- 可选「短回应」默认关闭。开启后，语音识别完成便自动根据最近的文字和声学情绪线索显示 1–2 个英文词，无需结束录音；录音中开启也会从下一段识别开始生效。液态光球散开并聚成液态字母，灯光矩阵直接用灯珠拼出单词；每次回复展示 2.5 秒后恢复情绪灯效，动画至少持续 5 秒才开始生成下一条回应。回应期间可切换显示方式，切换不会延长展示期限。
- 液态文字使用本地字体和 Canvas 2D，在无 WebGL 的兼容模式下也可显示；系统开启「减少动态效果」时直接显示静态字形。矩阵使用 7 行紧凑大写字形，所有候选短语（包括标点）都能完整放入 64 列，无需滚动。
- 静音窗口自动跳过。模型离线、权限拒绝、麦克风断开、超时与处理积压均有提示；网络失败后停止录音，避免无限排队。
- 转写只保存在当前页面内存，最多 120 条。刷新即清空；不保存音频、不使用云端识别、不连接 LedFx。字体与图形资源随网站一起打包。

SenseVoice 对短音频片段的情绪判断可能不稳定，部分扩展标签不一定经常输出。固定窗口也可能在字词中间切开。这是用于展示声光联动的 Demo，不提供逐字时间戳或医学判断。

## 短回应配置

服务端通过官方 OpenAI Node SDK 调用 OpenAI 兼容的 `POST /v1/chat/completions`，默认模型为 `gpt-6-luna`。SDK 固定为规划中验证过的 `7.34.0`；超时和取消采用[官方 SDK 接口](https://developers.openai.com/api/reference/typescript)。

复制 `.env.example` 为 `.env`（已有文件时直接编辑），填写服务端 `LLM_API_KEY` 后重新创建网站容器：

```bash
docker compose up -d --build web
```

| 配置 | 默认值 / 说明 |
| --- | --- |
| `LLM_API_KEY` | 留空时返回 `not_configured`；只传入服务端，不能使用 `VITE_` 前缀 |
| `LLM_MODEL` | `gpt-6-luna` |
| `LLM_BASE_URL` | 本机开发使用 `http://127.0.0.1:8317/v1` |
| `LLM_DOCKER_BASE_URL` | 容器使用 `http://host.docker.internal:8317/v1`，Compose 已添加 `host-gateway` 映射 |
| `LLM_TIMEOUT_MS` | 默认 `10000`，可配置为 `1000–30000`，SDK 不自动重试 |

宿主机代理需要监听容器可达的接口；容器里的 `127.0.0.1` 指向容器本身。使用远程兼容接口时，分别修改开发与 Docker 的地址。`.env` 已加入 Git 和 Docker 构建忽略列表，密钥不会打进镜像。

打开页面并开启「短回应」，开始聆听并说出完整表达，保持录音即可看到回应。例如考试成功可得到 `Congrats!`，临近挑战可得到 `Good luck!`。等待大模型时静默处理，页面不显示加载文案、转圈或提示框；收到有效回复后直接显示文字。功能只发送当前录音最近的转写与情绪线索，不发送音频或其他录音的历史记录；代理是否继续向云端转发，取决于其上游配置。

声学标签按本轮有效语音时长汇总，仅作辅助；模型需优先理解文字中的事实和否定。服务端只允许候选列表中的短语，拒绝长文本、截断、拒答和未知输出；`NONE` 转成跳过状态。白名单确保格式，不保证所有场景的语义正确。未配置、认证失败、限流、超时和模型离线会显示独立状态，不影响语音和灯效。

首次识别到有效语音后约 350 ms 自动提交，同一会话最多一个请求在途。有效回复显示 2.5 秒，清除文字后保留至少 5 秒连续动画，再用这期间合并的最新上下文生成下一条回应；文字不会被连续回复替换或延长。识别和情绪灯效持续更新，不积压逐条回复。模型返回 `NONE` 等未展示结果时，仍按每 4 秒最多一次请求限制频率。实际展示还需要加上语音分段和模型响应时间。结束聆听会处理尚未发送的末段，也遵守动画间隔，不重发已经处理过的文字。

上下文保留最近 6 个有效片段、最多 4000 字，按完整片段淘汰旧内容，不截断单个片段；超过 15 秒没有新识别时，新话题从空上下文开始。声学情绪按这些片段的有效语音时长汇总。单段超过 4000 字时跳过，后续正常片段仍可回应。开始新录音、关闭功能、清空记录或离开页面都会取消旧请求；清空会停止当前录音剩余部分的短回应，下次录音恢复。关闭后重新开启可从当前录音的新识别片段生效。服务端最多并行处理两个短回应，每个会话只保留一个请求，并在 5 分钟内去重最近最多 512 次请求；服务重启后清空。

Docker 的 `reaction.completed` 日志包含实际 `modelOutput`、校验通过的 `text`、`finishReason`、状态和耗时。浏览器「实时监控 → 日志筛选 → 短回应」会直接显示“大模型回复：I'm here.”等内容，展开事件可查看完整参数，也支持导出。`NONE`、空回复和不合规回复会记入日志并注明跳过原因，但不会成为灯效文字。模型输出日志最多保存 512 字，并用 `outputTruncated` 标记超长输出；这只限制日志大小，不会把无效输出截成有效短语。短回应请求原文、上游错误正文及密钥不写入服务端日志。

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

关键事件为 `audio.received` → `inference.dispatch` → `audio.decoded` → `inference.started` → `inference.completed` → `recognition.completed`。错误包含类型、HTTP 状态或原因，模型启动与连接状态变化也有日志。语音识别的 Docker 日志默认记录模型标签、文字长度、输入指标与耗时；如需保留识别文字，在 `.env` 设置 `LOG_TRANSCRIPTS=true`，然后执行 `docker compose up -d`。短回应的实际模型输出默认记录，详见上文。`LOG_LEVEL` 控制 Node 日志级别，默认 `info`。两容器日志各自轮转保留最多约 10 MB。

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
React Three Fiber 液态球体 / Canvas 2D 灯光矩阵 + 实时转写
```

网站前后端、音频采集与测试代码使用 **TypeScript / TSX**，构建工具是 Vite，服务端使用 Fastify，图形使用 Three.js、React Three Fiber 和 Drei。没有手写 JavaScript 源文件；浏览器运行的 JavaScript 是正常的编译产物。

SenseVoice 本身依赖 Python / PyTorch，因此保留独立推理容器。[inference/serve.py](inference/serve.py) 只是原模型的薄适配层：加载已有源码、用标准库解析 WAV、调用模型。不修改 `/home/zxc/workspace3/code/SenseVoice`，也不依赖其原 API 的可选 TorchCodec 音频解码组件。当前镜像为 CPU 版本，默认使用 4 个推理线程，可通过 `INFERENCE_THREADS` 调整。

| 文件 | 用途 |
| --- | --- |
| `src/App.tsx`、`src/styles.css` | 主页面与响应式样式 |
| `src/components/LiquidOrb.tsx` | 液态形变、流动纹理与情绪配色过渡 |
| `src/components/LiquidReply.tsx`、`src/visualization/liquidText.ts` | 光球到液态文字的液滴过渡、本地字形采样与兼容渲染 |
| `src/components/LightMatrix.tsx` | 8 × 64 灯珠矩阵、情绪流光与音量响应 |
| `src/visualization/matrixText.ts` | 矩阵字形与完整短回应的 64 列布局 |
| `src/hooks/useVoice.ts` | 录音生命周期、静音过滤、队列与错误恢复 |
| `src/hooks/useReaction.ts`、`src/reaction/` | 最近片段上下文、近实时调度、请求与取消、回复日志及展示期限 |
| `src/components/ReactionBadge.tsx`、`shared/reaction.ts` | 错误提示、读屏回应与共享协议、短语列表 |
| `src/audio/processor.ts`、`src/audio/wav.ts` | AudioWorklet、重采样与 WAV 编码 |
| `shared/emotions.ts` | 情绪配置与共享类型 |
| `server/app.ts`、`server/sensevoice.ts` | Fastify API 与 SenseVoice 适配 |
| `server/llm.ts`、`server/reaction.ts`、`server/reactionRoutes.ts` | 兼容模型 SDK、短语校验、短回应 API 与并发控制 |
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

如使用其他推理地址，可通过环境变量启动，例如 `SENSEVOICE_URL=http://127.0.0.1:50000 npm run dev`。Node 开发和生产入口都会自动加载工作目录下的 `.env`，已有进程环境变量优先；修改配置后需重启进程。Compose 读取相同文件，但使用 `LLM_DOCKER_BASE_URL` 设置容器中的上游地址。

```bash
npm run typecheck
npm test
npm run build
SENSEVOICE_URL=http://127.0.0.1:50000 npm start
```

## 验证

单元与 API 测试覆盖：44.1/48 kHz 重采样、PCM 编码、非法 WAV 拒绝、情绪标签解析、未知标签、静音事件、真实 multipart 转发和模型不可用时的返回。

短回应测试通过真实 SDK 连接模拟 HTTP 上游，覆盖白名单、否定片段保留、末段聚合、输入限制、未配置、认证失败、限流、超时、并发、去重、回复日志及连接取消。普通测试不调用付费模型。调度测试使用虚拟时钟验证合并、节流、慢请求、2.5 秒展示后的 5 秒动画间隔、重复短语、等待期间取消、上下文更新和错误恢复；浏览器测试验证录音中展示与更新、光球和矩阵的动画间隔、日志筛选、默认关闭、清空/关闭/新录音后丢弃旧回复、原生取消及故障后的继续录音；另有矩阵实际灯珠像素校验、最长短语、液态文字、无 WebGL、减少动态效果及手机/沉浸模式检查。原有真实 SenseVoice 测试仍使用本地公开音频。

配置好真实代理密钥后，可显式运行完整的 AudioWorklet → SenseVoice → 兼容模型 → 页面短回应测试。该测试使用本地公开测试音频并实际调用配置的模型，默认跳过：

```bash
LIVE_REACTION_TEST=true PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/reaction-live.spec.ts
```

浏览器测试需要运行中的网站与模型。使用本地模型自带的公开语音样本模拟麦克风，测试会经过真正的 AudioWorklet → Node → SenseVoice 全链路，不需要真人录音。

```bash
npx playwright install chromium
npx tsx scripts/prepare-test-audio.ts
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
```

也可以通过 `TEST_AUDIO_PATH=/absolute/path/example.wav` 提供测试音频。不提供样本时，真实语音转写测试会跳过。页面测试包含情绪预览、光球与矩阵切换、矩阵实际像素配色、减少动态效果、录音中切换、沉浸模式、权限失败、推理故障、录音停止、下载、清空与手机布局；截图输出到 `.artifacts/`。

## API

- `GET /api/health`：检查推理服务是否已加载模型，就绪返回 200，未就绪返回 503。
- `POST /api/analyze`：`Content-Type: audio/wav`，请求体是 0.1–5 秒的 16 kHz 单声道 PCM16 WAV。返回 `text`、`emotion`、`language`、`events`、`isSpeech`、`durationMs`、`latencyMs`。
- `POST /api/reaction`：JSON `{ sessionId, turnId, text, emotion }`；标识为 1–64 位字母、数字、下划线或连字符，文字最多 4000 字，情绪使用共享枚举。客户端不能传入密钥、上游 URL 或提示词。

短回应成功返回 `{ status: "replied", text, sessionId, turnId, latencyMs, requestId }`；跳过返回 `status: "skipped"` 与 `reason`。实际调用模型后的结果另含 `modelOutput`、`outputTruncated`、`finishReason`，用于日志诊断，只有通过校验的 `text` 可进入灯效。错误返回 `status: "error"`、`code` 和可展示的 `error`：未配置/认证失败为 503，限流/并发已满为 429，超时为 504，上游故障为 502，已取消为 409，输入非法为 400。`GET /api/health` 仍只反映本地语音模型状态。

网页服务默认对外开放 3000 端口；模型服务仅供 Docker 内部调用。该 Demo 没有用户登录，适用于本机或可信演示网络。
