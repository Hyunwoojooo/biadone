import {Check, Copy, ExternalLink, TerminalSquare} from 'lucide-react';
import type {SystemStatus} from '../shared/types';
import {codexConnectionCommand} from '../lib/codex';
import {Dialog} from './Dialog';

export function CodexDialog({system, onClose, onNotice}: {system: SystemStatus|null; onClose: () => void; onNotice: (message: string) => void}) {
  const command = system?.appDirectory ? codexConnectionCommand(system.appDirectory, window.location.origin) : '';
  return <Dialog title="Codex로 편집하기" onClose={onClose} wide><div className="dialog-body codex-dialog"><div className="codex-intro"><TerminalSquare size={30}/><div><h3>말로 지시하고, 화면으로 확인하세요</h3><p>Codex가 이 로컬 에디터의 장면·자막·검수·출력 기능을 사용합니다.</p></div></div><ol className="codex-steps"><li><strong>에디터를 실행해 둡니다</strong><p>이 창과 같은 프로젝트를 Codex가 읽고 수정합니다.</p></li><li><strong>로컬 MCP 서버를 Codex에 연결합니다</strong><p>아래 명령은 터미널에서 한 번 실행합니다. Codex 설정이 바뀌므로 직접 확인 후 실행하세요.</p><div className="code-block"><code>{command || '앱 실행 경로를 확인하고 있습니다. 에디터를 다시 실행해 주세요.'}</code><button className="icon-button" aria-label="Codex 연결 명령 복사" disabled={!command} onClick={() => {void navigator.clipboard.writeText(command).then(() => onNotice('연결 명령을 복사했습니다.')).catch(() => onNotice('명령을 선택해 직접 복사해 주세요.'));}}><Copy size={15}/></button></div></li><li><strong>프로젝트를 읽고 원하는 장면을 지시합니다</strong><blockquote>“Biadone Studio에서 현재 프로젝트를 읽고, 3번 장면을 세 단계 그래픽으로 정리해 줘. 다른 장면은 유지해 줘.”</blockquote></li></ol><div className="codex-note"><Check size={15}/><span>편집 명령은 잠금과 수정 버전 검사를 거칩니다. 외부 변경은 에디터에 자동 반영됩니다.</span></div><a className="text-button" href="https://developers.openai.com/codex/mcp" target="_blank" rel="noreferrer">Codex 공식 MCP 안내<ExternalLink size={13}/></a></div></Dialog>;
}
