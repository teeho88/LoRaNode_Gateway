#!/bin/bash
# Cai dat Comitup - WiFi provisioning qua captive portal cho Raspberry Pi gateway
#
# Sau khi cai: neu Pi khong ket noi duoc WiFi da luu, no tu bat AP.
# Dung dien thoai ket noi vao AP -> trinh duyet mo http://comitup.local
# -> chon SSID + nhap mat khau -> Pi chuyen sang che do client.
#
# CANH BAO: script nay chuyen quyen quan ly wlan0 sang NetworkManager va se
# lam rot ket noi WiFi hien tai. Chay qua man hinh/ban phim hoac day mang,
# KHONG chay qua SSID WiFi.
#
# Cach dung:
#   sudo bash scripts/setup-comitup.sh
#   sudo AP_NAME="HTGSNDDA-<nnnn>" AP_PASSWORD="matkhau8kytu" bash scripts/setup-comitup.sh

set -euo pipefail

# apt/systemctl dich ten truong theo locale ("Candidate:" -> tieng Viet khi chay
# o console cua Pi dat locale vi_VN). Ep C de output luon on dinh khi parse.
export LC_ALL=C
export LANG=C
export DEBIAN_FRONTEND=noninteractive

AP_NAME="${AP_NAME:-HTGSNDDA-<nnnn>}"
AP_PASSWORD="${AP_PASSWORD:-htgsndda2025}"
WIFI_DEV="${WIFI_DEV:-wlan0}"
APT_SOURCE_DEB="https://davesteele.github.io/comitup/latest/davesteele-comitup-apt-source_latest.deb"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# --- Helper -------------------------------------------------------------
# KHONG dung `lenh | grep -q` o day: `grep -q` dong pipe ngay khi khop, lenh
# dau tien an SIGPIPE va thoat 141, `set -o pipefail` bien ca pipeline thanh
# that bai. Ket qua la dieu kien bi dao nguoc dung luc tim thay. Cac ham duoi
# gom output vao bien roi moi doi chieu nen khong dinh bay do.

# Tra ve 0 neu apt biet goi nay. Dua vao ma thoat, khong parse chu, nen mien
# nhiem voi locale.
pkg_exists() {
  apt-cache show "$1" >/dev/null 2>&1
}

# In ra phien ban ung vien, chi de hien thi - rong cung khong sao.
pkg_candidate() {
  local out
  out="$(apt-cache policy "$1" 2>/dev/null || true)"
  printf '%s\n' "$out" | awk '/Candidate:/ && $2 != "(none)" { print $2 }'
}

# Tra ve 0 neu systemd co unit dung ten nay.
unit_exists() {
  local out
  out="$(systemctl list-unit-files --no-legend 2>/dev/null || true)"
  printf '%s\n' "$out" | awk -v u="$1" '$1 == u { found = 1 } END { exit !found }'
}

echo "========================================"
echo "Comitup WiFi Provisioning Setup"
echo "========================================"

# --- Kiem tra dieu kien -------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  echo "❌ Phai chay bang sudo: sudo bash scripts/setup-comitup.sh"
  exit 1
fi

if [ ! -e /etc/rpi-issue ] && [ ! -e /sys/firmware/devicetree/base/model ]; then
  echo "❌ Khong phai Raspberry Pi. Dung script nay tren Pi, khong phai may dev."
  exit 1
fi

if [ ! -d "/sys/class/net/${WIFI_DEV}" ]; then
  echo "❌ Khong tim thay thiet bi WiFi '${WIFI_DEV}'."
  echo "   Kiem tra: ls /sys/class/net"
  exit 1
fi

if [ "${#AP_PASSWORD}" -gt 0 ] && [ "${#AP_PASSWORD}" -lt 8 ]; then
  echo "❌ AP_PASSWORD phai it nhat 8 ky tu (hoac de rong de mo AP khong mat khau)."
  exit 1
fi

