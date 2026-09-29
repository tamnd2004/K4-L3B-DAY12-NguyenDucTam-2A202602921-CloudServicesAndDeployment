# Phiếu Phản Ánh — K4 Level 3B, Ngày 12

> **Bài làm cá nhân.** Trả lời bằng lời của chính bạn, dựa trên những gì bạn
> quan sát được khi chạy code — không sao chép đáp án của người khác.
>
> Cách trả lời: thay dòng placeholder "Câu trả lời của bạn" dưới mỗi câu bằng câu trả lời.
> `grade.py` đếm số câu đã trả lời (15 điểm cho 10 câu).
>
> Họ và tên: **Nguyễn Đức Tâm**  Mã học viên: **2A202602921**

---

### Câu 1 — Fail fast (CP1)

Trong `Settings`, `agent_api_key` không có giá trị mặc định nên app chết ngay
khi khởi động nếu thiếu biến môi trường. Hãy mô tả một tình huống cụ thể mà
việc "chết sớm" này cứu bạn, so với việc để mặc định `"changeme"`.

> **Tình huống:** deploy lên Railway nhưng quên set `AGENT_API_KEY` trong Variables.
>
> - Nếu có mặc định `"changeme"`: service vẫn lên, `/health` 200, dashboard xanh. Nhưng chuỗi `"changeme"` nằm trong code của một repo **public**, ai đọc code cũng gọi được `/ask` bằng khóa đó và tiêu ngân sách LLM của tôi. Tôi chỉ phát hiện khi thấy hóa đơn hoặc log lạ.
> - Không có mặc định: container chết ngay lúc khởi động, lần deploy báo đỏ, log nói rõ thiếu biến gì. Tôi sửa trong 1 phút và không có giây nào service chạy với khóa ai cũng biết.
>
> **Quan sát thật:** chạy image không truyền key (`docker run -e REDIS_URL=fake:// day12-agent:prod`) → container thoát ngay với **exit code 3**, log:
> `ValidationError: 1 validation error for Settings — agent_api_key: Field required` rồi `Application startup failed. Exiting.`
>
> Lưu ý tôi rút ra: chỉ khai báo trường bắt buộc là chưa đủ. Ban đầu `get_settings()` chỉ được gọi ở request đầu tiên nên container thiếu key vẫn "healthy". Phải gọi `get_settings()` trong `lifespan` thì mới thật sự fail fast lúc khởi động (chi tiết ở câu 10).

---

### Câu 2 — Log cho máy đọc (CP1)

Chạy service và gọi `/ask` vài lần. Dán một dòng log JSON bạn thu được, rồi
nêu **hai** việc bạn làm được với dòng log đó mà `print("đã trả lời xong")`
không làm được.

> Một dòng log thật khi gọi `/ask` trên stack docker compose:
>
> ```json
> {"event": "ask_completed", "level": "info", "timestamp": "2026-09-29T03:15:02.828939+00:00", "user_id": "sv01", "tokens_in": 179, "tokens_out": 50, "cost_usd": 5.685e-05}
> ```
>
> Hai việc làm được mà `print("đã trả lời xong")` không làm được:
>
> 1. **Lọc và cộng dồn theo field.** Ví dụ lọc `event = "ask_completed"`, nhóm theo `user_id`, cộng `cost_usd` để biết user nào tốn tiền nhất trong ngày, hoặc tính token trung bình mỗi request. Với chuỗi tự do thì phải viết regex, và regex vỡ ngay khi ai đó sửa câu chữ trong `print`.
> 2. **Đặt cảnh báo và tra cứu trên nền tảng log.** Railway tự tách dòng JSON thành field có cấu trúc (log khởi động hiện dạng `[INFO] event="service_started" service="day12-agent" version="1.0.0"`), nên tôi lọc được `level = error` hoặc đặt alert khi số `ask_completed` của một user tăng đột biến. `timestamp` theo ISO-8601/UTC giúp ghép log của 3 container vào đúng thứ tự thời gian. Mỗi event nằm gọn trên 1 dòng nên collector không cắt đôi một event thành hai bản ghi.

---

### Câu 3 — Kích thước image (CP2)

Build cả hai phiên bản và ghi lại số đo thật:

```bash
docker build -f <Dockerfile-1-stage> -t agent:single .
docker build -t agent:multi .
docker images | grep agent
```

| Bản | Dung lượng |
|-----|-----------|
| 1 stage (bản đầu) | 1.19 GB (~1190 MB) |
| Multi-stage | 184 MB |

Giải thích: phần dung lượng chênh lệch đó là những gì?

