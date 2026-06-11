import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSnapshot } from "./energyClient.js";
import { JsonStore } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const publicRoot = path.join(projectRoot, "public");
const localConfigPath = path.join(projectRoot, "config.local.json");
const exampleConfigPath = path.join(projectRoot, "config.example.json");

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ico": "image/x-icon",
    }[ext] ?? "application/octet-stream"
  );
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function isPlaceholder(value) {
  return /填写|fill-|your-|example/i.test(String(value ?? ""));
}

function hasUsableCredentials(config) {
  return Boolean(
    cleanString(config.loginUserCode) &&
      cleanString(config.password) &&
      !isPlaceholder(config.loginUserCode) &&
      !isPlaceholder(config.password),
  );
}

function normalizeConfig(input, previous = {}) {
  const alerts = {
    ...(previous.alerts ?? {}),
    ...(input.alerts ?? {}),
  };
  const loginUserCode = cleanString(input.loginUserCode, previous.loginUserCode);
  const password = cleanString(input.password, previous.password);

  return {
    schoolName: cleanString(input.schoolName, previous.schoolName || "广西智能制造职业技术学院"),
    loginUserCode,
    password,
    displayName: cleanString(input.displayName, previous.displayName || "宿舍用电状态屏"),
    customerUserCode: cleanString(input.customerUserCode, previous.customerUserCode || ""),
    port: numberInRange(input.port, Number(previous.port || 8787), 1024, 65535),
    bindHost: cleanString(input.bindHost, previous.bindHost || "0.0.0.0"),
    schoolRefreshNote: cleanString(
      input.schoolRefreshNote,
      previous.schoolRefreshNote || "学校每天约 12:00 结算并刷新昨天用电量",
    ),
    refreshMode: input.refreshMode === "interval" ? "interval" : "daily",
    dailyRefreshTime: /^\d{1,2}:\d{2}$/.test(String(input.dailyRefreshTime ?? ""))
      ? String(input.dailyRefreshTime)
      : previous.dailyRefreshTime || "12:10",
    refreshMinutes: numberInRange(input.refreshMinutes, Number(previous.refreshMinutes || 30), 5, 1440),
    retryMinutes: numberInRange(input.retryMinutes, Number(previous.retryMinutes || 30), 5, 1440),
    historyLimit: numberInRange(input.historyLimit, Number(previous.historyLimit || 420), 30, 2000),
    alerts: {
      lowBalance: numberInRange(alerts.lowBalance, 20, 0, 10000),
      criticalDays: numberInRange(alerts.criticalDays, 3, 1, 365),
      highUsageRatio: numberInRange(alerts.highUsageRatio, 1.5, 1, 10),
      staleHours: numberInRange(alerts.staleHours, 30, 1, 720),
    },
  };
}

async function loadConfig() {
  const example = await readJson(exampleConfigPath, {});
  const local = await readJson(localConfigPath, {});
  const config = normalizeConfig({ ...example, ...local }, {});

  return {
    ...config,
    loginUserCode: process.env.ELECTRIC_USER_CODE || config.loginUserCode,
    password: process.env.ELECTRIC_PASSWORD || config.password,
    port: Number(process.env.PORT || config.port || 8787),
    bindHost: process.env.BIND_HOST || config.bindHost || "0.0.0.0",
  };
}

