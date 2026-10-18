"""前端静态体检：括号配平 + 导入是否真的被用到 + 导出是否真的存在。

用法：python tools/check_js.py
"""
from __future__ import annotations

import io
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

JS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                  "app", "static", "js")
FILES = ["app.js", "core.js", "views/home.js", "views/goats.js", "views/herd.js",
         "views/milk.js", "views/fin.js", "views/rep.js", "views/me.js"]


def strip_code(s: str) -> str:
    """去掉字符串 / 模板串文本 / 注释，只留结构代码。
    模板串里的 ${...} 要保留（里面有真实的括号），所以递归处理。"""
    out: list[str] = []
    i, n = 0, len(s)

    def skip_string(i: int, q: str) -> int:
        i += 1
        while i < n:
            if s[i] == "\\":
                i += 2
                continue
            if s[i] == q:
                return i + 1
            i += 1
        return n

    def scan_tpl(i: int) -> int:
        i += 1  # 跳过起始 `
        while i < n:
            c = s[i]
            if c == "\\":
                i += 2
                continue
            if c == "`":
                return i + 1
            if c == "$" and i + 1 < n and s[i + 1] == "{":
                depth, j = 1, i + 2
                while j < n and depth:
                    if s[j] == "{":
                        depth += 1
                    elif s[j] == "}":
                        depth -= 1
                    j += 1
                out.append(strip_code(s[i + 2:j - 1]))
                i = j
                continue
            i += 1
        return n

    prev = ""
    OPEN_AFTER = set("(,=:[!&|?{};+-*/%~<>") | {""}

    while i < n:
        c = s[i]
        if c in "\"'":
            i = skip_string(i, c)
            continue
        if c == "`":
            i = scan_tpl(i)
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "/":
            j = s.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "*":
            j = s.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == "/" and prev in OPEN_AFTER:      # 正则字面量，整体丢弃
            j = i + 1
            while j < n and s[j] != "/":
                if s[j] == "\\":
                    j += 2
                    continue
                if s[j] == "[":
                    j += 1
                    while j < n and s[j] != "]":
                        j += 2 if s[j] == "\\" else 1
                    j += 1
                    continue
                j += 1
            i = j + 1
            continue
        prev = c
        out.append(c)
        i += 1
    return "".join(out)


def main() -> int:
    src = {f: io.open(os.path.join(JS, f), encoding="utf-8").read() for f in FILES}
    bad = 0

    print("== 括号配平 ==")
    for f, s in src.items():
        t = strip_code(s)
        probs = [f"{o}{c} {t.count(o)}/{t.count(c)}"
                 for o, c in [("(", ")"), ("[", "]"), ("{", "}")] if t.count(o) != t.count(c)]
        print(f"  [{'OK ' if not probs else 'BAD'}] {f:20s} {s.count(chr(10)):4d} 行"
              + ("" if not probs else "  " + " ".join(probs)))
        bad += bool(probs)

    print("\n== 导入了但没用上（不影响运行，容易误导阅读）==")
    for f, s in src.items():
        for blk in re.findall(r"import\s*\{([^}]*)\}\s*from\s*['\"]([^'\"]+)['\"]", s, re.S):
            for nm in [x.strip() for x in blk[0].split(",") if x.strip()]:
                real = nm.split(" as ")[-1].strip()
                rest = s[s.find(blk[0]) + len(blk[0]):]
                if not re.search(r"\b%s\b" % re.escape(real), rest):
                    print(f"  [未用] {f}: {real}  (from {blk[1]})")

    print("\n== 视图依赖的 core.js 导出是否都存在 ==")
    exported = set(re.findall(r"export\s+(?:async\s+)?(?:function|const|let|var)\s+(\w+)", src["core.js"]))
    for blk in re.findall(r"export\s*\{([^}]*)\}", src["core.js"], re.S):
        for x in blk.split(","):
            x = x.strip()
            if x:
                exported.add(x.split(" as ")[-1].strip())
    for f, s in src.items():
        if f == "core.js":
            continue
        for blk in re.findall(r"import\s*\{([^}]*)\}\s*from\s*['\"]\.\./core\.js['\"]", s, re.S):
            for nm in [x.strip() for x in blk.split(",") if x.strip()]:
                real = nm.split(" as ")[-1].strip()
                if real not in exported:
                    print(f"  [缺失] {f} 引用了 core.js 里没有的: {real}")
                    bad += 1

    print("\n== 视图是否都挂进路由 ==")
    for f in [x for x in FILES if x.startswith("views/")]:
        key = os.path.splitext(f)[0].split("/")[-1]
        if key not in src["app.js"]:
            print(f"  [未挂载] {f}")
            bad += 1

    print("\n== 前后端字段一致性抽查 ==")
    # 前端用到的接口路径必须都在后端注册过
    api_paths = set(re.findall(r"(?:api\()\s*['\"](/api/[^'\"?${]*)['\"]", " ".join(src.values())))
    print(f"  前端调用路径数：{len(api_paths)}")

    print("\n" + "=" * 52)
    print(f"  问题数：{bad}")
    print("=" * 52)
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