> Số đo thật từ `docker images`: `agent:single` (Dockerfile gốc, `FROM python:3.11`) **1.19 GB**; `agent:multi` (cũng là `day12-agent:prod`, `python:3.11-slim`) **184 MB**. Cả hai dùng cùng `requirements.txt` và cùng source code. Chênh lệch khoảng **1 GB**. `docker history agent:single` cho thấy phần đó gồm:
>
> 1. **Base image đầy đủ (~1.1 GB):** `python:3.11` là Debian đầy đủ, kèm `gcc`, `make`, header `-dev`, git, và nhiều thư viện hệ thống chỉ cần khi *biên dịch* package. App chỉ cần *chạy* Python, nên `python:3.11-slim` (125 MB) là đủ. Đây là phần lớn nhất của chênh lệch.
> 2. **Layer `pip install` 84.6 MB ở bản 1 stage**, trong khi bản multi-stage chỉ thêm khoảng 59 MB thư viện trên nền slim. Bản đầu chạy `pip install` không có `--no-cache-dir` nên cache tải về của pip nằm lại trong image. Bản multi-stage cài vào `/install` ở stage `builder` rồi chỉ `COPY --from=builder /install` sang, nên cache, pip metadata và mọi thứ phát sinh lúc build bị bỏ lại cùng stage builder.
> 3. **`COPY . .`:** ở lần đo này layer chỉ có 29 KB vì tôi đã sửa `.dockerignore`. Với `.dockerignore` gốc (chỉ loại `.git`) thì `COPY . .` sẽ chép cả `.venv`, `__pycache__`, `.pytest_cache`, và tệ nhất là `.env` chứa secret vào image.

---

### Câu 4 — Thứ tự lệnh trong Dockerfile (CP2)

Sửa một ký tự trong `app/main.py` rồi build lại. Với Dockerfile của bạn, những
layer nào được dùng lại từ cache, layer nào phải chạy lại? Nếu bạn đặt
`COPY . .` lên trước `RUN pip install` thì kết quả khác thế nào?

> **Thí nghiệm thật:** build một lần, sửa một ký tự trong `app/main.py` (`SERVICE_VERSION = "1.0.1"` → `"1.0.2"`), rồi build lại.
>
> **Với Dockerfile của tôi** (COPY `requirements.txt` → `pip install` → COPY code), build lại mất **3 giây**:
>
> ```
> [builder 3/4] COPY requirements.txt .                 CACHED
> [builder 4/4] RUN pip install --prefix=/install ...   CACHED
> [runtime 2/6] RUN useradd ... appuser                 CACHED
> [runtime 4/6] COPY --from=builder /install /usr/local CACHED
> [runtime 5/6] COPY app ./app                          chạy lại (0.2s)
> [runtime 6/6] COPY utils ./utils                      chạy lại (0.1s)
> ```
>
> Layer `COPY app` có checksum mới vì `main.py` đổi. Docker hủy cache từ layer đó trở xuống nên `COPY utils` cũng chạy lại. Mọi layer phía trên, gồm cả `pip install`, được dùng lại vì `requirements.txt` không đổi.
>
> **Khi đặt `COPY . .` trước `RUN pip install`** (tôi build thử bản này): sửa cùng một ký tự thì layer `COPY . .` đổi checksum, kéo theo `RUN pip install` **chạy lại từ đầu, mất 68.6 giây**, tải lại toàn bộ package từ PyPI. Mỗi lần sửa một dấu phẩy là chờ hơn 1 phút thay vì 3 giây. Ở một lần thử trước đó khi mạng chập chờn, bước cài lại này còn **fail sau 234 giây** vì `ReadTimeoutError` tới PyPI: build hỏng chỉ vì sửa một dòng code, trong khi bản đúng thứ tự không hề cần mạng.

---

### Câu 5 — Vì sao không chạy bằng root (CP2)

Container mặc định chạy bằng root. Mô tả chuỗi sự kiện dẫn từ "một lỗ hổng
trong code Python của bạn" tới "kẻ tấn công có quyền cao trên máy host", và
lệnh `USER` cắt đứt chuỗi đó ở chỗ nào.

> **Chuỗi sự kiện khi container chạy root:**
>
> 1. Code Python (hoặc một thư viện) có lỗ hổng cho phép thực thi lệnh, ví dụ deserialize dữ liệu không tin cậy hoặc một CVE trong dependency → kẻ tấn công có shell trong container **với quyền của process uvicorn**.
> 2. Process đó là root (uid 0). Không có user namespace thì uid 0 trong container chính là uid 0 trên kernel của host. Kẻ tấn công sửa được code trong `/app`, cài thêm công cụ bằng `apt`, đọc mọi secret trong env.
> 3. Chỉ cần thêm một cấu hình lỏng lẻo (mount `/var/run/docker.sock`, `--privileged`, mount thư mục host) hoặc một lỗi kernel là thoát ra host **với quyền root**. File ghi vào volume mount cũng thuộc root trên host.
>
> **`USER` cắt chuỗi ở bước 2:** trong image của tôi, `docker run ... id` in ra `uid=10001(appuser) gid=10001(appuser)`. RCE lúc này chỉ có quyền của một user thường: không ghi được vào `/app` (code do root sở hữu, appuser chỉ đọc), không `apt install` được. Kể cả khi thoát ra được qua volume thì cũng chỉ là uid 10001 không có đặc quyền trên host. Lỗ hổng vẫn còn nhưng thiệt hại bị khoanh lại.

