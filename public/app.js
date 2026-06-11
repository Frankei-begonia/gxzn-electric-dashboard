const $ = (id) => document.getElementById(id);
const yuan = (value) => `${format(value)} 元`;
const kwh = (value) => `${format(value)} 度`;

function format(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return number.toLocaleString("zh-CN", {
    minimumFractionDigits: number % 1 === 0 ? 0 : digits,
    maximumFractionDigits: digits,
  });
}

function formatTime(iso) {
  if (!iso) return "等待数据采集";
  const date = new Date(iso);
  return `本地更新 ${date.toLocaleString("zh-CN", { hour12: false })}`;
}

function setClock() {
  $("clock").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function alertClass(level) {
  return ["warning", "critical", "notice"].includes(level) ? level : "";
}

function renderAlerts(alerts = []) {
  $("alertStrip").innerHTML = alerts
    .slice(0, 3)
    .map(
      (alert) => `
        <div class="alert ${alertClass(alert.level)}">
          <strong>${alert.title}</strong>
          <span>${alert.detail}</span>
        </div>
      `,
    )
    .join("");
}

function renderTrendChart(daily = []) {
  const target = $("trendChart");
  const rows = daily.slice(-18);
  if (!rows.length) {
    target.innerHTML = '<div class="empty-state">暂无趋势数据</div>';
    return;
  }

  const width = 900;
  const height = 310;
  const pad = { left: 52, right: 24, top: 22, bottom: 42 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const maxKwh = Math.max(...rows.map((item) => item.kwh), 1);
  const maxCost = Math.max(...rows.map((item) => item.cost), 1);
  const barGap = 8;
  const barW = Math.max(10, chartW / rows.length - barGap);
  const x = (index) => pad.left + index * (chartW / rows.length) + barGap / 2;
  const yKwh = (value) => pad.top + chartH - (value / maxKwh) * chartH;
  const yCost = (value) => pad.top + chartH - (value / maxCost) * chartH;
  const points = rows.map((item, index) => `${x(index) + barW / 2},${yCost(item.cost)}`);

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const gy = pad.top + chartH * ratio;
      const label = format(maxKwh * (1 - ratio), 1);
      return `
        <line class="grid" x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}" />
        <text class="chart-label" x="8" y="${gy + 4}">${label}</text>
      `;
    })
    .join("");

  const bars = rows
    .map((item, index) => {
      const bx = x(index);
      const by = yKwh(item.kwh);
      const bh = pad.top + chartH - by;
      return `
        <rect class="bar" x="${bx}" y="${by}" width="${barW}" height="${Math.max(1, bh)}" rx="4">
          <title>${item.label}: ${kwh(item.kwh)} / ${yuan(item.cost)}</title>
        </rect>
        <text class="chart-label" x="${bx + barW / 2}" y="${height - 16}" text-anchor="middle">${item.label}</text>
      `;
    })
    .join("");

  const dots = rows
    .map((item, index) => `<circle class="dot" cx="${x(index) + barW / 2}" cy="${yCost(item.cost)}" r="4"><title>${yuan(item.cost)}</title></circle>`)
    .join("");

  target.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="每日结算趋势">
      ${grid}
      <line class="axis" x1="${pad.left}" y1="${pad.top + chartH}" x2="${width - pad.right}" y2="${pad.top + chartH}" />
      ${bars}
      <polyline class="cost-line" points="${points.join(" ")}" />
      ${dots}
    </svg>
  `;
}

function renderSettlementInfo(snapshot) {
  const latest = snapshot.totals?.latestDay;
  const fetchedAt = snapshot.fetchedAt ? new Date(snapshot.fetchedAt).toLocaleString("zh-CN", { hour12: false }) : "--";
  const latestText = latest ? `${latest.label}，统计区间 ${latest.from || "--"} 到 ${latest.to || "--"}` : "--";
  $("settlementInfo").innerHTML = `
    <div class="settlement-item">
      <strong>数据含义</strong>
      <span>学校系统每天约 12:00 结算并刷新昨天用电量；这里显示的是结算后的历史数据，不是实时功率。</span>
    </div>
    <div class="settlement-item">
      <strong>最新结算日</strong>
      <span>${latestText}</span>
    </div>
    <div class="settlement-item">
      <strong>本地更新时间</strong>
      <span>${fetchedAt}</span>
    </div>
  `;
}

function renderRooms(rooms = []) {
  const activeRooms = rooms.filter(
    (room) => room.totals?.monthKwh > 0 || room.totals?.monthCost > 0 || room.weekUsage?.length,
  );
  const visibleRooms = activeRooms.length ? activeRooms : rooms;
  $("roomCaption").textContent = `${rooms.length} 个回路，${visibleRooms.length} 个有数据`;
  $("rooms").innerHTML = visibleRooms.length
    ? visibleRooms
        .map((room) => {
          const latest = room.weekUsage?.at(-1);
          return `
            <div class="room-row">
              <div class="room-title">
                <strong>${room.roomName}</strong>
                <span>${latest ? `${latest.label} ${kwh(latest.kwh)} / ${yuan(latest.cost)}` : "暂无最近用电"}</span>
              </div>
              <div class="room-value">${kwh(room.totals.monthKwh)}</div>
              <div class="room-value">${yuan(room.totals.monthCost)}</div>
            </div>
          `;
        })
        .join("")
    : '<div class="empty-state">暂无回路数据</div>';
}

function renderRecent(rows = []) {
  const max = Math.max(...rows.map((item) => item.kwh), 1);
  $("recentTable").innerHTML = rows.length
    ? rows
        .slice(-3)
        .reverse()
        .map((item) => {
          const pct = Math.max(2, (item.kwh / max) * 100);
          return `
            <div class="recent-row">
              <strong>${item.label}</strong>
              <div class="recent-bar"><i style="width:${pct}%"></i></div>
              <div class="recent-value">${kwh(item.kwh)}</div>
              <div class="recent-value">${yuan(item.cost)}</div>
            </div>
          `;
        })
        .join("")
    : '<div class="empty-state">暂无最近记录</div>';
}

function render(snapshot) {
  $("setupBanner").classList.add("hidden");
  $("schoolName").textContent = snapshot.schoolName ? `${snapshot.schoolName}电费量化平台` : "电费量化平台";
  $("displayName").textContent = snapshot.displayName || snapshot.account?.userName || "宿舍用电";
  $("updatedAt").textContent = formatTime(snapshot.fetchedAt);
  $("balance").textContent = yuan(snapshot.account?.balance);
  $("expireDate").textContent = `系统预计到期 ${snapshot.account?.expectedExpireDate || "--"}`;
  $("daysRemaining").textContent =
    snapshot.totals?.daysRemaining === null ? "--" : `${format(snapshot.totals?.daysRemaining, 1)} 天`;
  $("dailyAvgCost").textContent = `日均 ${yuan(snapshot.totals?.dailyAvgCost)}`;
  $("latestKwh").textContent = kwh(snapshot.totals?.latestDay?.kwh);
  $("latestCost").textContent = snapshot.totals?.latestDay
    ? `结算日 ${snapshot.totals.latestDay.label} / ${yuan(snapshot.totals.latestDay.cost)}`
    : "--";
  $("monthCost").textContent = yuan(snapshot.totals?.accountMonthCost ?? snapshot.totals?.monthCost);
  $("monthKwh").textContent = kwh(snapshot.totals?.monthKwh);
  $("trendCaption").textContent = snapshot.schoolRefreshNote || "学校每天约 12:00 结算并刷新昨天用电量";

  renderAlerts(snapshot.alerts);
  renderTrendChart(snapshot.daily);
  renderSettlementInfo(snapshot);
  renderRooms(snapshot.rooms);
  renderRecent(snapshot.recent);
}

function renderSetupRequired(message) {
  $("setupBanner").classList.remove("hidden");
  $("displayName").textContent = "等待配置";
  $("updatedAt").textContent = "打开配置页填写账号密码";
  renderAlerts([{ level: "notice", title: "需要配置", detail: message || "请先完成网页配置" }]);
  renderTrendChart([]);
  renderSettlementInfo({ totals: {}, fetchedAt: null });
  renderRooms([]);
  renderRecent([]);
}

async function loadSnapshot() {
  const response = await fetch("/api/snapshot", { cache: "no-store" });
  const payload = await response.json();
  if (!payload.ok) {
    if (payload.setupRequired) {
      renderSetupRequired(payload.error?.message);
      return;
    }
    throw new Error(payload.error?.message || "暂无采集数据");
  }
  render(payload.data);
  $("refreshBtn").disabled = Boolean(payload.refreshing);
  $("refreshBtn").textContent = payload.refreshing ? "采集中" : "刷新";
}

async function refreshNow() {
  const button = $("refreshBtn");
  button.disabled = true;
  button.textContent = "采集中";
  try {
    const response = await fetch("/api/refresh", { method: "POST" });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || "刷新失败");
    render(payload.data);
  } catch (error) {
    renderAlerts([{ level: "warning", title: "刷新失败", detail: error.message }]);
  } finally {
    button.disabled = false;
    button.textContent = "刷新";
  }
}

$("refreshBtn").addEventListener("click", refreshNow);
setClock();
setInterval(setClock, 1000);
loadSnapshot().catch((error) => {
  renderAlerts([{ level: "notice", title: "等待数据采集", detail: error.message }]);
});
setInterval(() => loadSnapshot().catch(() => {}), 60 * 1000);
