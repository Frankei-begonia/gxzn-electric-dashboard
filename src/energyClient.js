const ENDPOINT = "https://dian.gxgj.com/energy/webservice/webservice?wsdl";
const SOAP_HEAD =
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://webService.energy.com/"><soapenv:Header/><soapenv:Body>';
const SOAP_TAIL = "</soapenv:Body></soapenv:Envelope>";

function xmlEscape(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (ch) => {
    const map = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    };
    return map[ch];
  });
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function round(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parsePayload(response) {
  if (!response?.data) return null;
  try {
    return JSON.parse(response.data);
  } catch {
    return response.data;
  }
}

function buildSoap(method, params) {
  const body = Object.entries(params ?? {})
    .map(([key, value]) => `<${key}>${xmlEscape(value)}</${key}>`)
    .join("");
  return `${SOAP_HEAD}<web:${method}>${body}</web:${method}>${SOAP_TAIL}`;
}

export async function callSoap(method, params, options = {}) {
  const timeoutMs = options.timeoutMs ?? 50000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${ENDPOINT}${method}`, {
      method: "POST",
      headers: {
        "content-type": "text/xml",
        "user-agent":
          "Mozilla/5.0 (Linux; Android 13; MicroMessenger/8.0) AppleWebKit/537.36 Mobile Safari/537.36",
      },
      body: buildSoap(method, params),
      signal: controller.signal,
    });

    const text = await response.text();
    const match = text.match(/<return>([\s\S]*?)<\/return>/);
    const rawReturn = match ? decodeXml(match[1]) : text;

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${rawReturn.slice(0, 240)}`);
    }

    try {
      return JSON.parse(rawReturn);
    } catch (error) {
      throw new Error(`SOAP ${method} returned non-JSON payload: ${rawReturn.slice(0, 240)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function callOk(method, params) {
  const response = await callSoap(method, params);
  if (response.code !== 200) {
    throw new Error(`${method} failed: ${response.message ?? response.msg ?? response.code}`);
  }
  return response;
}

async function login(config) {
  const isPlaceholder = (value) => /填写|fill-|your-|example/i.test(String(value ?? ""));
  if (!config.loginUserCode || !config.password || isPlaceholder(config.loginUserCode) || isPlaceholder(config.password)) {
    throw new Error("请先复制 config.example.json 为 config.local.json，并填写 loginUserCode 和 password");
  }

  const response = await callOk("loginByApp", {
    user_code: config.loginUserCode,
    user_pwd: config.password,
  });
  const payload = parsePayload(response);
  if (!payload?.token) {
    throw new Error("loginByApp did not return a token");
  }
  return payload.token;
}

function normalizeUsageRow(row) {
  const energyInfo = asArray(row.energy_info);
  const kwhFromSegments = energyInfo.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const costFromSegments = energyInfo.reduce((sum, item) => sum + Number(item.used || 0), 0);
  const kwh = Number.isFinite(Number(row.money)) ? Number(row.money) : kwhFromSegments;
  const cost = Number.isFinite(Number(row.value)) ? Number(row.value) : costFromSegments;

  return {
    label: row.date ?? "",
    date: row.lastDate ?? row.thisDate ?? row.date ?? "",
    from: row.lastDate ?? "",
    to: row.thisDate ?? "",
    address: row.address ?? "",
    kwh: round(kwh),
    cost: round(cost),
    meterTotal: round(row.thisTotal),
    previousMeterTotal: round(row.lastTotal),
    segments: energyInfo.map((item) => ({
      name: item.time ?? "",
      kwh: round(item.amount),
      cost: round(item.used),
      price: round(item.price),
    })),
  };
}

function aggregateDaily(roomSnapshots) {
  const byDate = new Map();
  for (const room of roomSnapshots) {
    for (const row of room.monthUsage ?? []) {
      const key = row.date || row.label;
      if (!key) continue;
      if (!byDate.has(key)) {
        byDate.set(key, {
          date: key,
          label: row.label || key.slice(5),
          from: row.from,
          to: row.to,
          kwh: 0,
          cost: 0,
          rooms: [],
        });
      }
      const item = byDate.get(key);
      item.kwh += row.kwh;
      item.cost += row.cost;
      item.rooms.push({
        roomId: room.roomId,
        roomName: room.roomName,
        kwh: row.kwh,
        cost: row.cost,
      });
    }
  }

  return [...byDate.values()]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((item) => ({
      ...item,
      kwh: round(item.kwh),
      cost: round(item.cost),
      rooms: item.rooms.map((room) => ({
        ...room,
        kwh: round(room.kwh),
        cost: round(room.cost),
      })),
    }));
}

function aggregateSegments(roomSnapshots) {
  const byName = new Map();
  for (const room of roomSnapshots) {
    for (const row of room.monthUsage ?? []) {
      for (const segment of row.segments ?? []) {
        const name = segment.name || "其他";
        const current = byName.get(name) ?? { name, kwh: 0, cost: 0 };
        current.kwh += segment.kwh;
        current.cost += segment.cost;
        byName.set(name, current);
      }
    }
  }
  const order = ["尖", "峰", "平", "谷", "其他"];
  return [...byName.values()]
    .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
    .map((item) => ({ ...item, kwh: round(item.kwh), cost: round(item.cost) }));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function robustRows(daily) {
  const rows = daily
    .filter((item) => Number(item.cost) > 0 && Number(item.kwh) > 0)
    .map((item, index) => ({
      ...item,
      index,
      cost: Number(item.cost),
      kwh: Number(item.kwh),
    }));
  if (!rows.length) return [];

  const costs = rows.map((item) => item.cost);
  const center = median(costs);
  const deviations = costs.map((value) => Math.abs(value - center));
  const mad = median(deviations) || center * 0.15 || 1;
  const low = Math.max(0.01, center - mad * 3);
  const high = center + mad * 3;

  return rows.map((item) => ({
    ...item,
    adjustedCost: clamp(item.cost, low, high),
    adjustedKwh: item.kwh,
  }));
}

function weightedMean(rows, key) {
  const n = rows.length;
  if (!n) return 0;
  const halfLife = clamp(Math.sqrt(n) * 1.8, 2, Math.max(2, n / 2));
  let weightSum = 0;
  let valueSum = 0;
  rows.forEach((row, index) => {
    const age = n - 1 - index;
    const weight = 0.5 ** (age / halfLife);
    weightSum += weight;
    valueSum += row[key] * weight;
  });
  return valueSum / Math.max(weightSum, 1);
}

function weightedTrend(rows, key) {
  const n = rows.length;
  if (n < 4) return { slope: 0, r2: 0 };
  let weightSum = 0;
  let xSum = 0;
  let ySum = 0;
  rows.forEach((row, index) => {
    const weight = 1 + index / n;
    weightSum += weight;
    xSum += index * weight;
    ySum += row[key] * weight;
  });
  const xMean = xSum / weightSum;
  const yMean = ySum / weightSum;
  let numerator = 0;
  let denominator = 0;
  let total = 0;
  rows.forEach((row, index) => {
    const weight = 1 + index / n;
    numerator += weight * (index - xMean) * (row[key] - yMean);
    denominator += weight * (index - xMean) ** 2;
    total += weight * (row[key] - yMean) ** 2;
  });
  const slope = denominator ? numerator / denominator : 0;
  const residual = rows.reduce((sum, row, index) => {
    const predicted = yMean + slope * (index - xMean);
    const weight = 1 + index / n;
    return sum + weight * (row[key] - predicted) ** 2;
  }, 0);
  const r2 = total ? clamp(1 - residual / total, 0, 1) : 0;
  return { slope, r2 };
}

function weekdayFactors(rows) {
  const overall = median(rows.map((item) => item.adjustedCost)) || 1;
  const byWeekday = new Map();
  for (const row of rows) {
    const date = new Date(`${row.date || row.to || row.label}T12:00:00+08:00`);
    if (Number.isNaN(date.getTime())) continue;
    const weekday = date.getDay();
    const list = byWeekday.get(weekday) ?? [];
    list.push(row.adjustedCost);
    byWeekday.set(weekday, list);
  }

  const factors = new Map();
  for (const [weekday, values] of byWeekday.entries()) {
    if (values.length >= 2) {
      factors.set(weekday, clamp(median(values) / overall, 0.75, 1.25));
    }
  }
  return factors;
}

function buildBalanceForecast(account, daily, config) {
  const balance = Number(account.balance ?? 0);
  const rows = robustRows(daily);
  if (!Number.isFinite(balance) || balance <= 0 || !rows.length) {
    return {
      daysRemaining: balance <= 0 ? 0 : null,
      forecastExpireDate: balance <= 0 ? new Date().toISOString().slice(0, 10) : null,
      dailyCost: 0,
      dailyKwh: 0,
      confidence: "low",
      confidenceText: rows.length ? "余额已低于或等于 0" : "历史数据不足，暂时无法预测",
      sampleDays: rows.length,
      trend: "flat",
      lowBalanceDate: null,
    };
  }

  const baseCost = weightedMean(rows, "adjustedCost");
  const baseKwh = weightedMean(rows, "adjustedKwh");
  const trend = weightedTrend(rows, "adjustedCost");
  const trendImpact = baseCost > 0 ? clamp((trend.slope / baseCost) * trend.r2, -0.25, 0.3) : 0;
  const adjustedBaseCost = Math.max(0.01, baseCost * (1 + trendImpact));
  const factors = weekdayFactors(rows);
  const costs = rows.map((item) => item.adjustedCost);
  const costMedian = median(costs) || adjustedBaseCost;
  const deviations = costs.map((value) => Math.abs(value - costMedian));
  const volatility = costMedian ? median(deviations) / costMedian : 1;
  const lowBalance = Number(config.alerts?.lowBalance ?? account.minimumAmount ?? 20);

  let remaining = balance;
  let lowBalanceDate = null;
  let daysRemaining = null;
  const today = new Date();
  const maxProjectionDays = 730;
  for (let day = 1; day <= maxProjectionDays; day += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + day);
    const weekdayFactor = factors.get(date.getDay()) ?? 1;
    const trendFactor = clamp(1 + trend.slope * day / Math.max(adjustedBaseCost, 1) * 0.35, 0.65, 1.45);
    const predictedCost = Math.max(0.01, adjustedBaseCost * weekdayFactor * trendFactor);
    remaining -= predictedCost;
    if (!lowBalanceDate && remaining <= lowBalance) {
      lowBalanceDate = date.toISOString().slice(0, 10);
    }
    if (remaining <= 0) {
      daysRemaining = day;
      break;
    }
  }

  const confidence =
    rows.length >= 14 && volatility < 0.35 ? "high" : rows.length >= 7 && volatility < 0.55 ? "medium" : "low";
  const confidenceText =
    confidence === "high"
      ? "历史样本较稳定，预测可信度较高"
      : confidence === "medium"
        ? "历史样本可用，预测可信度中等"
        : "历史样本偏少或波动较大，预测仅作提醒";
  const trendLabel = trendImpact > 0.06 ? "rising" : trendImpact < -0.06 ? "falling" : "flat";

  return {
    daysRemaining: daysRemaining === null ? null : round(daysRemaining, 1),
    forecastExpireDate:
      daysRemaining === null
        ? null
        : (() => {
            const date = new Date(today);
            date.setDate(today.getDate() + Math.floor(daysRemaining));
            return date.toISOString().slice(0, 10);
          })(),
    dailyCost: round(adjustedBaseCost),
    dailyKwh: round(baseKwh),
    confidence,
    confidenceText,
    sampleDays: rows.length,
    volatility: round(volatility, 2),
    trend: trendLabel,
    trendText: trendLabel === "rising" ? "近期消耗上升" : trendLabel === "falling" ? "近期消耗下降" : "近期消耗平稳",
    lowBalanceDate,
  };
}

function computeAlerts(account, daily, config) {
  const alertConfig = config.alerts ?? {};
  const balance = Number(account.balance ?? 0);
  const lowBalance = Number(alertConfig.lowBalance ?? account.minimumAmount ?? 20);
  const criticalDays = Number(alertConfig.criticalDays ?? 3);
  const highUsageRatio = Number(alertConfig.highUsageRatio ?? 1.5);
  const staleHours = Number(alertConfig.staleHours ?? 30);
  const alerts = [];
  const forecast = buildBalanceForecast(account, daily, config);
  const recent = daily.slice(-7);
  const latest = recent.at(-1);
  const previous = recent.slice(0, -1);
  const dailyAvgCost = previous.length
    ? previous.reduce((sum, item) => sum + item.cost, 0) / previous.length
    : recent.reduce((sum, item) => sum + item.cost, 0) / Math.max(recent.length, 1);
  const dailyAvgKwh = previous.length
    ? previous.reduce((sum, item) => sum + item.kwh, 0) / previous.length
    : recent.reduce((sum, item) => sum + item.kwh, 0) / Math.max(recent.length, 1);
  const daysRemaining = forecast.daysRemaining;

  if (balance <= 0) {
    alerts.push({
      level: "critical",
      title: "余额已耗尽",
      detail: "当前余额小于等于 0，可能触发断电或欠费限制。",
    });
  } else if (balance <= lowBalance) {
    alerts.push({
      level: "warning",
      title: "余额低于预警线",
      detail: `当前余额 ${round(balance)} 元，低于 ${round(lowBalance)} 元预警线。`,
    });
  }

  if (daysRemaining !== null && daysRemaining <= criticalDays) {
    alerts.push({
      level: "warning",
      title: "预计可用天数偏低",
      detail: `动态预测日耗 ${round(forecast.dailyCost)} 元，余额约可用 ${round(daysRemaining, 1)} 天。`,
    });
  }

  if (latest && previous.length >= 3 && latest.kwh > dailyAvgKwh * highUsageRatio) {
    alerts.push({
      level: "notice",
      title: "最近一天用电偏高",
      detail: `${latest.label} 用电 ${round(latest.kwh)} 度，高于近期均值 ${round(dailyAvgKwh)} 度。`,
    });
  }

  if (latest?.to) {
    const latestDate = new Date(`${latest.to}T12:00:00+08:00`);
    const staleMs = Date.now() - latestDate.getTime();
    if (Number.isFinite(staleMs) && staleMs > staleHours * 60 * 60 * 1000) {
      alerts.push({
        level: "notice",
        title: "统计数据可能未刷新",
        detail: `最新统计截止 ${latest.to}，学校系统通常每天 12:00 左右刷新。`,
      });
    }
  }

  if (!alerts.length) {
    alerts.push({
      level: "ok",
      title: "状态正常",
      detail: `余额和近期用电趋势均未触发预警，${forecast.confidenceText}。`,
    });
  }

  return {
    alerts,
    dailyAvgCost: round(dailyAvgCost),
    dailyAvgKwh: round(dailyAvgKwh),
    daysRemaining: daysRemaining === null ? null : round(daysRemaining, 1),
    forecast,
  };
}

async function fetchRoomSnapshot(token, userCode, room, typeId) {
  const [monthResponse, weekResponse, meterResponse, totalResponse] = await Promise.all([
    callOk("energyQuery", {
      token,
      query_type: 1,
      query_date1: "",
      query_date2: "",
      user_code: userCode,
      room_id: room.room_id,
      type_id: typeId,
    }),
    callOk("energyQuery", {
      token,
      query_type: 2,
      query_date1: "",
      query_date2: "",
      user_code: userCode,
      room_id: room.room_id,
      type_id: typeId,
    }),
    callOk("queryMeterByRoomId", { token, room_id: room.room_id }),
    callOk("queryTotalEnergyByRoomId", { token, room_id: room.room_id }).catch((error) => ({
      code: 500,
      message: error.message,
      data: "[]",
    })),
  ]);

  const meters = asArray(parsePayload(meterResponse)).filter((meter) => String(meter.meter_type) === String(typeId));
  const meterDetails = [];
  for (const meter of meters) {
    try {
      const detailResponse = await callOk("queryMeterInfo", { token, point_id: meter.point_id });
      meterDetails.push(parsePayload(detailResponse));
    } catch (error) {
      meterDetails.push({ point_id: meter.point_id, error: error.message });
    }
  }

  const monthUsage = asArray(parsePayload(monthResponse)).map(normalizeUsageRow);
  const weekUsage = asArray(parsePayload(weekResponse)).map(normalizeUsageRow);
  const totals = {
    monthKwh: round(monthUsage.reduce((sum, item) => sum + item.kwh, 0)),
    monthCost: round(monthUsage.reduce((sum, item) => sum + item.cost, 0)),
    weekKwh: round(weekUsage.reduce((sum, item) => sum + item.kwh, 0)),
    weekCost: round(weekUsage.reduce((sum, item) => sum + item.cost, 0)),
  };

  return {
    roomId: room.room_id,
    roomName: room.room_name,
    monthUsage,
    weekUsage,
    meters,
    meterDetails,
    totalEnergy: parsePayload(totalResponse),
    totals,
  };
}

export async function fetchSnapshot(config) {
  const startedAt = Date.now();
  if (!config.loginUserCode || !config.password) {
    throw new Error("Missing loginUserCode or password in config.local.json");
  }

  const token = await login(config);
  const userResponse = await callOk("indexQuery", { token, query_type: 2 });
  const users = asArray(parsePayload(userResponse));
  if (!users.length) {
    throw new Error("indexQuery returned no bound electricity accounts");
  }

  const selected = config.customerUserCode
    ? users.find((item) => String(item.USER_CODE) === String(config.customerUserCode)) ?? users[0]
    : users[0];

  const userCode = selected.USER_CODE;
  const [roomResponse, typeResponse] = await Promise.all([
    callOk("getRoom", { token, user_code: userCode }),
    callOk("getEnergyType", { token, user_code: userCode }),
  ]);

  const rooms = asArray(parsePayload(roomResponse));
  const types = asArray(parsePayload(typeResponse));
  const electricType = types.find((item) => String(item.type_id) === "107") ?? types[0];
  if (!electricType) {
    throw new Error("getEnergyType returned no electricity type");
  }

  const roomSnapshots = [];
  for (const room of rooms) {
    roomSnapshots.push(await fetchRoomSnapshot(token, userCode, room, electricType.type_id));
  }

  const daily = aggregateDaily(roomSnapshots);
  const recent = daily.slice(-7);
  const segmentTotals = aggregateSegments(roomSnapshots);
  const account = {
    loginUserCode: config.loginUserCode,
    userCode: selected.USER_CODE,
    userName: selected.USER_NAME,
    address: selected.USER_ADDRESS,
    customerId: selected.CUSTOMER_ID,
    balance: round(selected.USER_BALANCE),
    giftedBalance: round(selected.LEFTOVER_MONEY),
    monthCost: round(selected.ORDER_MONEY),
    expectedExpireDate: selected.balance_date,
    minimumAmount: round(selected.MINIMUN_AMOUNT),
    mobile: selected.MOBILE,
  };

  const computed = computeAlerts(account, daily, config);
  const totals = {
    monthKwh: round(roomSnapshots.reduce((sum, room) => sum + room.totals.monthKwh, 0)),
    monthCost: round(roomSnapshots.reduce((sum, room) => sum + room.totals.monthCost, 0)),
    accountMonthCost: account.monthCost,
    weekKwh: round(recent.reduce((sum, item) => sum + item.kwh, 0)),
    weekCost: round(recent.reduce((sum, item) => sum + item.cost, 0)),
    latestDay: recent.at(-1) ?? null,
    dailyAvgKwh: computed.dailyAvgKwh,
    dailyAvgCost: computed.dailyAvgCost,
    daysRemaining: computed.daysRemaining,
    forecastExpireDate: computed.forecast.forecastExpireDate,
    forecast: computed.forecast,
  };

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    source: "dian.gxgj.com SOAP",
    schoolName: config.schoolName ?? "广西智能制造职业技术学院",
    schoolRefreshNote: config.schoolRefreshNote,
    displayName: config.displayName ?? account.userName,
    account,
    rooms: roomSnapshots,
    daily,
    recent,
    segmentTotals,
    totals,
    alerts: computed.alerts,
  };
}
