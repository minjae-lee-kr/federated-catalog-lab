# 쿼리는 유효한데, 기존 소비자 코드도 컴파일될까?

[English](consumer-impact.md) · [스키마 분석](schema-evolution.ko.md) · [프로젝트 소개](../README.ko.md)

`Product.name`을 nullable로 바꿔도 이 필드를 조회하는 쿼리는 여전히 유효하다. 그렇다면 `product.name.toUpperCase()`를 호출하던 코드는 어떨까? 이 실험은 소비자 파일을 고정한 채, 스키마 변경이 실제 타입 생성과 TypeScript 컴파일에 미치는 영향을 확인한다.

기존 [스키마 시나리오](../src/evolution-scenarios.ts)에 Apollo 스키마 합성, GraphQL 검증, 공식 GraphQL Code Generator, 설치된 TypeScript 컴파일러를 연결했다. 입력은 모두 실험용으로 만든 데이터다. 리졸버, UI, 소비자 함수는 실행하지 않는다.

## 실행 방법

```sh
pnpm consumer-impact
# 패키지 매니저의 안내 문구 없이 JSON 출력:
node src/consumer-impact-cli.ts --format json
# 생성 타입, 고정 소비자, 설정, 진단 메시지 보관:
node src/consumer-impact-cli.ts --report-dir ./consumer-evidence
```

먼저 `pnpm install --frozen-lockfile`로 고정된 의존성을 설치한다. 출력 디렉터리는 새 경로여야 하며, 상위 디렉터리는 이미 존재해야 한다. `--report-dir`를 지정하지 않으면 성공 여부와 관계없이 임시 파일을 정리한다.

종료 코드 `0`은 **의도한 타입 오류를 포함해** 예상 결과를 관찰했다는 뜻이다. 도구 누락, 코드 생성 실패, 시간 초과, 예상 밖의 컴파일러 출력, 입력 변경은 종료 코드 `1`로 처리한다. 배포를 승인하는 검사는 아니다. 저장소에 체크인된 스키마와 쿼리 검증은 [`pnpm contracts`](../README.ko.md)가 담당한다.

## 스키마만 바꾸고 소비자는 그대로 둔다

아래 모든 후보에서 `CatalogOnly`와 `CatalogCards`는 GraphQL 검증을 통과한다. 표는 `futureProofEnums: false`로 타입을 새로 생성한 뒤, 명시적인 strict 설정으로 컴파일한 결과다.

| 후보 스키마 | 이름 직접 참조 | null 대체 처리 | 재고 상태 분기 + `assertNever` | 재고 상태 분기 + 대체 문구 |
| --- | --- | --- | --- | --- |
| 변경 없음 | 컴파일 성공 | 컴파일 성공 | 컴파일 성공 | 컴파일 성공 |
| 조회하지 않는 nullable `subtitle` 추가 | 컴파일 성공 | 컴파일 성공 | 컴파일 성공 | 컴파일 성공 |
| `name: String!` → `String` | **TS18047** | 컴파일 성공 | 컴파일 성공 | 컴파일 성공 |
| `StockStatus.PREORDER` 추가 | 컴파일 성공 | 컴파일 성공 | **TS2345** | 컴파일 성공 |

[이름을 직접 참조하는 소비자](../fixtures/consumers/strict-name.ts)는 non-null 보장에 의존한다. 타입을 다시 생성하면 선택한 `name`의 타입이 `string | null`로 바뀌고, 기존 소스에서 다음 진단이 발생한다.

```text
strict-name.ts(6,10): error TS18047: 'product.name' is possibly 'null'.
```

[재고 상태를 빠짐없이 처리하는 소비자](../fixtures/consumers/exhaustive-status.ts)는 `IN_STOCK`과 `SOLD_OUT`을 분기한 뒤, 남은 값을 `assertNever`에 넘긴다. `PREORDER`가 추가되면 남은 값의 타입은 더 이상 `never`가 아니다.

```text
exhaustive-status.ts(14,33): error TS2345: Argument of type '"PREORDER"' is not assignable to parameter of type 'never'.
```

[null 대체 처리](../fixtures/consumers/nullable-name.ts)와 [기본 분기](../fixtures/consumers/fallback-status.ts)가 있는 소비자는 계속 컴파일된다. 이는 두 함수가 변경된 타입을 처리할 수 있다는 뜻이다. 대체 문구가 제품 요구사항에도 적절하다는 뜻은 아니다.

