#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成 PWA 图标 PNG（纯标准库，无外部依赖）。

为什么需要它：iOS「添加到主屏幕」只认 PNG，manifest 里写 SVG 图标时
会被替换成一个默认的灰色图片图标。这里用软件光栅化把「羊」字画成 PNG。

用法：python tools/make_icons.py
输出：app/static/icon-192.png  icon-512.png  icon-maskable-512.png  apple-touch-icon.png
"""
from __future__ import annotations

import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.normpath(os.path.join(HERE, "..", "app", "static"))

GREEN = (31, 122, 82)       # #1f7a52 品牌绿
GREEN_DEEP = (20, 92, 60)   # 底部稍深，做出竖向渐变
STROKE_W = 0.130            # 笔画半宽（归一化坐标，图标半边长 = 1.0）

# 「羊」的六笔。归一化坐标：原点居中，y 向下，图标范围 [-1, 1]。
# 结构：丷（顶两笔）+ 三横 + 一竖。横画自上而下渐宽，竖画穿过全部横画。
STROKES = [
    ((-0.330, -0.315), (-0.205, -0.445)),   # 丶 左上点，朝右下
    ((-0.030, -0.445), ( 0.330, -0.300)),   # 丿 右上撇，朝右上
    ((-0.400, -0.150), ( 0.400, -0.150)),   # 一
    ((-0.505,  0.020), ( 0.505,  0.020)),   # 一
    ((-0.605,  0.190), ( 0.605,  0.190)),   # 一
    (( 0.000, -0.445), ( 0.000,  0.575)),   # 丨 竖，底部露出
]


def clamp01(v: float) -> float:
    return 0.0 if v < 0.0 else 1.0 if v > 1.0 else v


def smoothstep(t: float) -> float:
    t = clamp01(t)
    return t * t * (3.0 - 2.0 * t)


def sd_round_rect(px: float, py: float, hw: float, hh: float, r: float) -> float:
    """点到圆角矩形的有符号距离（矩形居中于原点）。"""
    qx = abs(px) - (hw - r)
    qy = abs(py) - (hh - r)
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    return (ax * ax + ay * ay) ** 0.5 + min(max(qx, qy), 0.0) - r


def dist_to_segment(px: float, py: float, ax: float, ay: float,
                    bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0.0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    ex, ey = ax + t * dx - px, ay + t * dy - py
    return (ex * ex + ey * ey) ** 0.5


def sample(u: float, v: float, corner_r: float, aa: float):
    """返回该点的预乘 RGB 与 alpha（均为 0..1 / 0..255 混合）。"""
    # 背景：圆角矩形 + 竖向渐变
    d_bg = sd_round_rect(u, v, 1.0, 1.0, corner_r)
    ba = smoothstep(0.5 - d_bg / (2.0 * aa))
    t = (v + 1.0) * 0.5
    r = (GREEN[0] + (GREEN_DEEP[0] - GREEN[0]) * t) * ba
    g = (GREEN[1] + (GREEN_DEEP[1] - GREEN[1]) * t) * ba
    b = (GREEN[2] + (GREEN_DEEP[2] - GREEN[2]) * t) * ba
    alpha = ba

    # 笔画：白色，圆头
    w = STROKE_W * 0.5
    for (ax, ay), (bx, by) in STROKES:
        c = smoothstep((w - dist_to_segment(u, v, ax, ay, bx, by)) / (2.0 * aa))
        if c <= 0.0:
            continue
        r = r * (1 - c) + 255.0 * c
        g = g * (1 - c) + 255.0 * c
        b = b * (1 - c) + 255.0 * c
        alpha = alpha + (1.0 - alpha) * c
    return r, g, b, alpha


def render(size: int, corner_r: float, scale: float = 1.0, ss: int = 4) -> bytearray:
    """软件光栅化。scale 用于把图案缩到 maskable 的安全区。"""
    inv = 1.0 / (size * ss)
    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    u = ((x + (sx + 0.5) / ss) / size * 2.0 - 1.0) / scale
                    v = ((y + (sy + 0.5) / ss) / size * 2.0 - 1.0) / scale
                    s = sample(u, v, corner_r / scale, inv * ss)
                    for i in range(4):
                        acc[i] += s[i]
            n = ss * ss
            i4 = (y * size + x) * 4
            a = clamp01(acc[3] / n)
            if a > 0.0:
                # sample() 返回「预乘 alpha、RGB 在 0..255」，除回 alpha 得正乘颜色
                def unpre(s: float) -> int:
                    return max(0, min(255, int(s / (n * a) + 0.5)))
                out[i4] = unpre(acc[0])
                out[i4 + 1] = unpre(acc[1])
                out[i4 + 2] = unpre(acc[2])
            out[i4 + 3] = int(a * 255.0 + 0.5)
    return out


def png_bytes(size: int, rgba: bytearray) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8bit RGBA
    raw = bytearray()
    for y in range(size):
        raw.append(0)                                   # 每行前置 filter 类型 0
        raw += rgba[y * size * 4:(y + 1) * size * 4]
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def stats(size: int, rgba: bytearray) -> dict:
    """自检：白像素比例、包围盒、左右对称偏差、底色采样。"""
    white, opaque = 0, 0
    minx, miny, maxx, maxy = size, size, -1, -1
    for y in range(size):
        for x in range(size):
            i = (y * size + x) * 4
            if rgba[i + 3] > 127:
                opaque += 1
                if rgba[i] > 220 and rgba[i + 1] > 220 and rgba[i + 2] > 220:
                    white += 1
                    minx, miny = min(minx, x), min(miny, y)
                    maxx, maxy = max(maxx, x), max(maxy, y)
    diff = 0
    for y in range(size):
        for x in range(size // 2):
            diff += abs(rgba[(y * size + x) * 4 + 3] - rgba[(y * size + (size - 1 - x)) * 4 + 3])
    # 取图案左上角背景色，确认是绿不是白
    bi = (int(size * 0.12) * size + int(size * 0.12)) * 4
    bg = rgba[bi:bi + 3]
    return {
        "opaque_pct": round(opaque / (size * size) * 100, 1),
        "white_pct": round(white / (size * size) * 100, 1),
        "bbox": [minx, miny, maxx, maxy],
        "bbox_center": [round((minx + maxx) / 2 - size / 2 + 0.5, 1),
                        round((miny + maxy) / 2 - size / 2 + 0.5, 1)],
        "mirror_diff_per_row": round(diff / size / (size // 2), 2),
        "bg_sample": tuple(bg),
    }


def main() -> int:
    os.makedirs(STATIC, exist_ok=True)
    jobs = [
        ("icon-192.png", 192, 0.235, 1.00, "any"),
        ("icon-512.png", 512, 0.235, 1.00, "any"),
        # maskable：不留圆角（系统自己裁），图案缩到 0.78 保证落在安全区内
        ("icon-maskable-512.png", 512, 0.0, 0.78, "maskable"),
        # iOS：180px，不留圆角（iOS 自己加圆角）
        ("apple-touch-icon.png", 180, 0.0, 0.86, "apple"),
    ]
    print("== 生成 PWA 图标 ==")
    for name, size, cr, scale, tag in jobs:
        img = render(size, cr, scale)
        st = stats(size, img)
        path = os.path.join(STATIC, name)
        with open(path, "wb") as f:
            f.write(png_bytes(size, img))
        print("  %-22s %3dx%3d %-8s 满图%5.1f%% 白%5.1f%% 对称偏差%.2f 居中(%+5.1f,%+5.1f) 底色%3s" % (
            name, size, size, tag, st["opaque_pct"], st["white_pct"],
            st["mirror_diff_per_row"], *st["bbox_center"], st["bg_sample"]))
    print("\n提示：图标图案为「羊」字，白色笔画压在品牌绿渐变底上。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
