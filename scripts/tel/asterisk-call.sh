#!/usr/bin/env bash
#
# Hamroh -> Asterisk orqali qo'ng'iroq.
#
# Ishlatilishi (.env):
#   HAMROH_TEL=cmd
#   HAMROH_TEL_CMD=/opt/hamroh/scripts/tel/asterisk-call.sh {to} {audio} {record}
#
# Talab: shu serverda Asterisk ishlab turishi va SIP trunk sozlangan bo'lishi.
# TRUNK — Asterisk dagi trunk nomi (pjsip endpoint yoki SIP peer).
#
set -euo pipefail

TO="${1:?raqam kerak}"
AUDIO="${2:?audio fayl kerak}"
RECORD="${3:-}"

TRUNK="${ASTERISK_TRUNK:-hamroh-trunk}"
CONTEXT="${ASTERISK_CONTEXT:-hamroh-out}"
SPOOL="${ASTERISK_SPOOL:-/var/spool/asterisk/outgoing}"
SOUNDS="${ASTERISK_SOUNDS:-/var/lib/asterisk/sounds/hamroh}"

# Asterisk 8 kHz mono wav kutadi — ffmpeg bilan o'giramiz
mkdir -p "$SOUNDS"
NAME="hamroh-$(date +%s)-$$"
ffmpeg -hide_banner -loglevel error -y -i "$AUDIO" -ar 8000 -ac 1 -c:a pcm_s16le "$SOUNDS/$NAME.wav"

# Call file: Asterisk uni spool papkasida ko'rib, qo'ng'iroqni boshlaydi
CALLFILE="$(mktemp)"
{
  echo "Channel: PJSIP/${TO}@${TRUNK}"
  echo "MaxRetries: 1"
  echo "RetryTime: 60"
  echo "WaitTime: 45"
  echo "Context: ${CONTEXT}"
  echo "Extension: s"
  echo "Priority: 1"
  echo "Setvar: HAMROH_SOUND=hamroh/${NAME}"
  [ -n "$RECORD" ] && echo "Setvar: HAMROH_RECORD=${RECORD%.wav}"
  echo "Archive: yes"
} > "$CALLFILE"

chown asterisk:asterisk "$CALLFILE" 2>/dev/null || true
chmod 600 "$CALLFILE"
mv "$CALLFILE" "$SPOOL/$NAME.call"

echo "$NAME"
