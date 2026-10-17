# 재고 하나를 읽지 못했을 때, 상품 정보는 어디까지 사라질까?

[English](batch-failure.md) · [소비자 타입 생성](consumer-impact.ko.md) · [프로젝트 소개](../README.ko.md)

쿼리가 유효하고 조회를 한 번에 묶었다고 해서, 실패 뒤에 어떤 값이 남을지까지 알 수는 없습니다. 이 실험은 두 결정을 나누어 바꿉니다. 배치 전체를 실패시킬지 특정 키에만 오류를 돌려줄지, 그리고 `Product.availability`가 `null`이어도 되는지입니다.

같은 가상 상품 세 개를 기존 Apollo Gateway와 세 HTTP 서브그래프로 조회합니다. `demo-lamp`만 조회 오류를 일으킵니다. 요청 순서는 노트, 램프, 컵이므로 실패 위치는 **1번 인덱스**입니다. 조회 함수는 가상이지만, 스키마 합성·GraphQL 실행·Federation 엔티티 결합·HTTP 호출은 실제로 수행합니다.

```sh
pnpm install --frozen-lockfile
pnpm batch-failure
```

명령은 관측한 데이터 개수와 오류 경로를 출력하고, 파싱한 원본 GraphQL 응답·계약 검사 결과·도구 버전·소스 매니페스트를 새 `.local/batch-failure-*.json`에 저장합니다. 임시 포트의 루프백 서버를 시작하고 반환 전에 종료합니다. 종료 코드 `0`은 부분 실패를 포함해 예상한 관측을 확인했다는 뜻입니다. 세 정책이 같은 데이터를 보존했다는 뜻은 아닙니다. 도구 실행 실패, 근거 불일치, 실행 중 소스 변경은 `1`로 종료합니다.

## 계약 검사는 모두 통과하지만, 남는 값은 다르다

세 조건 모두 스키마 합성과 `CatalogCards` 검증을 통과하고 HTTP **200**을 반환합니다. 설치된 GraphQL 스키마 비교에서도 breaking·dangerous 변경이 보고되지 않습니다. 그러나 실행 결과는 다릅니다.

| 재고 배치의 오류 처리 | 재고 필드 타입 | 남은 상품 수 | 값이 확인된 재고 수 | 게이트웨이 오류 경로 |
| --- | --- | ---: | ---: | --- |
| 램프 키에만 `Error` 반환 | `Availability` | 3 | 2 | `products[1].availability` |
| 배치 함수 전체에서 예외 발생 | `Availability` | 3 | 0 | `products[0..2].availability` |
| 램프 키에만 `Error` 반환 | `Availability!` | 2 | 2 | `products[1].availability` |

이 표는 고정된 입력에서 별도로 검사하는 예상 결과이며 성능 수치가 아닙니다. 명령이 출력하는 개수는 응답 데이터를 확인한 뒤 계산합니다. 실행 코드가 보고한 요약 카운터를 그대로 믿지 않습니다.

배치 전체가 실패하면 정상 키 두 개도 거절됩니다. 상품명·가격·판매자는 남지만 재고 값은 알 수 없게 됩니다. 조회 횟수를 한 번으로 줄였다는 사실만으로 키별 실패가 격리되지는 않습니다.

