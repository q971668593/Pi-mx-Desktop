#!/usr/bin/env bash
# Pi 自建中转 · 一键安装（可重复执行，不会重复装）
#
#   curl -fsSL https://raw.githubusercontent.com/q971668593/Pi-mx-Desktop/main/scripts/relay/install.sh | bash -s -- --token <口令>
#
#   --port 8443         监听端口（默认 8443；用 443 就写 443）
#   --token <口令>      电脑连中转用的口令（不填就自动生成一个）
#   --domain <域名>     有域名时用它申请/复用 Let's Encrypt 证书（默认自签 + 指纹）
#   --dir /opt/pi-relay 安装目录
#   --no-firewall       不去动本机防火墙（云控制台的安全组仍需自己放行）
#
# 做完会打印：中转地址、口令、证书指纹，以及「下一步」要放行哪个端口。
set -euo pipefail

PORT=8443
TOKEN=""
DOMAIN=""
DIR=/opt/pi-relay
FIREWALL=1
RAW_BASE="${PI_RELAY_RAW_BASE:-https://raw.githubusercontent.com/q971668593/Pi-mx-Desktop/main/scripts/relay}"

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:?}"; shift 2 ;;
    --token) TOKEN="${2:?}"; shift 2 ;;
    --domain) DOMAIN="${2:?}"; shift 2 ;;
    --dir) DIR="${2:?}"; shift 2 ;;
    --no-firewall) FIREWALL=0; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

say() { printf '\033[1;36m[pi-relay]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[pi-relay] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "请用 root 执行（或者 sudo bash 这个脚本）"

# ── 1. Node ────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  say "没找到 node，开始安装 Node 20…"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y >/dev/null
    apt-get install -y curl ca-certificates >/dev/null
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y nodejs >/dev/null
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null
    dnf install -y nodejs >/dev/null
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null
    yum install -y nodejs >/dev/null
  else
    die "认不出包管理器，请先手动装 Node 18+"
  fi
fi
command -v openssl >/dev/null 2>&1 || say "提示：没找到 openssl，自签证书那一步会失败（装一下 openssl 再来）"
say "Node $(node -v)"

# ── 2. 文件 ────────────────────────────────────────────────────────────────
mkdir -p "$DIR"
if [ ! -f "$DIR/server.mjs" ]; then
  say "下载中转服务…"
  if ! curl -fsSL "$RAW_BASE/server.mjs" -o "$DIR/server.mjs"; then
    [ -f ./server.mjs ] || die "下载失败：把 server.mjs 放到 $DIR/ 再跑一次"
    cp ./server.mjs "$DIR/server.mjs"
  fi
fi
chmod 644 "$DIR/server.mjs"

if [ ! -d "$DIR/node_modules/ws" ]; then
  say "安装依赖 ws…"
  (cd "$DIR" && npm i ws --omit=dev --no-audit --no-fund >/dev/null 2>&1) || die "npm 安装失败（检查网络或换 npmmirror：npm config set registry https://registry.npmmirror.com）"
fi

[ -n "$TOKEN" ] || TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
[ ${#TOKEN} -ge 16 ] || die "口令太短（至少 16 个字符）"

printf 'RELAY_TOKEN=%s\nRELAY_PORT=%s\n' "$TOKEN" "$PORT" > "$DIR/relay.env"
chmod 600 "$DIR/relay.env"

# ── 3. 证书 ────────────────────────────────────────────────────────────────
TLS_ARGS="--self-signed --tls-dir $DIR/relay-tls"
if [ -n "$DOMAIN" ] && command -v certbot >/dev/null 2>&1 && [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  TLS_ARGS="--cert /etc/letsencrypt/live/$DOMAIN/fullchain.pem --key /etc/letsencrypt/live/$DOMAIN/privkey.pem"
  say "使用已有证书：$DOMAIN"
fi

# ── 4. systemd ─────────────────────────────────────────────────────────────
cat > /etc/systemd/system/pi-relay.service <<UNIT
[Unit]
Description=Pi self-hosted relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$DIR
EnvironmentFile=$DIR/relay.env
ExecStart=/usr/bin/env node $DIR/server.mjs --port $PORT --host 0.0.0.0 $TLS_ARGS --token \${RELAY_TOKEN}
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable pi-relay >/dev/null 2>&1 || true
systemctl restart pi-relay
sleep 2
systemctl is-active pi-relay >/dev/null || { journalctl -u pi-relay -n 30 --no-pager; die "服务没起来，看上面的日志"; }

# ── 5. 本机防火墙 ──────────────────────────────────────────────────────────
if [ "$FIREWALL" = "1" ]; then
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "$PORT"/tcp >/dev/null 2>&1 || true
    say "已放行 ufw $PORT/tcp"
  fi
  if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active firewalld >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port="$PORT"/tcp >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
    say "已放行 firewalld $PORT/tcp"
  fi
fi

# ── 6. 收尾信息 ────────────────────────────────────────────────────────────
IP="$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
CERT="$DIR/relay-tls/cert.pem"
PIN=""
if [ -f "$CERT" ]; then
  PIN="$(node -e "const {X509Certificate,createHash}=require('node:crypto');const fs=require('node:fs');const c=new X509Certificate(fs.readFileSync(process.argv[1]));process.stdout.write(createHash('sha256').update(c.publicKey.export({type:'spki',format:'der'})).digest('base64url'))" "$CERT" 2>/dev/null || true)"
fi
HEALTH="$(curl -sk --max-time 5 "https://127.0.0.1:$PORT/healthz" || true)"

cat <<SUMMARY

────────────────────────────────────────────────
 中转已运行（systemd: pi-relay，开机自启）

 中转地址   $IP:$PORT
 口令       $TOKEN
 证书指纹   ${PIN:-（用域名证书时由系统信任链校验，不需要指纹）}
 本机自检   ${HEALTH:-（拿不到 /healthz，检查端口或证书）}

 下一步
 1) 云服务器控制台 → 防火墙/安全组 → 放行 TCP $PORT（这一步不做，外网连不上）
 2) Pi 桌面端 → 设置 → 手机连接 → 自建中转：
      中转地址填上面的「中转地址」，口令填「口令」，点「检测证书」→「信任并保存」
 3) 手机重新扫一次配对二维码（中转地址和指纹写在配对链接里）

 常用命令
   systemctl status pi-relay        # 看状态
   journalctl -u pi-relay -f        # 看日志
   systemctl restart pi-relay       # 改完配置重启（配置在 $DIR/relay.env）
────────────────────────────────────────────────
SUMMARY
