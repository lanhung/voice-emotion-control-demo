FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=4 MKL_NUM_THREADS=4 INFERENCE_THREADS=4 \
    SENSEVOICE_SOURCE=/opt/SenseVoice SENSEVOICE_MODEL=/models \
    HF_HUB_OFFLINE=1 MODELSCOPE_OFFLINE=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY inference/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=sensevoice_source model.py /opt/SenseVoice/model.py
COPY --from=sensevoice_source utils /opt/SenseVoice/utils
COPY inference/serve.py ./serve.py
EXPOSE 50000
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=4 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:50000/health', timeout=3)" || exit 1
CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "50000", "--no-access-log"]
