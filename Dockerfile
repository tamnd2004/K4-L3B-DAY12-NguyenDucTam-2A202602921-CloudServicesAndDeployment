# ═══════════════════════════════════════════════════════════════════
# CP2 — Containerization (production-ready)
#
#   [x] Multi-stage: `builder` cài dependency vào /install, `runtime` chỉ
#       copy kết quả sang → không mang theo pip cache, compiler, source thừa
#   [x] Base image python:3.11-slim cho cả hai stage
#   [x] COPY requirements.txt + pip install TRƯỚC khi COPY source (layer cache)
#   [x] Chạy bằng user thường `appuser` (uid 10001), code thuộc root → app
#       không tự sửa được chính mình
#   [x] HEALTHCHECK gọi /health
#   [x] Bind 0.0.0.0, cổng đọc từ ${PORT:-8000}
#
# Kiểm tra:  pytest tests/test_cp2.py -v
# Build thử: docker build -t day12-agent:prod .
#            docker images day12-agent:prod     # xem dung lượng
# ═══════════════════════════════════════════════════════════════════

# ── Stage 1: builder ────────────────────────────────────────────────
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# Chỉ copy requirements.txt → layer này chỉ build lại khi dependency đổi
COPY requirements.txt .
RUN pip install --prefix=/install -r requirements.txt


# ── Stage 2: runtime ────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN useradd --create-home --uid 10001 appuser

WORKDIR /app

# Thư viện đã cài sẵn ở stage builder
COPY --from=builder /install /usr/local

# Source code copy SAU cùng: sửa code không làm mất cache của pip install
COPY app ./app
COPY utils ./utils

USER appuser

EXPOSE 8000

# Shell form để ${PORT:-8000} được mở rộng lúc chạy, khớp với cổng uvicorn đang nghe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${PORT:-8000}/health', timeout=3)" || exit 1

# `exec` để uvicorn thay thế sh làm PID 1 → nhận thẳng SIGTERM từ orchestrator
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
