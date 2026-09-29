/* Page logic: scramble text, /ask client, /health + /ready probes, curl snippet.
 * Talks to the hero through `agent:log` / `agent:status` events. */
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (sel, root = document) => root.querySelector(sel);
  const emitLog = (obj) => window.dispatchEvent(new CustomEvent("agent:log", { detail: JSON.stringify(obj) }));
  const emitStatus = (s) => window.dispatchEvent(new CustomEvent("agent:status", { detail: s }));
  const session = {
    get(k) { try { return window.sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { window.sessionStorage.setItem(k, v); } catch { /* storage blocked */ } },
    del(k) { try { window.sessionStorage.removeItem(k); } catch { /* storage blocked */ } },
  };

  // ── Scramble: chữ hiện dần theo thứ tự ngẫu nhiên, không xô lệch layout ──
  const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&/";
  function prepare(el) {
    if (el._sc) return el._sc;
    const text = el.textContent.replace(/\s+/g, " ").trim();
    const sr = document.createElement("span");
    sr.className = "sr-only";
    sr.textContent = text;
    const vis = document.createElement("span");
    vis.setAttribute("aria-hidden", "true");
    const spans = [...text].map((ch) => {
      const s = document.createElement("span");
      s.className = "sc";
      s.textContent = ch;
      if (ch.trim() && !reduceMotion) s.classList.add("is-hidden");
      vis.appendChild(s);
      return s;
    });
    el.replaceChildren(sr, vis);
    el.classList.add("sc-ready");
    el._sc = { text, spans };
    return el._sc;
  }
  function scramble(el, duration = 800) {
    const { text, spans } = prepare(el);
    const chars = [...text];
    if (reduceMotion) { spans.forEach((s) => s.classList.remove("is-hidden", "is-ghost")); return; }
    const at = chars.map(() => Math.random() * duration);
    const start = performance.now();
    cancelAnimationFrame(el._scRaf);
    const tick = (now) => {
      const t = now - start;
      let pending = false;
      spans.forEach((s, i) => {
        if (!chars[i].trim()) return;
        if (t >= at[i]) { s.classList.remove("is-hidden", "is-ghost"); return; }
        pending = true;
        if (t > at[i] - duration * 0.45 && Math.random() < 0.3) {
          s.dataset.g = GLYPHS[(Math.random() * GLYPHS.length) | 0];
          s.classList.add("is-ghost");
          s.classList.remove("is-hidden");
        } else if (Math.random() < 0.08) {
          s.classList.remove("is-ghost");
          s.classList.add("is-hidden");
        }
      });
      if (pending) el._scRaf = requestAnimationFrame(tick);
    };
    el._scRaf = requestAnimationFrame(tick);
  }
  function setScrambled(el, text, duration = 500) {
    if (el.dataset.value === text) return;
    el.dataset.value = text;
    el._sc = null;
    el.textContent = text;
    scramble(el, duration);
  }

  const introEls = [...document.querySelectorAll("[data-scramble]")];
  introEls.forEach(prepare);
  setTimeout(() => introEls.forEach((el, i) => scramble(el, 650 + i * 70)), reduceMotion ? 0 : 1000);
  document.querySelectorAll(".nav a, .scroll-down").forEach((a) => {
    a.addEventListener("mouseenter", () => scramble(a, 380));
    a.addEventListener("focus", () => scramble(a, 380));
  });
  const viewEls = [...document.querySelectorAll("[data-scramble-view]")];
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      scramble(en.target, 900);
      io.unobserve(en.target);
    }), { threshold: 0.35 });
    viewEls.forEach((el) => { prepare(el); io.observe(el); });
  }

  // Header đặc lại khi đã cuộn qua hero
  const header = $(".site-header");
  const hero = $(".hero");
  if (header && hero && "IntersectionObserver" in window) {
    new IntersectionObserver(([en]) => header.classList.toggle("is-solid", !en.isIntersecting),
      { rootMargin: "-64px 0px 0px 0px" }).observe(hero);
  }

  // ── Ask ─────────────────────────────────────────────────────────
  const form = $("#ask-form");
  const keyEl = $("#api-key");
  const userEl = $("#user-id");
  const qEl = $("#question");
  const sendBtn = $("#send");
  const sendLabel = $("#send-label");
  const msgEl = $("#form-msg");
  const thread = $("#thread");
  const remember = $("#remember");
  const KEY_SLOT = "day12.agentKey";

  const savedKey = session.get(KEY_SLOT);
  if (savedKey) { keyEl.value = savedKey; remember.checked = true; }
  remember.addEventListener("change", () => {
    if (remember.checked && keyEl.value.trim()) session.set(KEY_SLOT, keyEl.value.trim());
    else session.del(KEY_SLOT);
  });
  keyEl.addEventListener("input", () => {
    $("#field-key").classList.remove("is-invalid");
    if (remember.checked) session.set(KEY_SLOT, keyEl.value.trim());
  });
  qEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
  });

  function setMsg(text, isError = false) {
    msgEl.textContent = text;
    msgEl.classList.toggle("is-error", isError);
  }
  const fmtCost = (v) => "$" + (v < 0.01 ? v.toFixed(6) : v.toFixed(4));
  const currentUser = () => userEl.value.trim() || "anonymous";

  function addMsg(kind, text, meta) {
    const empty = thread.querySelector(".thread-empty");
    if (empty) empty.remove();
    const li = document.createElement("li");
    li.className = `msg is-${kind}`;
    const m = document.createElement("div");
    m.className = "msg-meta";
    const body = document.createElement("p");
    body.className = "msg-body";
    body.textContent = text;
    li.append(m, body);
    thread.append(li);
    setMeta(li, meta);
    thread.scrollTop = thread.scrollHeight;
    return li;
  }
  function setMeta(li, meta) {
    li.querySelector(".msg-meta").replaceChildren(...meta.map((x) => {
      const s = document.createElement("span");
      s.textContent = x;
      return s;
    }));
  }

  // Sliding window phía client: những request đã tới được rate limiter, theo từng user
  const hits = new Map();
  function recordHit(uid, blocked) {
    const list = hits.get(uid) || [];
    list.push({ t: Date.now(), blocked });
    hits.set(uid, list);
    renderWindow();
  }
  function renderWindow() {
    const uid = currentUser();
    const now = Date.now();
    const list = (hits.get(uid) || []).filter((h) => now - h.t < 60000);
    hits.set(uid, list);
    $("#win-user").textContent = uid;
    $("#win-track").replaceChildren(...list.map((h) => {
      const d = document.createElement("span");
      d.className = "hit" + (h.blocked ? " is-blocked" : "");
      d.style.left = `${100 - (now - h.t) / 600}%`;
      return d;
    }));
    const allowed = list.filter((h) => !h.blocked).length;
    const blocked = list.length - allowed;
    $("#win-count").textContent = `${allowed} allowed` + (blocked ? ` · ${blocked} blocked` : "");
  }
  setInterval(renderWindow, 250);
  userEl.addEventListener("input", renderWindow);

  let cooldownTimer = 0;
  function cooldown(seconds) {
    clearInterval(cooldownTimer);
    let left = seconds;
    sendBtn.disabled = true;
    sendLabel.textContent = `Wait ${left}s`;
    cooldownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = 0;
        sendBtn.disabled = false;
        sendLabel.textContent = "Send";
        return;
      }
      sendLabel.textContent = `Wait ${left}s`;
    }, 1000);
  }

  let sessionCost = 0;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = keyEl.value.trim();
    const user = userEl.value.trim();
    const question = qEl.value.trim();
    if (!key) {
      $("#field-key").classList.add("is-invalid");
      setMsg("Paste the API key (the AGENT_API_KEY this service runs with) first.", true);
      keyEl.focus();
      return;
    }
    if (!question) { setMsg("Type a question first.", true); qEl.focus(); return; }

    const uid = user || "anonymous";
    addMsg("user", question, ["You", uid]);
    const reply = addMsg("agent is-pending", "", ["Agent", "thinking"]);
    setMsg("");
    sendBtn.disabled = true;

    const headers = { "Content-Type": "application/json", "X-API-Key": key };
    if (user) headers["X-User-Id"] = user;
    const started = performance.now();
    let res = null, body = null;
    try {
      res = await fetch("/ask", { method: "POST", headers, body: JSON.stringify({ question }) });
      try { body = await res.json(); } catch { body = null; }
    } catch { res = null; }
    const ms = Math.round(performance.now() - started);
    reply.classList.remove("is-pending");

    if (res && res.ok && body) {
      recordHit(uid, false);
      reply.querySelector(".msg-body").textContent = body.answer;
      setMeta(reply, ["Agent", `history ${body.history_length}`, `${body.tokens.in}/${body.tokens.out} tok`, fmtCost(body.cost_usd), `${ms} ms`]);
      sessionCost += body.cost_usd;
      $("#m-history").textContent = body.history_length;
      $("#m-cost").textContent = fmtCost(sessionCost);
      $("#m-tokens").textContent = `${body.tokens.in}/${body.tokens.out}`;
      emitLog({ event: "ask_completed", user_id: body.user_id, tokens_in: body.tokens.in, tokens_out: body.tokens.out, cost_usd: body.cost_usd });
      qEl.value = "";
      sendBtn.disabled = Boolean(cooldownTimer);
      return;
    }

    const code = res ? res.status : 0;
    let text;
    if (code === 401) {
      text = "401 · Invalid or missing API key.";
      $("#field-key").classList.add("is-invalid");
    } else if (code === 402) {
      recordHit(uid, false);
      text = "402 · Monthly budget exceeded for this user.";
    } else if (code === 429) {
      recordHit(uid, true);
      const retryAfter = parseInt(res.headers.get("Retry-After") || "60", 10);
      const allowed = (hits.get(uid) || []).filter((h) => !h.blocked).map((h) => h.t);
      const local = allowed.length ? Math.ceil((Math.min(...allowed) + 60000 - Date.now()) / 1000) : retryAfter;
      const wait = Math.max(1, Math.min(retryAfter, local > 0 ? local : retryAfter));
      text = `429 · Rate limit reached for ${uid}. Retry in ${wait} s.`;
      cooldown(wait);
    } else if (code === 422) {
      text = "422 · The question must be 1–2000 characters.";
    } else if (code === 0) {
      text = "Network error: the service did not answer. See Status below.";
    } else {
      text = `${code} · ${(body && body.detail) || "Service error"}`;
    }
    reply.classList.add("is-error");
    reply.querySelector(".msg-body").textContent = text;
    setMeta(reply, ["Agent", `HTTP ${code || "—"}`, `${ms} ms`]);
    setMsg(text, true);
    emitLog({ event: "ask_rejected", status: code, user_id: uid });
    if (code !== 429) sendBtn.disabled = false;
  });

  // ── Probes ──────────────────────────────────────────────────────
  const probes = {
    health: { el: $("#probe-health"), hist: [] },
    ready: { el: $("#probe-ready"), hist: [] },
  };
  async function hit(path) {
    const started = performance.now();
    try {
      const r = await fetch(path, { cache: "no-store", headers: { Accept: "application/json" } });
      const ms = Math.round(performance.now() - started);
      let body = null;
      try { body = await r.json(); } catch { body = null; }
      return { code: r.status, ok: r.ok, ms, body };
    } catch {
      return { code: 0, ok: false, ms: null, body: null };
    }
  }
  function renderProbe(name, r) {
    const p = probes[name];
    const el = p.el;
    p.hist.push(r);
    if (p.hist.length > 40) p.hist.shift();

    let state, detail;
    if (name === "health") {
      state = r.ok ? "Alive" : r.code === 503 ? "Stopping" : "Down";
      detail = r.body && r.body.version ? `v${r.body.version}` : (r.body && r.body.status) || "—";
    } else {
      const shutting = r.body && r.body.status === "shutting_down";
      state = r.ok ? "Ready" : shutting ? "Stopping" : r.code === 503 ? "Not ready" : "Down";
      detail = r.body && "redis" in r.body ? `redis ${r.body.redis ? "up" : "down"}` : (r.body && r.body.status) || "—";
    }
    el.dataset.ok = String(r.ok);
    setScrambled(el.querySelector("[data-state]"), state);
    el.querySelector("[data-code]").textContent = r.code || "ERR";
    el.querySelector("[data-latency]").textContent = r.ms == null ? "—" : `${r.ms} ms`;
    el.querySelector("[data-detail]").textContent = detail;

    const bars = [];
    for (let i = p.hist.length; i < 40; i++) {
      const b = document.createElement("span");
      b.className = "bar is-empty";
      bars.push(b);
    }
    p.hist.forEach((h) => {
      const b = document.createElement("span");
      b.className = "bar" + (h.ok ? "" : " is-fail");
      if (h.ok) b.style.height = `${Math.max(6, Math.min(100, (h.ms / 300) * 100))}%`;
      bars.push(b);
    });
    el.querySelector("[data-bars]").replaceChildren(...bars);
  }
  async function poll() {
    const [h, r] = await Promise.all([hit("/health"), hit("/ready")]);
    renderProbe("health", h);
    renderProbe("ready", r);
    $("#last-check").textContent = new Date().toLocaleTimeString();
    if (h.body && h.body.version) $("#svc-version").textContent = `${h.body.service || "day12-agent"} v${h.body.version}`;
    const redis = r.body && "redis" in r.body ? r.body.redis : r.ok ? true : null;
    emitStatus({ code: h.code, ms: h.ms, redis });
    emitLog({ event: "probe", path: "/health", status: h.code, ms: h.ms });
    emitLog({ event: "probe", path: "/ready", status: r.code, redis });
  }
  poll();
  setInterval(() => { if (!document.hidden) poll(); }, 5000);
  $("#check-now").addEventListener("click", poll);

  // ── curl snippet ────────────────────────────────────────────────
  const curl = [
    `URL=${window.location.origin}`,
    "",
    "curl -i $URL/health",
    "curl -i $URL/ready",
    "",
    "curl -i -X POST $URL/ask \\",
    '  -H "Content-Type: application/json" \\',
    '  -H "X-API-Key: $AGENT_API_KEY" \\',
    '  -H "X-User-Id: sv01" \\',
    `  -d '{"question":"Docker là gì?"}'`,
  ].join("\n");
  $("#curl").textContent = curl;
  $("#copy-curl").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(curl);
      btn.textContent = "Copied";
    } catch {
      const range = document.createRange();
      range.selectNodeContents($("#curl"));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      btn.textContent = "Selected — press Ctrl+C";
    }
    setTimeout(() => { btn.textContent = "Copy"; }, 1800);
  });
})();
