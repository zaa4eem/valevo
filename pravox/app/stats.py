import csv
import datetime as dt
import io
import math
import time


def summary(db, config, days=30):
    days = min(90, max(1, days))
    today = dt.datetime.now(dt.timezone.utc).date()
    start_date = today - dt.timedelta(days=days-1)
    start = dt.datetime.combine(start_date,dt.time(),dt.timezone.utc).timestamp()
    now = time.time()
    def count(sql, args=()):
        return db.one(sql,args)["n"] or 0
    users = count("SELECT count(*) n FROM users")
    jobs = db.rows("SELECT state,mode,surface,latency,input_tokens,output_tokens,search_calls,error_code,created FROM jobs WHERE created>=?", (start,))
    done = [j for j in jobs if j["state"] == "done"]
    failed = [j for j in jobs if j["state"] == "failed"]
    latencies = sorted(j["latency"] for j in done if j["latency"] is not None)
    def percentile(p):
        return round(latencies[max(0,math.ceil(len(latencies)*p)-1)],2) if latencies else None
    daily_rows = db.rows("""SELECT date(created,'unixepoch') day, count(*) requests,
      sum(state='done') completed,sum(state='failed') failed,count(DISTINCT user_id) active
      FROM jobs WHERE created>=? GROUP BY day ORDER BY day""", (start,))
    mapped = {r["day"]:r for r in daily_rows}
    daily = []
    for i in range(days):
        day = str(start_date + dt.timedelta(days=i))
        daily.append(mapped.get(day,{"day":day,"requests":0,"completed":0,"failed":0,"active":0}))
    gates = count("SELECT count(*) n FROM users WHERE gate_seen>=?", (start,))
    converted = count("SELECT count(*) n FROM users WHERE gate_seen>=? AND joined_after_gate>=gate_seen", (start,))
    tokens_in = sum(j["input_tokens"] for j in jobs)
    tokens_out = sum(j["output_tokens"] for j in jobs)
    return {
        "period_days":days,"timezone":"UTC","users_total":users,
        "users_new":count("SELECT count(*) n FROM users WHERE created>=?",(start,)),
        "dau":count("SELECT count(DISTINCT user_id) n FROM jobs WHERE created>=?",(now-86400,)),
        "wau":count("SELECT count(DISTINCT user_id) n FROM jobs WHERE created>=?",(now-7*86400,)),
        "mau":count("SELECT count(DISTINCT user_id) n FROM jobs WHERE created>=?",(now-30*86400,)),
        "requests":len(jobs),"completed":len(done),"failed":len(failed),
        "pending":count("SELECT count(*) n FROM jobs WHERE state IN ('queued','running')"),
        "success_rate":round(len(done)/(len(done)+len(failed))*100,1) if done or failed else None,
        "p50_seconds":percentile(.5),"p95_seconds":percentile(.95),
        "input_tokens":tokens_in,"output_tokens":tokens_out,
        "search_calls":sum(j["search_calls"] for j in jobs),
        "estimated_token_cost_usd":round((tokens_in*config.input_price+tokens_out*config.output_price)/1_000_000,4) if config.input_price or config.output_price else None,
        "gate_users":gates,"converted_users":converted,
        "conversion_pct":round(converted/gates*100,1) if gates else None,
        "known_members":count("SELECT count(*) n FROM users WHERE member_status IN ('member','administrator','creator')"),
        "by_surface":{s:sum(j["surface"]==s for j in jobs) for s in ("telegram","miniapp")},
        "by_mode":{s:sum(j["mode"]==s for j in jobs) for s in ("citizen","student")},
        "errors":db.rows("SELECT error_code,count(*) total FROM jobs WHERE state='failed' AND created>=? GROUP BY error_code",(start,)),
        "feedback":db.rows("SELECT feedback,count(*) total FROM messages WHERE feedback IS NOT NULL AND created>=? GROUP BY feedback",(start,)),
        "delivery_pending":count("SELECT count(*) n FROM outbox WHERE delivered IS NULL AND attempts<8"),
        "delivery_failed":count("SELECT count(*) n FROM outbox WHERE delivered IS NULL AND attempts>=8"),
        "daily":daily,
    }


def users_page(db,offset=0,limit=50):
    return db.rows("""SELECT id,first_name,username,created,last_seen,used,mode,member_status,
      member_checked,gate_seen,joined_after_gate FROM users ORDER BY created DESC LIMIT ? OFFSET ?""",(limit,max(0,offset)))


def requests_page(db,offset=0,limit=50):
    return db.rows("""SELECT id,user_id,mode,surface,state,created,finished,latency,error_code,
      input_tokens,output_tokens,search_calls FROM jobs ORDER BY created DESC LIMIT ? OFFSET ?""",(limit,max(0,offset)))


def csv_export(rows):
    stream = io.StringIO(newline="")
    if rows:
        writer = csv.DictWriter(stream,fieldnames=list(rows[0]))
        writer.writeheader()
        for row in rows:
            # Spreadsheet formula injection protection, including leading whitespace.
            safe = {k:("'"+v if isinstance(v,str) and v.lstrip().startswith(("=","+","-","@")) else v) for k,v in row.items()}
            writer.writerow(safe)
    return ("\ufeff" + stream.getvalue()).encode("utf-8")
