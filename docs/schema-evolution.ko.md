# 스키마를 바꾸면 어느 클라이언트를 확인해야 할까?

[English](schema-evolution.md) · [탐색기 실행 안내](federation-explorer.ko.md) · [프로젝트 소개](../README.ko.md)

저장된 API 기준 스키마와 이름 있는 클라이언트 쿼리에 가상의 변경을 적용해 비교합니다.

```sh
pnpm impact
pnpm impact --scenario weaken-name-nullability
pnpm impact --scenario remove-description --format json
```

패키지 관리자가 출력하는 명령 안내 없이 JSON만 파일에 저장하려면 Node 진입점을 직접 사용합니다.

```sh
node src/schema-impact-cli.ts --format json > schema-impact.json
```

이 명령은 **메모리에서 스키마만 분석**합니다. 서버를 시작하거나 resolver를 실행하지 않고, SDL·기준 스키마를 수정하거나 배포를 승인하지도 않습니다. 종료 코드 `0`은 실험을 끝냈다는 뜻입니다. 의도적으로 호환성을 깨뜨린 시나리오도 `0`으로 끝납니다. 저장소의 현재 스키마와 쿼리를 실제로 통과·실패 판정하는 명령은 `pnpm contracts`입니다.

## 세 결과를 나눠 읽기

| 가상 변경 | Federation 합성 | API 스키마 비교 | 저장된 쿼리 |
| --- | --- | --- | --- |
| 변경 없는 대조군 | 성공 | 호환 | 두 쿼리 모두 유효 |
| null을 허용하는 `Product.subtitle` 추가 | 성공 | 호환 | 둘 다 유효하며 새 필드를 선택하지 않음 |
| `Product.description` 삭제 | 성공 | 호환성 깨짐 | `CatalogOnly`는 무효, `CatalogCards`는 유효 |
| `Product.name: String!`을 `String`으로 변경 | 성공 | 호환성 깨짐 | 둘 다 유효하지만 변경된 보장을 사용함 |
| `Query.products(region: String!)` 필수 인자 추가 | 성공 | 호환성 깨짐 | 둘 다 인자를 전달하지 않아 무효 |
| `StockStatus.PREORDER` 추가 | 성공 | 검토 필요 | 둘 다 유효하며 `CatalogCards`만 해당 enum을 선택 |
| 서브그래프마다 `Product.sku` 타입을 다르게 선언 | 실패 | **평가하지 않음** | **평가하지 않음** |

핵심 반례는 `name`에 null을 허용하는 변경입니다. 쿼리가 여전히 유효해도 생성된 클라이언트 타입이나 화면 코드가 의존하던 보장은 달라질 수 있습니다.

```text
weaken-name-nullability: composition composed; schema breaking
  FIELD_CHANGED_KIND: Product.name changed type from String! to String.
  CatalogCards.graphql#CatalogCards: valid
    schema review: Product.name (String! -> String)
  CatalogOnly.graphql#CatalogOnly: valid
    schema review: Product.name (String! -> String)
```

이 결과가 두 클라이언트의 런타임 실패를 입증하지는 않습니다. resolver가 계속 이름을 반환하거나 클라이언트가 이미 null을 처리할 수도 있습니다. 분석은 **무슨 계약이 바뀌었고 그 필드를 선택하는 쿼리는 무엇인지** 짚습니다. 실제 실행 결과는 GraphQL 쿼리 검증만으로 알 수 없습니다.

[소비자 컴파일 실험](consumer-impact.ko.md)은 이 변경을 타입 재생성과 기존 소비자 코드의 컴파일까지 이어서 확인합니다. 변경 전 타입을 그대로 쓰는 경우도 대조군으로 비교합니다.

## JSON에 담는 근거

- 기준 스키마의 해시와 **문서명 + 연산명**으로 구분한 소비자 목록. 파일이 다르면 연산명이 같아도 구분합니다.
- 오류 코드를 포함한 Apollo 합성 오류. 합성이 실패하면 이후 결과를 성공처럼 보이는 빈 배열로 만들지 않고 `null` 또는 `not-evaluated`로 남깁니다.
- GraphQL.js가 판단한 호환성 파괴 변경과 위험 변경.
- 쿼리별 검증 상태, 정확한 오류 메시지와 소스 위치.
- 이 시나리오에서 바뀐 스키마 좌표 중 해당 쿼리가 선택하는 항목. fragment와 alias를 통한 선택도 포함합니다. Alias는 응답 키를 바꾸지만 스키마상의 필드 좌표는 바꾸지 않습니다.
- 유효하지 않게 된 쿼리 목록과, 여전히 유효하지만 변경된 좌표를 사용하는 쿼리 목록.

`separateOperations`는 각 연산이 참조하는 fragment만 함께 분리합니다. 한 문서 안에 소비자가 둘 있어도, 한쪽 fragment에서만 사용하는 필드를 삭제했다고 다른 연산까지 영향을 받은 것으로 처리하지 않습니다. 분석 전에 기준 문서 자체를 검증하므로 중복 이름·잘못된 fragment·기존 쿼리 오류를 후보 스키마가 만든 회귀로 잘못 분류하지 않습니다.

## 분석의 범위

필드·타입·enum 변경을 소비자 선택에 연결하는 로직은 이 프로젝트의 시나리오에 맞춘 것입니다. 모든 스키마 사용을 분석하는 도구나 트래픽 기반 소비자 목록이 아니며, 기존 스키마 검사 서비스를 대체하지 않습니다. 조건부 선택은 실제 요청 변수 값을 모르므로 선택 가능성이 있는 필드로 보수적으로 포함합니다.

일곱 변경은 원본 SDL의 복사본에 GraphQL AST 편집으로 적용합니다. 예상한 필드가 이미 바뀌어 시나리오의 전제와 맞지 않으면 명시적으로 실패합니다. 검사를 통과시키려고 기준 스키마를 자동으로 다시 쓰지 않습니다.

테스트는 영향을 받지 않는 소비자, alias·fragment, 한 파일의 여러 연산, 서로 다른 파일의 동일 연산명, 잘못된 기준 문서, 합성 실패, 결과의 결정성, 원본 파일 불변을 확인합니다. 각 검사 단계의 차이를 검증하며 업무 의미·권한이나 가능한 모든 스키마 변경을 검증하지는 않습니다.

## 구현과 참고 문서

- [`src/evolution-scenarios.ts`](../src/evolution-scenarios.ts): 명시적인 가상 AST 변경.
- [`src/schema-impact.ts`](../src/schema-impact.ts): 기준 쿼리 검증, 연산 분리, 스키마 비교, 선택한 좌표와 변경의 연결.
- [`src/schema-impact-cli.ts`](../src/schema-impact-cli.ts): 파일을 수정하지 않는 텍스트·JSON 출력.
- [GraphQL 검증](https://www.graphql.org/learn/validation/): 구조 검증은 실행과 별도 단계입니다.
- [GraphQL 스키마와 타입](https://www.graphql.org/learn/schema/): 출력의 null 허용과 필수 인자의 계약.
- [GraphQL.js 16 유틸리티](https://www.graphql-js.org/api-v16/utilities/): 설치한 `16.14.2`에서 `separateOperations`, `findBreakingChanges`, `findDangerousChanges`, `TypeInfo`를 사용합니다.
