#!/usr/bin/env python3
"""R11 色弱模拟 + 对比度计算（只读 src/，产物写到 playtest/）。

- 红绿色弱近似：Machado et al. 2009 在**线性 RGB** 上做 3x3 变换（deuteranopia/protanopia 严重度 1.0）。
- 同时输出灰阶（模拟全色盲/低视力看亮度）。
- 逐张处理 playtest/r11-screens/*.png，输出 playtest/r11-sim/{name}-deutan.png 等。
- 对关键"仅靠颜色"的状态对做 WCAG 对比度 + 模拟后 Lab ΔE76（<~10 视为难区分）。
"""
import os
import sys

import numpy as np
from PIL import Image

SRC_DIRS = ["playtest/r11-screens"]
OUT_DIR = "playtest/r11-sim"

# Machado 2009, severity 1.0
MATRICES = {
    "deutan": np.array(
        [
            [0.367322, 0.860646, -0.227968],
            [0.280085, 0.672501, 0.047413],
            [-0.011820, 0.042940, 0.968881],
        ]
    ),
    "protan": np.array(
        [
            [0.152286, 1.052583, -0.204868],
            [0.114503, 0.786281, 0.099216],
            [-0.003882, -0.048116, 1.051998],
        ]
    ),
}
# Machado 2009 deuteranomaly severity 0.6（更接近"红绿色弱"实际体验）
MATRICES["deutan06"] = np.array(
    [
        [0.713976, 0.348315, -0.062291],
        [0.222246, 0.756402, 0.021352],
        [-0.003823, 0.039215, 0.964608],
    ]
)


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def srgb_to_linear(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)


def simulate_rgb(rgb, kind):
    v = srgb_to_linear(np.array(rgb, dtype=float) / 255.0)
    out = MATRICES[kind] @ v
    return tuple(int(round(c * 255)) for c in linear_to_srgb(out))


def luminance(rgb):
    r, g, b = (c / 255.0 for c in rgb)
    f = lambda v: v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def rgb_to_lab(rgb):
    r, g, b = (c / 255.0 for c in rgb)
    f = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = f(r), f(g), f(b)
    x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
    y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / 1.00000
    z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883
    g_ = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    x, y, z = g_(x), g_(y), g_(z)
    return (116 * y - 16, 500 * (x - y), 200 * (y - z))


def de76(a, b):
    la, lb = rgb_to_lab(a), rgb_to_lab(b)
    return float(np.sqrt(sum((x - y) ** 2 for x, y in zip(la, lb))))


def simulate_image(path, out_base):
    img = Image.open(path).convert("RGB")
    arr = np.asarray(img, dtype=np.float32) / 255.0
    lin = srgb_to_linear(arr)
    out = {}
    for kind in ("deutan", "protan", "deutan06"):
        conv = np.clip(lin.reshape(-1, 3) @ MATRICES[kind].T, 0, 1)
        out[kind] = Image.fromarray((linear_to_srgb(conv).reshape(arr.shape) * 255).astype(np.uint8))
    gray = np.asarray(img.convert("L").convert("RGB"))
    out["gray"] = Image.fromarray(gray)
    base = os.path.basename(path).rsplit(".", 1)[0]
    for kind, im in out.items():
        dst = os.path.join(OUT_DIR, f"{base}-{kind}.png")
        im.save(dst)
    return {k: os.path.join(OUT_DIR, f"{base}-{k}.png") for k in out}


