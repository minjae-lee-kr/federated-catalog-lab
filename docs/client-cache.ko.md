# 오류가 사라졌는데, 재고를 다시 확인한 걸까요?

[English](client-cache.md) · [서버의 부분 응답 실험](batch-failure.ko.md)

재고 조회가 실패해도 상품 정보는 남길 수 있습니다. 그렇다면 클라이언트는 그 응답에서 무엇을 보관할까요? 상품의 필드 값, 오류, 또는 이전에 조회한 재고 중 무엇이 다음 조회에 나타나는지 확인합니다.

이 실험은 `ApolloClient.query`를 실제 로컬 Federation 게이트웨이 두 개에 연결합니다. 하나는 정상 재고를 반환하고, 다른 하나는 `demo-lamp` 조회만 실패합니다. 실패 서버도 HTTP 200으로 상품 세 개를 반환하지만, 조명의 `availability`는 `null`이고 `products[1].availability` 위치에 오류가 있습니다. 다른 상품인 노트의 수량 `0`과는 다릅니다. 조명의 `null`은 이번 조회에서 수량을 확인하지 못했다는 뜻입니다.

## 실행과 기록 확인

```sh
pnpm install --frozen-lockfile
pnpm client-cache
```

명령은 URL이나 다른 옵션을 받지 않습니다. loopback 게이트웨이 두 개와 각각의 HTTP 서브그래프 세 개를 띄우고, 다섯 조건을 실행한 뒤 종료합니다. 조건마다 새 클라이언트와 캐시를 사용합니다. warm 조건은 먼저 정상 서버를 HTTP로 조회한 뒤, 같은 클라이언트의 `HttpLink` URI만 실패 서버로 바꿉니다. 캐시는 교체하지 않습니다. 마지막 호출은 `fetchPolicy: 'cache-first'`로 실행하는 또 하나의 `client.query`이며, `ObservableQuery.refetch`가 아닙니다. 요청을 보내지 않는 경우에도 대상 URI는 실패 서버로 유지됩니다.

결과는 새 `.local/client-cache-*.json` 파일에 저장됩니다. 각 단계의 기록은 다음처럼 나뉩니다.

- `http`: 요청 본문, HTTP 상태, UTF-8 응답 원문과 SHA-256. 기록이 없으면 해당 단계에서 fetch 어댑터를 호출하지 않았다는 뜻입니다.
- `result`: promise의 resolve/reject 여부, 반환 데이터와 직렬화한 오류. `none`에서 reject되면 정상 반환 결과는 없지만, `CombinedGraphQLErrors.data`에는 부분 응답 데이터가 남습니다.
- `cacheBefore` / `cacheAfter`: 실제 `cache.extract()` 결과. `readAfter`는 별도로 실행한 `cache.readQuery` 결과입니다. 읽을 수 있는 값이라고 해서 최신이거나 업무상 유효한 것은 아닙니다.

## 다섯 조건의 차이

실패 조회에는 `network-only`를 사용하고, 대조군 하나에만 `no-cache`를 적용합니다. 한 조건의 모든 호출은 같은 오류 정책을 사용합니다. 정상 조회로 채운 조명의 가상 재고는 `3`입니다.

| 조건 | 실패 조회 | 조회 직후 | 다음 `cache-first` 조회 |
| --- | --- | --- | --- |
| `all-cold` | 데이터와 오류를 함께 반환 | 조명의 `null` 저장 | HTTP 없음, 조명 `null`, 오류 없음 |
| `none-warm` | 오류와 함께 reject | 이전 수량 `3` 유지 | HTTP 없음, 수량 `3`, 오류 없음 |
| `all-warm` | 데이터와 오류를 함께 반환 | 수량 `3`을 `null`로 교체 | HTTP 없음, 조명 `null`, 오류 없음 |
| `ignore-warm` | 데이터 반환, 오류 생략 | 수량 `3`을 `null`로 교체 | HTTP 없음, 조명 `null`, 오류 없음 |
| `all-no-cache` | 데이터와 오류를 함께 반환 | 캐시가 빈 상태로 유지 | 같은 실패 서버에 HTTP 1회, 데이터와 오류 반환. 이번 호출은 부분 데이터를 캐시에 저장 |

표는 명령이 검사하는 고정 조건의 관측값입니다. 모든 Apollo API와 설정에 대한 보장은 아닙니다. 다섯 조건에서 `client.query`는 열세 번, 클라이언트 HTTP 요청은 아홉 번 실행합니다. 요청 수는 대조 조건을 확인하기 위한 값이며 성능 측정값이 아닙니다.

