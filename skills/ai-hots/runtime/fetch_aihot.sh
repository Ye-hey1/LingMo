#!/usr/bin/env bash
set -euo pipefail

export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"
export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"

UA="${AIHOT_UA:-Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-skill/0.2.0}"
BASE_URL="${AIHOT_BASE_URL:-https://aihot.virxact.com}"
MODE="${AIHOT_MODE:-selected}"
TAKE="${AIHOT_TAKE:-100}"
SINCE="${AIHOT_SINCE:-}"
OUTPUT_DIR="${SKILL_OUTPUT_DIR:-${LINGMO_OUTPUT_DIR:-.}}"

if [[ -z "$SINCE" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    SINCE="$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) - timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ'))
PY
)"
  elif command -v python >/dev/null 2>&1; then
    SINCE="$(python - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) - timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ'))
PY
)"
  else
    SINCE="$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT00:00:00Z)"
  fi
fi

mkdir -p "$OUTPUT_DIR"

URL="${BASE_URL}/api/public/items?mode=${MODE}&since=${SINCE}&take=${TAKE}"
OUT_FILE="${OUTPUT_DIR}/aihot-items.json"
MD_FILE="${OUTPUT_DIR}/aihot-digest.md"

curl -fsSL \
  -H "User-Agent: ${UA}" \
  -H "Accept: application/json" \
  "$URL" \
  -o "$OUT_FILE"

if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3 2>/dev/null || command -v python)"
  "$PYTHON_BIN" - "$OUT_FILE" "$MD_FILE" "$SINCE" <<'PY'
import json
import sys
from datetime import datetime, timezone, timedelta

json_path, md_path, since = sys.argv[1:4]
with open(json_path, 'rb') as handle:
    payload = json.loads(handle.read().decode('utf-8', errors='replace'))

labels = {
    'ai-models': '模型发布/更新',
    'ai-products': '产品发布/更新',
    'industry': '行业动态',
    'paper': '论文研究',
    'tip': '技巧与观点',
    None: '其他',
}
order = ['ai-models', 'ai-products', 'industry', 'paper', 'tip', None]
items = payload.get('items') if isinstance(payload, dict) else []
items = items if isinstance(items, list) else []
grouped = {key: [] for key in order}
for item in items:
    if not isinstance(item, dict):
        continue
    key = item.get('category') if item.get('category') in grouped else None
    grouped[key].append(item)

def human_time(value):
    if not value:
        return ''
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone(timedelta(hours=8)))
        return dt.strftime('%m/%d %H:%M')
    except Exception:
        return str(value)

lines = [
    f'**AI HOT - 最近 24 小时精选**',
    '',
    f'共 {len(items)} 条，按发布时间倒序。数据来自 aihot.virxact.com。',
    '',
]
index = 1
for key in order:
    section_items = grouped.get(key) or []
    if not section_items:
        continue
    lines.extend([f'## {labels.get(key, "其他")}', ''])
    for item in section_items:
        title = item.get('title') or item.get('title_en') or '未命名'
        source = item.get('source') or '未知来源'
        url = item.get('url') or ''
        summary = (item.get('summary') or '').strip()
        lines.append(f'{index}. **{title}** - {source}')
        when = human_time(item.get('publishedAt'))
        if when:
            lines.append(f'   {when}')
        if summary:
            lines.append(f'   {summary[:180]}')
        if url:
            lines.append(f'   {url}')
        lines.append('')
        index += 1

with open(md_path, 'w', encoding='utf-8', newline='\n') as handle:
    handle.write('\n'.join(lines).rstrip() + '\n')
PY
fi

printf 'AI HOT fetch succeeded.\n'
printf 'Window since: %s\n' "$SINCE"
printf 'Saved JSON: %s\n' "$OUT_FILE"
if [[ -f "$MD_FILE" ]]; then
  printf 'Saved Markdown: %s\n' "$MD_FILE"
fi
