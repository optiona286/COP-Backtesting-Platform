const fs = require("fs");
const http = require("http");
const path = require("path");
const zlib = require("zlib");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5100);
const DATA_FOLDER = process.env.OP_PRO_DATA_DIR || "D:\\op_pro\\data";
const TAIEX_FOLDER = process.env.OP_PRO_TAIEX_DIR || "F:\\加權指數5s\\加權指數資料庫";
const TX_FOLDER = process.env.OP_PRO_TX_DIR || "F:\\加權指數5s\\台指期資料庫";
const FSP_CSV = path.join(ROOT, "fsp_data.csv");
const TAIFEX_FSP_URL = "https://www.taifex.com.tw/cht/5/optIndxFSP";
const FINMIND_API_URL = "https://api.finmindtrade.com/api/v4/data";
const FINMIND_TAIEX_DATASET = "TaiwanVariousIndicators5Seconds";

const contractsDb = new Map();
let contractsList = [];
let dateFileMap = new Map();
let txDateFileMap = new Map();
const responseCache = new Map();
const responseCacheSizes = new Map();
const RESPONSE_CACHE_MAX_ITEMS = 3;
const RESPONSE_CACHE_MAX_BYTES = 250 * 1024 * 1024;

function getCachedResponse(key) {
  if (!responseCache.has(key)) return null;
  const text = responseCache.get(key);
  // Map 的插入順序作為 LRU；命中後移到最後。
  responseCache.delete(key);
  responseCache.set(key, text);
  return text;
}

function setCachedResponse(key, text) {
  if (responseCache.has(key)) responseCache.delete(key);
  responseCache.set(key, text);
  responseCacheSizes.set(key, Buffer.byteLength(text));
  let totalBytes = Array.from(responseCacheSizes.values()).reduce((sum, size) => sum + size, 0);
  while (responseCache.size > 1 && (responseCache.size > RESPONSE_CACHE_MAX_ITEMS || totalBytes > RESPONSE_CACHE_MAX_BYTES)) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
    totalBytes -= responseCacheSizes.get(oldestKey) || 0;
    responseCacheSizes.delete(oldestKey);
  }
}

function clearResponseCache() {
  const cleared = responseCache.size;
  responseCache.clear();
  responseCacheSizes.clear();
  return cleared;
}
const taiexCache = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".ico": "image/x-icon",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(text);
}

function sendJsonText(req, res, text) {
  const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(String(req.headers["accept-encoding"] || ""));
  if (!acceptsGzip) return sendText(res, 200, text, "application/json; charset=utf-8");
  zlib.gzip(text, { level: 1 }, (err, body) => {
    if (err) return sendText(res, 200, text, "application/json; charset=utf-8");
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "gzip",
      "Content-Length": body.length,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      Vary: "Accept-Encoding",
    });
    res.end(body);
  });
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function parseTaifexTxfRows(html) {
  const pattern = /<TD width="14%" align=middle>(\d{4}\/\d{2}\/\d{2})<\/TD>\s*<TD width="10%" align=middle>([^<]+)<\/TD>\s*<TD width="10%" align=right>([^<]+)<\/TD>/g;
  const rows = [];
  let match;
  while ((match = pattern.exec(html)) !== null) {
    rows.push({
      contract: match[2].trim(),
      settleDate: match[1].trim(),
      txoFSP: match[3].replace(/,/g, "").trim(),
    });
  }
  return rows;
}