# Canh bao neu dang SSH qua chinh card WiFi sap bi chuyen chu
if [ -n "${SSH_CONNECTION:-}" ]; then
  SSH_LOCAL_IP="$(echo "$SSH_CONNECTION" | awk '{print $3}')"
  WIFI_ADDRS="$(ip -4 addr show "$WIFI_DEV" 2>/dev/null || true)"
  if printf '%s\n' "$WIFI_ADDRS" | grep -F "$SSH_LOCAL_IP" >/dev/null; then
    echo ""
    echo "⚠️  Ban dang SSH qua ${WIFI_DEV} (${SSH_LOCAL_IP})."
    echo "   Cai Comitup se cat ket noi nay va co the khong vao lai duoc."
    echo "   Hay chay lai qua day mang hoac man hinh/ban phim."
    if [ "${FORCE:-0}" != "1" ]; then
      echo "   Neu chac chan van muon tiep tuc: FORCE=1 sudo -E bash scripts/setup-comitup.sh"
      exit 1
    fi
    echo "   FORCE=1 -> van tiep tuc."
  fi
fi

CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-unknown}")"
echo ""
echo "🔎 Phien ban OS: ${CODENAME}"

# --- Cai NetworkManager neu chua co -------------------------------------
echo ""
echo "📦 Cap nhat danh sach goi..."
# Repo ben thu ba hong chu ky (vd nodesource node_18.x dung khoa SHA1 da bi
# tu choi) khong nen chan viec cai dat - index cua Debian van dung duoc.
apt-get update || echo "⚠️  apt-get update bao loi o mot so repo - tiep tuc voi index hien co"

if ! command -v nmcli >/dev/null 2>&1; then
  echo ""
  echo "📦 Cai NetworkManager (Comitup bat buoc phai co)..."
  apt-get install -y network-manager
fi
systemctl enable --now NetworkManager

# --- Go bo cac dich vu tranh chap wlan0 ---------------------------------
# Bookworm tro di da dung NetworkManager san. Bullseye tro ve truoc dung
# dhcpcd + wpa_supplicant@wlan0, hai thu nay danh nhau voi Comitup.
echo ""
echo "🧹 Go tranh chap tren ${WIFI_DEV}..."
for svc in dhcpcd "wpa_supplicant@${WIFI_DEV}"; do
  if unit_exists "${svc}.service"; then
    echo "   - tat ${svc}"
    systemctl disable --now "${svc}.service" 2>/dev/null || true
  fi
done

# dnsmasq dung rieng se chiem port 53 cua comitup (comitup dung dnsmasq-base)
if unit_exists "dnsmasq.service"; then
  echo "   - mask dnsmasq (Comitup tu quan ly DNS o che do AP)"
  systemctl disable --now dnsmasq.service 2>/dev/null || true
  systemctl mask dnsmasq.service 2>/dev/null || true
fi

# Khai bao wlan0 trong /etc/network/interfaces se ghi de NetworkManager
if [ -f /etc/network/interfaces ] && grep -qE "^[[:space:]]*(iface|allow-hotplug|auto)[[:space:]]+${WIFI_DEV}" /etc/network/interfaces; then
  echo "   - sao luu /etc/network/interfaces va go khai bao ${WIFI_DEV}"
  cp /etc/network/interfaces "/etc/network/interfaces.bak.$(date +%Y%m%d%H%M%S)"
  sed -i "/^[[:space:]]*\(iface\|allow-hotplug\|auto\)[[:space:]]\+${WIFI_DEV}/,/^$/d" /etc/network/interfaces
fi

# Go khoa rfkill neu co
rfkill unblock wifi 2>/dev/null || true

# --- Cai Comitup --------------------------------------------------------
# Debian trixie tro di da co comitup trong repo chinh thuc, khong can repo
# ngoai. Chi khi khong tim thay moi dung apt source cua davesteele.
echo ""
if pkg_exists comitup; then
  echo "📦 Cai comitup tu repo Debian ($(pkg_candidate comitup))..."
