FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.9.1 \
    && pip install --no-cache-dir -r requirements.txt
COPY *.py ./
RUN useradd --create-home --uid 10001 vision && mkdir -p /data && chown vision /data
USER vision
ENV VISION_INDEX_PATH=/data/vision.sqlite3 HF_HOME=/data/huggingface
VOLUME ["/data"]
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
