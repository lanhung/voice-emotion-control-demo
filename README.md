# Aura · 让情绪自然流动

一个本地语音情绪可视化 Demo。打开麦克风后，页面上方的液态球体或 8 × 64 灯光矩阵随语音情绪改变颜色和律动，下方连续显示转写文字。浅色、留白、柔和虹彩与半透明控件组成整个界面。

## 启动

复制或克隆当前工程到目标电脑，在工程目录执行一条命令即可构建并启动。无需安装 Node.js、Python、SenseVoice 或独立 Ollama，也无需复制其他工程目录。

**当前完整功能的硬件要求：** x86_64 电脑、Docker Compose v2.30+、支持 CUDA 13 的 NVIDIA GPU/驱动，以及可用的 Docker GPU 访问（Linux 使用 [NVIDIA Container Toolkit](https://docs.ollama.com/docker)，Windows 使用支持 GPU 的 Docker Desktop / WSL2 环境）。SenseVoice 使用 CPU；当前 `laya:322m-multilingual-mlx-fp16` 依赖 Ollama 镜像内的 MLX CUDA 运行库。纯 CPU、AMD GPU 和 Apple Silicon Mac 不能直接使用这份完整部署配置；普通 Ollama 的 CPU 支持不代表该 Laya 模型也能运行。

```bash
docker compose up -d --build
```

打开 **http://localhost:3000**，点击「开始聆听」并允许麦克风。默认无需 `.env`；如需改端口或 HTTPS，可复制 `.env.example` 为 `.env` 后修改对应配置。

首次部署需要联网下载基础镜像、Node/PyTorch 依赖、SenseVoice 源码与权重，以及 Laya 模型，耗时取决于网络速度：

- `sensevoice`：构建时获取固定版本的上游源码和 ModelScope 权重，校验 SHA-256 后打入镜像；运行时不依赖宿主机模型目录。
- `ollama`：由本工程启动固定版本的 Ollama，模型保存到项目独立的 `ollama-data` Docker 卷；默认不向宿主机公开模型端口。
- `ollama-init`：通过官方 TypeScript SDK 检查完整模型标签，缺失时自动下载，再完成一次真实 Laya 决策推理。模型已缓存时跳过下载；首次 CUDA 内核编译可能需要一分钟以上，启动检查最多等待 5 分钟。初始化成功后以退出码 0 结束。
- `web`：等待 SenseVoice 健康、Laya 初始化成功后启动，通过 `http://sensevoice:50000` 和 `http://ollama:11434` 访问模型。

`docker compose build` 只构建镜像；上面的 `up -d --build` 才包含启动 Ollama、首次下载 Laya 和启动网站。下载失败可重试同一命令；初始化/推理失败时网站不会被错误地标记为就绪，可查看 `ollama-init` 和 `ollama` 日志。

```bash
docker compose ps -a               # web/sensevoice/ollama 应为 healthy；ollama-init 应 Exited (0)
docker compose logs -f web         # 网站日志
docker compose logs -f sensevoice  # 推理服务日志
docker compose logs -f ollama-init ollama  # 模型下载、初始化和决策运行日志
docker compose down               # 停止本 Demo
```

普通 `docker compose down` 会保留 Laya 模型卷，下次启动复用已下载模型；`docker compose down -v` 会删除本工程的模型卷，下次需要重新下载。SenseVoice 权重随镜像保留。部署到另一台电脑时复制仓库即可，再执行同一条启动命令；首次部署需要网络，并不是仅复制仓库即可离线部署。

旧 `.env` 中的 `SENSEVOICE_SOURCE`、`SENSEVOICE_MODEL_PATH`、`OLLAMA_DOCKER_BASE_URL` 已不再被 Compose 读取。已有的其他工程 Ollama 容器和模型目录不属于此部署，新服务使用独立的数据卷。可保留原服务，它的宿主机 11434 端口不会与这里的内部端口冲突。

如果首次拉取 Laya 提示 `redirect target not allowed`、`resolves to non-public 198.18.*`，说明当前代理的 Fake-IP DNS 返回了虚拟地址。需要在代理 DNS 配置中让报错的模型存储域名解析为真实公网 IP，然后重试启动命令。模型已经下载到卷后，后续启动不会再次拉取。

**浏览器麦克风要求：** 本机请使用 `localhost` 或 `127.0.0.1`。用手机或其他电脑访问局域网 IP 时，需要提供 HTTPS；普通 `http://192.168.x.x:3000` 只能预览灯效，浏览器不会开放麦克风。推荐使用新版 Chrome、Edge 或 Safari。未提供 HTTPS 的网络访问会显示明确提示。

## 内网 HTTPS：直接加载固定证书

使用一对固定的自签名证书和私钥，Vite 开发服务器和 Fastify 网站服务直接提供 HTTPS。证书通过文件挂载，不需要额外容器；启动不会生成或更换证书。

在项目根目录执行一次以下命令，将两处 `192.168.1.10` 换成测试设备实际访问的服务器 IP（已有证书时直接使用）：

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -sha256 -nodes \
  -keyout certs/server.key -out certs/server.crt -days 365 \
  -subj "/CN=192.168.1.10" \
  -addext "subjectAltName=IP:192.168.1.10,IP:127.0.0.1,DNS:localhost" \
  -addext "extendedKeyUsage=serverAuth"
chmod 600 certs/server.key
```

在 `.env` 中设置：

```dotenv
HTTPS_CERT_FILE=certs/server.crt
HTTPS_KEY_FILE=certs/server.key
```

启动 Docker 网站服务：

```bash
docker compose up -d --build web
```

访问 **`https://192.168.1.10:3000`**（端口以 `APP_PORT` 为准）。Docker 只读挂载 `certs/`，不把证书打进镜像；容器的 Node 用户（UID 1000）需要有文件读取权限。若私钥属于其他用户，请调整属主或文件 ACL，让该用户可以读取，同时保留私钥访问限制。

`npm run dev` 读取相同的 `.env` 配置，前端使用 **`https://192.168.1.10:5173`**，API 使用 HTTPS 并由 Vite 同源代理。证书须保留 `127.0.0.1`，供开发代理及 Docker 健康检查验证使用。只有构建时不读取证书，因此镜像构建无需证书文件。

访问设备需要导入并信任 `server.crt`，然后允许网站使用麦克风。证书信任方式取决于设备和浏览器；仅点击跳过证书警告不能作为麦克风可用的保证。服务器 IP 改变或证书过期时重新生成证书并重启服务；每次替换自签名证书后，访问设备也需要重新信任。证书与私钥默认不会提交到 Git。

可在服务器验证 HTTPS（保留证书验证）：

```bash
curl --cacert certs/server.crt https://127.0.0.1:3000/api/health
```

将两个 `HTTPS_*_FILE` 配置都清空并重启即可使用原来的 HTTP。仅设置一个路径，或证书无法读取、格式错误、私钥不匹配时，服务会明确报错并停止启动。

## 体验

- 连续采集麦克风，默认每 **2.5 秒**提交一段音频，可在实时监控中切换为 **5 秒**，同时显示输入音量；实际结果在窗口结束后加上模型推理时间到达。
- 点击灯效上方的「液态光球 / 灯光矩阵」切换显示方式；矩阵为 **8 行 × 64 列，共 512 颗灯珠**，支持手机与沉浸模式。录音时也可切换，转写不中断。
- 根据 SenseVoice 原始声学情绪标签切换灯效配色。音量影响光球起伏或矩阵光带的宽度与亮度，文字内容不参与情绪推测。矩阵遵循系统的减少动态效果设置，并在页面隐藏时暂停动画。
- 平静、愉悦、低落、愤怒、惊讶、紧张、厌恶有不同配色与律动。默认禁用模型的 `EMO_UNKNOWN` 输出，让模型选择具体情绪；开启「允许待辨识」可恢复未知标签。缺失或未知标签仍显示「待辨识」，不映射为平静、不制造置信度。禁用未知标签不等于提高了识别准确率。
- 开麦前可点击情绪按钮预览。预览有明确标注，不伪造转写；开始录音后自动回到真实识别。
- 支持沉浸模式（Esc 退出）、转写下载和清空。停止录音后会送出不足所选分段时长的最后一段有效音频，再完成已有任务。
- 可选「短回应」默认关闭。开启后，根据语音情绪，结合本地决策模型和 CSV 词库选择 1–2 个英文词，无需结束录音；转写内容不参与选词。液态光球聚成液态字母，灯光矩阵用灯珠拼出单词；文字展示 2.5 秒后恢复至少 5 秒情绪灯效。切换显示方式不会延长展示期限或重复计数。
- 液态文字使用本地字体和 Canvas 2D，在无 WebGL 的兼容模式下也可显示；系统开启「减少动态效果」时直接显示静态字形。矩阵使用 7 行紧凑大写字形，所有候选短语（包括标点）都能完整放入 64 列，无需滚动。
- 静音窗口自动跳过。模型离线、权限拒绝、麦克风断开、超时与处理积压均有提示；网络失败后停止录音，避免无限排队。
- 转写只保存在当前页面内存，最多 120 条。刷新即清空；不保存音频、不使用云端识别、不连接 LedFx。字体与图形资源随网站一起打包。

SenseVoice 对短音频片段的情绪判断可能不稳定，部分扩展标签不一定经常输出。固定窗口也可能在字词中间切开。这是用于展示声光联动的 Demo，不提供逐字时间戳或医学判断。

## 短回应配置

服务端使用官方 `ollama@0.6.4` 的 `systemone()` 调用同一 Compose 内 Ollama 中的 `laya:322m-multilingual-mlx-fp16`，通过 [System One 决策接口](https://docs.ollama.com/api/systemone)评价 CSV 中的合法候选。无需 API key，不再使用聊天生成模型或代理。前端只提交当前声学情绪、任务标识和界面是否可显示；候选、概率、权重和使用记录均留在服务端。

默认模型会自动下载并验证，无需手动执行 `ollama pull`。修改配置后重新启动：

```bash
docker compose up -d --build
```

| 配置 | 默认值 / 说明 |
| --- | --- |
| `LAYA_MODEL` | `laya:322m-multilingual-mlx-fp16`，保留完整标签 |
| `OLLAMA_BASE_URL` | 本机开发默认 `http://127.0.0.1:11435`；Compose 自动设置为 `http://ollama:11434` |
| `OLLAMA_DEV_PORT` | 开发覆盖文件公开的宿主机端口，默认 `11435`；修改后同步修改开发用 `OLLAMA_BASE_URL` |
| `LAYA_TIMEOUT_MS` | 默认 `5000`，允许 `1000–10000`；浏览器总期限 12 秒 |
| `REACTION_CATALOG_PATH` | 默认 `config/reaction-phrases.csv`；容器中使用容器可达路径 |

`LAYA_MODEL` 同时用于初始化服务和网站服务；更换标签后重新执行启动命令会下载并检查新模型。Ollama 镜像版本和摘要固定在 `compose.yaml`，升级时需重新验证 System One 接口及 GPU 运行库。运行期间 Ollama 出错只影响短回应，SenseVoice 健康检查保持独立。旧 `.env` 中的 `LLM_*` 项已不再读取，可移除。

`config/reaction-phrases.csv` 是唯一词库来源。字段为 `id,text,emotions,weight,cooldown_seconds,enabled`：情绪用 `|` 分隔，权重为有限正数，冷却为非负整数秒，开关为 `true/false`。允许 UTF-8 BOM、LF/CRLF、标准 CSV 引号和空白行。文字必须为 1–2 个英文词，可含缩写和一个结尾句号或感叹号，并完整适配 64 列矩阵。弯撇号统一为直撇号；ID、规范化文字不能重复。每种情绪最多 20 条启用短语；停用行也校验。`unknown` 不可配置，平静候选默认停用。

默认词库包含 56 条不同短语，48 条启用：开心 20 条、低落 20 条、紧张 17 条、生气和厌恶各 14 条、惊讶 8 条；陪伴短语可跨情绪共享，因此各情绪数量相加不等于独立短语总数。另有 8 条平静候选默认停用。新增陪伴短语以倾听、关怀和放慢节奏为主，惊讶短语不判断事情好坏。

维护流程：编辑 CSV → 校验 → 重启 Web。文本略改保留 ID，不要把旧 ID 分配给不同含义的新短语。

```bash
npm run check:reactions
# 可校验其他文件：npm run check:reactions -- /path/to/phrases.csv
docker compose restart web
```

镜像包含默认词库，Compose 将宿主机 `config/` 只读挂载至 `/app/config`；使用挂载时只需重启，不需要重建前端。无挂载时须重建镜像。服务启动只加载一次，整份 CSV 任一错误都会停用文字反馈并报告文件、行号、字段，识别与灯效照常工作。

服务端保留最近 3 个语音情绪，最新非 `unknown` 标签出现至少 2 次才可回应；超过 15 秒无有效语音则重新观察。整体间隔至少 10 秒，同情绪至少 30 秒，单短语冷却以 CSV 为准。先排除冷却和近期连续重复，再按 `weight / (1 + 最近300秒确认次数)` 调整权重。多候选融合 Laya 概率，偏好因子为 `0.8 × p + 0.2 / N`，然后加权抽取；单候选直接按规则选择。模型 choice 仅为诊断，不能绕过冷却。模型失败不随机降级，至少等待 5 秒且有新语音才再次尝试。

每个页面实例独立保存服务端使用记录。清空、隐藏、开关功能和新录音会递增任务代次、取消旧任务，冷却保持；新页面和刷新产生新的客户端标识。前端只保留当前任务、当前显示和最新待发送片段，没有情绪窗口或选词历史。停止录音可处理已经进入流程的末段，没有新识别时不会按计时器自动补发。等待模型期间不显示转圈或生成提示。

首次可见绘制后，前端发送展示回执；服务端只对首次有效回执增加次数，以收到回执的单调时间开始确认冷却。重复回执不延长冷却。5 秒内没有回执的下发标为 `delivery_unconfirmed`，保留防重复预留但不增加确认次数。单客户端最多一个评分和一个待确认结果，全局最多两项评分。最多保存 512 个客户端，各客户端 5 分钟内最多 512 个请求；满额返回 `busy`，不提前驱逐有效冷却。空闲 TTL 至少覆盖 300 秒及最长短语冷却，服务重启清空内存记录。

服务端 `reaction.*` 日志包含词库版本、候选概率、模型 choice、基础与最终权重、近期次数和跳过原因；`single_candidate` 分支不伪造模型字段。浏览器监控记录“已选择陪伴短语”和“展示已确认”，不接收评分集合。Laya 概率不是情绪识别置信度。正常冷却和无候选静默跳过，词库、模型、超时等错误只影响短回应。

## 真实麦克风监控

1. 打开 `http://localhost:3000`，在「开始聆听」上方选择输入麦克风。首次授权前浏览器可能隐藏设备名称，开麦后会显示实际设备；可停止后重新选择。
2. 点击「开始聆听」并正常说话，在下方「实时监控」观察输入设备、真实采样率、RMS 电平、采集/提交/返回数、模型推理与请求往返耗时。
3. 每段音频都有序号。展开 `audio.window` 可查看 RMS、峰值、削波比例、时长与静音门限；`request.sent` 表示实际提交；`recognition.result` 展示模型原始标签、识别文字与请求 ID；`visual.applied` 表示渲染器已应用主色。
4. 若反复出现 `audio.skipped`，说明音量低于静音门限。默认门限为 **−55 dBFS**，可以调低，或暂时关闭「跳过静音」让每段音频都提交。实时音量每秒记一条日志，完整音频窗口按所选的 2.5 秒或 5 秒记一条。
5. 若原始标签持续为 `NEUTRAL`，球体会保持平静的青色。面板会显示同一标签连续出现的次数。提高音量只会改变起伏，不会强行制造愤怒等标签；可用语调不同的真实讲话测试模型。

默认关闭浏览器自动增益，以保留语音强弱变化；输入较小时可在面板开启自动增益，再次开麦生效。降噪、回声消除与实际 AGC 设置可在 `mic.ready` 事件中核对。浏览器的生产代码始终调用 `getUserMedia`，测试文件与模拟输入仅用于 Playwright 测试。

### 情绪识别对照设置

在「实时监控」中设置，开麦后锁定直到本轮结束；刷新页面恢复默认值。

| 设置 | 默认值 | 对照方法 |
| --- | --- | --- |
| 分段时长 | 2.5 秒 | 可选 5 秒，为每次推理提供更长上下文；也增加首段等待时间。两种时长都使用独立、无重叠窗口。 |
| 识别语言 | 自动识别 | 可指定中文、英语、粤语、日语、韩语；固定语种与自动识别应使用相同讲话内容对照。 |
| 允许待辨识 | 关闭 | 关闭时传入 `ban_emo_unk=true`；开启后为 `false`，恢复此前允许未知情绪的行为。 |

这些设置会从浏览器随每段音频传到 Node，再传入原始 SenseVoice 推理方法。`session.started` 和 `request.sent` 记录本轮设置；`recognition.result` 中的 `recognitionOptions` 由推理服务回传，包含实际使用的 `language` 和 `banUnknownEmotion`。Node 的 `inference.dispatch`、模型的 `inference.started/completed` 和 Node 的 `recognition.completed` 也记录参数，可按请求 ID 核对。停止时的末段沿用本轮设置。

`POST /api/analyze` 可通过 `X-Aura-Language: auto|zh|en|yue|ja|ko` 和 `X-Aura-Ban-Emo-Unk: true|false` 指定参数；缺省为 `auto` 与 `true`，非法值返回 400。音频仍为 0.1–5 秒、16 kHz 单声道 PCM16 WAV，5 秒窗口不扩大上传上限。

建议每轮只调整一项：先比较是否允许未知标签，再比较分段时长或语种。记录具体情绪是否符合讲话语气，不能只凭「待辨识」占比下降判断准确率提升。应用不保存录音，需要重复录制相同测试内容。升级此功能时需同时重建网站和推理服务：`docker compose up -d --build web sensevoice`。

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
  麦克风 → AudioWorklet → 每 2.5 / 5 秒一段 → 静音过滤
              ↓ 16 kHz / mono / PCM16 WAV
Node.js / Fastify / TypeScript
  校验音频、限制并发、请求超时、解析情绪标签
              ↓ Docker 内部 HTTP
SenseVoice 推理服务
  镜像中的 model.py + 模型权重 → 原始文字 / 情绪 / 声音事件
              ↓
React Three Fiber 液态球体 / Canvas 2D 灯光矩阵 + 实时转写
```

网站前后端、音频采集与测试代码使用 **TypeScript / TSX**，构建工具是 Vite，服务端使用 Fastify，图形使用 Three.js、React Three Fiber 和 Drei。没有手写 JavaScript 源文件；浏览器运行的 JavaScript 是正常的编译产物。

SenseVoice 本身依赖 Python / PyTorch，因此保留独立推理容器。[inference/serve.py](inference/serve.py) 只是原模型的薄适配层：加载镜像内的上游源码、用标准库解析 WAV、调用模型。源码固定到提交 `586bbdb2b052f4fe19322581825228b6810a9fb3`，ModelScope 权重固定到 `7bf452403abd7353a300cd760f7adae7701c92c1`；下载文件及校验值集中在 [docker/sensevoice.Dockerfile](docker/sensevoice.Dockerfile)，源码许可证和模型说明随镜像保存。不依赖原 API 的可选 TorchCodec 音频解码组件。当前镜像为 CPU 版本，默认使用 4 个推理线程，可通过 `INFERENCE_THREADS` 调整。

| 文件 | 用途 |
| --- | --- |
| `src/App.tsx`、`src/styles.css` | 主页面与响应式样式 |
| `src/components/LiquidOrb.tsx` | 液态形变、流动纹理与情绪配色过渡 |
| `src/components/LiquidReply.tsx`、`src/visualization/liquidText.ts` | 光球到液态文字的液滴过渡、本地字形采样与兼容渲染 |
| `src/components/LightMatrix.tsx` | 8 × 64 灯珠矩阵、情绪流光与音量响应 |
| `shared/matrixGlyphs.ts`、`src/visualization/matrixText.ts` | 服务端校验与矩阵渲染复用字形和宽度测量 |
| `src/hooks/useVoice.ts` | 录音生命周期、静音过滤、队列与错误恢复 |
| `src/hooks/useReaction.ts`、`src/reaction/` | 识别结果提交、取消、最终文字展示和绘制回执 |
| `src/components/ReactionBadge.tsx`、`shared/reaction.ts` | 错误提示、读屏回应与共享决策协议 |
| `src/audio/processor.ts`、`src/audio/wav.ts` | AudioWorklet、重采样与 WAV 编码 |
| `shared/emotions.ts` | 情绪配置与共享类型 |
| `server/app.ts`、`server/sensevoice.ts` | Fastify API 与 SenseVoice 适配 |
| `server/laya.ts`、`server/reaction.ts`、`server/reactionRoutes.ts` | 官方 Ollama SDK、决策编排与接口 |
| `server/reactionContext.ts`、`server/reactionUsage.ts`、`server/reactionDecision.ts` | 情绪稳定、频控、使用记录、概率融合与加权选择 |
| `config/reaction-phrases.csv`、`server/reactionCatalog.ts`、`shared/reactionCatalog.ts` | 词库、CSV 加载和通用格式校验 |
| `server/modelSetup.ts`、`server/prepareModels.ts` | Laya 模型缓存检查、下载、实际推理验证与初始化入口 |
| `compose.yaml`、`Dockerfile`、`docker/sensevoice.Dockerfile` | 网站、两项模型服务及一次性初始化的一键构建与启动 |

参考：[SenseVoice 官方模型](https://huggingface.co/FunAudioLLM/SenseVoiceSmall)、[React Three Fiber](https://r3f.docs.pmnd.rs/getting-started/installation)、[Fastify TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/)。

## 本地开发

需要 Node.js 22.12+（本机使用 Node.js 24）以及上述 Docker/GPU 环境。用开发覆盖配置把模型端口绑定到本机，然后启动 TypeScript 开发服务：

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d --build sensevoice ollama-init
npm ci
npm run dev
```

- 前端：`http://localhost:5173`
- Node API：`http://127.0.0.1:3001`
- SenseVoice：`http://127.0.0.1:50000`
- Ollama：`http://127.0.0.1:11435`（避免与其他工程的 11434 冲突）

如使用其他推理地址，可通过环境变量启动，例如 `SENSEVOICE_URL=http://127.0.0.1:50000 npm run dev`。Node 开发和生产入口都会自动加载工作目录下的 `.env`，已有进程环境变量优先；修改配置后需重启进程。开发用 `OLLAMA_BASE_URL` 不会覆盖 Compose 内部服务地址。

```bash
npm run typecheck
npm test
npm run build
SENSEVOICE_URL=http://127.0.0.1:50000 npm start
```

## 验证

单元与 API 测试覆盖：44.1/48 kHz 重采样、PCM 编码、非法 WAV 拒绝、情绪标签解析、未知标签、静音事件、真实 multipart 转发和模型不可用时的返回。

短回应测试覆盖 CSV 格式与错误定位、情绪窗口、概率合法性、权重边界、冷却、单候选、去重、回执、内存记录回收与并发取消。真实 `ollama` SDK 连接模拟 HTTP 上游，验证 `/v1/systemone` 路径、错误、超时和独立取消。普通测试无需启动 Ollama。浏览器测试检查身份和请求字段、绘制回执、显示方式切换、隐藏/清空/关停、新录音、过期结果、静默跳过和错误恢复；矩阵像素、液态文字、无 WebGL、减少动态效果及手机布局继续覆盖。

显式运行本地 Laya 多候选评分验收，以及真实 AudioWorklet → SenseVoice → 情绪决策接口。自然音频可能只有平静或不稳定情绪；浏览器测试不人为改标签强迫显示，独立 SDK 测试必须完成真实多候选推理：

```bash
LIVE_LAYA_TEST=true npx vitest run tests/reaction-api.test.ts -t 'uses the deployed Laya'
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
- `POST /api/reaction/decision`：JSON `{ clientId, sessionId, generation, turnId, sequence, emotion, isSpeech, canDisplay }`。标识为 1–64 位字母、数字、下划线或连字符，代次和序号为非负安全整数。不能上传转写、音频、候选、概率、使用记录或模型配置。
- `POST /api/reaction/displayed`：JSON `{ clientId, sessionId, generation, decisionId }`；首次有效回执返回 `accepted`，重复返回 `duplicate`，未知、归属不符或失效返回 HTTP 409 与 `rejected`。

成功返回 `status: "replied"`、最终 `text`、`phraseId`、`decisionId`、`emotion`、请求身份、`expiresAt`（服务端墙钟毫秒期限）、`displayMs`、`animationGapMs`、`latencyMs` 和 `requestId`。期限用于前端防止迟到展示，冷却与回执时限以服务端单调时钟为准。跳过返回 `status: "skipped"` 和原因。错误返回 `status: "error"`、`code` 与 `error`：词库/配置/模型缺失为 503，繁忙为 429，超时为 504，上游或评分非法为 502，非法请求为 400。旧 `/api/reaction` 已删除；发布时前后端需一起更新。`GET /api/health` 仍只反映 SenseVoice 状态。

网页服务默认对外开放 3000 端口；模型服务仅供 Docker 内部调用。该 Demo 没有用户登录，适用于本机或可信演示网络。
