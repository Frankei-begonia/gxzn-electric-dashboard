const $ = (id) => document.getElementById(id);

function setStatus(message, tone = "neutral") {
  const target = $("formStatus");
  target.textContent = message;
  target.dataset.tone = tone;
}

function value(id) {
  return $(id).value.trim();
}

function fill(config) {
  $("schoolNameInput").value = config.schoolName || "广西智能制造职业技术学院";
  $("displayNameInput").value = config.displayName || "";
  $("customerUserCodeInput").value = config.customerUserCode || "";
  $("dailyRefreshTimeInput").value = config.dailyRefreshTime || "12:10";
  $("schoolRefreshNoteInput").value = config.schoolRefreshNote || "学校每天约 12:00 结算并刷新昨天用电量";
  $("portInput").value = config.port || 8787;
  $("bindHostInput").value = config.bindHost || "0.0.0.0";
  $("retryMinutesInput").value = config.retryMinutes || 30;
  $("historyLimitInput").value = config.historyLimit || 420;
  $("lowBalanceInput").value = config.alerts?.lowBalance ?? 20;
  $("criticalDaysInput").value = config.alerts?.criticalDays ?? 3;

  $("loginUserCodeInput").placeholder = config.hasLoginUserCode ? "已保存，留空不修改" : "填写服务号里的缴费账号";
  $("passwordInput").placeholder = config.hasPassword ? "已保存，留空不修改" : "填写查询密码";
  setStatus(config.configured ? "配置已完成，可以采集或打开状态屏" : "请填写账号和密码后保存", config.configured ? "ok" : "neutral");
}

async function loadConfig() {
  const response = await fetch("/api/config", { cache: "no-store" });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "读取配置失败");
  fill(payload.data);
}

function collect() {
  return {
    schoolName: value("schoolNameInput"),
    displayName: value("displayNameInput"),
    loginUserCode: value("loginUserCodeInput"),
    password: value("passwordInput"),
    customerUserCode: value("customerUserCodeInput"),
    dailyRefreshTime: value("dailyRefreshTimeInput"),
    schoolRefreshNote: value("schoolRefreshNoteInput"),
    port: Number(value("portInput") || 8787),
    bindHost: value("bindHostInput") || "0.0.0.0",
    retryMinutes: Number(value("retryMinutesInput") || 30),
    historyLimit: Number(value("historyLimitInput") || 420),
    refreshMode: "daily",
    alerts: {
      lowBalance: Number(value("lowBalanceInput") || 20),
      criticalDays: Number(value("criticalDaysInput") || 3),
      highUsageRatio: 1.5,
      staleHours: 30,
    },
  };
}

async function saveConfig() {
  setStatus("正在保存配置...", "neutral");
  const response = await fetch("/api/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(collect()),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "保存失败");
  fill(payload.data);
  if (payload.needsRestart) {
    setStatus("配置已保存。端口或访问范围变更后，需要关闭窗口重新双击启动文件。", "warning");
  } else {
    setStatus("配置已保存，可以采集一次或打开状态屏。", "ok");
  }
}

async function refreshOnce() {
  setStatus("正在采集学校平台数据，可能需要几秒钟...", "neutral");
  const response = await fetch("/api/refresh", { method: "POST" });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || "采集失败");
  const fetchedAt = new Date(payload.data.fetchedAt).toLocaleString("zh-CN", { hour12: false });
  setStatus(`采集成功，本地更新时间 ${fetchedAt}`, "ok");
}

$("configForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("saveBtn").disabled = true;
  try {
    await saveConfig();
  } catch (error) {
    setStatus(error.message, "warning");
  } finally {
    $("saveBtn").disabled = false;
  }
});

$("testBtn").addEventListener("click", async () => {
  $("testBtn").disabled = true;
  try {
    await saveConfig();
    await refreshOnce();
  } catch (error) {
    setStatus(error.message, "warning");
  } finally {
    $("testBtn").disabled = false;
  }
});

loadConfig().catch((error) => {
  setStatus(error.message, "warning");
});
