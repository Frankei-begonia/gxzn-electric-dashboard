# 广西智能制造职业技术学院电费量化状态屏

一个面向宿舍屏幕的本地网页项目，用于把学校智慧能耗平台里的宿舍用电结算数据做成可长期全屏展示的状态屏。

它会采集余额、预计可用天数、本月消费、每日结算趋势、回路明细和预警信息。学校系统通常每天约 12:00 结算并刷新昨天用电量，所以本项目默认每天 12:10 后采集一次，不做实时电表读数展示。

## 功能

- 余额状态：显示当前余额、系统预计到期日、预计可用天数。
- 每日趋势：按学校已结算数据展示每日用电度数和费用趋势。
- 回路明细：如果账号下有多个回路，会自动汇总并展示各回路数据。
- 预警提醒：支持余额过低、预计可用天数过低、最近一天用电偏高、数据疑似未刷新等提醒。
- 状态屏模式：网页适合在宿舍屏幕、旧平板、小主机或局域网设备上全屏常亮。
- 本地缓存：采集结果保存在本机 `data/` 目录，网页每 60 秒读取本地缓存。

## 适用范围

当前接口适配广西智能制造职业技术学院微信服务号“宿舍用电”入口背后的智慧能耗平台。

如果其他学校也使用同一套 `dian.gxgj.com` 智慧能耗平台，并且账号密码登录接口一致，只需要改配置文件即可复用。不同学校或不同平台可能需要调整 `src/energyClient.js` 里的接口方法。

## 环境要求

- Windows、macOS 或 Linux 都可以运行。
- 需要 Node.js 18 或更高版本。
- 不需要数据库。
- 不需要安装前端依赖。

检查 Node.js 版本：

```bash
node -v
```

## 快速启动

1. 进入项目目录：

```bash
cd gxzn-electric-dashboard
```

2. 复制配置文件：

```bash
cp config.example.json config.local.json
```

Windows PowerShell 可以用：

```powershell
Copy-Item config.example.json config.local.json
```

3. 编辑 `config.local.json`，填入自己的宿舍用电账号和密码：

```json
{
  "schoolName": "广西智能制造职业技术学院",
  "loginUserCode": "填写你的宿舍缴费账号",
  "password": "填写你的查询密码",
  "displayName": "宿舍名称，例如 1栋101",
  "customerUserCode": "",
  "port": 8787,
  "bindHost": "0.0.0.0",
  "schoolRefreshNote": "学校每天约 12:00 结算并刷新昨天用电量",
  "refreshMode": "daily",
  "dailyRefreshTime": "12:10",
  "retryMinutes": 30,
  "historyLimit": 420,
  "alerts": {
    "lowBalance": 20,
    "criticalDays": 3,
    "highUsageRatio": 1.5,
    "staleHours": 30
  }
}
```

4. 启动服务：

```bash
npm start
```

5. 打开状态屏：

```text
http://localhost:8787
```

如果屏幕设备和运行服务的电脑在同一局域网，也可以访问这台电脑的局域网 IP：

```text
http://你的电脑IP:8787
```

## 手动采集一次

如果只想测试账号、接口和采集结果：

```bash
npm run refresh
```

成功后会在 `data/latest.json` 和 `data/history.json` 里保存本地缓存。

## 配置说明

| 字段 | 说明 |
| --- | --- |
| `schoolName` | 页面顶部显示的学校名称。 |
| `loginUserCode` | 宿舍用电查询账号。 |
| `password` | 宿舍用电查询密码。 |
| `displayName` | 页面主标题，建议填宿舍名或房间名。 |
| `customerUserCode` | 可选。账号绑定多个用电户时，可指定其中一个客户编号；留空默认使用第一个。 |
| `port` | 本地网页端口，默认 `8787`。 |
| `bindHost` | 监听地址。`0.0.0.0` 表示允许局域网访问；只想本机访问可改成 `127.0.0.1`。 |
| `schoolRefreshNote` | 页面上的结算说明文字。 |
| `refreshMode` | 默认 `daily`，按每天一次采集。也支持 `interval`，按分钟间隔采集。 |
| `dailyRefreshTime` | 每天从几点后认为应该采集新数据，默认 `12:10`。 |
| `retryMinutes` | 采集失败后的重试冷却时间，默认 30 分钟。 |
| `historyLimit` | 本地保留的历史采集快照数量。 |
| `alerts.lowBalance` | 余额低于多少元触发预警。 |
| `alerts.criticalDays` | 预计可用天数低于多少天触发预警。 |
| `alerts.highUsageRatio` | 最近一天用电高于近期均值多少倍时提醒。 |
| `alerts.staleHours` | 最新结算日距离当前超过多少小时后提示数据可能未刷新。 |

如果使用环境变量，会覆盖配置文件里的账号、密码、端口和监听地址：

```bash
ELECTRIC_USER_CODE=你的账号 ELECTRIC_PASSWORD=你的密码 PORT=8787 npm start
```

PowerShell 示例：

```powershell
$env:ELECTRIC_USER_CODE="你的账号"
$env:ELECTRIC_PASSWORD="你的密码"
$env:PORT="8787"
npm start
```

## 状态屏部署建议

- 运行服务的电脑保持不断电，浏览器打开 `http://localhost:8787` 后全屏。
- 如果使用独立屏幕、平板或小主机，建议接入同一个局域网后访问 `http://运行服务电脑IP:8787`。
- 学校数据每天约 12:00 才更新昨天用电量，状态屏不需要高频刷新接口。
- 页面每 60 秒刷新本地缓存，只是为了让屏幕自动显示最新采集结果。

## 数据和隐私

请不要把 `config.local.json`、`data/`、`.env` 上传到公开仓库。

本项目的 `.gitignore` 已默认忽略这些文件：

- `config.local.json`
- `config.*.local.json`
- `data/`
- `.env`

公开仓库只应该包含 `config.example.json` 这样的占位配置，不应该包含真实账号、密码、宿舍地址、余额截图或采集数据。

## 常见问题

### 页面显示“等待数据采集”

先检查 `config.local.json` 是否已经填写真实账号和密码，然后运行：

```bash
npm run refresh
```

如果命令报错，按终端里的错误信息处理。常见原因是账号密码错误、校园平台接口临时不可用、网络无法访问学校平台。

### 为什么不是实时电表读数？

学校平台展示的是结算后的历史用电数据，通常每天约 12:00 刷新昨天数据。本项目不会假装推测实时功率，也不会把每日数据拆成不存在的时间段。

### 多个宿舍或多个账号怎么用？

最简单的做法是复制多份项目目录，每份项目使用不同的 `config.local.json` 和不同的 `port`。

如果一个账号绑定多个用电户，可以先留空 `customerUserCode`。需要固定某一个用电户时，再从采集到的 `data/latest.json` 里查看对应编号并填入配置。

### 局域网设备打不开页面

检查三点：

- `bindHost` 是否是 `0.0.0.0`。
- Windows 防火墙是否允许 Node.js 监听当前端口。
- 屏幕设备访问的是运行服务电脑的局域网 IP，而不是 `localhost`。

## 项目结构

```text
.
├── config.example.json     # 示例配置，公开仓库只放占位值
├── public/                 # 状态屏前端页面
├── scripts/                # Windows 启动脚本
├── src/
│   ├── energyClient.js     # 学校智慧能耗平台接口采集逻辑
│   ├── server.js           # 本地 HTTP 服务和定时采集
│   └── store.js            # 本地 JSON 缓存
└── data/                   # 本地采集结果，默认不提交
```

## 许可证

MIT License
