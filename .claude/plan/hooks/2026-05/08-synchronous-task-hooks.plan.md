# Synchronous Task Hook Installation

## Business Goal
원격 worktree task 생성 직후 hook 파일과 설정 검증 결과가 상세 화면에 일관되게 보이도록, task 생성 응답 전에 hook 설치와 검증 시도를 완료한다.

## Scope
- **In Scope**: branch 기반 task 생성 시 hook 설치를 백그라운드 예약이 아닌 동기 실행으로 변경, 원격 hook 설치 후 검증 로그가 완료될 때까지 대기, 수동 설치 검증 경로가 SSH 기반 scan 결과를 client state에 전달하는 구조 확인 및 테스트 보강
- **Out of Scope**: hook 설정 포맷 변경, 신규 API 추가, OpenCode 원격 plugin 등록 방식 변경, hook 설치 실패 시 생성된 task/worktree 롤백

## Codebase Analysis Summary
`kanbanService.createTask`는 worktree/session 생성 후 task를 저장하고 `scheduleTaskHookInstall`로 hook 설치를 백그라운드 예약한다. `installKanvibeHooks`는 로컬 검증은 기다리지만 원격 검증은 `void logHookVerificationStatuses(...)`로 분리해 설치 직후 반환한다. 수동 설치 버튼은 `projectService.installTask*Hooks`를 통해 공통 installer를 실행한 뒤 provider별 `get*HooksStatus`를 다시 호출하고, renderer의 `HooksStatusCard`/`HooksStatusDialog`가 해당 결과를 local state와 parent route state에 반영한다.

### Relevant Files
| File | Role | Action |
|------|------|--------|
| `src/desktop/main/services/kanbanService.ts` | task 생성 및 hook 설치 예약 | Modify |
| `src/lib/kanvibeHooksInstaller.ts` | 공통 hook installer와 설치 후 검증 | Modify |
| `src/desktop/main/services/__tests__/kanbanService.test.ts` | task 생성 hook 설치 동작 테스트 | Modify |
| `src/lib/__tests__/kanvibeHooksInstaller.test.ts` | 원격 설치/검증 동작 테스트 | Modify |
| `src/desktop/main/services/projectService.ts` | 수동 설치 후 provider별 status scan 반환 | Reference |
| `src/components/HooksStatusCard.tsx` | 설치 결과와 refresh scan을 client state에 반영 | Reference |

### Conventions to Follow
| Convention | Source | Rule |
|-----------|--------|------|
| Runtime env safety | `CLAUDE.md` | process-wide env 변경 없이 명시 인자와 기존 helper를 사용한다. |
| Hook target resolution | `projectService.resolveTaskHookTarget` | worktree가 있으면 worktree path/task id 기준, repo root default branch는 root task id 기준을 유지한다. |
| Failure notification | `kanbanService.scheduleTaskHookInstall` | hook 설치 실패는 `broadcastTaskHookInstallFailed` payload로 renderer에 알린다. |
| TDD | `superpowers:test-driven-development` | production code 변경 전 실패하는 테스트를 먼저 작성하고 확인한다. |

## Architecture Decisions
| Decision | Choice | Rationale | Alternatives |
|----------|--------|-----------|--------------|
| Task 생성 hook 설치 시점 | `createTask`가 `installKanvibeHooks`를 `await` | 상세 화면 진입 전에 설치와 scan이 완료되어 remote race를 제거한다. | 기존 백그라운드 예약 유지, 별도 설치 완료 API 추가 |
| 설치 실패 처리 | task는 유지하고 실패 이벤트만 broadcast | 기존 UX와 데이터 보존 정책을 유지하면서 사용자가 상세 화면에서 재설치할 수 있다. | task 생성 실패 처리, 생성된 worktree/task 롤백 |
| 원격 설치 후 검증 | 원격도 `logHookVerificationStatuses`를 await | SSH `readTextFiles`와 hook server reachability 확인이 설치 함수 완료 전에 끝난다. | 로그만 비동기 유지, 별도 polling 추가 |
| 수동 설치 검증 방식 | 기존 install API 응답 + renderer refresh scan 유지 | 이미 `installTask*Hooks`가 SSH status scan을 반환하고 client가 `refreshAllHookStatuses`로 전체 provider state를 갱신한다. | 새 “설치 완료 API” 추가 |

## API Contracts (if applicable)
기존 Electron IPC method를 유지한다. 신규 API는 만들지 않는다.

## Data Models (if applicable)
DB schema 변경 없음.

## Implementation Todos