---

### Câu 6 — Cửa sổ trượt (CP3)

Rate limit của bạn dùng sliding window 60 giây. Nếu thay bằng cách đếm theo
phút đồng hồ (reset lúc giây 00), một người dùng có thể gửi tối đa bao nhiêu
request trong 2 giây liên tiếp khi hạn mức là 10/phút? Giải thích cách đạt được
con số đó.

> **Tối đa 20 request trong 2 giây.**
>
> Cách đạt được với cách đếm theo phút đồng hồ (hạn mức 10/phút): gửi 10 request lúc `10:00:59` (hết hạn mức của phút 10:00), bộ đếm reset lúc `10:01:00`, gửi tiếp 10 request lúc `10:01:00`–`10:01:01`. Cả 20 request "đúng luật" vì mỗi phút đồng hồ chỉ có 10, nhưng thực tế server nhận gấp đôi hạn mức trong 2 giây.
>
> Sliding window không có "biên phút" để lách: nó luôn đếm các request trong 60 giây **tính ngược từ thời điểm hiện tại** (ZSET, xóa entry có score `< now - 60` rồi `ZCARD`). Request thứ 11 trong bất kỳ khoảng 60 giây nào cũng bị chặn. Trên Railway tôi gọi liên tục: 10 request đầu `200`, request thứ 11 trả `429` kèm `Retry-After: 60`.

---

### Câu 7 — Rate limit và cost guard (CP3)

Hai cơ chế này khác nhau ở điểm nào? Cho một tình huống mà rate limit cho qua
nhưng cost guard phải chặn, và một tình huống ngược lại.

> | | Rate limit | Cost guard |
> |---|---|---|
> | Đếm cái gì | **số request** / 60 giây trượt | **số tiền** (USD) / tháng UTC |
> | Bảo vệ khỏi | spam, bot, dùng quá dồn dập | đốt ngân sách LLM |
> | Mã lỗi | 429 + `Retry-After` | 402 Payment Required |
> | Tự hết khi nào | sau tối đa 60 giây | sang tháng mới |
>
> **Rate limit cho qua nhưng cost guard chặn:** user gửi chậm (vài request/phút, dưới hạn mức 10) nhưng mỗi request kèm lịch sử dài hoặc prompt hàng chục nghìn token, hoặc gửi đều đặn cả tháng → tổng chi phí vượt 10 USD. Tôi mô phỏng bằng cách đặt `cost:sv-budget:2026-09 = 999` trong Redis: request **đầu tiên** của user đó (rate limit còn trống) nhận ngay `402 monthly budget exceeded`.
>
> **Ngược lại, cost guard cho qua nhưng rate limit chặn:** script gửi dồn câu hỏi rất ngắn. Trên Railway, 10 request `"test"` chỉ tốn khoảng 0,0002 USD (mỗi request ~2e-05 USD), còn rất xa 10 USD, nhưng request thứ 11 trong cùng phút vẫn bị `429`.

---

### Câu 8 — /health khác /ready (CP4)

Nếu gộp hai endpoint làm một và cho nó kiểm tra Redis, chuyện gì xảy ra với cụm
3 container khi Redis mất kết nối 30 giây? Trả lời theo đúng thứ tự sự kiện.

> Giả sử gộp thành một endpoint `/health` có ping Redis, orchestrator dùng nó làm liveness (ví dụ interval 10s, 3 lần fail thì restart):
>
> 1. **t = 0s:** Redis mất kết nối. Cả 3 container cùng ping Redis thất bại → cùng trả 503.
> 2. **t ≈ 10–30s:** orchestrator thấy 3 lần fail liên tiếp ở **cả 3** container → đánh dấu unhealthy.
> 3. **t ≈ 30s:** orchestrator **restart cả 3 cùng lúc**. Request đang xử lý dở bị cắt (502), không còn instance nào nhận traffic → sập 100%, kể cả những request không cần Redis.
> 4. **t ≈ 30s+:** Redis đã quay lại nhưng các container đang khởi động lại, service vẫn chưa phục vụ được. Nếu Redis còn chập chờn thì các container rơi vào vòng restart liên tục.
>
> Một sự cố 30 giây của dependency biến thành downtime dài hơn của cả cụm, dù bản thân các process không hề hỏng.
>
> **Khi tách hai endpoint (đã thử thật trên stack 3 container):** tắt Redis (`docker compose stop redis`) → `/health` vẫn `200`, `/ready` trả `503 {"status":"not ready","redis":false}`. Sau 25 giây cả 3 container **vẫn `(healthy)`, không bị restart**. Bật Redis lại → `/ready` về `200` ngay. Load balancer chỉ ngừng gửi traffic trong lúc Redis hỏng, process không bị giết.

