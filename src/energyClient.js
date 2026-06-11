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

function computeAlerts(account, daily, config) {
  const alertConfig = config.alerts ?? {};
  const balance = Number(account.balance ?? 0);
  const lowBalance = Number(alertConfig.lowBalance ?? account.minimumAmount ?? 20);
  const criticalDays = Number(alertConfig.criticalDays ?? 3);
  const highUsageRatio = Number(alertConfig.highUsageRatio ?? 1.5);
  const staleHours = Number(alertConfig.staleHours ?? 30);
  const alerts = [];
  const recent = daily.slice(-7);
  const latest = recent.at(-1);
  const previous = recent.slice(0, -1);
  const dailyAvgCost = previous.length
    ? previous.reduce((sum, item) => sum + item.cost, 0) / previous.length
    : recent.reduce((sum, item) => sum + item.cost, 0) / Math.max(recent.length, 1);
  const dailyAvgKwh = previous.length
    ? previous.reduce((sum, item) => sum + item.kwh, 0) / previous.length
    : recent.reduce((sum, item) => sum + item.kwh, 0) / Math.max(recent.length, 1);
  const daysRemaining = dailyAvgCost > 0 ? balance / dailyAvgCost : null;

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
      detail: `按最近日均 ${round(dailyAvgCost)} 元估算，余额约可用 ${round(daysRemaining, 1)} 天。`,
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
      detail: "余额和近期用电趋势均未触发预警。",
    });
  }

  return {
    alerts,
    dailyAvgCost: round(dailyAvgCost),
    dailyAvgKwh: round(dailyAvgKwh),
    daysRemaining: daysRemaining === null ? null : round(daysRemaining, 1),
  };
}

function forecastDate(daysRemaining) {
  if (!Number.isFinite(daysRemaining)) return null;
  const date = new Date();
  date.setDate(date.getDate() + Math.floor(daysRemaining));
  return date.toISOString().slice(0, 10);
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
    forecastExpireDate: forecastDate(computed.daysRemaining),
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