필드를 non-null로 선언하면 램프의 **상품 객체 전체가 null**이 됩니다. 이미 읽은 상품명과 가격도 사라집니다. 목록 타입은 `[Product]!`이므로 목록 자체는 남습니다. 목록은 필수지만 각 상품은 null일 수 있기 때문입니다. 이는 게이트웨이 결함이 아니라 스키마에 선언한 오류 처리 규칙입니다. 출력 필드의 보장을 강화하면 호환성 검사를 통과하면서도 실행 실패가 지우는 범위는 달라질 수 있습니다. [GraphQL 실행 오류 규칙](https://spec.graphql.org/September2025/#sec-Handling-Execution-Errors)

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

[검사기](../src/batch-failure-check.ts)는 resolver·loader·실행 코드의 요약 카운터를 가져오지 않습니다. 공개된 가상 입력 세 개의 예상 값을 따로 정의하고, 기준 스키마가 null을 허용하는지 확인한 뒤 기록된 API 스키마를 다시 파싱해 쿼리를 검증합니다. 서브그래프 연산은 AST로 비교해 선택 필드와 인수를 변수에 연결합니다. 생성된 연산 이름이나 서식에는 의존하지 않습니다. [변형 테스트](../tests/batch-failure.test.ts)는 실제 응답의 사본에서 쿼리 구조, 오류 경로, 엔티티 순서, 정상 데이터, 원인 식별자와 계약 근거를 바꿉니다. 근거가 어긋나면 요약 수치를 내지 않습니다. 계측한 로컬 실행의 일관성 검사이며 독립 네트워크 관측이나 암호학적 증명은 아닙니다.

## 실패가 지울 범위를 선택한다

조회 결과에서 특정 키의 실패를 구분할 수 있다면 그 키에 `Error`를 반환해 나머지 값을 보존할 수 있습니다. 반면 저장소 전체에 접근하지 못했다면 모든 결과가 불확실합니다. 이때 키별 성공을 만들어 내서는 안 됩니다. `Availability!` 역시 보장을 지키지 못할 때 부모 객체까지 제거해도 되는지 판단해야 합니다. null 허용 여부는 생성 타입을 다루기 편한가의 문제를 넘어 실패 계약의 일부입니다.

캐시 처리도 다릅니다. 설치된 DataLoader는 개별 `Error` 결과를 기억하지만, 배치 전체가 실패하면 해당 요청의 캐시 항목을 비웁니다. 이후 같은 키를 읽으면 다시 배치가 실행될 수 있습니다. 같은 프로세스에서 수행하는 별도 테스트가 이 차이와 JavaScript 오류 객체의 동일성을 확인합니다. JSON 오류 객체만으로 원래 객체의 동일성을 판단하지 않습니다. HTTP 요청마다 새 loader를 만들므로 캐시가 요청을 넘어 유지되지는 않습니다. 공유 애플리케이션 캐시와 재시도는 이 실험의 범위가 아닙니다. [DataLoader 오류 캐시](https://github.com/graphql/dataloader#caching-errors)

[소비자 컴파일 실험](consumer-impact.ko.md)과 보는 지점이 다릅니다. 타입 검사는 주어진 타입으로 소비자 코드를 처리할 수 있는지 묻고, 이 실험은 실행 후 선택한 값 중 무엇이 남는지 묻습니다. 클라이언트는 자체 오류 정책에 따라 부분 데이터를 버릴 수도 있습니다. 여기서는 클라이언트 라이브러리나 상품 화면을 실행하지 않습니다. [Apollo Client 오류 정책](https://www.apollographql.com/docs/react/data/error-handling)

## 확인한 범위와 출처

모든 서비스는 하나의 Node 프로세스에서 실행됩니다. 실제 DB 장애 대신 요청별 배치 함수 안에 오류를 주입합니다. 지연 개선, 운영 규모, 회사 시스템, 재시도 정책이나 분산 캐시를 입증하지 않습니다. 기록의 소요 시간은 진단용입니다. 기존 Cancellation Debt·공유 작업 원본 기록은 그대로 보존하며 새 보고서에 해당 실행의 소스 리비전, 변경 여부와 실행 전후 지문을 기록합니다.

실험은 각 보고서에 기록한 설치 버전을 기준으로 합니다. 구현: [실행기](../src/batch-failure-experiment.ts), [HTTP 관측](../src/lab.ts), [loader](../src/loaders.ts). 공식 참고 자료: [DataLoader 배치 계약](https://github.com/graphql/dataloader#batch-function), [Apollo의 null 허용 여부 설명](https://www.apollographql.com/blog/using-nullability-in-graphql), [Shopify의 너비 우선 실행 글](https://shopify.engineering/faster-breadth-first-graphql-execution). Shopify가 순회 뒤 오류 위치를 별도로 복원하는 점을 참고해 이 실험에서도 경로와 값을 함께 검사했습니다. 해당 실행 엔진이나 성능 수치를 재현한 것은 아닙니다.
