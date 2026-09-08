#!/usr/bin/env bash
#
# Hamroh — VPS ga o'rnatish skripti (Ubuntu 22.04 / 24.04).
#
#   curl -fsSL https://raw.githubusercontent.com/firda00/hamroh/main/scripts/install-vps.sh | sudo bash
#
# yoki repo ichidan:
#
#   sudo bash scripts/install-vps.sh
#
# Qayta ishga tushirish xavfsiz: mavjud .env va ma'lumotlar bazasiga tegmaydi.
# Yangilash uchun:  sudo bash scripts/install-vps.sh --update
#
set -euo pipefail

REPO="${HAMROH_REPO:-https://github.com/firda00/hamroh.git}"
BRANCH="${HAMROH_BRANCH:-main}"
DIR="${HAMROH_DIR:-/opt/hamroh}"
USER_NAME="${HAMROH_USER:-hamroh}"
NODE_MAJOR="${HAMROH_NODE:-24}"
UPDATE_ONLY=0
WITH_WHISPER=0

for arg in "$@"; do
  case "$arg" in
    --update) UPDATE_ONLY=1 ;;
    --with-whisper) WITH_WHISPER=1 ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Noma'lum argument: $arg" >&2; exit 1 ;;
  esac
done

# ----------------------------------------------------------------- ko'rinish

if [ -t 1 ]; then
  B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'
else
  B=''; G=''; Y=''; R=''; N=''
fi

step()  { echo; echo "${B}==> $*${N}"; }
ok()    { echo "  ${G}✓${N} $*"; }
warn()  { echo "  ${Y}!${N} $*"; }
fail()  { echo "  ${R}✗${N} $*" >&2; exit 1; }

# ----------------------------------------------------------------- tekshiruvlar

[ "$(id -u)" -eq 0 ] || fail "root kerak:  sudo bash $0"

if [ -r /etc/os-release ]; then
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ok "OS: ${PRETTY_NAME:-$ID}" ;;
    *) warn "Sinalgan OS — Ubuntu 22.04/24.04. Davom etamiz: ${PRETTY_NAME:-$ID}" ;;
  esac
else
  warn "OS aniqlanmadi, davom etamiz"
fi

# ----------------------------------------------------------------- tez yangilash

if [ "$UPDATE_ONLY" -eq 1 ]; then
  [ -d "$DIR/.git" ] || fail "$DIR da o'rnatilgan nusxa yo'q — avval to'liq o'rnating"
  step "Yangilash"
  sudo -u "$USER_NAME" git -C "$DIR" fetch --quiet origin "$BRANCH"
  sudo -u "$USER_NAME" git -C "$DIR" reset --quiet --hard "origin/$BRANCH"
  ok "$(sudo -u "$USER_NAME" git -C "$DIR" log --oneline -1)"

  if [ -f "$DIR/package-lock.json" ]; then
    sudo -u "$USER_NAME" npm --prefix "$DIR" ci --omit=dev --silent >/dev/null 2>&1 || true
  fi

  for unit in hamroh-bot hamroh-daemon; do
    if systemctl is-enabled --quiet "$unit" 2>/dev/null; then
      systemctl restart "$unit"
      ok "$unit qayta ishga tushdi"
    fi
  done
  echo
  echo "  Jurnal:  journalctl -u hamroh-bot -f"
  exit 0
fi

# ----------------------------------------------------------------- paketlar

step "Kerakli paketlar"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ffmpeg sqlite3 >/dev/null
ok "git, curl, ffmpeg, sqlite3"

step "Node.js ${NODE_MAJOR}"
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  CURRENT="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$CURRENT" -ge 22 ]; then
    NEED_NODE=0
    ok "mavjud: $(node --version)"
  else
    warn "eski versiya $(node --version) — yangilanadi"
  fi
fi

