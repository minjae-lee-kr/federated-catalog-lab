# 어떤 응답이 캐시를 바꿀 수 있는가

[English](README.md) · [설계 노트](../../docs/react-attempts.ko.md)

실제 React `useQuery` 컴포넌트가 Apollo 캐시를 구독하는 동안, 독립적인 HTTP 요청을 정해진 순서로 완료합니다. 조회 상태만 보호하는 방식과 캐시 쓰기 전에도 같은 검사를 하는 방식을 비교합니다.

- `status-only`: `client.query({ fetchPolicy: 'network-only' })`의 자동 캐시 쓰기를 허용합니다. 호출자는 자신의 조회 상태를 갱신하기 전에 범위·세대·시도 번호를 검사합니다.
- `guarded-write`: `client.query({ fetchPolicy: 'no-cache' })`로 자동 쓰기를 생략합니다. 허용된 성공 응답만 `writeQuery`로 쓰고 상태를 갱신합니다.

양쪽 검사 조건은 같습니다. 화면은 `cache-only`이며 일반적인 `refetch`나 앞선 실험의 `observable.reobserve`를 사용하지 않습니다. 범위는 SKU와 창고이고 정규화된 `Product` 키도 두 값을 포함합니다. 이전 범위로 돌아오더라도 범위 전환마다 세대를 올립니다. 마지막 시도만 관리하며 별도의 성공 이력은 저장하지 않습니다.

## 저장소 루트에서 실행하기

Node 24.x (24.19.0+), pnpm 11.25.0, Git, `AbortSignal.any`와 Web Crypto를 지원하는 브라우저가 필요합니다. Apollo는 루트 설치를, React는 중첩 패키지에 고정한 버전을 사용합니다.

```sh
pnpm install --frozen-lockfile
pnpm --dir experiments/react-attempts install --frozen-lockfile
pnpm --dir experiments/react-attempts build
pnpm --dir experiments/react-attempts test
pnpm --dir experiments/react-attempts start
```

실험 소스가 커밋된 변경 없는 Git checkout에서 시작합니다. 서버는 소스 리비전과 tracked 파일의 해시를 기록합니다. 생성된 `app.js`와 빌드 영수증은 Git에서 제외되지만 별도로 해시를 남깁니다. 기록 중에는 소스를 바꾸거나 다시 빌드하지 마세요.

`http://127.0.0.1:4354`에서 **Run all ten cases and save**를 누릅니다. 다섯 사례를 두 방식으로 실행하고, 모두 끝나면 새 파일을 저장합니다. 표시된 파일명을 복사한 뒤 **Stop owned server**로 종료하세요. 포트 4354가 비어 있어야 하며, 다른 프로세스를 임의로 종료하지 마세요. 기록은 Git에서 제외된 로컬 `records/`에 남고 자동 업로드하지 않습니다.

```sh
pnpm --dir experiments/react-attempts audit attempts-SESSION-1.json
pnpm --dir experiments/react-attempts check:negative attempts-SESSION-1.json
```

예시 파일명을 실제 저장된 이름으로 바꿉니다. 감사기는 저장된 기록을 읽으며 HTTP나 React를 다시 실행하지 않습니다. 반증 검사는 사본을 바꾸고 원본은 보존합니다.

## 다섯 순서, 두 쓰기 정책

각 실행은 새 클라이언트·캐시를 만들고 실제 HTTP로 초기 수량 `3`을 받습니다. 한 실행 안에서는 같은 캐시 구독 컴포넌트가 화면 전환 중에도 유지됩니다. 로컬 GraphQL 서버는 명시적으로 풀어 줄 때까지 응답을 보류하고, 브라우저는 요청 도착을 확인한 뒤 응답을 풀 순서를 정합니다.

| 사례 | 초기 성공 이후 응답 순서 |
| --- | --- |
| `late-success` | 새 요청 실패 → 같은 범위의 이전 요청 성공 `7` |
| `product-switch` | B·동쪽 `12` → 이전 A·동쪽 `7` |
| `variable-switch` | A·서쪽 `12` → 이전 A·동쪽 `7` |
| `aba` | A → B → A 복귀 뒤 새 A의 `9` → 첫 방문 A의 `7` |
| `cache-read` | 새 요청 실패 → 네트워크 시도 없이 남아 있는 캐시 읽기 |

상품·창고 변경은 캐시 식별이 올바르게 분리된 상황의 대조입니다. 캐시 읽기는 양쪽 모두 독립적인 실패 상태를 유지하는지 확인합니다. 한 방식이 다섯 번 모두 실패하도록 만든 비교가 아닙니다.

`queryDeduplication: false`로 겹치는 요청을 독립적으로 보냅니다. 고정 수량은 응답을 구분하는 값이며 운영 수치나 권위 있는 서버 재고 버전이 아닙니다. 서버는 가상 GraphQL HTTP 엔드포인트 하나이며 저장소의 여러 subgraph를 사용하는 Federation 구성과 다릅니다.

## 기록 읽는 순서

HTTP 요청의 도착과 응답 해제 → Promise 결과 → 시도 허용 판단 → 캐시 → 실제 commit 뒤 DOM 순서로 읽습니다. 자동 쓰기 방식에서는 이전 시도를 거절했어도 캐시 쓰기는 일어났을 수 있습니다. 실패 안내가 유지된다는 사실만으로 화면의 숫자까지 유지됐다고 판단할 수 없습니다.

화면은 `useSyncExternalStore`로 불변 조회 상태를, `useQuery`로 캐시를 각각 구독합니다. 관측기는 `useLayoutEffect`에서 컴포넌트 HTML과 text를 읽습니다. snapshot은 관측된 상태·hook 값이 현재 store·cache와 일치하는지 기다릴 뿐, 직접 렌더링하거나 값을 쓰지 않습니다. 값이 바뀌지 않은 단계는 마지막으로 일치한 DOM 관측을 재사용할 수 있습니다. snapshot 개수는 render·commit·paint 횟수가 아니며, 이 대기가 전체 비동기 작업의 종료를 보장하지도 않습니다.

쓰기 예외에 대한 상태 모형 테스트는 예외를 던지는 합성 콜백을 사용합니다. 실패 상태를 검사할 뿐 Apollo의 부분 쓰기 롤백을 검증하지 않습니다. `writeQuery` 직전 검사도 외부 구독자나 다른 쓰기 경로와 함께 트랜잭션을 만들지는 않습니다.

## 범위

React 19.3.1 production, StrictMode 꺼짐, Apollo Client 4.3.3, 고정 변수·식별자·응답 순서, 메모리 캐시를 사용합니다. 자동 취소, 서버 버전 중재, 탭 간 조정, SSR, Suspense, 재마운트 복구, 영속 캐시와 운영 부하는 확인하지 않습니다.

나중에 시작한 시도를 우선하는 것은 선택한 화면 정책입니다. 유용한 이전 성공을 버리거나 현재 화면 밖의 캐시를 미리 채울 기회를 잃을 수 있습니다. 실제 현재 재고를 판정하거나 구매를 허용하지 않습니다. 해시와 일관성 검사는 기록 검토를 돕지만 악의적인 로컬 환경의 관측을 인증하지 않습니다.