---

### Câu 9 — Stateless (CP4)

Chạy `docker compose up --scale agent=3` rồi gọi `/ask` nhiều lần với cùng một
`X-User-Id`. Quan sát `history_length` trong response. Nếu lịch sử được lưu
trong một dict Python thay vì Redis, bạn sẽ thấy con số đó thay đổi thế nào?

> **Quan sát thật** (3 container agent sau nginx, gọi 5 lần với `X-User-Id: sv01`):
>
> ```
> history_length = 0, 2, 4, 6, 8
> ```
>
> Log `ask_completed` cho thấy các request rơi vào cả `agent-1`, `agent-2` và `agent-3`, nhưng con số vẫn tăng đều 2 mỗi lượt (1 message user + 1 message assistant). Trong Redis, `LLEN history:sv01 = 10`, `TTL ≈ 604 800 s` (7 ngày), vì mọi container cùng đọc/ghi một list `history:sv01`.
>
> **Nếu lưu trong dict Python:** mỗi container có một dict riêng trong RAM, nên `history_length` phụ thuộc vào việc request rơi vào container nào. Với round-robin qua 3 container A, B, C sẽ thấy kiểu `0, 0, 0, 2, 2, 2, 4, …`: lượt 2 vào B nên B không biết lượt 1 ở A, agent "mất trí nhớ" lúc nhớ lúc quên. Mỗi lần container restart (deploy, scale, crash) thì lịch sử trong container đó về 0.

---

### Câu 10 — Deploy thật (CP5)

Ghi lại **một** lỗi bạn gặp khi deploy lên cloud (build fail, health check
timeout, sai REDIS_URL, app không đọc `$PORT`...): thông báo lỗi là gì, bạn
tìm ra nguyên nhân bằng cách nào, và sửa ra sao?

> **Lỗi:** service thiếu `AGENT_API_KEY` vẫn khởi động và báo **healthy**, thay vì fail fast. Nếu quên set biến này trên Railway, dashboard vẫn xanh nhưng mọi request `/ask` đều trả 500.
>
> **Phát hiện thế nào:** trước khi deploy, tôi chạy image đúng như cloud sẽ chạy nhưng cố tình không truyền key:
> `docker run --rm -e REDIS_URL=fake:// day12-agent:prod`. Tôi chờ container chết, nhưng lệnh cứ treo. `docker ps` cho thấy container `Up About a minute (healthy)`, log không có lỗi gì.
>
> **Tìm nguyên nhân:** unit test `test_thieu_api_key_thi_fail_fast` vẫn pass vì nó gọi thẳng `Settings()`. Nhưng trong app, `Settings()` chỉ được tạo trong `get_settings()`, và hàm này chỉ chạy khi có request cần `verify_api_key` hoặc Redis. `lifespan` và `/health` không đụng tới cấu hình, nên lúc khởi động không có gì kiểm tra biến môi trường, còn healthcheck chỉ gọi `/health`.
>
> **Sửa:** gọi `get_settings()` ở đầu `lifespan` trong `app/main.py`. Chạy lại cùng lệnh → container thoát ngay, **exit code 3**:
> `ValidationError: 1 validation error for Settings — agent_api_key Field required` rồi `ERROR: Application startup failed. Exiting.` Bài học: test unit pass chưa chắc hành vi lúc chạy đúng, phải chạy thử image theo đúng cách platform chạy.
>
> Một lỗi khác tôi tránh được nhờ đọc tài liệu Railway: `railway.toml` mẫu có `startCommand = "uvicorn ... --port $PORT"`. Với service build từ Dockerfile, Railway chạy start command ở dạng exec (không qua shell) nên `$PORT` không được thay giá trị, uvicorn sẽ nhận nguyên chuỗi `"$PORT"`. Tôi bỏ `startCommand` để Railway dùng `CMD sh -c "... --port ${PORT:-8000}"` trong Dockerfile. Log trên Railway xác nhận `Uvicorn running on http://0.0.0.0:8080`, đúng cổng Railway cấp.
