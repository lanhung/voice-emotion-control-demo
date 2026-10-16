# Source and model revisions are pinned; downloads are verified before use.
# Neither build nor runtime needs a checkout/model cache outside this project.
FROM python:3.11-slim-bookworm AS source
ADD --checksum=sha256:46ee4f6d77d558586a4647c43b339b0b94328828c82871b2ab05427f1b07be6c \
    https://codeload.github.com/QwenAudio/SenseVoice/tar.gz/586bbdb2b052f4fe19322581825228b6810a9fb3 /tmp/sensevoice.tar.gz
RUN mkdir -p /source && tar -xzf /tmp/sensevoice.tar.gz --strip-components=1 -C /source

FROM scratch AS model
ARG SENSEVOICE_MODEL_BASE_URL=https://modelscope.cn/models/iic/SenseVoiceSmall/resolve/7bf452403abd7353a300cd760f7adae7701c92c1
ADD --checksum=sha256:833ca2dcfdf8ec91bd4f31cfac36d6124e0c459074d5e909aec9cabe6204a3ea \
    ${SENSEVOICE_MODEL_BASE_URL}/model.pt /models/model.pt
ADD --checksum=sha256:f71e239ba36705564b5bf2d2ffd07eece07b8e3f2bbf6d2c99d8df856339ac19 \
    ${SENSEVOICE_MODEL_BASE_URL}/config.yaml /models/config.yaml
ADD --checksum=sha256:02810a7f8e9e8aee10370a265f7e799728ce25b4c00cdbf4602b303ee395a38e \
    ${SENSEVOICE_MODEL_BASE_URL}/configuration.json /models/configuration.json
ADD --checksum=sha256:29b3c740a2c0cfc6b308126d31d7f265fa2be74f3bb095cd2f143ea970896ae5 \
    ${SENSEVOICE_MODEL_BASE_URL}/am.mvn /models/am.mvn
ADD --checksum=sha256:aa87f86064c3730d799ddf7af3c04659151102cba548bce325cf06ba4da4e6a8 \
    ${SENSEVOICE_MODEL_BASE_URL}/chn_jpn_yue_eng_ko_spectok.bpe.model /models/chn_jpn_yue_eng_ko_spectok.bpe.model
ADD --checksum=sha256:a2594fc1474e78973149cba8cd1f603ebed8c39c7decb470631f66e70ce58e97 \
    ${SENSEVOICE_MODEL_BASE_URL}/tokens.json /models/tokens.json
ADD --checksum=sha256:0e64de19e4ff9a02e682955c9112f32d2317cfdbb5bc2f3504664044c993f195 \
    ${SENSEVOICE_MODEL_BASE_URL}/example/zh.mp3 /models/example/zh.mp3
ADD --checksum=sha256:1e9a3ad58f907aeb099a650a2f2565c64f9936820c8654016c3980b767a6407b \
    ${SENSEVOICE_MODEL_BASE_URL}/README.md /models/README.md

FROM python:3.11-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=4 MKL_NUM_THREADS=4 INFERENCE_THREADS=4 \
    SENSEVOICE_SOURCE=/opt/SenseVoice SENSEVOICE_MODEL=/models \
    HF_HUB_OFFLINE=1 MODELSCOPE_OFFLINE=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY inference/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=source /source/model.py /opt/SenseVoice/model.py
COPY --from=source /source/utils /opt/SenseVoice/utils
COPY --from=source /source/LICENSE /opt/SenseVoice/LICENSE
COPY --from=model /models /models
COPY inference/serve.py ./serve.py
EXPOSE 50000
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=4 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:50000/health', timeout=3)" || exit 1
CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "50000", "--no-access-log"]