# 关键"颜色承载信息"的状态对：(说明, 颜色A, 颜色B, 背景, 用途)
PAIRS = [
    ("商店 tag：点了才赚 / 会自动赚", "#ff9e9e", "#8be2c0", "#34344b", "小标签底色文字（另有文字标签」）"),
    ("可买卡边框 / 不可买卡边框", "#7ec8ff", "#4a4a66", "#34344b", "商店卡片可买性"),
    ("可买卡底色 / 不可买卡底色", "#3d4a6b", "#34344b", "#232332", "商店卡片可买性"),
    ("巡逻横幅 hold 红 / 任务绿", "#b3413c", "#2f7a4f", "#3a3f5c", "8 秒限时玩法（红=忍住，绿=点）"),
    ("日报可领红点 / 按钮底色", "#ff5a5a", "#3a3a52", "#3a3a52", "📔 有奖可领角标"),
    ("日报完成绿框 / 未完成灰框", "#4c9e52", "#55557a", "#3a3a52", "日报目标完成态"),
    ("图鉴已解锁绿边 / 未解锁灰边", "#4c9e52", "#43435c", "#2a2a3c", "图鉴 55 格解锁态"),
    ("升级最优星标黄 / 普通字色", "#ffd76e", "#b8e0ff", "#34344b", "性价比最优提示（有 ★ 字形）"),
]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("== 颜色对：WCAG 对比度 + 模拟后 ΔE76 ==")
    rows = []
    for name, ca, cb, bg, use in PAIRS:
        a, b, bgc = hex2rgb(ca), hex2rgb(cb), hex2rgb(bg)
        row = {
            "info": name,
            "A": ca,
            "B": cb,
            "bg": bg,
            "contrast_A": round(contrast(a, bgc), 2),
            "contrast_B": round(contrast(b, bgc), 2),
            "dE_orig": round(de76(a, b), 1),
        }
        for kind in ("deutan", "protan", "deutan06"):
            sa, sb = simulate_rgb(a, kind), simulate_rgb(b, kind)
            row[f"dE_{kind}"] = round(de76(sa, sb), 1)
            row[f"{kind}_A"] = "#%02x%02x%02x" % sa
            row[f"{kind}_B"] = "#%02x%02x%02x" % sb
        rows.append(row)
        print(
            f"- {name}: 原ΔE={row['dE_orig']} | deutan ΔE={row['dE_deutan']} "
            f"(A→{row['deutan_A']}, B→{row['deutan_B']}) | protan ΔE={row['dE_protan']} | "
            f"对比度 A={row['contrast_A']} B={row['contrast_B']}"
        )

    print("\n== WCAG 对比度（正文 <18.66px 需 4.5:1，大字/粗体大字需 3:1）==")
    TEXT = [
        (".hud-moyu 摸鱼值", "#ffd76e", "#232332", 30, 800),
        (".hud-moyu small 摸鱼值标签", "#bdb89f", "#232332", 13, 600),
        (".hud-sub 点击/挂机/段位", "#a8a493", "#232332", 14, 400),
        (".hud-sub b 数值", "#8be28b", "#232332", 14, 400),
        (".tag-click 点了才赚", "#ff9e9e", "#4a3040", 10, 400),
        (".tag-idle 会自动赚", "#8be2c0", "#2f4a44", 10, 400),
        (".shop-name 升级名", "#f4f1e8", "#34344b", 13, 700),
        (".shop-next 效果", "#b8e0ff", "#34344b", 13, 400),
        (".shop-value 最划算", "#ffd76e", "#34344b", 13, 400),
        (".shop-remain 还差/再戳", "#b8b39c", "#34344b", 12, 400),
        (".shop-cost 价格", "#ffd76e", "#34344b", 15, 400),
        (".shop-level Lv.", "#8be28b", "#34344b", 10, 400),
        (".goal-desc 日报目标", "#f4f1e8", "#3a3a52", 14, 400),
        (".goal-progress 进度", "#ffd76e", "#3a3a52", 12, 400),
        (".c-label 图鉴标签", "#b4c0e6", "#2a2a3c", 12, 400),
        (".c-text 图鉴文本", "#f4f1e8", "#2a2a3c", 12, 400),
        (".journal-meta 日期", "#a8a493", "#2f2f44", 12, 400),
        (".stat-row 统计", "#b8b39c", "#2f2f44", 13, 400),
        (".stat-row b 统计值", "#ffd76e", "#2f2f44", 13, 400),
        (".prestige-desc 说明", "#a8a493", "#2f2f44", 13, 400),
        (".journal-latest 最新彩蛋", "#8f9fd0", "#2f2f44", 11, 400),
        ("#shop-hint 滑动提示", "#ffd76e", "#232332", 12, 400),
        ("#quest-text 新手目标", "#d6f0d6", "#2f3d34", 15, 400),
        ("#journal-claim 领取(可)", "#10241a", "#8be28b", 15, 700),
        ("#journal-claim 领取(禁用)", "#e8e2d0", "#55557a", 15, 700),
        ("#journal-close 关闭图标", "#a8a493", "#2f2f44", 18, 400),
        (".welcome-rule 离线规则", "#c3cce8", "#3a3a52", 13, 400),
    ]
    fails = []
    for label, fg, bg, size, weight in TEXT:
        r = contrast(hex2rgb(fg), hex2rgb(bg))
        large = size >= 24 or (size >= 18.66 and weight >= 700)
        need = 3.0 if large else 4.5
        ok = r >= need
        print(f"- {label}: {r:.2f}:1 (需 {need}:1, {size}px/{weight}) {'PASS' if ok else 'FAIL'}")
        if not ok:
            fails.append((label, round(r, 2), need))
    print(f"\n对比度未达标 {len(fails)} 项: {fails}")

    print("\n== 截图模拟 ==")
    made = []
    for d in SRC_DIRS:
        if not os.path.isdir(d):
            print(f"跳过（不存在）: {d}")
            continue
        for f in sorted(os.listdir(d)):
            if f.lower().endswith(".png"):
                made.append(simulate_image(os.path.join(d, f), os.path.join(OUT_DIR, f)))
    print(f"生成 {len(made)} 组模拟图 → {OUT_DIR}")


if __name__ == "__main__":
    sys.exit(main())