## 다음 화면에 필요한 맥락을 정해야 합니다

`all`은 유용한 필드를 남기고 첫 오류를 드러냅니다. 하지만 그 오류가 다음 캐시 결과에도 따라오지는 않습니다. 화면에서 ‘재고 조회 실패’와 nullable 필드가 비어 있는 다른 이유를 구분해야 한다면, 그 구분을 위한 상태가 필요합니다. 오류 상태를 따로 보관할 때도 언제 만료하고 어떤 후속 결과로 해제할지 정해야 합니다.

`none`은 이번 부분 응답을 캐시에 쓰지 않습니다. 캐시가 이미 채워져 있다면 이전 수량도 그대로 남습니다. 오류 없이 캐시를 읽었다는 이유로 재고를 새로 확인했다고 표시하면 잘못된 판단이 됩니다. 이 실험은 수량 `3`이 여전히 맞는지 알 수 없습니다. 재고 변경, 유효 기한, 예약 계약을 다루지 않기 때문입니다.

`ignore`는 첫 오류 신호를 생략하지만 `null`을 0으로 바꾸지는 않습니다. `no-cache`는 이번 응답을 캐시에 남기지 않는 대신, 빈 캐시에서 이어지는 `cache-first` 조회에 네트워크 요청이 한 번 더 필요합니다. 그 요청도 실패합니다. 이 정책들은 무엇을 노출하고 저장할지 결정할 뿐, 의존성의 오류를 고치거나 재고의 유효성을 보장하지 않습니다.

## 실험 범위와 근거

Apollo Client는 `4.3.3`, RxJS는 `7.8.2`, GraphQL은 `16.14.2`로 고정했습니다. 정규화 키도 `Product.keyFields: ['sku']`, `Merchant.keyFields: ['id']`로 명시했습니다. 이 상품 데이터에는 기본 키로 쓸 `id`가 없습니다. 기본값에 맡기면 상품을 부모 아래에 포함하는 다른 캐시 조건을 시험하게 됩니다. 재고와 금액 객체는 상품 아래에 포함됩니다. 서버는 요청마다 DataLoader를 새로 만들며, 요청 안의 메모이제이션과 클라이언트 캐시는 별개입니다.

독립 검사기는 Apollo Client나 실행기·resolver 코드를 가져오지 않습니다. 선택한 연산과 SKU 순서, 응답 원문의 해시와 값, 서브그래프의 키와 오류 경로, promise 결과, 정규화 캐시 변화, 실제 요청 유무를 대조합니다. 변형 테스트는 실제 요청을 지우거나 오류 위치·캐시 값을 바꾸고, 응답을 재사용하거나 소스 안정성을 위조합니다. 근거가 맞지 않으면 표시용 관측값을 반환하지 않습니다.

기록에는 설치된 버전과 실행 전후의 소스 manifest·Git 상태를 담습니다. 해시 일치는 재현을 돕지만, 신뢰할 수 없는 호스트에서의 실행을 보증하지는 않습니다. 응답 원문은 fetch 어댑터 안에서 관측하며 독립적인 패킷 기록은 아닙니다. 각 HTTP 작업과 응답 크기에 상한을 두고 순차 실행하며, 만든 클라이언트와 서버를 종료합니다.

하나의 Node 프로세스에서 가상 데이터와 resolver 오류를 사용한 실험입니다. React 렌더링, `watchQuery`, 영속 캐시, 재시도, 네트워크 오류 정책, 탭 간 상태, 업무상 최신성 정책은 검사하지 않습니다. 여기서 `client.query` 결과에는 `dataState` 필드가 없으며, 캐시 조회 결과는 `readAfter`로 기록합니다. 이전 batch-failure 기록은 서버 경계의 별도 근거로 보존합니다.

## 공식 자료

- [Apollo: API별 오류 처리](https://www.apollographql.com/docs/react/data/error-handling#promise-based-apis)는 promise 정책을 설명합니다. 위 캐시 변화는 별도로 실행해 관측한 결과입니다.
- [Apollo: fetch 정책](https://www.apollographql.com/docs/react/data/queries#supported-fetch-policies)은 `cache-first`, `network-only`, `no-cache`를 구분합니다.
- [Apollo: 캐시 ID 지정](https://www.apollographql.com/docs/react/caching/cache-configuration#customizing-cache-ids)은 `keyFields`를 설명합니다.
- [Apollo: CombinedGraphQLErrors](https://www.apollographql.com/docs/react/api/errors/CombinedGraphQLErrors)는 오류에 남는 원래 응답 데이터를 설명합니다.
