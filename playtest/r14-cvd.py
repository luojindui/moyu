#!/usr/bin/env python3
"""r14 色弱模拟（deuteranopia / protanopia / tritanopia）+ 关键色对比度数值。
用 PIL/numpy 对工位面板截图做 CVD 模拟，并计算状态色对在模拟后的 WCAG 对比度。
"""
import json
import numpy as np
from PIL import Image

# Viénot/Brettel 常见近似矩阵（作用于 sRGB 0-255 非线性值，业界通用近似）
MATS = {
    "normal": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    "deuteranopia": [
        [0.367322, 0.860646, -0.227968],
        [0.280085, 0.672501, 0.047413],
        [-0.011820, 0.042940, 0.968881],
    ],
    "protanopia": [
        [0.152286, 1.052583, -0.204868],
        [0.114503, 0.786281, 0.099216],
        [-0.003882, -0.048116, 1.051998],
    ],
    "tritanopia": [
        [1.255528, -0.076749, -0.178779],
        [-0.078411, 0.930809, 0.147602],
        [0.004733, 0.691367, 0.303900],
    ],
}


def simulate(rgb, kind):
    m = np.array(MATS[kind], dtype=float)
    a = np.clip(np.array(rgb, dtype=float), 0, 255)
    out = a @ m.T
    return np.clip(out, 0, 255)


def lum(rgb):
    c = np.clip(np.array(rgb, dtype=float), 0, 255) / 255.0
    lin = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return float(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2])


def contrast(fg, bg):
    l1, l2 = lum(fg), lum(bg)
    return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)


# 从实测 DOM 得到的实际颜色（见 r14-a11y-evidence.json）
PAIRS = {
    "已装修✓圆点绿 vs 面板底": ((139, 226, 139), (47, 47, 68)),
    "已装修✓圆点绿 vs 空圆点底": ((139, 226, 139), (38, 38, 54)),
    "✓字符(深) vs 绿圆点": ((16, 36, 26), (139, 226, 139)),
    "家具描述字 vs 面板底": ((184, 179, 156), (47, 47, 68)),
    "精力描述字 vs 分组底": ((184, 179, 156), (58, 58, 82)),
    "精力“剩X/100”字 vs 分组底": ((143, 159, 208), (58, 58, 82)),
    "启用按钮(黄底) vs 面板底": ((255, 215, 110), (47, 47, 68)),
    "禁用按钮(灰底) vs 面板底": ((67, 67, 92), (47, 47, 68)),
    "禁用按钮文字 vs 自身底": ((168, 164, 147), (67, 67, 92)),
    "启用按钮文字 vs 黄底": ((16, 36, 26), (255, 215, 110)),
    "选中tab蓝底 vs 未选中tab底": ((126, 200, 255), (58, 58, 82)),
    "summary白字 vs 面板底": ((244, 241, 232), (47, 47, 68)),
    "黄(启用钮) vs 绿(已拥有点)": ((255, 215, 110), (139, 226, 139)),
}

res = {"pairs": {}, "matrix": MATS}
for name, (fg, bg) in PAIRS.items():
    row = {}
    for kind in MATS:
        row[kind] = round(contrast(simulate(fg, kind), simulate(bg, kind)), 2)
    row["normal"] = round(contrast(fg, bg), 2)
    row["sim_rgb"] = {k: [int(round(x)) for x in simulate(fg, k)] for k in MATS}
    res["pairs"][name] = row

# 截图的 CVD 模拟（直接矩阵乘整图）
SHOTS = {
    "decor-empty": "playtest/r14-shots/decor-empty.png",
    "energy-used": "playtest/r14-shots/energy-used.png",
    "decor-owned-top": "playtest/r14-shots/decor-owned-top.png",
}
for name, path in SHOTS.items():
    im = Image.open(path).convert("RGB")
    arr = np.asarray(im, dtype=float)
    for kind in ["deuteranopia", "protanopia", "tritanopia"]:
        m = np.array(MATS[kind], dtype=float)
        out = np.clip(arr @ m.T, 0, 255).astype(np.uint8)
        Image.fromarray(out).save(f"playtest/r14-shots/cvd-{name}-{kind}.png")

# 灰度（全色盲 / 单色打印）
im = Image.open("playtest/r14-shots/decor-owned-top.png").convert("L")
im.save("playtest/r14-shots/cvd-decor-owned-top-gray.png")
im2 = Image.open("playtest/r14-shots/energy-used.png").convert("L")
im2.save("playtest/r14-shots/cvd-energy-used-gray.png")

with open("playtest/r14-cvd.json", "w") as f:
    json.dump(res, f, ensure_ascii=False, indent=2)

print("== 状态色对比度（正常 / 红绿色弱两种 / 蓝黄色弱） ==")
for name, row in res["pairs"].items():
    print(f"{name:34s} normal={row['normal']:5.2f} deut={row['deuteranopia']:5.2f} prot={row['protanopia']:5.2f} trit={row['tritanopia']:5.2f}")
print("\nCVD 模拟截图已写入 playtest/r14-shots/cvd-*.png")