#!/usr/bin/env python3
"""
PostToolUse hook: Block verbose/decorative comment patterns in TypeScript.

Catches:
- Section dividers (===, ---, ***)
- "This function/method/class..." comments
- "The following code..." comments
- Obvious inline comments
- Multi-sentence comments

Exit codes:
- 0: No violations found
- 2: Violations found, block with feedback
"""
import json
import re
import sys

# Patterns for verbose comments (pattern, description)
VERBOSE_PATTERNS = [
    # Section dividers
    (r'^//\s*[=\-*#]{4,}\s*$', "Section divider line (decorative)"),
    (r'^//\s*[=\-*#]{2,}.*[=\-*#]{2,}\s*$', "Decorated section header"),

    # "This X..." patterns
    (r'//\s*This\s+(function|method|class|module|variable|code|block|section|component)\s',
     "Comment starting with 'This function/method...'"),

    # "The following..." patterns
    (r'//\s*The\s+following\s+(code|function|method|block|section)\s',
     "Comment starting with 'The following...'"),

    # "Below/Above we..." patterns
    (r'//\s*(Below|Above)\s+(we|is|are)\s', "Comment using 'Below/Above we...'"),

    # Stating the obvious
    (r'//\s*(Return|Returns)\s+(the\s+)?(result|value|data|response)\.?\s*$',
     "Obvious comment '// Return the result'"),
    (r'//\s*(Loop|Iterate)\s+(through|over)\s+(the\s+)?(items|elements|list|array)',
     "Obvious comment about looping"),
    (r'//\s*(Check|Verify)\s+(if|whether)\s+(the\s+)?(condition|value)',
     "Obvious comment about checking condition"),
    (r'//\s*Initialize\s+(the\s+)?(variable|value|counter|list|array|object)',
     "Obvious comment about initialization"),
    (r'//\s*(Import|Importing)\s+(the\s+)?(necessary|required)\s+',
     "Obvious comment about imports"),
    (r'//\s*(Define|Defining)\s+(a\s+)?(helper\s+)?(function|method|class|component)\s+',
     "Obvious comment about defining something"),

    # Multi-sentence comments
    (r'//\s*\w+.*\.\s+\w+.*\.', "Multi-sentence comment — be more concise"),
]


def check_content(content: str) -> list:
    """Check for verbose comment patterns."""
    violations = []
    lines = content.splitlines()

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped.startswith('//'):
            continue

        # Skip eslint/prettier directives
        if 'eslint' in stripped or 'prettier' in stripped or '@ts-' in stripped:
            continue

        for pattern, description in VERBOSE_PATTERNS:
            if re.search(pattern, stripped, re.IGNORECASE):
                violations.append(f"Line {i}: {description}")
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

    if tool_name == 'Write':
        content = tool_input.get('content', '')
    else:
        content = tool_input.get('new_string', '')

    if not content:
        sys.exit(0)

    violations = check_content(content)

    if violations:
        error_msg = (
            "VERBOSE COMMENT VIOLATION\n"
            "Comments should be minimal and meaningful.\n\n"
            "Violations:\n"
        )
        for v in violations:
            error_msg += f"  - {v}\n"
        error_msg += (
            "\nFix: Remove decorative/obvious comments. "
            "Code should be self-documenting."
        )
        print(error_msg, file=sys.stderr)
        sys.exit(2)

    sys.exit(0)


if __name__ == '__main__':
    main()
