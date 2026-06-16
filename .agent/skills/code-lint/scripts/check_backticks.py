#!/usr/bin/env python3
"""
code-lint: Check for unescaped backticks inside template literal strings.

Detects a common bug in agent prompt files where markdown inline code
backticks (\\`text\\`) are embedded in JS/TS template literals without
escaping, causing TypeScript compilation errors (TS1005, TS1443).

Heuristic:
- Tracks template literal state via a simple state machine.
- Flags a backtick as a potential issue when it is preceded by a
  non-whitespace character AND followed by a non-whitespace character
  (the markdown inline code pattern: \\`word\\`).
- Ignores triple-backtick code blocks (\\`\\`\\`) which are legitimate.
- Skips .d.ts files (JSDoc code blocks are normal there).

Usage:
  python3 check_backticks.py <file_or_directory>
  python3 check_backticks.py server/agents.ts
  python3 check_backticks.py server/

Exit code:
  0 = no issues found
  1 = issues found
  2 = usage/IO error
"""

import os
import sys
from dataclasses import dataclass
from pathlib import Path

IGNORED_SUFFIXES = {'.d.ts', '.d.mts', '.d.cts'}


@dataclass
class Issue:
    filepath: str
    line: int
    col: int
    snippet: str


def _is_escaped(text: str, pos: int) -> bool:
    """Check if the character at pos is preceded by an odd number of backslashes."""
    bs = 0
    j = pos - 1
    while j >= 0 and text[j] == '\\':
        bs += 1
        j -= 1
    return bs % 2 == 1


def _is_triple_backtick(text: str, pos: int) -> bool:
    """Check if the backtick at pos starts or ends a triple-backtick block."""
    # Opening: pos is followed by two more backticks
    if pos + 2 < len(text) and text[pos+1] == '`' and text[pos+2] == '`':
        # Check not inside a template literal content (simplified: just treat as triple)
        return True
    # Closing: pos-2, pos-1, pos are backticks
    if pos >= 2 and text[pos-1] == '`' and text[pos-2] == '`':
        return True
    return False


def find_issues(text: str) -> list[tuple[int, int, str]]:
    """
    Find unescaped backticks that look like inline code in template content.

    Returns list of (line_no, col_no, context_snippet).
    """
    issues = []
    in_tmpl = False

    i = 0
    while i < len(text):
        ch = text[i]

        if ch == '`' and not _is_escaped(text, i) and not _is_triple_backtick(text, i):
            if not in_tmpl:
                in_tmpl = True
            else:
                prev = text[i - 1] if i > 0 else ''
                nxt = text[i + 1] if i + 1 < len(text) else None

                # Real closer: followed by whitespace, newline, semicolon, etc.
                is_real_closer = (
                    nxt is None
                    or nxt in ' \t\n\r;),}\'"`'
                )

                if not is_real_closer and prev not in ' \t\n\r' and nxt not in ' \t\n\r':
                    line_no = text[:i].count('\n') + 1
                    col_no = i - text[:i].rfind('\n')
                    snippet = text[max(0, i - 25):i + 25].replace('\n', '\\n')
                    issues.append((line_no, col_no, snippet))
                    # Treat as close to avoid cascading
                    in_tmpl = False
                else:
                    in_tmpl = False

        i += 1

    return issues


def check_file(filepath: str) -> list[Issue]:
    """Check a single file."""
    # Skip .d.ts files (JSDoc code blocks are intentional)
    if any(filepath.endswith(s) for s in IGNORED_SUFFIXES):
        return []

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"ERROR reading {filepath}: {e}", file=sys.stderr)
        return []

    return [
        Issue(filepath=filepath, line=line, col=col, snippet=snippet)
        for line, col, snippet in find_issues(content)
    ]


def collect_files(target: str, extensions: tuple = ('.ts', '.tsx', '.js', '.jsx')) -> list[str]:
    """Collect files to check."""
    path = Path(target)
    if path.is_file():
        if path.suffix in extensions:
            return [str(path)]
        return []
    elif path.is_dir():
        files = []
        for root, _, filenames in os.walk(path):
            if 'node_modules' in root or '/.' in root:
                continue
            for fn in filenames:
                if fn.endswith(extensions):
                    files.append(os.path.join(root, fn))
        return sorted(files)
    return []


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python3 check_backticks.py <file_or_directory> ...", file=sys.stderr)
        return 2

    all_issues: list[Issue] = []
    for target in sys.argv[1:]:
        files = collect_files(target)
        for f in files:
            all_issues.extend(check_file(f))

    if not all_issues:
        print("OK: no unescaped backticks found in template literals.")
        return 0

    print(f"\nFound {len(all_issues)} potential unescaped backtick(s) in template literals:\n")
    for issue in all_issues:
        print(f"  {issue.filepath}:{issue.line}:{issue.col}")
        print(f"    ...{issue.snippet}...")
        print()

    print("Fix: replace ` with \\` inside the template literal.")
    print("Common cause: markdown inline code in agent prompt strings.")
    return 1


if __name__ == '__main__':
    sys.exit(main())
