# 첫 사용 점검 / First trial

공개 실험 버전의 로컬 실행 점검표입니다. [평가용 이용 조건](../LICENSE.md)에 따라 사용해 볼 수 있으며, 일반적인 오픈소스·상업적 사용·재배포 허가는 아닙니다. [배포 상태](../DISTRIBUTION.md)를 먼저 확인하세요.

## 1. 예제로 실행 확인 — 환경 준비 후 약 5–10분

Node.js 20 이상과 최신 데스크톱 브라우저가 필요합니다. ZIP을 새 폴더에 풀고 `package.json`이 있는 `dsp-workbench` 폴더에서 `npm start`를 실행한 뒤 표시된 로컬 주소를 엽니다. `npm install`은 필요 없습니다. 첫 실행 환경 다운로드 시간은 별도로 기록하세요.

1. **예시 파일로 시작 → 비교 검사 시작**을 누릅니다.
2. **구간 검토 필요**, **2.0–2.1초의 100 ms 누락 후보**를 확인합니다. 예제에서 이 표시는 실패가 아닙니다.
3. 원본과 처리본의 **구간 듣기**를 각각 실행합니다.
4. JSON과 HTML을 저장하고, 저장한 HTML이 별도로 열리는지 확인합니다. 보고서에는 진단 정보와 해시가 있으므로 그대로 공개하지 않습니다.
5. 검사를 다시 시작해 **검사 취소**를 누른 후 재실행합니다. 짧은 예제가 이미 끝났다면 취소 검사는 **미실시**로 남깁니다. 확인하지 않은 동작을 통과로 적지 않습니다.
6. 터미널에서 Ctrl+C로 로컬 서버를 종료합니다.

예제 성공은 설치·화면 점검일 뿐 실제 고객 효용이나 탐지 정확도를 증명하지 않습니다. 이 버전의 실제 브라우저·CSP·독립 PC 확인도 사용자가 관측한 항목만 기록합니다.

## 2. 실제 업무 시험 — 파일이 생겼을 때만

같은 원본에서 만든 처리 전후 PCM16 모노 WAV(각 2–30초), 적용한 처리 설명과 기존 조사 방식이 필요합니다. 별도로 녹음한 두 파일이나 예제 실행을 이 시험으로 대체하지 않습니다.

- 파일·설정이 지원 범위에 맞는지 확인하고, 기존 방식과 Workbench로 문제가 의심되는 구간을 확인합니다.
- 알려진 정답이 있을 때만 놓친 오류·오경고를 적습니다. 의심 후보를 곧바로 실제 결함으로 세지 않습니다.
- 조사 시간은 다운로드·설치 시간을 분리해 적고, 단일 사용자·같은 파일의 반복 순서 효과가 있는 관찰임을 표시합니다. 한 건의 관찰로 일반적인 시간 절감을 주장하지 않습니다.
- **다시 사용 / 조건부 사용 / 보류** 중 하나를 고릅니다. 근거가 없으면 보류할 수 있습니다.

## 3. 최소 기록 — 오디오나 비공개 자료는 제출하지 않음

아래만 로컬 메모에 적으면 됩니다. 실명·소속·고객명·경로·파일명·파일 해시·원본 보고서는 필요 없습니다.

```text
사용 범위: 예제만 / 실제 처리 흐름 / 아직 실행 못 함
OS / 브라우저 / Node 버전:
혼자 실행 가능했나: 예 / 아니오
예상 구간 표시 / 재생 / 저장: 확인 / 실패 / 미실시 (항목별)
취소 후 재실행: 확인 / 실패 / 미실시
막힌 단계와 짧은 오류 코드:
실제 흐름이 있을 때만 — 기존 방식과 걸린 시간, 오경고·놓친 오류·보류:
다시 사용할 의향과 이유:
```

공유하고 싶다면 개인정보를 제거한 텍스트만 [사용 경험 양식](https://github.com/mingyeomjung-alt/dsp-workbench/issues/new?template=usage_feedback.yml)에 옮기세요. 실행 오류는 [오류 보고 양식](https://github.com/mingyeomjung-alt/dsp-workbench/issues/new?template=bug_report.yml)을 사용할 수 있습니다. **이슈와 첨부물은 공개되므로 오디오·비공개 보고서·인증정보는 올리지 마세요.** 비공개 오디오 접수나 지원 계약은 없으며, 문의·오디오 제공은 필수가 아닙니다. 민감한 보안 문제는 [SECURITY.md](../SECURITY.md)를 따르세요.

English: Clone or download the public repository, open a terminal in the folder containing `package.json`, run `npm start`, and open its loopback URL. Load the owned example, run the comparison, confirm the 2.0–2.1 s deletion candidate, listen to both regions, and save JSON/HTML. Try cancel/re-run only if the job is still active; otherwise mark it untested. Stop the server with Ctrl+C. Record setup and usability separately from real-workflow usefulness. Use is limited by the [evaluation licence](../LICENSE.md). Feedback and bug-report links above lead to public GitHub issues: do not post private audio, names, paths, hashes, credentials or unreviewed reports. No private audio intake or support contract is provided. For sensitive security findings, follow [SECURITY.md](../SECURITY.md).