async function updateFspCsvFromTaifex() {
  const now = new Date();
  const body = new URLSearchParams({
    commodityIds: "2",
    start_year: "2011",
    start_month: "01",
    end_year: String(now.getFullYear()),
    end_month: String(now.getMonth() + 1).padStart(2, "0"),
    button: "送出查詢",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(TAIFEX_FSP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "OP-PRO/1.0",
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`TAIFEX HTTP ${response.status}`);
    const html = await response.text();
    const rows = parseTaifexTxfRows(html);
    if (!rows.length) throw new Error("TAIFEX returned no TXO FSP rows");

    const lines = [
      ["契約月份", "最後結算日", "臺指選擇權(TXO)"].map(csvEscape).join(","),
      ...rows.map((row) => [row.contract, row.settleDate, row.txoFSP].map(csvEscape).join(",")),
    ];
    fs.writeFileSync(FSP_CSV, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
    return {
      ok: true,
      count: rows.length,
      latest: rows[0],
      earliest: rows[rows.length - 1],
      file: FSP_CSV,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseDate(value) {
  const s = String(value || "").trim().replace(/-/g, "/");
  let y;
  let m;
  let d;
  if (/^\d{8}$/.test(s)) {
    y = Number(s.slice(0, 4));
    m = Number(s.slice(4, 6));
    d = Number(s.slice(6, 8));
  } else {
    const parts = s.split("/");
    if (parts.length !== 3) return null;
    y = Number(parts[0]);
    m = Number(parts[1]);
    d = Number(parts[2]);
  }
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function ymd(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
}

function y_m_d(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}_${p(date.getMonth() + 1)}_${p(date.getDate())}`;
}

function isTradingDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function tradingDaysBetween(start, end) {
  const days = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cur <= end) {
    if (isTradingDay(cur)) days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function loadContracts() {
  contractsDb.clear();
  contractsList = [];
  if (!fs.existsSync(FSP_CSV)) return false;

  const text = fs.readFileSync(FSP_CSV, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return false;

  const headers = parseCsvLine(lines[0]);
  const contractIdx = headers.findIndex((h) => h.includes("契約") || /contract/i.test(h));
  const settleIdx = headers.findIndex((h) => h.includes("結算") || /settle/i.test(h));
  const txoIdx = headers.findIndex((h) => /txo/i.test(h) || h.includes("臺指"));
  const startDate = new Date(2011, 0, 1);

  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const key = String(row[contractIdx >= 0 ? contractIdx : 0] || "").trim();
    const settleDate = String(row[settleIdx >= 0 ? settleIdx : 1] || "").trim();
    const txoRaw = String(row[txoIdx >= 0 ? txoIdx : 2] || "").replace(/,/g, "").trim();
    const dt = parseDate(settleDate);
    if (!key || !dt || dt < startDate) continue;

    let typeLabel = "?";
    if (/^\d{6}$/.test(key)) typeLabel = "M";
    else if (/W/i.test(key)) typeLabel = "W";
    else if (/F/i.test(key)) typeLabel = "F";

    const info = {
      key,
      label: `${key} (${settleDate})`,
      settleDate,
      typeLabel,
      txoFSP: txoRaw && txoRaw !== "-" ? Number(txoRaw) : null,
    };
    contractsDb.set(key, info);
    contractsList.push(info);
  }
  return contractsList.length > 0;
}

function scanDir(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scanDir(full, files);
    else files.push(full);
  }
  return files;
}

function scanDataFolder() {
  dateFileMap = new Map();
  let count = 0;
  for (const fullPath of scanDir(DATA_FOLDER)) {
    const filename = path.basename(fullPath);
    if (!/\.zip$/i.test(filename)) continue;
    let match = filename.match(/^OptionsDaily[_-]?(\d{4})[_-](\d{2})[_-](\d{2})/i);
    let kind = "op";
    if (!match) {
      match = filename.match(/^Daily[_-]?(\d{4})[_-](\d{2})[_-](\d{2})/i);
      kind = "fu";
    }
    if (!match) continue;
    const dateKey = `${match[1]}_${match[2]}_${match[3]}`;
    if (!dateFileMap.has(dateKey)) dateFileMap.set(dateKey, { op: [], fu: [] });
    dateFileMap.get(dateKey)[kind].push({ filename, path: fullPath, kind });
    count += 1;
  }
  return count;
}

function scanTxDataFolder() {
  txDateFileMap = new Map();
  let count = 0;
  for (const fullPath of scanDir(TX_FOLDER)) {
    const filename = path.basename(fullPath);
    if (!/\.zip$/i.test(filename)) continue;
    const match = filename.match(/^Daily[_-]?(\d{4})[_-](\d{2})[_-](\d{2})/i);
    if (!match) continue;
    const dateKey = `${match[1]}_${match[2]}_${match[3]}`;
    if (!txDateFileMap.has(dateKey)) txDateFileMap.set(dateKey, []);
    txDateFileMap.get(dateKey).push({ filename, path: fullPath, kind: "tx" });
    count += 1;
  }
  return count;
}

function findEndOfCentralDirectory(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function readZipEntries(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) return [];
  const total = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < total; i += 1) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries
    .filter((entry) => /\.rpt$/i.test(entry.name))
    .map((entry) => {
      const local = entry.localOffset;
      if (buf.readUInt32LE(local) !== 0x04034b50) return null;
      const nameLen = buf.readUInt16LE(local + 26);
      const extraLen = buf.readUInt16LE(local + 28);
      const dataStart = local + 30 + nameLen + extraLen;
      const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);
      let data;
      if (entry.method === 0) data = compressed;
      else if (entry.method === 8) data = zlib.inflateRawSync(compressed);
      else return null;
      if (entry.uncompressedSize && data.length !== entry.uncompressedSize) {
        data = data.subarray(0, entry.uncompressedSize);
      }
      return { name: entry.name, text: data.toString("latin1") };
    })
    .filter(Boolean);
}

function extractFilteredRecords(zipPath, targetExpiry) {
  const opData = [];
  const fuData = [];
  const target = targetExpiry ? String(targetExpiry).trim().toUpperCase() : "";
  const futuresProducts = new Set(["TX", "MTX", "TXF"]);

  for (const entry of readZipEntries(zipPath)) {
    for (const line of entry.text.split(/\r?\n/)) {
      const parts = line.trim().split(",").map((s) => s.trim());
      if (parts.length < 5) continue;
      const product = String(parts[1] || "").toUpperCase();

      if (product === "TXO" && parts.length >= 8) {
        if (target && String(parts[3] || "").trim().toUpperCase() !== target) continue;
        const price = Number(parts[6]);
        const volume = Number.parseInt(parts[7], 10);
        if (!Number.isFinite(price) || !Number.isFinite(volume) || volume < 0) continue;
        opData.push({
          date: parts[0],
          product: parts[1],
          strike: parts[2],
          expiry: parts[3],
          type: parts[4],
          time: parts[5],
          price,
          volume,
          openFlag: parts[8] || "",
        });
      } else if (futuresProducts.has(product)) {
        // Calendar-spread rows use values such as 202510/202511 and have a
        // different price layout. They are not outright TX quote data.
        if (String(parts[2] || "").includes("/")) continue;
        let expiry;
        let time;
        let price;
        let volume;
        const second = parts[2] || "";
        if (/^\d{4,6}$/.test(second)) {
          expiry = parts[2] || "";
          time = parts[3] || "";
          price = Number(parts[4]);
          volume = Number.parseInt(parts[5] || "0", 10);
        } else {
          expiry = parts[3] || "";
          time = parts[5] || "";
          price = Number(parts[6]);
          volume = Number.parseInt(parts[7] || "0", 10);
        }
        if (!Number.isFinite(price) || price <= 0) continue;
        fuData.push({
          date: parts[0],
          product: parts[1],
          expiry: String(expiry).replace(/\s/g, ""),
          time,
          price,
          volume: Number.isFinite(volume) ? volume : 0,
        });
      }
    }
  }

  return { opData, fuData };
}

function extractTxRecords(zipPath) {
  return extractFilteredRecords(zipPath, "").fuData.filter(
    (row) => String(row.product || "").trim().toUpperCase() === "TX",
  );
}

function selectMainTxRecords(rows) {
  const stats = new Map();
  for (const row of rows) {
    const expiry = String(row.expiry || "").trim();
    if (!expiry) continue;
    const current = stats.get(expiry) || { volume: 0, count: 0 };
    current.volume += Number(row.volume) || 0;
    current.count += 1;
    stats.set(expiry, current);
  }
  let mainExpiry = "";
  let best = null;
  for (const [expiry, stat] of stats) {
    if (!best || stat.volume > best.volume || (stat.volume === best.volume && stat.count > best.count)) {
      mainExpiry = expiry;
      best = stat;
    }
  }
  return {
    mainExpiry,
    rows: mainExpiry ? rows.filter((row) => String(row.expiry || "").trim() === mainExpiry) : [],
  };
}

function compactTxRecordsBySecond(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const key = `${row.date}|${row.time}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.price = row.price;
      existing.volume += Number(row.volume) || 0;
    } else {
      buckets.set(key, { ...row, volume: Number(row.volume) || 0 });
    }
  }
  return Array.from(buckets.values());
}

function compactOptionRecordsBySecond(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const key = `${row.date}|${row.time}|${row.expiry}|${row.strike}|${row.type}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.price = row.price;
      existing.volume += Number(row.volume) || 0;
      if (row.openFlag) existing.openFlag = row.openFlag;
    } else {
      buckets.set(key, { ...row, volume: Number(row.volume) || 0 });
    }
  }
  return Array.from(buckets.values());
}

function findPreviousContract(contractKey) {
  const key = String(contractKey || "").toUpperCase().trim();
  const current = contractsDb.get(key);
  if (!current) return null;
  const currentSettle = parseDate(current.settleDate);
  if (!currentSettle) return null;

  if (current.typeLabel === "F") {
    let best = null;
    let bestSettle = null;
    for (const c of contractsList) {
      if (c.typeLabel !== "F" || c.key === key) continue;
      const settle = parseDate(c.settleDate);
      if (settle && settle < currentSettle && (!bestSettle || settle > bestSettle)) {
        best = c;
        bestSettle = settle;
      }
    }
    return best;
  }

  const match = key.match(/^(\d{6})(W(\d))?$/);
  if (!match) return null;
  const ym = match[1];
  const week = match[3] ? Number(match[3]) : 3;
  let prevKey = null;

  if (week === 1) {
    const prevMonth = new Date(Number(ym.slice(0, 4)), Number(ym.slice(4, 6)) - 1, 0);
    const prevYm = `${prevMonth.getFullYear()}${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
    for (const candidate of [`${prevYm}W5`, `${prevYm}W4`, prevYm]) {
      if (contractsDb.has(candidate)) return contractsDb.get(candidate);
    }
    let best = null;
    let bestSettle = null;
    for (const c of contractsList) {
      if (!["W", "M"].includes(c.typeLabel)) continue;
      const settle = parseDate(c.settleDate);
      if (settle && settle < currentSettle && (!bestSettle || settle > bestSettle)) {
        best = c;
        bestSettle = settle;
      }
    }
    return best;
  }
  if (week === 2) prevKey = `${ym}W1`;
  else if (week === 3) prevKey = `${ym}W2`;
  else if (week === 4) prevKey = contractsDb.has(ym) ? ym : `${ym}W3`;
  else if (week === 5) prevKey = `${ym}W4`;

  return prevKey ? contractsDb.get(prevKey) || null : null;
}

function contractWindow(contractKey) {
  if (!contractsDb.has(contractKey)) {
    return { statusCode: 404, payload: { status: "error", message: `Contract ${contractKey} not found` } };
  }

  const contract = contractsDb.get(contractKey);
  const settleDate = parseDate(contract.settleDate);
  if (!settleDate) {
    return { statusCode: 400, payload: { status: "error", message: "Invalid settle date" } };
  }

  const prevContract = findPreviousContract(contractKey);
  let startDate = prevContract ? parseDate(prevContract.settleDate) : null;
  if (!startDate) {
    startDate = new Date(settleDate);
    startDate.setDate(startDate.getDate() - 10);
    while (!isTradingDay(startDate)) startDate.setDate(startDate.getDate() - 1);
  }

  const tradingDays = tradingDaysBetween(startDate, settleDate);
  const dateRange = tradingDays.map(ymd);
  const availableDates = [];
  const missingDates = [];
  let opFiles = 0;
  let fuFiles = 0;
  let txDatabaseFiles = 0;
  let txFallbackFiles = 0;

  for (const day of tradingDays) {
    const dateKey = y_m_d(day);
    const info = dateFileMap.get(dateKey);
    const txFiles = txDateFileMap.get(dateKey) || [];
    const fallbackFiles = info ? info.fu : [];
    const selectedTxFiles = txFiles.length ? txFiles : fallbackFiles;
    if ((!info || !info.op.length) && !selectedTxFiles.length) {
      missingDates.push(ymd(day));
      continue;
    }
    availableDates.push(ymd(day));
    opFiles += info ? info.op.length : 0;
    fuFiles += selectedTxFiles.length;
    txDatabaseFiles += txFiles.length;
    if (!txFiles.length) txFallbackFiles += fallbackFiles.length;
  }

  return {
    statusCode: 200,
    window: {
      contract,
      prevContract,
      startDate: ymd(startDate),
      endDate: ymd(settleDate),
      tradingDays,
      dateRange,
      totalDays: tradingDays.length,
      availableDates,
      missingDates,
      files: {
        total: opFiles + fuFiles,
        op: opFiles,
        fu: fuFiles,
        txDatabase: txDatabaseFiles,
        txFallback: txFallbackFiles,
        availableDays: availableDates.length,
        dataFolder: DATA_FOLDER,
        txFolder: TX_FOLDER,
      },
      cached: Array.from(responseCache.keys()).some((key) => key === contractKey || key.startsWith(`${contractKey}|`)),
    },
  };
}

function contractInfo(contractKey) {
  const result = contractWindow(contractKey);
  if (result.payload) return result;
  const { tradingDays, ...info } = result.window;
  return { statusCode: 200, payload: { status: "success", ...info } };
}

function contractData(contractKey, options = {}) {
  const requestedDays = Math.max(0, Number.parseInt(options.days || "0", 10) || 0);
  const requestedDate = /^\d{8}$/.test(String(options.date || "")) ? String(options.date) : "";
  const cacheKey = `${contractKey}|${requestedDate ? `date:${requestedDate}` : `days:${requestedDays}`}`;
  const cachedText = getCachedResponse(cacheKey);
  if (cachedText !== null) return { cached: true, text: cachedText };

  const plan = contractWindow(contractKey);
  if (plan.payload) return plan;
  const meta = plan.window;
  let selectedTradingDays = meta.tradingDays;
  if (requestedDate) selectedTradingDays = meta.tradingDays.filter((day) => ymd(day) === requestedDate);
  else if (requestedDays > 0) {
    // Walk archived trading dates backwards from settlement, including dates
    // before the normal contract window. Only this expiry's actual ticks count.
    selectedTradingDays = Array.from(dateFileMap.entries())
      .filter(([, info]) => info.op.length > 0)
      .map(([key]) => parseDate(key.replace(/_/g, '/')))
      .filter(day => day && ymd(day) <= meta.endDate)
      .sort((a, b) => b - a);
  }
  if (!selectedTradingDays.length) {
    return { statusCode: 404, payload: { status: "error", message: "No trading data in requested range" } };
  }
  const allOp = [];
  const allFu = [];
  let filesFound = 0;
  let txDatabaseDays = 0;
  let txFallbackDays = 0;
  const loadedTradingDays = [];

  for (const day of selectedTradingDays) {
    const dateKey = y_m_d(day);
    const info = dateFileMap.get(dateKey) || { op: [], fu: [] };
    const databaseTxFiles = txDateFileMap.get(dateKey) || [];

    const dayOpRows = [];
    for (const fileInfo of info.op) {
      const rows = extractFilteredRecords(fileInfo.path, contractKey);
      for (const row of rows.opData) dayOpRows.push(row);
      filesFound += 1;
    }
    if (!requestedDate && requestedDays > 0 && !dayOpRows.length) continue;
    loadedTradingDays.push(day);
    for (const row of dayOpRows) allOp.push(row);

    const dayTxRows = [];
    for (const fileInfo of databaseTxFiles) {
      for (const row of extractTxRecords(fileInfo.path)) dayTxRows.push(row);
      filesFound += 1;
    }

    if (dayTxRows.length) {
      txDatabaseDays += 1;
    } else {
      for (const fileInfo of info.fu) {
        for (const row of extractTxRecords(fileInfo.path)) dayTxRows.push(row);
        filesFound += 1;
      }
      if (dayTxRows.length) txFallbackDays += 1;
    }
    for (const row of dayTxRows) allFu.push(row);
    if (!requestedDate && requestedDays > 0 && loadedTradingDays.length >= requestedDays) break;
  }

  const mainTx = selectMainTxRecords(allFu);
  const compactTx = compactTxRecordsBySecond(mainTx.rows);
  const compactOp = compactOptionRecordsBySecond(allOp);
  const loadedDateRange = loadedTradingDays.map(ymd).sort();
  const loadedDateSet = new Set(loadedDateRange);
  const contractAvailableDates = Array.from(new Set([...meta.availableDates, ...loadedDateRange])).sort();
  const payload = {
    status: "success",
    contract: meta.contract,
    prevContract: meta.prevContract,
    dateRange: loadedDateRange,
    totalDays: Math.max(meta.totalDays, loadedDateRange.length),
    loadedDays: loadedDateRange.length,
    requestedDays,
    requestedDate,
    startDate: loadedDateRange[0],
    endDate: loadedDateRange[loadedDateRange.length - 1],
    contractStartDate: meta.startDate,
    contractEndDate: meta.endDate,
    contractAvailableDates,
    availableDates: contractAvailableDates.filter((date) => loadedDateSet.has(date)),
    shortfallDays: !requestedDate && requestedDays > 0 ? Math.max(0, requestedDays - loadedDateRange.length) : 0,
    missingDates: meta.missingDates.filter((date) => loadedDateSet.has(date)),
    opData: compactOp,
    fuData: compactTx,
    summary: {
      totalOp: compactOp.length,
      totalOpBeforeSecondCompact: allOp.length,
      totalFu: compactTx.length,
      totalFuBeforeMainFilter: allFu.length,
      totalFuBeforeSecondCompact: mainTx.rows.length,
      txMainExpiry: mainTx.mainExpiry,
      filesFound,
      txDatabaseDays,
      txFallbackDays,
      txSource: txDatabaseDays && txFallbackDays ? "mixed" : (txDatabaseDays ? "database" : "fallback"),
      txFolder: TX_FOLDER,
    },
  };
  const text = JSON.stringify(payload);
  setCachedResponse(cacheKey, text);
  return { cached: false, text };
}

function normalizeTaiexDate(raw) {
  const s = String(raw || "").trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}[\/\-]\d{2}[\/\-]\d{2}$/.test(s)) return s.replace(/\//g, "-");
  return null;
}

function loadTaiexCsv(dateIso) {
  if (taiexCache.has(dateIso)) return taiexCache.get(dateIso);
  const filePath = [
    path.join(TAIEX_FOLDER, `${dateIso}.csv`),
    path.join(TAIEX_FOLDER, `TAIEX_${dateIso}.csv`),
  ].find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    return { ok: false, message: `TAIEX file not found for ${dateIso}` };
  }

  const text = fs.readFileSync(filePath, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/);
  const data = [];
  // header expected: date,TAIEX
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const idx = line.indexOf(",");
    if (idx < 0) continue;
    const ts = line.slice(0, idx).trim();
    const px = parseFloat(line.slice(idx + 1));
    if (!Number.isFinite(px)) continue;
    // ts looks like "2026-04-29 09:00:00"
    const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!m) continue;
    const dt = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    );
    const dtms = dt.getTime();
    if (!Number.isFinite(dtms)) continue;
    const dateYmd = `${m[1]}${m[2]}${m[3]}`;
    const timeHms = `${m[4]}${m[5]}${m[6]}`;
    data.push({ date: dateYmd, time: timeHms, dtms, price: px });
  }

  const result = { ok: true, dateIso, count: data.length, data };
  taiexCache.set(dateIso, result);
  return result;
}

