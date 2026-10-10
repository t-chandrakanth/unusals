#!/usr/bin/env python3
"""Turn a CSV export of the " DPWCS LOCO" position tab into js/history-data.js.

Usage: python3 tools/build_history.py POSITION_CSV SHED_XLSX TODAY LAST_REPORT_TIME_UTC
       (TODAY as YYYY-MM-DD; needs openpyxl for the shed workbook)

The position tab holds one report per date: an "OTHER DIV" table followed
by an "SC DIV" table. Each pair becomes one snapshot. The date in the OTHER
DIV title is taken as the report date (the SC title is sometimes left stale).
"""
import csv, datetime, io, json, re, sys

MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()
TITLE = re.compile(r'DATA\s+DT-(\d\d)-(\d\d)-(\d{4})')


# Confirmed typing mistakes in loco numbers, corrected on the way in.
LOCO_FIXES = {'27764': '27767'}


def loco(v):
    return re.sub(r'\d{5}', lambda m: LOCO_FIXES.get(m.group(0), m.group(0)), clean(v))


def clean(v):
    return re.sub(r'\s+', ' ', (v or '').replace('\t', ' ')).strip()


def due(v):
    v = clean(v)
    m = re.fullmatch(r'(\d{1,2})[-/](\d{1,2})', v)
    if m and 1 <= int(m.group(2)) <= 12:
        return f'{int(m.group(1)):02d}-{MONTHS[int(m.group(2)) - 1]}'
    if re.fullmatch(r'4\d{4}', v):  # a date that leaked through as an Excel serial
        d = datetime.date(1899, 12, 30) + datetime.timedelta(days=int(v))
        return f'{d.day:02d}-{MONTHS[d.month - 1]}'
    return v


def join(parts):
    return ' / '.join(p for p in (clean(x) for x in parts) if p)


def parse(text):
    lines = text.split('\n')
    # Only the first tab of the export is the position tab.
    end = next((i for i, l in enumerate(lines) if i and l.startswith('## Sheet name')), len(lines))
    lines = lines[:end]
    snapshots, i = [], 0
    while i < len(lines):
        m = TITLE.search(lines[i])
        if not m:
            i += 1
            continue
        other = 'OTHER DIV' in lines[i].upper()
        day = f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
        header = [c.strip().upper() for c in next(csv.reader([lines[i + 1]]))]
        working = 'WORKING' in header
        i += 2
        rows = []
        while i < len(lines) and lines[i].strip() and not TITLE.search(lines[i]):
            c = next(csv.reader(io.StringIO(lines[i]))) + [''] * 12
            i += 1
            if not re.search(r'\d{5}', c[1]):
                continue
            row = dict(locoNo=loco(c[1]), dueDate=due(c[2]), trainNo=clean(c[3]), location=clean(c[4]),
                       division='OTHER' if other else 'SC', hoTrain='', hoPoint='', hoTime='',
                       working='', remarks='', sameSerial=bool(rows) and clean(c[0]) == '')
            if other:
                row.update(hoTrain=clean(c[5]), hoPoint=clean(c[6]), hoTime=clean(c[7]), remarks=join(c[8:]))
            elif working:
                row.update(working=clean(c[5]), remarks=join(c[6:]))
            else:
                row.update(remarks=join(c[5:]))
            # One row has the whole position typed into the train column.
            if not row['location'] and len(row['trainNo']) > 25:
                row['location'], row['trainNo'] = row['trainNo'], ''
            rows.append(row)
        if other:
            snapshots.append(dict(day=day, rows=rows))
        elif snapshots:
            snapshots[-1]['rows'] += rows
    return snapshots