async function saveLocalConfig(nextConfig) {
  await mkdir(projectRoot, { recursive: true });
  await writeFile(localConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
}

function safeConfig(config) {
  return {
    schoolName: config.schoolName,
    displayName: config.displayName,
    customerUserCode: config.customerUserCode,
    port: config.port,
    bindHost: config.bindHost,
    schoolRefreshNote: config.schoolRefreshNote,
    refreshMode: config.refreshMode,
    dailyRefreshTime: config.dailyRefreshTime,
    refreshMinutes: config.refreshMinutes,
    retryMinutes: config.retryMinutes,
    historyLimit: config.historyLimit,
    alerts: config.alerts,
    configured: hasUsableCredentials(config),
    hasLoginUserCode: Boolean(cleanString(config.loginUserCode) && !isPlaceholder(config.loginUserCode)),
    hasPassword: Boolean(cleanString(config.password) && !isPlaceholder(config.password)),
  };
}

async function readRequestJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("请求内容太大");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function isPathInside(parent, target) {
  const relative = path.relative(parent, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname === "/setup" ? "/setup.html" : url.pathname;
  const requested = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const target = path.join(publicRoot, requested);
  if (!isPathInside(publicRoot, target)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const bytes = await readFile(target);
    res.writeHead(200, {
      "content-type": contentType(target),
      "cache-control": target.endsWith(".html") ? "no-store" : "public, max-age=60",
    });
    res.end(bytes);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function parseDailyRefreshTime(value) {
  const match = String(value || "12:10").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hours: 12, minutes: 10 };
  return {
    hours: Math.max(0, Math.min(23, Number(match[1]))),
    minutes: Math.max(0, Math.min(59, Number(match[2]))),
  };
}

function dailyCutoff(now, dailyRefreshTime) {
  const { hours, minutes } = parseDailyRefreshTime(dailyRefreshTime);
  const cutoff = new Date(now);
  cutoff.setHours(hours, minutes, 0, 0);
  if (now < cutoff) cutoff.setDate(cutoff.getDate() - 1);
  return cutoff;
}

function shouldRunRefresh(lastSnapshot, config) {
  if (!hasUsableCredentials(config)) return false;
  if (!lastSnapshot?.fetchedAt) return true;
  const mode = config.refreshMode || "daily";
  if (mode === "daily") {
    return new Date(lastSnapshot.fetchedAt) < dailyCutoff(new Date(), config.dailyRefreshTime);
  }
  const refreshMinutes = Math.max(5, Number(config.refreshMinutes || 30));
  const ageMs = Date.now() - new Date(lastSnapshot.fetchedAt).getTime();
  return ageMs >= refreshMinutes * 60 * 1000;
}

function applyConfigLabels(snapshot, config) {
  if (!snapshot) return snapshot;
  return {
    ...snapshot,
    schoolName: snapshot.schoolName ?? config.schoolName ?? "广西智能制造职业技术学院",
    schoolRefreshNote: snapshot.schoolRefreshNote ?? config.schoolRefreshNote,
    displayName: config.displayName ?? snapshot.displayName,
  };
}

async function main() {
  let config = await loadConfig();
  const store = new JsonStore(path.join(projectRoot, "data"), Number(config.historyLimit || 420));
  let refreshing = null;
  let lastError = null;
  let lastRefreshAttemptAt = 0;

  async function refresh(reason = "manual") {
    if (!hasUsableCredentials(config)) {
      throw new Error("配置未完成，请先打开网页配置账号和密码");
    }
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        lastRefreshAttemptAt = Date.now();
        const snapshot = await fetchSnapshot(config);
        snapshot.refreshReason = reason;
        await store.save(snapshot);
        lastError = null;
        return snapshot;
      } catch (error) {
        lastError = {
          message: error.message,
          time: new Date().toISOString(),
          reason,
        };
        await store.saveError(error, { reason });
        throw error;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  if (process.argv.includes("--refresh-once")) {
    const snapshot = await refresh("cli");
    console.log(JSON.stringify({ ok: true, fetchedAt: snapshot.fetchedAt, account: snapshot.account }, null, 2));
    return;
  }

  const latestAtStartup = await store.latest();
  if (shouldRunRefresh(latestAtStartup, config)) {
    refresh("startup").catch((error) => {
      console.error(`[startup refresh failed] ${error.message}`);
    });
  }

  const retryMinutes = () => Math.max(5, Number(config.retryMinutes || config.refreshMinutes || 30));
  setInterval(async () => {
    const latest = await store.latest();
    if (!shouldRunRefresh(latest, config)) return;
    if (Date.now() - lastRefreshAttemptAt < retryMinutes() * 60 * 1000) return;
    refresh("interval").catch((error) => {
      console.error(`[interval refresh failed] ${error.message}`);
    });
  }, 60 * 1000);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    try {
      if (url.pathname === "/api/config" && req.method === "GET") {
        sendJson(res, 200, { ok: true, data: safeConfig(config) });
        return;
      }

      if (url.pathname === "/api/config" && req.method === "POST") {
        const body = await readRequestJson(req);
        const previous = config;
        const nextInput = { ...body };
        if (!cleanString(nextInput.loginUserCode) && previous.loginUserCode) {
          nextInput.loginUserCode = previous.loginUserCode;
        }
        if (!cleanString(nextInput.password) && previous.password) {
          nextInput.password = previous.password;
        }
        const nextConfig = normalizeConfig(nextInput, previous);
        await saveLocalConfig(nextConfig);
        config = await loadConfig();
        store.historyLimit = Number(config.historyLimit || 420);
        lastError = null;

        sendJson(res, 200, {
          ok: true,
          data: safeConfig(config),
          needsRestart: previous.port !== config.port || previous.bindHost !== config.bindHost,
        });
        return;
      }

      if (url.pathname === "/api/snapshot" && req.method === "GET") {
        const latest = await store.latest();
        if (!latest) {
          sendJson(res, hasUsableCredentials(config) ? 503 : 428, {
            ok: false,
            refreshing: Boolean(refreshing),
            setupRequired: !hasUsableCredentials(config),
            error: lastError ?? {
              message: hasUsableCredentials(config) ? "No snapshot yet" : "配置未完成，请先完成网页配置",
            },
          });
          return;
        }
        sendJson(res, 200, { ok: true, refreshing: Boolean(refreshing), data: applyConfigLabels(latest, config), lastError });
        return;
      }

      if (url.pathname === "/api/history" && req.method === "GET") {
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 120)));
        const history = await store.history();
        sendJson(res, 200, { ok: true, data: history.slice(-limit).map((item) => applyConfigLabels(item, config)) });
        return;
      }

      if (url.pathname === "/api/refresh" && req.method === "POST") {
        const snapshot = await refresh("manual");
        sendJson(res, 200, { ok: true, data: applyConfigLabels(snapshot, config) });
        return;
      }

      if (url.pathname === "/api/health" && req.method === "GET") {
        const latest = await store.latest();
        sendJson(res, 200, {
          ok: true,
          configured: hasUsableCredentials(config),
          refreshing: Boolean(refreshing),
          fetchedAt: latest?.fetchedAt ?? null,
          lastError,
          refreshMode: config.refreshMode || "daily",
          dailyRefreshTime: config.dailyRefreshTime || null,
          retryMinutes: retryMinutes(),
        });
        return;
      }

      if (req.method === "GET" || req.method === "HEAD") {
        await serveStatic(req, res);
        return;
      }

      sendText(res, 405, "Method not allowed");
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
  });

  server.listen(config.port, config.bindHost, () => {
    console.log(`GXZN electricity dashboard: http://localhost:${config.port}`);
    console.log(`Open setup page: http://localhost:${config.port}/setup.html`);
    if ((config.refreshMode || "daily") === "daily") {
      console.log(`Listening on ${config.bindHost}:${config.port}, daily refresh after ${config.dailyRefreshTime || "12:10"}`);
    } else {
      console.log(`Listening on ${config.bindHost}:${config.port}, refresh interval ${config.refreshMinutes || 30} minutes`);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