### Todo 1: Write failing tests for synchronous create and remote verification
- **Priority**: 1
- **Dependencies**: none
- **Goal**: 현재 백그라운드/비동기 검증 동작이 요구사항을 만족하지 않음을 테스트로 고정한다.
- **Work**:
  - `src/desktop/main/services/__tests__/kanbanService.test.ts`에서 worktree task 생성이 hook 설치 Promise를 기다리는지 확인하는 테스트로 기존 즉시 반환 기대를 변경한다.
  - 원격 worktree task 생성도 `installKanvibeHooks`가 resolve되기 전에는 `createTask`가 resolve되지 않아야 함을 검증한다.
  - hook 설치 실패는 task 생성 결과를 반환하되 `broadcastTaskHookInstallFailed`를 호출하는 테스트로 변경한다.
  - `src/lib/__tests__/kanvibeHooksInstaller.test.ts`에서 원격 설치가 provider별 `get*HooksStatus(targetPath, taskId, sshHost)` 호출을 기다린 뒤 resolve되는 테스트로 기존 조기 반환 기대를 변경한다.
- **Convention Notes**: Given/When/Then 테스트 스타일과 기존 mock 구조를 유지한다.
- **Verification**: `pnpm vitest run src/desktop/main/services/__tests__/kanbanService.test.ts src/lib/__tests__/kanvibeHooksInstaller.test.ts`
- **Exit Criteria**: 새 테스트가 현재 production code에서 의도한 이유로 실패한다.
- **Status**: completed

### Todo 2: Implement synchronous task hook installation
- **Priority**: 2
- **Dependencies**: Todo 1
- **Goal**: task 생성 응답 전에 hook 설치를 실행하고 실패를 기존 이벤트 경로로 알린다.
- **Work**:
  - `src/desktop/main/services/kanbanService.ts`에 hook 설치 실패 이벤트 로직을 재사용할 helper를 추출한다.
  - `createTask`에서 `scheduleTaskHookInstall` 대신 `await installKanvibeHooks(hookTargetPath, saved.id, saved.sshHost)`를 호출한다.
  - 설치 실패 시 helper로 실패 이벤트를 emit하고 task 생성 결과는 계속 반환한다.
  - `broadcastBoardUpdate()`는 hook 설치 시도 후 호출해 상세 route refresh가 최신 scan 상태를 읽도록 한다.
- **Convention Notes**: 기존 task/worktree/session 생성 흐름과 직렬화 반환 방식을 유지한다.
- **Verification**: `pnpm vitest run src/desktop/main/services/__tests__/kanbanService.test.ts`
- **Exit Criteria**: createTask 관련 테스트가 통과하고 기존 connectTerminalSession의 background hook 예약 테스트는 유지된다.
- **Status**: completed

### Todo 3: Await remote hook verification in installer
- **Priority**: 2
- **Dependencies**: Todo 1
- **Goal**: 원격 설치 함수 완료 시점이 SSH 기반 hook scan 완료 이후가 되도록 한다.
- **Work**:
  - `src/lib/kanvibeHooksInstaller.ts`의 `installKanvibeHooksOnce`에서 `sshHost` 분기에서도 `await logHookVerificationStatuses(...)`를 실행한다.
  - verification error는 기존 local 경로와 동일하게 installer 실패로 전파한다.
- **Convention Notes**: `get*HooksStatus`가 이미 `readTextFiles(..., sshHost)`와 remote curl reachability를 사용하므로 별도 SSH command를 새로 만들지 않는다.
- **Verification**: `pnpm vitest run src/lib/__tests__/kanvibeHooksInstaller.test.ts`
- **Exit Criteria**: 원격 설치가 검증 Promise를 기다리고, 검증 함수가 sshHost를 받는 테스트가 통과한다.
- **Status**: completed

### Todo 4: Final verification
- **Priority**: 3
- **Dependencies**: Todo 2, Todo 3
- **Goal**: 관련 회귀 테스트와 타입 검사를 통과시킨다.
- **Work**:
  - 관련 vitest 파일을 실행한다.
  - `pnpm check`를 실행한다.
  - 필요 시 `pnpm test` 범위까지 확대한다.
- **Convention Notes**: 실패 시 원인만 좁혀 수정하고 범위를 늘리지 않는다.
- **Verification**: `pnpm vitest run src/desktop/main/services/__tests__/kanbanService.test.ts src/lib/__tests__/kanvibeHooksInstaller.test.ts`, `pnpm check`
- **Exit Criteria**: 모든 검증 명령이 통과한다.
- **Status**: completed

## Verification Strategy
- `pnpm vitest run src/desktop/main/services/__tests__/kanbanService.test.ts src/lib/__tests__/kanvibeHooksInstaller.test.ts`
- `pnpm check`
- 필요 시 실패 원인에 해당하는 추가 단위 테스트만 실행한다.

## Progress Tracking
- Total Todos: 4
- Completed: 4
- Status: Execution complete

## Change Log
- 2026-05-08: Plan created
- 2026-05-08: Todo 1 completed — failing tests added for synchronous task hook install and remote verification wait
- 2026-05-08: Todo 2 completed — createTask now awaits hook installation before board refresh
- 2026-05-08: Todo 3 completed — remote installer now waits for hook verification scan
- 2026-05-08: Todo 4 completed — targeted tests, typecheck, and full test suite passed
- 2026-05-08: Execution complete
