#!/usr/bin/env python3
"""
SonarQube Scan Report Parser

调用 SonarQube REST API 拉取扫描结果，输出结构化 JSON 供 GitHub Actions 上传。

Usage:
    python3 parse_report.py \
        --host http://sonarqube:9000 \
        --token sqp_xxx \
        --project game-studio \
        --output /report/sonar-issues.json
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.error


def api_get(host: str, token: str, path: str) -> dict:
    """发 GET 请求到 SonarQube API，带 Bearer token 认证。"""
    url = f"{host}{path}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"[parse_report] HTTP {e.code} for {url}: {e.read().decode()[:200]}", file=sys.stderr)
        return {}
    except Exception as e:
        print(f"[parse_report] Request failed for {url}: {e}", file=sys.stderr)
        return {}


def wait_for_ce_task(host: str, token: str, task_id: str, timeout: int = 300) -> dict:
    """等待 CE task 变成 SUCCESS 或 FAILED。"""
    start = time.time()
    while time.time() - start < timeout:
        status = api_get(host, token, f"/api/ce/task?id={task_id}")
        task = status.get("task", {})
        st = task.get("status", "")
        print(f"[parse_report] CE task status: {st}")
        if st in ("SUCCESS", "FAILED", "CANCELED"):
            return task
        time.sleep(5)
    print("[parse_report] CE task wait timeout", file=sys.stderr)
    return {}


def main():
    parser = argparse.ArgumentParser(description="Parse SonarQube scan report")
    parser.add_argument("--host", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    project_key = args.project

    # ── 1. 尝试从 report-task.txt 拿到 taskId ─────────────────────
    report_task_file = "/usr/src/.scannerwork/report-task.txt"
    task_id = None
    analysis_date = ""
    try:
        with open(report_task_file) as f:
            for line in f:
                if line.startswith("taskId="):
                    task_id = line.split("=", 1)[1].strip()
                elif line.startswith("analysedAt="):
                    analysis_date = line.split("=", 1)[1].strip()
    except FileNotFoundError:
        print(f"[parse_report] {report_task_file} not found", file=sys.stderr)

    # ── 2. 拉取 CE task 详情 ─────────────────────────────────────
    ce_info = {}
    if task_id:
        print(f"[parse_report] Waiting for CE task: {task_id}")
        ce_info = wait_for_ce_task(args.host, args.token, task_id)
        if ce_info:
            analysis_date = ce_info.get("submittedAt", analysis_date)

    # ── 3. 拉取 issues ────────────────────────────────────────────
    print("[parse_report] Fetching issues...")
    all_issues = []
    page = 1
    page_size = 100
    while True:
        resp = api_get(
            args.host, args.token,
            f"/api/issues/search?projects={project_key}&ps={page_size}&p={page}&statuses=OPEN,CONFIRMED,REOPENED,RESOLVED,CLOSED"
        )
        issues = resp.get("issues", [])
        all_issues.extend(issues)
        total = resp.get("total", 0)
        print(f"[parse_report] Page {page}: fetched {len(issues)} issues (total {total})")
        if len(all_issues) >= total or len(issues) == 0:
            break
        page += 1

    # ── 4. 按 severity + type 统计 ──────────────────────────────
    severities = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"]
    types = ["BUG", "VULNERABILITY", "CODE_SMELL", "SECURITY_HOTSPOT"]
    summary = {sev: {t: 0 for t in types} for sev in severities}
    for issue in all_issues:
        sev = issue.get("severity", "INFO")
        itype = issue.get("type", "CODE_SMELL")
        if sev in summary and itype in summary[sev]:
            summary[sev][itype] += 1

    open_issues = [i for i in all_issues if i.get("status") in ("OPEN", "CONFIRMED", "REOPENED")]
    closed_issues = [i for i in all_issues if i.get("status") in ("RESOLVED", "CLOSED")]

    report = {
        "project": project_key,
        "analysisDate": analysis_date,
        "taskId": task_id,
        "totalIssues": len(all_issues),
        "openIssues": len(open_issues),
        "closedIssues": len(closed_issues),
        "summaryBySeverity": summary,
        "openIssuesList": [
            {
                "key": i.get("key"),
                "severity": i.get("severity"),
                "type": i.get("type"),
                "message": i.get("message", ""),
                "file": (i.get("component", "") or "").split(":")[0] if ":" in (i.get("component", "") or "") else i.get("component", ""),
                "line": i.get("line"),
                "status": i.get("status"),
                "tags": i.get("tags", []),
            }
            for i in open_issues
        ],
        "closedIssuesList": [
            {
                "key": i.get("key"),
                "severity": i.get("severity"),
                "type": i.get("type"),
                "message": i.get("message", ""),
                "status": i.get("status"),
            }
            for i in closed_issues[:50]
        ],
    }

    # ── 5. 写 JSON ─────────────────────────────────────────────
    output_path = args.output
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    # 摘要
    total_open = report["openIssues"]
    blockers = summary["BLOCKER"]["BUG"] + summary["BLOCKER"]["VULNERABILITY"] + summary["BLOCKER"]["SECURITY_HOTSPOT"]
    criticals = summary["CRITICAL"]["BUG"] + summary["CRITICAL"]["VULNERABILITY"] + summary["CRITICAL"]["SECURITY_HOTSPOT"]
    print(f"\n[parse_report] === SonarQube Report Summary ===")
    print(f"[parse_report] Open issues : {total_open}")
    print(f"[parse_report]   BLOCKER   : {summary['BLOCKER']}")
    print(f"[parse_report]   CRITICAL  : {summary['CRITICAL']}")
    print(f"[parse_report]   MAJOR     : {summary['MAJOR']}")
    print(f"[parse_report]   MINOR     : {summary['MINOR']}")
    print(f"[parse_report]   INFO      : {summary['INFO']}")
    print(f"[parse_report] Report saved: {output_path}")

    if blockers > 0 or criticals > 0:
        print(f"[parse_report] WARNING: {blockers} blocker(s) + {criticals} critical(s) found!", file=sys.stderr)


if __name__ == "__main__":
    main()
