#!/bin/zsh
set -eu
export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"
cd -- "$(dirname -- "$0")"
if curl -fsS --max-time 2 http://127.0.0.1:4317/api/system >/dev/null 2>&1; then
  open 'http://127.0.0.1:4317'
  exit 0
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  print 'Node.js 22.12 이상을 설치한 뒤 다시 열어 주세요.'
  read '?Enter를 눌러 닫기: '
  exit 1
fi
if [[ ! -d node_modules ]]; then
  print 'Biadone Studio 구성 요소를 설치합니다.'
  npm install
fi
mkdir -p .cache
print 'Biadone Studio를 준비합니다.'
if ! npm run build >.cache/launch-build.log 2>&1; then
  print '준비 중 오류가 발생했습니다. .cache/launch-build.log를 확인해 주세요.'
  tail -30 .cache/launch-build.log
  read '?Enter를 눌러 닫기: '
  exit 1
fi
print '주소: http://127.0.0.1:4317'
print '에디터를 사용하는 동안 이 창을 열어 두세요. 종료: Control-C'
(sleep 2; open 'http://127.0.0.1:4317') &
npm start