if [ "$NEED_NODE" -eq 1 ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
  ok "o'rnatildi: $(node --version)"
fi

node -e 'require("node:sqlite")' 2>/dev/null \
  || fail "Bu Node da node:sqlite yo'q. Node 22.5+ kerak (hozir $(node --version))."
ok "node:sqlite ishlaydi"

# ----------------------------------------------------------------- foydalanuvchi

step "Foydalanuvchi va papka"
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$DIR" --shell /usr/sbin/nologin "$USER_NAME"
  ok "yaratildi: $USER_NAME"
else
  ok "mavjud: $USER_NAME"
fi

# ----------------------------------------------------------------- kod

step "Kod"
if [ -d "$DIR/.git" ]; then
  sudo -u "$USER_NAME" git -C "$DIR" fetch --quiet origin "$BRANCH"
  sudo -u "$USER_NAME" git -C "$DIR" reset --quiet --hard "origin/$BRANCH"
  ok "yangilandi: $(sudo -u "$USER_NAME" git -C "$DIR" log --oneline -1)"
else
  rm -rf "${DIR:?}/lost+found" 2>/dev/null || true
  if [ -n "$(find "$DIR" -mindepth 1 -maxdepth 1 -not -name '.*' -print -quit 2>/dev/null)" ]; then
    fail "$DIR bo'sh emas va git repo ham emas. Qo'lda tozalang."
  fi
  git clone --quiet --branch "$BRANCH" "$REPO" "$DIR.tmp"
  mv "$DIR.tmp"/* "$DIR.tmp"/.[!.]* "$DIR"/ 2>/dev/null || true
  rmdir "$DIR.tmp"
  chown -R "$USER_NAME:$USER_NAME" "$DIR"
  ok "klonlandi: $REPO ($BRANCH)"
fi

# Runtime bog'liqliklari yo'q, lekin lock fayl bo'lsa dev-siz o'rnatamiz
if [ -f "$DIR/package-lock.json" ]; then
  sudo -u "$USER_NAME" npm --prefix "$DIR" ci --omit=dev --silent >/dev/null 2>&1 || true
fi

install -d -o "$USER_NAME" -g "$USER_NAME" "$DIR/data" "$DIR/out"
ok "papkalar: data, out"

# ----------------------------------------------------------------- sozlama

step "Sozlama (.env)"
if [ -f "$DIR/.env" ]; then
  ok ".env mavjud — tegilmadi"
else
  cp "$DIR/.env.example" "$DIR/.env"
  chown "$USER_NAME:$USER_NAME" "$DIR/.env"
  chmod 600 "$DIR/.env"
  warn ".env yaratildi — TELEGRAM_BOT_TOKEN va TELEGRAM_CHAT_ID ni to'ldiring:"
  echo "      sudo nano $DIR/.env"
fi

# ----------------------------------------------------------------- systemd

step "systemd xizmatlari"

write_unit() {
  local name="$1" desc="$2" exec="$3"
  cat > "/etc/systemd/system/${name}.service" <<UNIT
[Unit]
Description=${desc}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${USER_NAME}
WorkingDirectory=${DIR}
ExecStart=/usr/bin/node ${exec}
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Xavfsizlik: faqat o'z papkasiga yozadi
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DIR}/data ${DIR}/out

[Install]
WantedBy=multi-user.target
UNIT
  ok "${name}.service"
}

write_unit "hamroh-bot"    "Hamroh — Telegram bot"        "${DIR}/src/cli.ts bot start"
write_unit "hamroh-daemon" "Hamroh — rejalashtiruvchi"    "${DIR}/src/daemon.ts"

systemctl daemon-reload

if grep -q '^TELEGRAM_BOT_TOKEN=.\+' "$DIR/.env"; then
  systemctl enable --now hamroh-bot hamroh-daemon >/dev/null 2>&1
  ok "ishga tushirildi"
else
  systemctl enable hamroh-daemon >/dev/null 2>&1
  systemctl restart hamroh-daemon
  warn "bot yoqilmadi — TELEGRAM_BOT_TOKEN bo'sh"
fi

# ----------------------------------------------------------------- Whisper (ixtiyoriy)

if [ "$WITH_WHISPER" -eq 1 ]; then
  step "Whisper (ovozni matnga o'girish)"
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh >/dev/null
    ok "docker o'rnatildi"
  fi
  GPU_ARGS=""
  if command -v nvidia-smi >/dev/null 2>&1; then
    GPU_ARGS="--gpus all"
    IMAGE="fedirz/faster-whisper-server:latest-cuda"
    ok "GPU topildi: $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
  else
    IMAGE="fedirz/faster-whisper-server:latest-cpu"
    warn "GPU yo'q — CPU varianti (sekinroq)"
  fi
  docker rm -f hamroh-whisper >/dev/null 2>&1 || true
  # shellcheck disable=SC2086
  docker run -d --name hamroh-whisper --restart unless-stopped $GPU_ARGS \
    -p 127.0.0.1:8000:8000 "$IMAGE" >/dev/null
  ok "whisper: http://127.0.0.1:8000/v1"
  echo "      .env ga qo'shing:  HAMROH_STT=local"
fi

# ----------------------------------------------------------------- yakun

step "Tayyor"
cat <<INFO
  Papka:      ${DIR}
  Sozlama:    ${DIR}/.env
  Baza:       ${DIR}/data/hamroh.db

  Holat:      systemctl status hamroh-bot hamroh-daemon
  Jurnal:     journalctl -u hamroh-bot -f
  Qayta:      systemctl restart hamroh-bot
  Tekshirish: sudo -u ${USER_NAME} node ${DIR}/src/cli.ts doctor

  Yangilash:  sudo bash ${DIR}/scripts/install-vps.sh --update
INFO

if ! grep -q '^TELEGRAM_BOT_TOKEN=.\+' "$DIR/.env"; then
  echo
  warn "Keyingi qadam: .env ga token qo'ying va botni yoqing:"
  echo "      sudo nano ${DIR}/.env"
  echo "      sudo systemctl enable --now hamroh-bot"
fi