else
  echo "📦 comitup khong co trong repo Debian - them apt source cua davesteele..."
  if ! wget -q -O "${WORKDIR}/comitup-apt-source.deb" "$APT_SOURCE_DEB"; then
    echo "❌ Khong tai duoc ${APT_SOURCE_DEB}"
    echo "   Kiem tra mang, hoac lay link moi tai https://davesteele.github.io/comitup/"
    exit 1
  fi
  dpkg -i --force-all "${WORKDIR}/comitup-apt-source.deb"
  apt-get update
fi

apt-get install -y comitup

# comitup-web / comitup-cli chi tach goi rieng o repo davesteele; ban Debian
# da gop san vao goi comitup.
for extra in comitup-web comitup-cli; do
  if pkg_exists "$extra"; then
    apt-get install -y "$extra"
  fi
done

# avahi cho ten mien comitup.local (thuong da la dependency cua comitup)
apt-get install -y avahi-daemon
systemctl enable --now avahi-daemon

# --- Cau hinh -----------------------------------------------------------
echo ""
echo "⚙️  Ghi /etc/comitup.conf..."
[ -f /etc/comitup.conf ] && cp /etc/comitup.conf "/etc/comitup.conf.bak.$(date +%Y%m%d%H%M%S)"
cat > /etc/comitup.conf <<EOF
# Ten AP hien ra khi Pi chua ket noi duoc WiFi.
# <nnnn> se duoc Comitup thay bang so dinh danh rieng cua tung Pi.
ap_name: ${AP_NAME}

# Mat khau AP (>= 8 ky tu). De rong = AP mo, ai cung vao doi duoc WiFi.
ap_password: ${AP_PASSWORD}

# Card WiFi dung cho ca AP lan client.
primary_wifi_device: ${WIFI_DEV}

# Che do appliance: chi mot card WiFi, luan phien AP <-> client.
enable_appliance_mode: 1
EOF
chmod 600 /etc/comitup.conf

echo ""
echo "🚀 Bat dich vu comitup..."
systemctl enable comitup
# comitup-web.service khong co o moi ban dong goi
if unit_exists "comitup-web.service"; then
  systemctl enable comitup-web
fi

# --- Kiem tra -----------------------------------------------------------
echo ""
echo "🔍 Kiem tra cai dat..."
FAIL=0
for svc in NetworkManager comitup avahi-daemon; do
  if systemctl is-enabled --quiet "$svc" 2>/dev/null; then
    echo "   ✅ ${svc}: enabled"
  else
    echo "   ❌ ${svc}: CHUA enabled"
    FAIL=1
  fi
done
if unit_exists "comitup-web.service"; then
  systemctl is-enabled --quiet comitup-web && echo "   ✅ comitup-web: enabled" || {
    echo "   ❌ comitup-web: CHUA enabled"; FAIL=1; }
fi

echo ""
echo "========================================"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ Cai dat xong."
else
  echo "⚠️  Cai dat xong nhung co dich vu chua bat - xem lai o tren."
fi
echo "========================================"
cat <<EOF

Buoc tiep theo:
  1. Khoi dong lai Pi:  sudo reboot
  2. Neu Pi khong vao duoc WiFi da luu, no se phat AP ten "${AP_NAME/<nnnn>/<so>}".
  3. Dung dien thoai ket noi vao AP do (mat khau: ${AP_PASSWORD:-<khong co>}).
  4. Trinh duyet tu mo trang cau hinh; neu khong, vao http://comitup.local
  5. Chon SSID, nhap mat khau. Pi luu lai va chuyen sang che do client.

Lenh huu ich tren Pi:
  comitup-cli              # cau hinh WiFi tu terminal
  systemctl status comitup # xem trang thai
  journalctl -u comitup -f # xem log truc tiep
  nmcli con show           # danh sach mang da luu

Luu y: dashboard gateway chay o port 3000, comitup-web chay o port 80 - khong dung nhau.
EOF
