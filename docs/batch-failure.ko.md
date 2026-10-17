# 재고 하나를 읽지 못했을 때, 상품 정보는 어디까지 사라질까?

[English](batch-failure.md) · [소비자 타입 생성](consumer-impact.ko.md) · [프로젝트 소개](../README.ko.md)

쿼리가 유효하고 조회를 한 번에 묶었다고 해서, 실패 뒤에 어떤 값이 남을지까지 알 수는 없습니다. 이 실험은 두 결정을 나누어 바꿉니다. 배치 전체를 실패시킬지 특정 키에만 오류를 돌려줄지, 그리고 `Product.availability`가 `null`이어도 되는지입니다.

같은 가상 상품 세 개를 기존 Apollo Gateway와 세 HTTP 서브그래프로 조회합니다. `demo-lamp`만 조회 오류를 일으킵니다. 요청 순서는 노트, 램프, 컵이므로 실패 위치는 **1번 인덱스**입니다. 조회 함수는 가상이지만, 스키마 합성·GraphQL 실행·Federation 엔티티 결합·HTTP 호출은 실제로 수행합니다.

[기록된 상품 카드와 오류 경로 비교하기](https://minjae-lee-kr.github.io/research/partial-data/)에서 `e34b17e` 실행을 살펴보거나, 아래 명령으로 다시 실행할 수 있습니다. 뷰어는 저장된 서버 응답을 보여 주며 클라이언트 라이브러리의 오류 정책을 실행하지는 않습니다.

```sh
pnpm install --frozen-lockfile
pnpm batch-failure
```

명령은 관측한 데이터 개수와 오류 경로를 출력하고, 파싱한 원본 GraphQL 응답·계약 검사 결과·도구 버전·소스 매니페스트를 새 `.local/batch-failure-*.json`에 저장합니다. 임시 포트의 루프백 서버를 시작하고 반환 전에 종료합니다. 종료 코드 `0`은 부분 실패를 포함해 예상한 관측을 확인했다는 뜻입니다. 세 정책이 같은 데이터를 보존했다는 뜻은 아닙니다. 도구 실행 실패, 근거 불일치, 실행 중 소스 변경은 `1`로 종료합니다.

## 같은 쿼리, 실패가 지우는 세 가지 범위

세 실행 모두 Federation 스키마 합성에 성공하고, 만들어진 API 스키마에서 `CatalogCards`가 유효하며, 게이트웨이가 HTTP **200**을 반환합니다. 설치된 GraphQL 라이브러리로 각 API 스키마를 null 허용 기준 스키마와 비교해도 breaking·dangerous 변경은 보고되지 않습니다. 그래도 남는 결정이 있습니다. 조회 하나가 실패했을 때 어디까지 지울 것인가입니다.

| 재고 배치의 오류 처리 | 재고 필드 타입 | 남은 상품 수 | 값이 확인된 재고 수 | 게이트웨이 오류 경로 |
| --- | --- | ---: | ---: | --- |
| 램프 키에만 `Error` 반환 | `Availability` | 3 | 2 | `products[1].availability` |
| 배치 함수 전체에서 예외 발생 | `Availability` | 3 | 0 | `products[0..2].availability` |
| 램프 키에만 `Error` 반환 | `Availability!` | 2 | 2 | `products[1].availability` |

표의 수치는 고정된 입력에서 응답에 남은 데이터의 개수입니다. 검사기가 실행기의 카운터와 별개로 받은 응답에서 계산합니다.

배치 전체가 실패하면 정상 키 두 개도 거절됩니다. 상품명·가격·판매자는 남지만 재고 값은 알 수 없게 됩니다. 조회 횟수를 한 번으로 줄였다는 사실만으로 키별 실패가 격리되지는 않습니다.

필드를 non-null로 선언하면 램프의 **상품 객체 전체가 null**이 됩니다. 이미 읽은 상품명과 가격도 사라집니다. 목록 타입은 `[Product]!`이므로 목록 자체는 남습니다. 목록은 필수지만 각 상품은 null일 수 있기 때문입니다. GraphQL의 오류 전파 규칙에 따른 결과입니다. 출력 필드의 보장을 강화하면 호환성 검사를 통과하면서도 실행 실패가 지우는 범위는 달라질 수 있습니다. [GraphQL 실행 오류 규칙](https://spec.graphql.org/September2025/#sec-Handling-Execution-Errors)

## 실패가 지울 범위를 선택한다

조회 결과에서 특정 키의 실패를 구분할 수 있다면 그 키에 `Error`를 반환해 나머지 값을 보존합니다. 대신 소비자는 재고를 확인하지 못한 상태와 사용 가능한 상품 정보를 함께 처리해야 합니다. 의존 서비스에서 어떤 결과도 확인할 수 없다면 배치 전체를 거절합니다. `Availability!`는 재고를 제공하지 못할 때 부모 상품까지 제거해도 되는 경우에 선택합니다. null 허용 여부는 생성 타입뿐 아니라 실패로 잃을 데이터의 범위를 정합니다.

## 실패한 키가 응답의 어느 위치로 이어졌는가

검사기는 오류 개수만 세지 않고 식별자의 연결을 확인합니다.

```text
요청 skus[1] = demo-lamp
  → 재고 representation[1].sku = demo-lamp
  → DataLoader 배치 keys[1] = demo-lamp
  → 서브그래프 오류: _entities[1].availability
  → 게이트웨이 오류: products[1].availability
```

정상 상품 두 개의 정확한 값과, 게이트웨이에서 합치기 전의 상품·판매자 응답도 대조합니다. 따라서 non-null 조건에서 사라진 램프 정보가 실제로 조회됐음을 확인할 수 있습니다. 배치 전체 오류에는 가상의 원인 키 `failedSku: demo-lamp`가 남지만 영향을 받은 응답 경로는 세 개입니다. 실패 원인과 영향을 받은 위치를 구분해야 합니다.

[검사기](../src/batch-failure-check.ts)는 resolver·loader와 별도로 가상 입력의 예상 값을 정의합니다. 기준 스키마가 null을 허용하는지 확인하고, 기록된 API 스키마를 다시 파싱해 쿼리를 검증합니다. 서브그래프 연산은 AST로 비교해 선택 필드와 인수를 변수에 연결하므로 생성된 이름이나 서식에 의존하지 않습니다. [변형 테스트](../tests/batch-failure.test.ts)는 응답 사본의 쿼리 구조, 오류 경로, 엔티티 순서, 정상 데이터, 원인 식별자와 계약 근거를 바꿉니다. 근거가 어긋나면 요약 수치를 내지 않습니다. 스키마 합성은 실행기가 수행하며, 검사기는 그 결과인 API 계약과 실행 기록을 다시 확인합니다.

## 캐시 수명이 다음 조회를 바꾼다

설치된 DataLoader는 개별 `Error` 결과를 기억하지만, 배치 전체가 실패하면 해당 요청의 캐시 항목을 비웁니다. 이후 같은 키를 읽으면 다시 배치가 실행될 수 있습니다. 같은 프로세스의 별도 테스트가 이 차이와 JavaScript 오류 객체의 동일성을 확인합니다. JSON만으로는 원래 오류 객체의 동일성을 판단할 수 없습니다. 서브그래프의 HTTP 요청마다 새 loader를 만들므로 캐시는 그 요청 동안만 유지됩니다. [DataLoader 오류 캐시](https://github.com/graphql/dataloader#caching-errors)

[소비자 컴파일 실험](consumer-impact.ko.md)과 보는 지점이 다릅니다. 타입 검사는 주어진 타입으로 소비자 코드를 처리할 수 있는지 묻고, 이 실험은 실행 후 선택한 값 중 무엇이 남는지 묻습니다. 클라이언트는 자체 [오류 정책](https://www.apollographql.com/docs/react/data/error-handling)에 따라 부분 데이터를 버릴 수도 있습니다.

## 확인한 범위와 출처

모든 서비스는 하나의 Node 프로세스에서 실행하며 요청별 배치 함수에 오류를 주입합니다. 근거가 다루는 범위는 이때의 서버 데이터와 오류 경로입니다. 실제 DB 장애, 클라이언트 동작, 재시도, 공유 애플리케이션 캐시는 다루지 않습니다. 소요 시간은 성능 측정이 아닌 진단용입니다. 검사기는 계측된 실행 안에서 일관성을 확인하며 네트워크를 별도로 관측하지는 않습니다. 각 보고서에 소스 리비전, 변경 여부, 실행 전후 지문을 기록하고 과거 기록의 원본 바이트를 보존합니다.

실험은 각 보고서에 기록한 설치 버전을 기준으로 합니다. 구현: [실행기](../src/batch-failure-experiment.ts), [HTTP 관측](../src/lab.ts), [loader](../src/loaders.ts). 공식 참고 자료: [DataLoader 배치 계약](https://github.com/graphql/dataloader#batch-function), [Apollo의 null 허용 여부 설명](https://www.apollographql.com/blog/using-nullability-in-graphql), [Shopify의 너비 우선 실행 글](https://shopify.engineering/faster-breadth-first-graphql-execution). Shopify가 오류 위치를 별도로 복원하는 점을 참고해 이 실험에서도 경로와 값을 함께 검사했습니다.
