import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

export class JsonStore {
  constructor(rootDir, historyLimit = 420) {
    this.rootDir = rootDir;
    this.historyLimit = historyLimit;
    this.latestPath = path.join(rootDir, "latest.json");
    this.historyPath = path.join(rootDir, "history.json");
    this.errorPath = path.join(rootDir, "errors.log");
  }

  async ensure() {
    await mkdir(this.rootDir, { recursive: true });
  }

  async readJson(filePath, fallback) {
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      return fallback;
    }
  }

  async latest() {
    await this.ensure();
    return this.readJson(this.latestPath, null);
  }

  async history() {
    await this.ensure();
    return this.readJson(this.historyPath, []);
  }

  async save(snapshot) {
    await this.ensure();
    const history = await this.history();
    history.push(snapshot);
    const limited = history.slice(-this.historyLimit);
    await writeFile(this.latestPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await writeFile(this.historyPath, `${JSON.stringify(limited, null, 2)}\n`, "utf8");
  }

  async saveError(error, context = {}) {
    await this.ensure();
    const row = {
      time: new Date().toISOString(),
      message: error?.message ?? String(error),
      stack: error?.stack,
      context,
    };
    await appendFile(this.errorPath, `${JSON.stringify(row)}\n`, "utf8");
  }
}
