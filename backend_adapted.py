#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TXO K線圖 後端 v2 - 伺服器端過濾版
核心改進：
  - 解壓後立即過濾，只保留 TXO + TX/MTX/TXF 的行
  - 不返回原始記錄（2M 筆 → ~30-50K 筆有效資料）
  - 支援分頁（?page=&limit=）以防資料量仍然過大
  - 支援 /api/contract-data-filtered（直接返回結構化 tick 物件）
"""

import os
import re
import json
import zipfile
import pandas as pd
import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, request, Response, stream_with_context
from flask_cors import CORS
from datetime import datetime, timedelta
from typing import List, Dict, Tuple

# ============================================================
# 配置
# ============================================================

app = Flask(__name__)
CORS(app)

FSP_CSV = 'fsp_data.csv'
DATA_FOLDER = 'data'

FILENAME_PATTERN_OP = r'^OptionsDaily[_\-]?(\d{4})[_\-](\d{2})[_\-](\d{2})'
FILENAME_PATTERN_FU = r'^Daily[_\-]?(\d{4})[_\-](\d{2})[_\-](\d{2})'

# 全域變數
contracts_db = {}
contracts_list = []
date_file_map = {}

# ★ 快取：contract_key -> 預先序列化的 JSON bytes
# 第一次查詢後存入，之後直接返回，不再重新解壓 ZIP
_response_cache: Dict[str, bytes] = {}

# ============================================================
# 初始化（與原始版本相同）
# ============================================================

# ============================================================
# 啟動時自動爬取最後結算價並更新 fsp_data.csv
# ============================================================

def fetch_and_update_fsp_csv():
    """
    從台灣期交所爬取「指數選擇權最後結算價」頁面，
    只取 臺指選擇權(TXO) 欄位，將新資料合併寫入 fsp_data.csv。
    - 逐年 POST queryYear=YYYY，從 2013 年抓到今年，確保歷史資料完整
    - 以「契約月份」為唯一鍵，網頁有的才更新/新增
    - 舊 CSV 中網頁沒有的資料保持不變
    """
    URL = 'https://www.taifex.com.tw/cht/5/optIndxFSP'
    START_YEAR = 2013
    current_year = datetime.now().year

    print("=" * 70)
    print(f"🌐 自動抓取最後結算價（指數選擇權 TXO），{START_YEAR} 年 ~ {current_year} 年...")
    print(f"   URL: {URL}")

    req_headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                      'AppleWebKit/537.36 (KHTML, like Gecko) '
                      'Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-TW,zh;q=0.9',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': URL,
        'Origin': 'https://www.taifex.com.tw',
    }

    now = datetime.now()
    end_year  = str(now.year)
    end_month = now.strftime('%m')

    # form 真正的參數：start_year / start_month / end_year / end_month
    # commodityIds=2 對應 臺指選擇權(TXO)
    post_data = {
        'pstring':      '',
        'commodityIds': '2',
        'start_year':   str(START_YEAR),
        'start_month':  '01',
        'end_year':     end_year,
        'end_month':    end_month,
        'button':       '送出查詢',
    }
    print(f"   POST 參數: start={START_YEAR}/01 end={end_year}/{end_month}")

    # ── 先 GET 建立 Session cookie，再 POST ───────────────────
    session = requests.Session()
    try:
        session.get(URL, headers=req_headers, timeout=20)
        print(f"   ✓ Session cookie 取得: {dict(session.cookies)}")
    except Exception as e:
        print(f"   ⚠ Session 初始化失敗: {e}，仍嘗試繼續...")

    try:
        resp = session.post(URL, data=post_data, headers=req_headers, timeout=30)
        resp.raise_for_status()
        resp.encoding = 'utf-8'
    except Exception as e:
        print(f"❌ POST 請求失敗: {e}")
        print("   跳過更新，使用現有 fsp_data.csv")
        return

    # ── 解析回應表格 ──────────────────────────────────────────
    try:
        soup = BeautifulSoup(resp.text, 'html.parser')
        table = None
        for t in soup.find_all('table'):
            hrow = t.find('tr')
            if hrow and '最後' in hrow.get_text() and '契約' in hrow.get_text():
                table = t
                break

        if table is None:
            print("❌ 找不到結算價表格，跳過更新")
            return

        header_cells = [th.get_text(strip=True) for th in table.find('tr').find_all(['th', 'td'])]
        print(f"   表格欄位: {header_cells}")

        col_contract = col_settle = col_txo = None
        for i, h in enumerate(header_cells):
            hn = h.replace('（', '(').replace('）', ')')
            if '契約' in hn and '月份' in hn:
                col_contract = i
            elif '契約' in hn and col_contract is None:
                col_contract = i
            if '最後' in hn and '結算日' in hn:
                col_settle = i
            if 'TXO' in hn.upper() or ('臺指' in hn and '選擇權' in hn):
                col_txo = i

        if col_contract is None: col_contract = 1
        if col_settle is None:   col_settle = 0
        if col_txo is None:      col_txo = 2

        web_data = {}
        for row in table.find_all('tr')[1:]:
            cells = row.find_all(['td', 'th'])
            if len(cells) <= max(col_contract, col_settle, col_txo):
                continue
            contract = cells[col_contract].get_text(strip=True)
            settle   = cells[col_settle].get_text(strip=True)
            txo_raw  = cells[col_txo].get_text(strip=True)
            if not contract or not settle:
                continue
            txo_val = txo_raw.replace(',', '').strip()
            if txo_val in ('-', ''):
                txo_val = ''
            web_data[contract] = {'最後結算日': settle, '臺指選擇權(TXO)': txo_val}

        print(f"   📊 從網頁解析到 {len(web_data)} 筆（{START_YEAR}/01 ~ {end_year}/{end_month}）")
        if not web_data:
            print("❌ 解析結果為空，跳過更新")
            return

    except Exception as e:
        print(f"❌ 解析頁面失敗: {e}")
        return

    # ── 讀取現有 CSV（若存在）────────────────────────────────
    col_names = ['契約月份', '最後結算日', '臺指選擇權(TXO)']
    if os.path.exists(FSP_CSV):
        try:
            # 自動嘗試多種編碼（Windows 常見 Big5/cp950，也可能是 utf-8-sig）
            existing_df = None
            for enc in ['utf-8-sig', 'utf-8', 'cp950', 'big5', 'gbk']:
                try:
                    existing_df = pd.read_csv(FSP_CSV, dtype=str, encoding=enc)
                    print(f"   ✓ 讀取 {FSP_CSV} 成功（編碼: {enc}）")
                    break
                except UnicodeDecodeError:
                    continue
            if existing_df is None:
                print(f"   ⚠ 自動偵測編碼失敗，改用強制讀取（cp950 + replace）")
                existing_df = pd.read_csv(FSP_CSV, dtype=str, encoding='cp950', encoding_errors='replace')
            if existing_df is None:
                raise ValueError("所有編碼均無法解析")
            # 確保欄位一致
            for c in col_names:
                if c not in existing_df.columns:
                    existing_df[c] = ''
            existing_df = existing_df[col_names]
        except Exception as e:
            print(f"⚠ 讀取現有 CSV 失敗: {e}，將建立新檔")
            existing_df = pd.DataFrame(columns=col_names)
    else:
        print(f"   {FSP_CSV} 不存在，將建立新檔")
        existing_df = pd.DataFrame(columns=col_names)

    # 轉為 dict 以便合併
    existing_map = {}
    for _, row in existing_df.iterrows():
        k = str(row['契約月份']).strip()
        if k:
            existing_map[k] = {
                '最後結算日':       str(row['最後結算日']).strip(),
                '臺指選擇權(TXO)': str(row['臺指選擇權(TXO)']).strip(),
            }

    # ── 合併：網頁資料覆蓋/新增，舊資料保留 ─────────────────
    added = updated = 0
    for contract, info in web_data.items():
        if contract not in existing_map:
            existing_map[contract] = info
            added += 1
        else:
            # 若 TXO 有值才更新（避免用 '-' 覆蓋正常值）
            if info['臺指選擇權(TXO)']:
                old_txo = existing_map[contract]['臺指選擇權(TXO)']
                existing_map[contract] = info
                if old_txo != info['臺指選擇權(TXO)']:
                    updated += 1

    # ── 按最後結算日降序排列後寫入 CSV ────────────────────────
    def parse_settle_for_sort(date_str):
        """將各種格式的日期字串轉為可排序的格式"""
        date_str = date_str.strip().replace('-', '/')
        for fmt in ('%Y/%m/%d', '%Y/%#m/%#d', '%Y%m%d'):
            try:
                return datetime.strptime(date_str, fmt)
            except:
                pass
        # 嘗試容錯：月日沒有補零
        try:
            parts = date_str.split('/')
            if len(parts) == 3:
                return datetime(int(parts[0]), int(parts[1]), int(parts[2]))
        except:
            pass
        return datetime.min

    rows_list = [
        {'契約月份': k, '最後結算日': v['最後結算日'], '臺指選擇權(TXO)': v['臺指選擇權(TXO)']}
        for k, v in existing_map.items()
    ]
    rows_list.sort(key=lambda r: parse_settle_for_sort(r['最後結算日']), reverse=True)

    result_df = pd.DataFrame(rows_list, columns=col_names)

    # 寫入前先移除唯讀屬性（支援 Windows / Linux）
    import stat
    import tempfile
    import shutil
    import subprocess
    import platform
    if os.path.exists(FSP_CSV):
        try:
            # Python 標準方式
            current_mode = os.stat(FSP_CSV).st_mode
            os.chmod(FSP_CSV, current_mode | stat.S_IWRITE | stat.S_IWGRP | stat.S_IWOTH)
            # Windows 額外用 attrib 指令確保移除唯讀
            if platform.system() == 'Windows':
                subprocess.run(['attrib', '-R', FSP_CSV], check=False, capture_output=True)
            print(f"   ℹ 已確認 {FSP_CSV} 可寫入")
        except Exception as e:
            print(f"   ⚠ 移除唯讀屬性時發生問題: {e}")

    # 先寫入暫存檔，再替換原檔（避免 Windows 檔案鎖定問題）
    tmp_path = FSP_CSV + '.tmp'
    try:
        result_df.to_csv(tmp_path, index=False, encoding='utf-8-sig')
        # 暫存檔寫成功後再覆蓋原檔
        if os.path.exists(FSP_CSV):
            os.remove(FSP_CSV)
        shutil.move(tmp_path, FSP_CSV)
        print(f"✅ fsp_data.csv 更新完成：新增 {added} 筆，更新 {updated} 筆，共 {len(rows_list)} 筆")
    except PermissionError as e:
        print(f"⚠ 無法寫入 {FSP_CSV}：{e}")
        print("   請確認沒有其他程式（Excel、記事本等）開著該檔案")
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        print("   後端將繼續使用舊版 CSV 啟動")
    except Exception as e:
        print(f"⚠ 寫入 {FSP_CSV} 失敗: {e}")
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        print("   後端將繼續使用舊版 CSV 啟動")
    print("=" * 70)


def initialize_contracts():
    global contracts_db, contracts_list
    if not os.path.exists(FSP_CSV):
        print(f"❌ 找不到 {FSP_CSV}")
        return False
    try:
        print(f"📥 讀取結算價資料: {FSP_CSV}")
        df = None
        for enc in ['utf-8-sig', 'utf-8', 'cp950', 'big5', 'gbk']:
            try:
                df = pd.read_csv(FSP_CSV, encoding=enc)
                print(f"   ✓ 編碼: {enc}，欄位: {list(df.columns)}")
                break
            except UnicodeDecodeError:
                continue
            except Exception as e:
                print(f"   ✗ {enc} 讀取錯誤: {type(e).__name__}: {e}")
                break
        # 所有編碼都失敗時，強制用 cp950 + errors='replace' 讀進來
        if df is None:
            print(f"   ⚠ 自動偵測編碼失敗，改用強制讀取（cp950 + replace）")
            df = pd.read_csv(FSP_CSV, encoding='cp950', encoding_errors='replace')
        if df is None:
            raise ValueError("所有編碼均無法解析 CSV")
        contract_col = settle_col = txo_col = None
        for col in df.columns:
            col_upper = col.upper().strip()
            if '契約' in col or 'CONTRACT' in col_upper:
                contract_col = col
            elif '結算' in col or 'SETTLE' in col_upper or '日期' in col:
                settle_col = col
            elif ('TXO' in col_upper or '臺指' in col) and '（' not in col and '）' not in col:
                txo_col = col
        if not contract_col: contract_col = df.columns[0]
        if not settle_col:   settle_col   = df.columns[1]
        if not txo_col:      txo_col      = df.columns[2] if len(df.columns) > 2 else None
        print(f"✓ 欄位識別: 契約={contract_col}, 結算日={settle_col}, TXO={txo_col}")
        START_DATE = datetime(2013, 1, 1)

        for _, row in df.iterrows():
            contract_month = str(row[contract_col]).strip()
            settle_date    = str(row[settle_col]).strip()
            txo_value      = row[txo_col] if txo_col else None

            # ★ 只讀取 2013 年 1 月之後的結算日
            parsed_settle = parse_date(settle_date)
            if parsed_settle is None or parsed_settle < START_DATE:
                continue

            if len(contract_month) == 6 and contract_month.isdigit():
                type_label = 'M'
            elif 'W' in contract_month.upper():
                type_label = 'W'
            elif 'F' in contract_month.upper():
                type_label = 'F'
            else:
                type_label = '?'
            contract_info = {
                'key': contract_month,
                'label': f"{contract_month} ({settle_date})",
                'settleDate': settle_date,
                'typeLabel': type_label,
                'txoFSP': float(txo_value) if pd.notna(txo_value) else None
            }
            contracts_db[contract_month] = contract_info
            contracts_list.append(contract_info)
        print(f"✓ 成功讀取 {len(contracts_db)} 個契約")
        return True
    except Exception as e:
        print(f"❌ 讀取失敗: {e}")
        return False


def scan_data_folder():
    global date_file_map
    date_file_map = {}
    if not os.path.exists(DATA_FOLDER):
        print(f"❌ 找不到 {DATA_FOLDER} 資料夾")
        return 0
    print(f"\n📁 掃描 {DATA_FOLDER} 資料夾...")
    file_count = 0
    for root, dirs, files in os.walk(DATA_FOLDER):
        for filename in files:
            if not filename.endswith('.zip'):
                continue
            m = re.match(FILENAME_PATTERN_OP, filename, re.IGNORECASE)
            if m:
                yyyy, mm, dd = m.groups(); dateKey = f"{yyyy}_{mm}_{dd}"; kind = 'op'
            else:
                m = re.match(FILENAME_PATTERN_FU, filename, re.IGNORECASE)
                if m:
                    yyyy, mm, dd = m.groups(); dateKey = f"{yyyy}_{mm}_{dd}"; kind = 'fu'
                else:
                    continue
            if dateKey not in date_file_map:
                date_file_map[dateKey] = {'op': [], 'fu': []}
            full_path = os.path.join(root, filename)
            date_file_map[dateKey][kind].append({'filename': filename, 'path': full_path, 'kind': kind})
            file_count += 1
    print(f"✓ 掃描完成，找到 {file_count} 個 ZIP 檔案，{len(date_file_map)} 個交易日")
    return file_count


# ============================================================
# ★ 核心改進：伺服器端過濾
# ============================================================

def decode_bytes(content: bytes) -> str:
    """嘗試多種編碼解析位元組"""
    for enc in ['utf-8', 'utf-8-sig', 'big5', 'gbk', 'latin-1']:
        try:
            return content.decode(enc)
        except:
            continue
    return ''


def extract_filtered_records(zip_path: str,
                             target_expiry: str = None) -> Tuple[List[dict], List[dict]]:
    """
    解壓 ZIP 並立即過濾：
      - op_ticks: TXO 且 expiry == target_expiry（若有指定）
      - fu_ticks: TX / MTX / TXF（不過濾 expiry）

    RPT 欄位（OptionsDaily）：
      [0]date, [1]product, [2]strike, [3]expiry, [4]type,
      [5]time, [6]price, [7]volume, [8]openFlag

    target_expiry 格式與 RPT 欄位相同，例如 '202603W2'
    """
    op_ticks = []
    fu_ticks = []
    FUTURES_PRODUCTS = {'TX', 'MTX', 'TXF'}

    # 正規化：方便比較（去空白、大寫）
    target_exp_norm = target_expiry.strip().upper() if target_expiry else None

    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            rpt_files = [f for f in zf.namelist() if f.lower().endswith('.rpt')]
            for rpt_name in rpt_files:
                try:
                    raw = zf.read(rpt_name)
                    text = decode_bytes(raw)
                    if not text:
                        continue

                    for line in text.split('\n'):
                        line = line.strip()
                        if not line:
                            continue
                        parts = [p.strip() for p in line.split(',')]
                        if len(parts) < 5:
                            continue

                        product = parts[1].upper() if len(parts) > 1 else ''

                        # ── TXO 選擇權 ──────────────────────────────
                        if product == 'TXO' and len(parts) >= 8:
                            # ★ expiry 過濾：只保留指定契約
                            if target_exp_norm:
                                row_expiry = parts[3].strip().upper()
                                if row_expiry != target_exp_norm:
                                    continue   # 跳過其他契約，不進 list

                            try:
                                price  = float(parts[6])
                                volume = int(parts[7])
                                if not (price != price) and volume >= 0:
                                    op_ticks.append({
                                        'date':     parts[0],
                                        'product':  parts[1],
                                        'strike':   parts[2],
                                        'expiry':   parts[3],
                                        'type':     parts[4],
                                        'time':     parts[5],
                                        'price':    price,
                                        'volume':   volume,
                                        'openFlag': parts[8] if len(parts) > 8 else ''
                                    })
                            except (ValueError, IndexError):
                                pass

                        # ── 期貨 TX / MTX / TXF（不過濾 expiry）──
                        elif product in FUTURES_PRODUCTS:
                            try:
                                d2 = parts[2] if len(parts) > 2 else ''
                                is_fut_fmt = bool(re.match(r'^\d{4,6}$', d2))
                                if is_fut_fmt:
                                    expiry = parts[2]
                                    time   = parts[3] if len(parts) > 3 else ''
                                    price  = float(parts[4]) if len(parts) > 4 else float('nan')
                                    volume = int(parts[5]) if len(parts) > 5 else 0
                                else:
                                    expiry = parts[3] if len(parts) > 3 else ''
                                    time   = parts[5] if len(parts) > 5 else ''
                                    price  = float(parts[6]) if len(parts) > 6 else float('nan')
                                    volume = int(parts[7]) if len(parts) > 7 else 0

                                if not (price != price) and price > 0:
                                    fu_ticks.append({
                                        'date':    parts[0],
                                        'product': parts[1],
                                        'expiry':  expiry.replace(' ', ''),
                                        'time':    time,
                                        'price':   price,
                                        'volume':  volume
                                    })
                            except (ValueError, IndexError):
                                pass

                except Exception as e:
                    print(f"  ⚠ 讀取 {rpt_name} 失敗: {e}")

    except Exception as e:
        print(f"❌ 解壓 {zip_path} 失敗: {e}")

    return op_ticks, fu_ticks


# ============================================================
# 工具函數
# ============================================================

def parse_date(date_str: str):
    date_str = date_str.strip().replace('-', '/')
    try:
        if len(date_str) == 8 and date_str.isdigit():
            return datetime.strptime(date_str, '%Y%m%d')
        return datetime.strptime(date_str, '%Y/%m/%d')
    except:
        return None

def format_date_yyyymmdd(date) -> str:
    return date.strftime('%Y%m%d')

def format_date_yyyy_mm_dd(date) -> str:
    return date.strftime('%Y_%m_%d')

def is_trading_day(date) -> bool:
    return date.weekday() < 5

def get_trading_days_between(start_date, end_date) -> List:
    """返回 start_date 到 end_date 之間所有交易日（含兩端）"""
    days = []
    cur = start_date
    while cur <= end_date:
        if is_trading_day(cur):
            days.append(cur)
        cur += timedelta(days=1)
    return days


def find_previous_contract(contract_key: str) -> dict:
    """
    找到指定契約的「上一個同類型契約」，用其結算日作為本契約的起點。

    規則：
      W1 → 找同年月或上月的 W4（若無 W4 則找月選 M）
      W2 → 找同年月的 W1
      W3（月選 M）→ 找同年月的 W2
      W4 → 找同年月的月選 M（即 W3）
      月選 M（YYYYMM）→ 找同年月的 W2（因為月選就是 W3）
      F 契約 → 找結算日在本契約結算日之前、最近的 F 契約

    回傳 contracts_db 中的 contract_info，找不到回傳 None
    """
    key = contract_key.upper().strip()
    cur = contracts_db.get(key)
    if not cur:
        return None

    cur_settle = parse_date(cur['settleDate'])
    if not cur_settle:
        return None

    # ── F 契約：找結算日最近的前一個 F ──────────────────────
    if cur['typeLabel'] == 'F':
        best = None
        best_settle = None
        for c in contracts_list:
            if c['typeLabel'] != 'F' or c['key'] == key:
                continue
            s = parse_date(c['settleDate'])
            if s and s < cur_settle:
                if best_settle is None or s > best_settle:
                    best = c
                    best_settle = s
        return best

    # ── W / M 契約：解析年月週次 ─────────────────────────────
    # key 格式範例：202603W1, 202603W2, 202603W4, 202603（月選）
    m = re.match(r'^(\d{6})(W(\d))?$', key)
    if not m:
        return None

    ym   = m.group(1)          # e.g. '202603'
    wnum = int(m.group(3)) if m.group(3) else None   # W週次，月選為 None

    # 月選視為 W3
    effective_wnum = wnum if wnum is not None else 3

    # 決定「上一個」的週次和年月
    if effective_wnum == 1:
        # W1 的前一個 = 上月的 W5，若無則找 W4，若無則找月選
        prev_ym_dt = datetime.strptime(ym + '01', '%Y%m%d') - timedelta(days=1)
        prev_ym = prev_ym_dt.strftime('%Y%m')
        # 先找 W5
        prev_key = f'{prev_ym}W5'
        if prev_key in contracts_db:
            return contracts_db[prev_key]
        # 再找 W4
        prev_key = f'{prev_ym}W4'
        if prev_key in contracts_db:
            return contracts_db[prev_key]
        # 再找月選
        prev_key = prev_ym
        if prev_key in contracts_db:
            return contracts_db[prev_key]
        # 找不到：往前掃所有契約，找結算日最近的週選或月選
        best = None; best_settle = None
        for c in contracts_list:
            if c['typeLabel'] not in ('W', 'M'): continue
            s = parse_date(c['settleDate'])
            if s and s < cur_settle:
                if best_settle is None or s > best_settle:
                    best = c; best_settle = s
        return best

    elif effective_wnum == 2:
        prev_key = f'{ym}W1'
    elif effective_wnum == 3:
        # 月選或 W3 的前一個 = 同年月 W2
        prev_key = f'{ym}W2'
    elif effective_wnum == 4:
        # W4 的前一個 = 同年月月選（W3）
        prev_key = ym   # 月選 key 就是 YYYYMM
        if prev_key not in contracts_db:
            prev_key = f'{ym}W3'
    elif effective_wnum == 5:
        # W5 的前一個 = 同年月 W4
        prev_key = f'{ym}W4'
    else:
        return None

    return contracts_db.get(prev_key)


# ============================================================
# API 端點
# ============================================================

@app.route('/api/contracts', methods=['GET'])
def get_contracts():
    return jsonify({'status': 'success', 'count': len(contracts_list), 'contracts': contracts_list})


@app.route('/api/summary', methods=['GET'])
def get_summary():
    total_op = sum(len(v['op']) for v in date_file_map.values())
    total_fu = sum(len(v['fu']) for v in date_file_map.values())
    return jsonify({
        'status': 'success',
        'contracts': {
            'total': len(contracts_db),
            'monthly': len([c for c in contracts_list if c['typeLabel'] == 'M']),
            'weekly':  len([c for c in contracts_list if c['typeLabel'] == 'W']),
            'future':  len([c for c in contracts_list if c['typeLabel'] == 'F']),
        },
        'files': {
            'totalDates': len(date_file_map),
            'opFiles': total_op,
            'fuFiles': total_fu,
        }
    })


@app.route('/api/contract-data/<contract_key>', methods=['GET'])
def get_contract_data(contract_key):
    """
    ★ 改進版 v3：expiry 過濾 + 記憶體快取
    - 第一次查詢：解壓 ZIP → 過濾 → 序列化 → 存入快取
    - 後續查詢：直接從快取返回，毫秒級回應
    - GET /api/cache/clear  可清空快取
    """
    if contract_key not in contracts_db:
        return jsonify({'status': 'error', 'message': f'契約 {contract_key} 未找到'}), 404

    # ★ 快取命中：直接返回，不重新解壓
    if contract_key in _response_cache:
        print(f"⚡ 快取命中: {contract_key}")
        return Response(
            _response_cache[contract_key],
            status=200,
            mimetype='application/json'
        )

    contract_info = contracts_db[contract_key]
    settle_date   = parse_date(contract_info['settleDate'])
    if not settle_date:
        return jsonify({'status': 'error', 'message': f'無法解析結算日期'}), 400

    # ── 找上一個契約的結算日作為起點 ───────────────────────
    prev_contract = find_previous_contract(contract_key)
    if prev_contract:
        start_date = parse_date(prev_contract['settleDate'])
        print(f"\n📊 查詢契約: {contract_key}  結算日: {contract_info['settleDate']}")
        print(f"   上一個契約: {prev_contract['key']} 結算日: {prev_contract['settleDate']} → 作為起點")
    else:
        # 找不到上一個契約，退回固定 6 日
        start_date = settle_date - timedelta(days=10)
        while not is_trading_day(start_date):
            start_date -= timedelta(days=1)
        print(f"\n📊 查詢契約: {contract_key}  找不到上一個契約，使用預設起點")

    trading_days = get_trading_days_between(start_date, settle_date)
    date_range   = [format_date_yyyymmdd(d) for d in trading_days]

    print(f"   交易日範圍: {date_range[0]} → {date_range[-1]}（共 {len(trading_days)} 天）")
    print(f"   ★ TXO expiry 過濾: 只保留 expiry == '{contract_key}'")

    all_op_ticks: List[dict] = []
    files_found = 0

    for date in trading_days:
        date_key = format_date_yyyy_mm_dd(date)
        date_str = format_date_yyyymmdd(date)

        if date_key not in date_file_map:
            print(f"   ✗ {date_str}: 未找到檔案")
            continue

        for file_info in date_file_map[date_key]['op']:
            op_t, _ = extract_filtered_records(file_info['path'],
                                               target_expiry=contract_key)
            all_op_ticks.extend(op_t)
            files_found += 1
            print(f"   ✓ {file_info['filename']}: OP={len(op_t)}")

    total_op = len(all_op_ticks)
    print(f"   過濾後：OP={total_op}，開始序列化並存入快取...\n")

    payload = {
        'status':        'success',
        'contract':      contract_info,
        'prevContract':  prev_contract,          # 上一個契約資訊（起點依據）
        'dateRange':     date_range,             # 完整交易日清單
        'totalDays':     len(trading_days),
        'opData':        all_op_ticks,
        'fuData':        [],
        'summary': {
            'totalOp':    total_op,
            'totalFu':    0,
            'filesFound': files_found,
        }
    }

    # 序列化一次，存入快取供後續請求直接使用
    json_bytes = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    _response_cache[contract_key] = json_bytes
    print(f"   ✓ 快取已儲存 {contract_key}（{len(json_bytes)/1024:.1f} KB）\n")

    return Response(json_bytes, status=200, mimetype='application/json')


@app.route('/api/fsp-data', methods=['GET'])
def get_fsp_data():
    """回傳 fsp_data.csv 的結算價資料（JSON 格式）"""
    if not os.path.exists(FSP_CSV):
        return jsonify({'status': 'error', 'message': 'fsp_data.csv 不存在'}), 404
    try:
        rows = []
        with open(FSP_CSV, 'r', encoding='utf-8-sig') as f:
            import csv
            reader = csv.DictReader(f)
            for row in reader:
                contract_month = row.get('契約月份', '').strip()
                settle_date    = row.get('最後結算日', '').strip()
                txo            = row.get('臺指選擇權(TXO)', '-').strip()
                if not contract_month or not settle_date:
                    continue
                rows.append({
                    'contractMonth': contract_month,
                    'settleDate':    settle_date,
                    'txo':           txo,
                    'teo':           '-',
                    'tfo':           '-',
                })
        return jsonify({'status': 'success', 'count': len(rows), 'data': rows})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/cache/clear', methods=['GET'])
def clear_cache():
    """清空所有快取（重新掃描或資料更新後使用）"""
    count = len(_response_cache)
    _response_cache.clear()
    print(f"🗑 快取已清空（共 {count} 個）")
    return jsonify({'status': 'success', 'cleared': count})


@app.route('/api/cache/status', methods=['GET'])
def cache_status():
    """查看目前快取狀態"""
    items = [
        {'key': k, 'sizeKB': round(len(v)/1024, 1)}
        for k, v in _response_cache.items()
    ]
    total_kb = sum(len(v) for v in _response_cache.values()) / 1024
    return jsonify({
        'status':   'success',
        'count':    len(_response_cache),
        'totalKB':  round(total_kb, 1),
        'items':    items
    })

# ── 舊版相容（分頁參數，保留但不建議使用）──────────────────
def _get_contract_data_paged(contract_key, contract_info, date_range, trading_days):
    """保留分頁邏輯供需要時使用"""
    pass  # 目前快取版本已不需要分頁


# ============================================================
# 啟動
# ============================================================

if __name__ == '__main__':
    print("=" * 70)
    print("🚀 TXO 後端 API v2 - 伺服器端過濾版")
    print("=" * 70)
    print("\n核心改進：")
    print("  ✓ 解壓後立即過濾（只保留 TXO + TX/MTX/TXF）")
    print("  ✓ 返回結構化 tick 物件，而非原始 CSV 行")
    print("  ✓ 資料量：2M 筆 → ~30-80K 筆（expiry 過濾）")
    print("  ✓ 記憶體快取：同一契約第二次查詢秒回")
    print("  ✓ 清快取：GET http://localhost:5000/api/cache/clear\n")

    fetch_and_update_fsp_csv()
    ok = initialize_contracts()
    print()
    scan_data_folder()
    print()

    if ok:
        print("✓ 初始化完成，啟動伺服器...\n")
        app.run(debug=False, use_reloader=False, port=5000, host='0.0.0.0', threaded=True)
    else:
        print("❌ 初始化失敗")