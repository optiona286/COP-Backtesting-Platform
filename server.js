const fs = require("fs");
const http = require("http");
const path = require("path");
const zlib = require("zlib");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5000);
const DATA_FOLDER = path.join(ROOT, "data");
const FSP_CSV = path.join(ROOT, "fsp_data.csv");

const contractsDb = new Map();
let contractsList = [];
let dateFileMap = new Map();
const responseCache = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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
  const startDate = new Date(2013, 0, 1);

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

function contractData(contractKey) {
  if (!contractsDb.has(contractKey)) {
    return { statusCode: 404, payload: { status: "error", message: `Contract ${contractKey} not found` } };
  }
  if (responseCache.has(contractKey)) return { cached: true, text: responseCache.get(contractKey) };

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
  const allOp = [];
  const allFu = [];
  let filesFound = 0;

  for (const day of tradingDays) {
    const info = dateFileMap.get(y_m_d(day));
    if (!info) continue;
    for (const fileInfo of [...info.op, ...info.fu]) {
      const rows = extractFilteredRecords(fileInfo.path, contractKey);
      for (const row of rows.opData) allOp.push(row);
      for (const row of rows.fuData) allFu.push(row);
      filesFound += 1;
    }
  }

  const payload = {
    status: "success",
    contract,
    prevContract,
    dateRange,
    totalDays: tradingDays.length,
    opData: allOp,
    fuData: allFu,
    summary: {
      totalOp: allOp.length,
      totalFu: allFu.length,
      filesFound,
    },
  };
  const text = JSON.stringify(payload);
  responseCache.set(contractKey, text);
  return { cached: false, text };
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
  if (!full.startsWith(ROOT)) return sendJson(res, 403, { ok: false, message: "Forbidden" });
  fs.readFile(full, (err, data) => {
    if (err) return sendJson(res, 404, { ok: false, message: "Not found" });
    const type = mimeTypes[path.extname(full).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(data);
  });
}

loadContracts();
scanDataFolder();

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });
    if (url.pathname === "/ping") return sendJson(res, 200, { ok: true, service: "OP PRO", port: PORT });
    if (url.pathname === "/api/contracts") {
      return sendJson(res, 200, { status: "success", count: contractsList.length, contracts: contractsList });
    }
    if (url.pathname === "/api/summary") {
      const opFiles = Array.from(dateFileMap.values()).reduce((sum, v) => sum + v.op.length, 0);
      const fuFiles = Array.from(dateFileMap.values()).reduce((sum, v) => sum + v.fu.length, 0);
      return sendJson(res, 200, {
        status: "success",
        contracts: {
          total: contractsList.length,
          monthly: contractsList.filter((c) => c.typeLabel === "M").length,
          weekly: contractsList.filter((c) => c.typeLabel === "W").length,
          future: contractsList.filter((c) => c.typeLabel === "F").length,
        },
        files: { totalDates: dateFileMap.size, opFiles, fuFiles },
      });
    }
    if (url.pathname.startsWith("/api/contract-data/")) {
      const key = decodeURIComponent(url.pathname.replace("/api/contract-data/", ""));
      const result = contractData(key);
      if (result.payload) return sendJson(res, result.statusCode, result.payload);
      return sendText(res, 200, result.text, "application/json; charset=utf-8");
    }
    if (url.pathname === "/api/fsp-data") {
      const result = fspData();
      return sendJson(res, result.statusCode, result.payload);
    }
    if (url.pathname === "/api/cache/clear") {
      const cleared = responseCache.size;
      responseCache.clear();
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`OP PRO is running at http://localhost:${PORT}`);
  console.log(`Contracts: ${contractsList.length}, dates: ${dateFileMap.size}`);
});
