#!/bin/sh
# 更新 Skill Hub 儀表板（macOS／Linux）
#   ./scripts/update-dashboard.sh          重新產生並用預設瀏覽器打開
#   ./scripts/update-dashboard.sh --quiet  只產生不打開，輸出寫到 out/last-build.log（給 cron 用）
cd "$(dirname "$0")/.." || exit 1
mkdir -p out

if [ "$1" = "--quiet" ]; then
  node bin/skill-hub.mjs build > out/last-build.log 2>&1
  exit $?
fi

node bin/skill-hub.mjs build --open || {
  echo
  echo "更新失敗，請看上面的錯誤訊息。第一次使用請先執行：node bin/skill-hub.mjs init"
  exit 1
}