function listLocalTaiexDates() {
  if (!fs.existsSync(TAIEX_FOLDER)) return [];
  return fs.readdirSync(TAIEX_FOLDER)
    .map((name) => {
      const m = name.match(/^(?:TAIEX_)?(\d{4}-\d{2}-\d{2})\.csv$/i);
      return m ? m[1] : null;
    })
    .filter(Boolean)
    .sort();
}

function getTaiexPreviousClose(dateIso) {
  const dates = listLocalTaiexDates();
  let index = dates.findIndex((date) => date >= dateIso) - 1;
  if (index < 0 && dates.length && dates[dates.length - 1] < dateIso) index = dates.length - 1;
  for (let i = index; i >= 0; i -= 1) {
    const previousDateIso = dates[i];
    const result = loadTaiexCsv(previousDateIso);
    if (!result.ok || !result.data.length) continue;
    const last = result.data[result.data.length - 1];
    if (Number.isFinite(Number(last.price))) {
      return { dateIso: previousDateIso, price: Number(last.price) };
    }
  }
  return null;
}

function getTaiexPreviousCloseMap(dates) {
  const map = {};
  for (const dateIso of dates || []) map[dateIso] = getTaiexPreviousClose(dateIso);
  return map;
}

function subtractCalendarMonths(dateIso, months) {
  const [year, month, day] = dateIso.split("-").map(Number);
  const target = new Date(year, month - 1, 1);
  target.setMonth(target.getMonth() - months);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  const pad = (value) => String(value).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

function loadTaiexRange(endIso, months = 6) {
  const startIso = subtractCalendarMonths(endIso, months);
  const dates = listLocalTaiexDates().filter((date) => date >= startIso && date <= endIso);
  const data = [];
  const loadedDates = [];
  for (const dateIso of dates) {
    const result = loadTaiexCsv(dateIso);
    if (!result.ok || !result.data.length) continue;
    loadedDates.push(dateIso);
    data.push(...result.data);
  }
  return { startIso, endIso, months, dates: loadedDates, count: data.length, data };
}

function loadTaiexBetween(startIso, endIso) {
  const dates = listLocalTaiexDates().filter((date) => date >= startIso && date <= endIso);
  const data = [];
  const loadedDates = [];
  for (const dateIso of dates) {
    const result = loadTaiexCsv(dateIso);
    if (!result.ok || !result.data.length) continue;
    loadedDates.push(dateIso);
    data.push(...result.data);
  }
  return { startIso, endIso, dates: loadedDates, count: data.length, data };
}

function normalizeFinMindTimestamp(value) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  return {
    isoDate: `${m[1]}-${m[2]}-${m[3]}`,
    text: `${m[1]}-${m[2]}-${m[3]} ${m[4] || "00"}:${m[5] || "00"}:${m[6] || "00"}`,
  };
}