조회하지 않는 필드를 추가한 대조군에서는 두 쿼리의 생성 타입 파일이 바이트 단위로 같다는 것도 확인한다. enum 추가 후에도 재고 상태를 조회하지 않는 `CatalogOnly`의 생성 타입은 그대로다. 같은 스키마 변경이 모든 소비자에게 같은 영향을 주지는 않는다.

## 이전 타입을 쓰면 통과해도 변경을 검증한 것이 아니다

이름 nullability 변경과 enum 추가에는 별도 대조군이 있다. **변경 전 스키마에서 생성한 타입**으로 동일한 소비자 네 개를 컴파일하면 모두 통과한다. 보고서는 `candidateSchemaSha256`과 `generatedFromSchemaSha256`을 따로 기록해, 이 결과를 새 타입으로 검사한 결과와 구별한다.

일부러 오래된 입력을 사용한 것이며 컴파일러 결함은 아니다. 컴파일 성공은 검사에 사용한 타입에 대한 결과다. 새 스키마가 타입에 반영되지 않았다면 그 변경과의 호환성까지 확인할 수는 없다.

## `futureProofEnums`를 켜면 변경 전에도 결과가 달라진다

변경 없는 스키마와 enum을 확장한 스키마를 `futureProofEnums: true`로도 생성한다. 이 실험의 고정된 설정에서는 Code Generator가 enum 유니온에 `"%future added value"`를 추가한다. 따라서 기존 두 값만 처리하고 나머지를 `assertNever`로 확인하는 소비자는 **스키마 변경 전부터** 컴파일에 실패한다. 대체 문구를 반환하는 소비자는 두 경우 모두 컴파일된다.

이는 `PREORDER` 추가와 구분해야 할 타입 생성 정책이다. catch-all 타입 항목이 있다고 해서 응답의 알 수 없는 값을 해석하거나 해당 문자열로 치환해 주지는 않는다. 소비자에는 여전히 런타임 처리 정책이 필요하다.

## 이 근거로 확인할 수 있는 범위

`report.json`에는 스키마 변경 분류, 쿼리 검증 결과, 도구 버전, 생성기·컴파일러 설정, 입력·생성 파일 해시, 각 컴파일러의 종료 코드와 진단을 기록한다. 시간이나 로컬 절대 경로는 넣지 않는다. 같은 입력과 도구 버전으로 반복하면 같은 JSON을 얻는다. 파일을 보관할 때는 모든 복사가 끝난 뒤 `report.json`을 완료 표시로 작성하며, 기존 출력 디렉터리를 덮어쓰지 않는다.

실행기는 스키마·쿼리·소비자 입력을 읽어 보관하고 종료 전에 변경 여부를 확인한다. 생성기와 컴파일러 프로세스마다 30초 제한과 출력 크기 제한을 적용한다. 중단 시에는 실행한 프로세스 트리의 종료를 요청하고, 직접 실행한 프로세스의 종료를 기다린 뒤 임시 파일을 정리한다. 예상한 타입 오류도 고정된 컴파일러의 전체 진단과 일치해야 한다. 추가 stdout이나 stderr가 있으면 의도한 오류로 인정하지 않고 실험 실패로 처리한다.

소비자 함수는 `NonNullable`로 제한한 `Product` 또는 `availability` 값을 받는다. 제품이나 재고 정보 자체가 없는 경우를 호출부에서 처리하는 문제는 범위에 포함하지 않는다. 쿼리 응답을 가져오거나 런타임 장애를 재현하지 않았으며, 회사나 실서비스의 성과를 주장하지 않는다. 확인한 것은 구체적이다. **유효한 쿼리에서 생성한 타입이 바뀌면, 더 엄격한 보장에 의존하던 기존 소비자는 컴파일되지 않을 수 있다.**

구현: [실행기](../src/consumer-impact.ts), [생성기 워커](../src/consumer-impact-worker.ts), [프로세스 제어](../src/consumer-impact-process.ts), [테스트](../tests/consumer-impact.test.ts).

공식 참고 자료: [Code Generator 프로그래밍 API](https://the-guild.dev/graphql/codegen/docs/advanced/programmatic-usage), [TypeScript operations 플러그인](https://the-guild.dev/graphql/codegen/plugins/typescript/typescript-operations), [operations v6 마이그레이션과 enum 설정](https://the-guild.dev/graphql/codegen/docs/migration/operations-and-client-preset-from-5-0), [TypeScript 누락 분기 검사](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking).
