#!/bin/bash

dir="/etc/apt/sources.list.d/"
file="/etc/apt/sources.list"
pve_file="/etc/apt/sources.list.d/pve-enterprise.list"

if [ -d "$dir" ]; then
  echo "正在删除目录 $dir..."
  rm -rf "$dir"
  echo "目录已删除。"
else
  echo "目录 $dir 不存在，跳过删除。"
fi

echo "正在替换 $file 的内容..."

echo "deb https://mirrors.ustc.edu.cn/debian/ bookworm main contrib non-free non-free-firmware" > "$file"
echo "deb https://mirrors.ustc.edu.cn/debian/ bookworm-updates main contrib non-free non-free-firmware" >> "$file"
echo "deb https://mirrors.ustc.edu.cn/debian/ bookworm-backports main contrib non-free non-free-firmware" >> "$file"
echo "deb https://mirrors.ustc.edu.cn/debian-security bookworm-security main" >> "$file"
echo "deb https://mirrors.ustc.edu.cn/proxmox/debian bookworm pve-no-subscription" >> "$file"

echo "内容已替换。"

if [ -f "$pve_file" ]; then
  echo "正在修改 $pve_file..."
  sed -i 's|^deb https://enterprise.proxmox.com/debian/pve|#deb https://enterprise.proxmox.com/debian/pve|' "$pve_file"
  echo "添加清华源..."
  echo "deb https://mirrors.tuna.tsinghua.edu.cn/proxmox/debian bullseye pve-no-subscription" >> "$pve_file"
  echo "$pve_file 已修改。"
else
  echo "$pve_file 不存在，跳过修改。"
fi
