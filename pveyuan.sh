#!/bin/bash

dir="/etc/apt/sources.list.d/"
file="/etc/apt/sources.list"

if [ -d "$dir" ];; then
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
