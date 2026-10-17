# 값이 보인다는 것과 재확인에 성공했다는 것은 다르다

[English](README.md) · [상세 노트](../../docs/react-recheck.ko.md)

실제 React `useQuery` 컴포넌트를 두 개의 로컬 Apollo Federation 서버에 연결합니다. 재고 조회가 실패한 뒤 화면에 어떤 값이 남고, 같은 observable을 `cache-first`로 다시 평가하면 무엇이 달라지는지 비교합니다.

각 정책은 새 client/cache와 하나의 컴포넌트로 시작합니다. 정상 서버 `network-only` 조회 → 조명 재고 필드가 실패하는 서버 `network-only` 조회 → `cache-first` 순서입니다. 가상 상품 세 개를 사용하며 정상 조명 수량은 3입니다. 실패 응답은 HTTP 200이지만 `availability: null`과 GraphQL 필드 오류를 담습니다. `errorPolicy: all`과 `none`을 비교합니다.

호출하는 API는 **hook이 만든 `observable.reobserve`**입니다. 일반적인 `refetch` 버튼의 재현이 아닙니다. StrictMode, Suspense, SSR, 재마운트, 변수 변경, 동시 요청과 다른 버전의 동작은 확인하지 않습니다.

## 저장소 루트에서 실행하기

Node 24.x (24.19.0+), pnpm 11.25.0, Git, `AbortSignal.any`와 Web Crypto를 지원하는 브라우저가 필요합니다. 루트와 실험 패키지를 모두 설치하세요. 실험은 루트에 설치한 Apollo를 사용합니다.

```sh
pnpm install --frozen-lockfile
pnpm --dir experiments/react-recheck install --frozen-lockfile
pnpm --dir experiments/react-recheck build
pnpm --dir experiments/react-recheck test
pnpm --dir experiments/react-recheck start
```

실험 소스까지 커밋된 **변경 없는 Git checkout**이 필요합니다. Git이 없거나 미커밋 변경이 있으면 시작하지 않습니다. 빌드가 생성하는 `app.js`와 `build-receipt.json`은 Git에서 제외되지만 실행 전후 별도로 해시를 기록합니다. 실행 중에는 소스를 고치거나 다시 빌드하지 마세요.

`http://127.0.0.1:4352`에서 `all`을 고르고 1 → 2 → 3을 누릅니다. 이어 `none`을 고르고 같은 순서로 실행합니다. 두 사례가 끝난 뒤 한 번 저장하세요. 저장하면 현재 컴포넌트를 해제합니다. 표시된 파일명을 확인한 뒤 마지막 버튼으로 소유 서버를 종료합니다. 화면 조작 문구는 한국어이며 이 안내와 상세 노트는 한·영으로 제공합니다. 포트 4352가 사용 중이면 다른 프로세스를 임의로 종료하지 마세요.

```sh
pnpm --dir experiments/react-recheck audit react-SESSION-1.json
pnpm --dir experiments/react-recheck check:negative react-SESSION-1.json
```

실제 저장된 파일명으로 바꿉니다. 기록은 Git에서 제외된 `records/`에만 남고 자동 업로드하지 않습니다. 감사기는 두 정책, 고정 query/variables, 가상 상품 식별자와 정상 조명 수량, 서버·브라우저 응답 원문, hook·Promise·cache·실제 DOM 표시의 일치를 검사합니다. 반증 검사는 기록의 사본에서 표시 값·요청 인자·응답 원문·출처를 바꿉니다. 새 HTTP 요청을 보내지 않습니다. CI는 빌드와 요청 계약 테스트를 실행하며 **브라우저 관측은 실행하지 않습니다**.

## 관측을 위해 감수한 비용과 확인 범위

fetch 래퍼는 원문을 남기기 위해 크기가 제한된 응답을 버퍼링합니다. 따라서 전달 타이밍은 원래 fetch와 달라집니다. `useLayoutEffect`에서 해당 컴포넌트의 실제 HTML/text를 읽고 직전과 같은 DOM은 생략합니다. 관측 개수는 render·commit·paint 횟수가 아닙니다. 각 단계는 non-loading DOM과 타이머 한 턴을 기다리며 전체 시스템의 작업 종료를 증명하지 않습니다.

프록시는 Apollo가 추가한 `__typename`과 고정 client-library extension을 포함한 지정 연산만 허용합니다. loopback에만 바인딩하고 Origin/Host·세션 토큰을 확인하며 요청 수·본문 크기·저장 횟수를 제한합니다. 20분 뒤 자동 종료하고 토큰은 저장하지 않습니다. 실수로 노출할 여지를 줄이는 장치이며 악의적인 로컬 브라우저의 기록을 인증하지는 않습니다. HTTP 200, Promise resolve, `dataState: complete`, 읽을 수 있는 캐시 값은 서로 다른 질문에 답합니다. 하나만으로 현재 재고가 맞거나 주문을 허용해도 된다고 판단할 수 없습니다.

`sourceBefore/After`에는 모든 Git tracked 파일의 해시가 들어갑니다. `harnessBefore/After`는 실제 제공한 번들과 빌드 영수증도 별도로 기록합니다. 나중에 실행한 일관성 검사는 당시 실행을 재현한 것이 아닙니다. 공개할 기록은 별도로 검토하고, 과거 원본 바이트와 소스 리비전은 보존하세요.

요청 fixture는 이전 독립 가상 실험에서 추출했습니다. 공개된 고정 연산과 가상 SKU 입력만 포함하며, 계약 회귀 검사 입력이지 새 실행 결과가 아닙니다.
