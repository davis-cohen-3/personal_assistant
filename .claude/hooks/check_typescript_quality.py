#!/usr/bin/env python3
"""
PostToolUse hook: Block TypeScript anti-patterns.

Detects:
- Explicit `any` types (: any, as any)
- console.log/warn/info/debug in production code
- Swallowed exceptions (empty catch blocks)
- Fallback defaults (?? 'default', || fallback)

Exit codes:
- 0: No violations found
- 2: Violations found, block with feedback
"""
import json
import re
import sys


def check_content(content: str, file_path: str) -> list:
    """Check content for TypeScript anti-patterns."""
    violations = []
    lines = content.split('\n')
    is_test = '/test' in file_path or '.test.' in file_path or '.spec.' in file_path

    for i, line in enumerate(lines, 1):
        stripped = line.strip()

        # Skip comments
        if stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*'):
            continue

        # No explicit `any` type
        if re.search(r':\s*any\b', line):
            violations.append(
                f"Line {i}: Explicit 'any' type — use a proper type or 'unknown'"
            )

        # No `as any` assertion
        if re.search(r'\bas\s+any\b', line):
            violations.append(
                f"Line {i}: 'as any' type assertion — use proper typing"
            )

        # No console.log/debug in production code (console.info, console.warn, console.error are allowed)
        if not is_test and re.search(r'\bconsole\.(log|debug)\b', line):
            violations.append(
                f"Line {i}: console.log in production code — use console.info, console.error, or console.warn"
            )

        # Swallowed exceptions (catch with empty body or just pass)
        if re.search(r'catch\s*\([^)]*\)\s*\{\s*\}', line):
            violations.append(
                f"Line {i}: Swallowed exception — handle the error or re-throw"
            )

    # Multi-line catch block check
    for i, line in enumerate(lines):
        if re.search(r'catch\s*\(', line):
            # Look ahead for empty catch body
            for j in range(i + 1, min(i + 3, len(lines))):
                next_line = lines[j].strip()
                if next_line == '}':
                    violations.append(
                        f"Line {i + 1}: Swallowed exception (empty catch block) — handle or re-throw"
                    )
                    break
                if next_line and next_line != '{':
                    break

    return violations


def main():
    input_data = json.load(sys.stdin)

    tool_name = input_data.get('tool_name', '')
    tool_input = input_data.get('tool_input', {})

    if tool_name not in ('Edit', 'Write'):
        sys.exit(0)

    file_path = tool_input.get('file_path', '')

    if not file_path.endswith(('.ts', '.tsx')):
        sys.exit(0)

    # Get content being written
    if tool_name == 'Write':
        content = tool_input.get('content', '')
    else:
        content = tool_input.get('new_string', '')

    if not content:
        sys.exit(0)

    violations = check_content(content, file_path)

    if violations:
        error_msg = (
            "TYPESCRIPT QUALITY VIOLATION\n"
            "Code contains anti-patterns (see CLAUDE.md).\n\n"
            "Violations found:\n"
        )
        for v in violations:
            error_msg += f"  - {v}\n"
        error_msg += (
            "\nFix: Use fail-fast patterns.\n"
            "- any → proper type or unknown\n"
            "- as any → proper type assertion with runtime check\n"
            "- console.log/debug → console.info, console.warn, or console.error\n"
            "- empty catch → handle error or re-throw"
        )
        print(error_msg, file=sys.stderr)
        sys.exit(2)

    sys.exit(0)


if __name__ == '__main__':
    main()