async function fetchTaiexCsvFromFinMind(dateIso) {
  const url = new URL(FINMIND_API_URL);
  url.searchParams.set("dataset", FINMIND_TAIEX_DATASET);
  url.searchParams.set("start_date", dateIso);
  url.searchParams.set("end_date", dateIso);

  const token = process.env.FINMIND_API_TOKEN || process.env.FINMIND_TOKEN || "";
  const headers = { "User-Agent": "OP-PRO/1.0" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_err) {
      throw new Error(`FinMind returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
    }

    if (!response.ok) {
      throw new Error(`FinMind HTTP ${response.status}: ${payload.msg || JSON.stringify(payload).slice(0, 200)}`);
    }
    if (payload.status && Number(payload.status) >= 400) {
      throw new Error(`FinMind status ${payload.status}: ${payload.msg || "request failed"}`);
    }
    if (!Array.isArray(payload.data)) {
      throw new Error("FinMind response has no data array");
    }

    const rows = payload.data
      .map((row) => {
        const ts = normalizeFinMindTimestamp(row.date);
        const price = Number(row.TAIEX ?? row.taiex);
        if (!ts || ts.isoDate !== dateIso || !Number.isFinite(price)) return null;
        return { ts: ts.text, price };
      })
      .filter(Boolean)
      .sort((a, b) => a.ts.localeCompare(b.ts));

    if (!rows.length) {
      throw new Error(`FinMind returned no TAIEX rows for ${dateIso}`);
    }

    fs.mkdirSync(TAIEX_FOLDER, { recursive: true });
    const filePath = path.join(TAIEX_FOLDER, `TAIEX_${dateIso}.csv`);
    const lines = [
      ["date", "TAIEX"].map(csvEscape).join(","),
      ...rows.map((row) => [row.ts, row.price].map(csvEscape).join(",")),
    ];
    fs.writeFileSync(filePath, `\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
    taiexCache.delete(dateIso);

    return { ok: true, count: rows.length, file: filePath };
  } finally {
    clearTimeout(timer);
  }
}

function fspData() {
  if (!fs.existsSync(FSP_CSV)) {
    return { statusCode: 404, payload: { status: "error", message: "fsp_data.csv not found" } };
  }
  const text = fs.readFileSync(FSP_CSV, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    const parts = parseCsvLine(line);
    if (!parts[0] || !parts[1]) continue;
    rows.push({
      contractMonth: parts[0],
      settleDate: parts[1],
      txo: parts[2] || "-",
      teo: "-",
      tfo: "-",
    });
  }
  return { statusCode: 200, payload: { status: "success", count: rows.length, data: rows } };
}

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT + path.sep)) return sendJson(res, 403, { ok: false, message: "Forbidden" });
  if (!['index.html','manifest.webmanifest','sw.js'].includes(rel) && !/^(css|js|favicon|sound)\//.test(rel.replace(/\\/g, "/")) && !/^data\/(?:online-index\.json|manifest\.json|(?:options|tx|taiex)\/(?:manifest\.json|\d{4}-\d{2}-\d{2}\.json\.gz))$/.test(rel.replace(/\\/g, "/"))) return sendJson(res, 403, { ok: false, message: "Forbidden" });
  fs.readFile(full, (err, data) => {
    if (err) return sendJson(res, 404, { ok: false, message: "Not found" });
    const type = mimeTypes[path.extname(full).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
    if (url.pathname === "/ping") return sendJson(res, 200, { ok: true, service: "OP PRO Online", port: PORT });
    if (url.pathname === "/api/contracts") {
      return sendJson(res, 200, { status: "success", count: contractsList.length, contracts: contractsList });
    }
    if (url.pathname === "/api/summary") {
      const opFiles = Array.from(dateFileMap.values()).reduce((sum, v) => sum + v.op.length, 0);
      const fuFiles = Array.from(dateFileMap.values()).reduce((sum, v) => sum + v.fu.length, 0);
      const txDatabaseFiles = Array.from(txDateFileMap.values()).reduce((sum, v) => sum + v.length, 0);
      return sendJson(res, 200, {
        status: "success",
        contracts: {
          total: contractsList.length,
          monthly: contractsList.filter((c) => c.typeLabel === "M").length,
          weekly: contractsList.filter((c) => c.typeLabel === "W").length,
          future: contractsList.filter((c) => c.typeLabel === "F").length,
        },
        files: {
          totalDates: dateFileMap.size,
          opFiles,
          fuFiles,
          txDatabaseDates: txDateFileMap.size,
          txDatabaseFiles,
          txFolder: TX_FOLDER,
        },
      });
    }
    if (url.pathname.startsWith("/api/contract-data/")) {
      const key = decodeURIComponent(url.pathname.replace("/api/contract-data/", ""));
      const result = contractData(key, {
        days: url.searchParams.get("days"),
        date: url.searchParams.get("date"),
      });
      if (result.payload) return sendJson(res, result.statusCode, result.payload);
      return sendJsonText(req, res, result.text);
    }
    if (url.pathname.startsWith("/api/contract-info/")) {
      const key = decodeURIComponent(url.pathname.replace("/api/contract-info/", ""));
      const result = contractInfo(key);
      return sendJson(res, result.statusCode, result.payload);
    }
    if (url.pathname === "/api/fsp-data") {
      const result = fspData();
      return sendJson(res, result.statusCode, result.payload);
    }
    if (url.pathname === "/api/taiex-range") {
      const endIso = normalizeTaiexDate(url.searchParams.get("end"));
      const requestedStartIso = normalizeTaiexDate(url.searchParams.get("start"));
      const months = Math.min(24, Math.max(1, Number.parseInt(url.searchParams.get("months") || "6", 10) || 6));
      if (!endIso) return sendJson(res, 400, { status: "error", message: "Invalid TAIEX range end date" });
      if (url.searchParams.has("start") && !requestedStartIso) {
        return sendJson(res, 400, { status: "error", message: "Invalid TAIEX range start date" });
      }
      const result = requestedStartIso
        ? loadTaiexBetween(requestedStartIso, endIso)
        : loadTaiexRange(endIso, months);
      return sendJson(res, 200, {
        status: "success",
        ...result,
        previousCloses: getTaiexPreviousCloseMap(result.dates),
        dateCount: result.dates.length,
        folder: TAIEX_FOLDER,
        source: "local",
      });
    }
    if (url.pathname.startsWith("/api/taiex/")) {
      const raw = decodeURIComponent(url.pathname.replace("/api/taiex/", ""));
      const dateIso = normalizeTaiexDate(raw);
      if (!dateIso) {
        return sendJson(res, 400, { status: "error", message: `Invalid TAIEX date: ${raw}` });
      }
      let fetched = null;
      let result = loadTaiexCsv(dateIso);
      if (!result.ok) {
        try {
          fetched = await fetchTaiexCsvFromFinMind(dateIso);
          result = loadTaiexCsv(dateIso);
        } catch (err) {
          return sendJson(res, 404, {
            status: "error",
            message: `${result.message}; FinMind fetch failed: ${err.message}`,
            dateIso,
            folder: TAIEX_FOLDER,
          });
        }
      }
      return sendJson(res, 200, {
        status: "success",
        dateIso: result.dateIso,
        count: result.count,
        data: result.data,
        previousClose: getTaiexPreviousClose(result.dateIso),
        folder: TAIEX_FOLDER,
        source: fetched ? "finmind" : "local",
      });
    }
    if (url.pathname === "/api/taiex-list") {
      try {
        if (!fs.existsSync(TAIEX_FOLDER)) {
          return sendJson(res, 200, { status: "success", count: 0, dates: [], folder: TAIEX_FOLDER });
        }
        const dates = listLocalTaiexDates();
        return sendJson(res, 200, { status: "success", count: dates.length, dates, folder: TAIEX_FOLDER });
      } catch (err) {
        return sendJson(res, 500, { status: "error", message: err.message });
      }
    }
    if (url.pathname === "/api/tx-list") {
      const dates = Array.from(txDateFileMap.keys()).sort();
      const count = Array.from(txDateFileMap.values()).reduce((sum, files) => sum + files.length, 0);
      return sendJson(res, 200, {
        status: "success",
        count,
        dateCount: dates.length,
        dates,
        folder: TX_FOLDER,
      });
    }
    if (url.pathname === "/api/scan") {
      let fspUpdate = null;
      try {
        fspUpdate = await updateFspCsvFromTaifex();
      } catch (err) {
        fspUpdate = { ok: false, message: err.message };
      }
      const okContracts = loadContracts();
      const scanned = scanDataFolder();
      const txScanned = scanTxDataFolder();
      clearResponseCache();
      return sendJson(res, 200, {
        status: "success",
        fspUpdate,
        scanned,
        txScanned,
        contracts: {
          ok: okContracts,
          total: contractsList.length,
          latest: contractsList[0] || null,
        },
        files: { totalDates: dateFileMap.size, txDatabaseDates: txDateFileMap.size, txFolder: TX_FOLDER },
      });
    }
    if (url.pathname === "/api/cache/clear") {
      const cleared = clearResponseCache();
      return sendJson(res, 200, { status: "success", cleared });
    }
    if (url.pathname === "/api/cache/status") {
      const items = Array.from(responseCache.entries()).map(([key, value]) => ({
        key,
        sizeKB: Math.round((Buffer.byteLength(value) / 1024) * 10) / 10,
      }));
      const totalKB = items.reduce((sum, item) => sum + item.sizeKB, 0);
      return sendJson(res, 200, { status: "success", count: items.length, totalKB, items });
    }
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return sendJson(res, 500, { status: "error", message: err.message });
  }
});

async function boot() {
  console.log("OP PRO booting...");
  if (process.env.OP_PRO_LOCAL_SOURCE !== "1") {
    if (fs.existsSync(path.join(ROOT, 'data', 'options'))) require('./scripts/build-online-index.cjs')();
    server.listen(PORT, "127.0.0.1", () => console.log(`OP PRO compressed data: http://localhost:${PORT}`));
    return;
  }
  console.log(`FSP CSV: ${FSP_CSV}`);
  try {
    const fspUpdate = process.env.OP_PRO_SKIP_FSP_REFRESH === "1" ? null : await updateFspCsvFromTaifex();
    if (fspUpdate) console.log(`FSP updated: ${fspUpdate.count} rows, latest ${fspUpdate.latest.contract} ${fspUpdate.latest.settleDate}`);
  } catch (err) {
    console.warn(`FSP update failed, using local csv: ${err.message}`);
  }
  loadContracts();
  scanDataFolder();
  scanTxDataFolder();

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`OP PRO is running at http://localhost:${PORT}`);
    console.log(`Contracts: ${contractsList.length}, dates: ${dateFileMap.size}`);
    console.log(`TX database: ${TX_FOLDER} (${txDateFileMap.size} dates)`);
  });
}

boot().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
