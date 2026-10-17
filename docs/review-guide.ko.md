# Federation 탐색기 구현 검토 순서

[English](review-guide.md) · [탐색기 실행 안내](federation-explorer.ko.md) · [프로젝트 소개](../README.ko.md)

기본 조회 탐색기(`pnpm dev`)를 읽는 순서입니다. 실행 슬롯의 수명과 협력적 취소는 별도 [Cancellation Debt 설명](cancellation-debt.ko.md)에서 다룹니다.

## 1. 화면에서 일부러 실패시키기

`pnpm dev`를 실행하고 `http://127.0.0.1:4181/`에서 **정상 응답**, **의존성 오류**, **응답 기한 초과**를 비교합니다. 상품명·가격·판매자 정보가 남는지, 미확인 재고를 품절로 표시하지 않는지 확인합니다. 원본 응답을 펼쳐 오류까지 읽습니다. 오른쪽 위에서 언어를 바꿔도 조회 조건과 결과는 유지되며, 쿼리와 원본 응답·오류 메시지는 번역하지 않습니다.

## 2. 엔티티 키를 따라가기

[`catalog.graphql`](../schemas/catalog.graphql), [`inventory.graphql`](../schemas/inventory.graphql), [`merchants.graphql`](../schemas/merchants.graphql)을 읽고 `Product.sku`와 `Merchant.id`가 [`src/subgraphs.ts`](../src/subgraphs.ts)에서 어떻게 쓰이는지 따라갑니다. 최종 응답을 직접 조립한 것이 아니라 Federation의 엔티티 표현을 전달해 조회합니다.

## 3. 배치의 입력과 출력을 대조하기

[`src/loaders.ts`](../src/loaders.ts)에서 입력 키 순서에 맞춰 배치 결과를 돌려주는지, HTTP 요청마다 새 로더를 만드는지 확인합니다. 화면에서 **같은 SKU 한 번 더 조회**를 켜고 응답의 위치와 원본 응답에 담긴 배치의 고유 키를 비교합니다.

## 4. 서로 다른 호환성 파괴를 비교하기

[`tests/contracts.test.ts`](../tests/contracts.test.ts)를 읽습니다. 필드 삭제는 스키마 계약과 해당 필드를 선택한 쿼리를 모두 깨뜨립니다. 반면 출력 필드에 null을 허용하는 변경은 쿼리 검증을 통과하면서 스키마 계약을 깨뜨립니다. 쿼리 검증만으로 호환성을 판단할 수 없는 이유입니다. 변경별 소비자 영향은 [스키마 변경 분석](schema-evolution.ko.md)에서 이어서 확인할 수 있습니다.

## 5. 주장의 범위 확인하기

[`src/lab.ts`](../src/lab.ts), [`tests/integration.test.ts`](../tests/integration.test.ts), [`src/http-server.ts`](../src/http-server.ts), [보안 문서](../SECURITY.md)를 읽습니다. 기본 탐색기는 기다림을 끝내도 하위 작업을 취소하지 않습니다. 별도 협력적 취소 실험이 그 신호를 명시적으로 연결합니다. 두 실행 모두 메모리 저장소를 사용하고 인증이나 운영용 쿼리 비용·호출 빈도 제한이 없습니다. 상위 의존성 권고도 공개하고 있습니다.

기술 목록보다 실행 가능한 반례와 각 주장을 어디까지 확인했는지가 검토의 근거입니다. 선택의 이유는 [설계 문서](design.ko.md)에 정리했습니다.