def cell(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime('%d.%m.%y')
    return clean('' if v is None else str(v))


def dash(v):
    return '' if v in ('-', '--') else v


def parse_shed(path):
    """The loco shed's workbook: one sheet per day, one table per sheet."""
    import openpyxl
    snapshots = []
    for ws in openpyxl.load_workbook(path, data_only=True):
        rows = [[cell(c) for c in r] for r in ws.iter_rows(values_only=True)]
        rows = [r for r in rows if any(r)]
        if len(rows) < 3:
            continue
        m = re.search(r'WORKING ON\s+(\d\d)\.(\d\d)\.(\d{4})', ' '.join(rows[0]))
        if not m:
            continue  # undated reference sheets
        day = f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
        head = [c.upper() for c in rows[1]]
        col = lambda name: next((i for i, c in enumerate(head) if c.startswith(name)), None)
        c_loco, c_due, c_now = col('LOCO NO'), col('DUE'), col('CURRENTLY WORKING')
        c_loc, c_ho, c_dest = col('CURRENT LOCATION'), col('HANDED OVER'), col('TRAIN DESTINATION')
        c_work, c_train, c_rem = col('DPWCS WORKING'), col('TRAIN WORKING'), col('REMARKS')
        get = lambda r, i: dash(r[i]) if i is not None and i < len(r) else ''
        out = []
        for r in rows[2:]:
            if not re.search(r'\d{5}', get(r, c_loco)):
                break  # end of the main table (a note or other lists follow)
            ho = get(r, c_ho)
            d = re.search(r'(\d\d)\.(\d\d)\.(\d{4})', ho)
            ho_point = clean(re.sub(r'\bON\s*$', '', ho.replace(d.group(0), '') if d else ho))
            work, train = get(r, c_work), get(r, c_train)
            dest = get(r, c_dest)
            out.append(dict(
                locoNo=loco(get(r, c_loco)), dueDate=get(r, c_due),
                # Older sheets have train and location in separate columns;
                # later ones combine them, so the text is kept whole.
                trainNo=get(r, c_now) if c_loc is not None else '',
                location=get(r, c_loc) if c_loc is not None else get(r, c_now),
                division='OTHER' if ho else 'SC', hoTrain='', hoPoint=ho_point,
                hoTime=f'{d.group(1)}-{d.group(2)}-{d.group(3)[2:]}' if d else '',
                working=work if not train or train == work else f'{work} / TRAIN {train}',
                remarks=join([get(r, c_rem), f'DEST: {dest}' if dest else '']), sameSerial=False))
        if out:
            snapshots.append(dict(day=day, source='shed', rows=out))
    return snapshots


def stamp(snaps, hours_one, hours_many):
    by_day = {}
    for s in snaps:
        by_day.setdefault(s['day'], []).append(s)
    for day, group in by_day.items():
        hours = [hours_one] if len(group) == 1 else hours_many[:len(group)]
        for s, h in zip(group, hours):
            local = datetime.datetime.fromisoformat(f'{day}T{h:02d}:00:00+05:30')
            s['at'] = local.astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def main():
    position, shed, today, last_at = sys.argv[1:5]
    sheet = parse(open(position, encoding='utf-8').read())
    for s in sheet:
        s['source'] = 'sheet'
    sheet.sort(key=lambda s: s['day'])  # stable: same-day reports keep sheet order
    # Neither file records a time of day. Position reports are filed at noon
    # IST (10:00 and 16:00 when there are two), shed statements at 07:00 IST
    # (07:00 and 15:00), so that on a day with both the position report,
    # which is the later and fuller record, is the one carried forward.
    stamp(sheet, 12, [10, 16])
    sheet[-1]['at'] = last_at
    sheds = parse_shed(shed)
    sheds.reverse()  # the workbook is newest first
    sheds.sort(key=lambda s: s['day'])
    stamp(sheds, 7, [7, 15])
    # Sheets dated after today are copies prepared in advance, not records.
    snaps = sorted((s for s in sheet + sheds if s['day'] <= today), key=lambda s: s['at'])
    out = ('// Generated by tools/build_history.py from the " DPWCS LOCO" position tab\n'
           '// (source "sheet") and the loco shed\'s daily workbook (source "shed").\n'
           '// One entry per report, oldest first. Do not edit by hand.\n\n'
           'export const SNAPSHOTS = ' + json.dumps(snaps, indent=1, ensure_ascii=False) + ';\n')
    open('js/history-data.js', 'w', encoding='utf-8').write(out)
    for s in snaps:
        print(s['day'], s['at'][11:16], s['source'], len(s['rows']), 'rows',
              sum(r['division'] == 'OTHER' for r in s['rows']), 'other')


main()
