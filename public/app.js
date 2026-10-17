const languageKey = "federation-explorer-language";
const messages = {
  en: {
    title: "Federated Catalog Lab — One graph. Honest failures.",
    meta: "An interactive, local Apollo Federation lab with three synthetic subgraphs, request-scoped batching and observable partial failure.",
    home: "Federated Catalog Lab home",
    local: "LOCAL LAB · SYNTHETIC DATA",
    eyebrow: "GRAPHQL API ENGINEERING / 02",
    heading: "One graph.",
    headingAccent: "Honest failures.",
    lede: "Three domains meet in a single product query. Interrupt one dependency and inspect exactly what survives.",
    batching: "Request-scoped batching",
    contracts: "Executable contracts",
    workspace: "Federation experiment",
    conditions: "01 / Set the conditions",
    transport: "REAL HTTP · IN-MEMORY FIXTURES",
    operation: "Operation",
    cardsOperation: "Catalog cards · three domains",
    onlyOperation: "Catalog only · one domain",
    scenario: "Inventory scenario",
    healthy: "Healthy",
    dependencyError: "Dependency error",
    timeout: "Response timeout",
    missing: "Missing record",
    duplicates: "Repeat one SKU",
    run: "Run query",
    runningButton: "Running…",
    send: "02 / Send one query",
    named: "NAMED OPERATION",
    queryLabel: "GraphQL query",
    loading: "Loading operation…",
    loadError: "Could not load operations. Restart the local lab and reload.",
    queryFoot:
      "The same query runs against the local Apollo gateway. Inventory is nullable by design. Unknown is never “sold out”.",
    follow: "03 / Follow the work",
    ready: "READY",
    noResult: "NO RESULT",
    gateway: "Gateway",
    catalog: "Catalog",
    inventory: "Inventory",
    merchants: "Merchants",
    graphAll: "Catalog resolves first, then inventory and merchants.",
    graphOnly: "Catalog is selected. Inventory and merchants are not fetched.",
    graphNone: "No subgraph calls were recorded.",
    empty: "Run a query to inspect dependency calls and loader batches.",
    noFetches: "No subgraph fetch record received.",
    traceFoot:
      "Durations are observations from this local run, not benchmarks. A timed-out response cannot report its batch details.",
    resultHeading: "04 / Read the product result",
    idle: "Choose a condition and run the query.",
    running: "Running the selected operation…",
    complete: "Response complete · selected fields resolved",
    errorPrefix: "Could not run query: ",
    noTrace: "No current trace. Check that the local server is running.",
    raw: "Inspect raw GraphQL response",
    responseLabel: "Raw GraphQL response",
    noResponse: "No response yet.",
    noBatch: "No batch result received",
    merchantUnavailable: "Merchant unavailable",
    unknown: "UNKNOWN",
    soldOut: "SOLD OUT",
    ownership: "Compose ownership",
    ownershipBody:
      "Catalog owns product identity. Inventory extends the entity. Merchant details resolve through a second entity reference.",
    uncertainty: "Keep uncertainty visible",
    uncertaintyBody:
      "A missing record, sold-out stock and an unavailable dependency have different meanings. The interface preserves that distinction.",
    contractHeading: "Make the contract executable",
    contractBody:
      "Composition, API schema diffs and named operation validation run before integration tests. Each catches a different class of breakage.",
    footer: "A small lab, with inspectable decisions.",
    footerBody:
      "Original personal project. All records, faults and timing thresholds are synthetic. No production architecture or performance claims.",
    language: "Switch to Korean",
    fetchCount: (n) => `${n} SUBGRAPH FETCH${n === 1 ? "" : "ES"}`,
    batchCount: (batches, keys) =>
      `${batches} batch${batches === 1 ? "" : "es"} · ${keys} unique keys`,
    productMissing: (n) => `Product ${n} not found`,
    available: (n) => `${n} AVAILABLE`,
    partial: (n) =>
      `Partial data · ${n} error${n === 1 ? "" : "s"} · availability is unknown`,
    unknownCount: (n) =>
      `Response received · ${n} unknown inventory record${n === 1 ? "" : "s"}`,
    catalogNote:
      "Catalog-only selections do not fetch inventory or merchants. Inventory faults should have no effect.",
    notes: {
      healthy:
        "All three subgraphs answer. Look for one inventory batch and two unique merchant keys.",
      "inventory-error":
        "Inventory throws a field error. Product and merchant data should remain readable.",
      "inventory-timeout":
        "Inventory exceeds a synthetic deadline. The gateway stops waiting; other fields survive.",
      "missing-inventory":
        "The lamp has no inventory record. Unknown remains distinct from sold out, without a transport error.",
    },
  },
  ko: {
    title: "Federated Catalog Lab — 하나의 조회, 구분할 수 있는 실패",
    meta: "가상의 서브그래프 세 개로 엔티티 결합, 요청별 배칭, 부분 실패를 살펴보는 로컬 Apollo Federation 탐색기입니다.",
    home: "Federated Catalog Lab 처음으로",
    local: "로컬 실험 · 가상 데이터",
    eyebrow: "GRAPHQL API 설계 / 02",
    heading: "하나의 조회.",
    headingAccent: "실패도 그대로.",
    lede: "상품 조회 하나로 세 도메인을 연결합니다. 의존성 하나를 실패시키고 어떤 정보가 남는지 확인해 보세요.",
    batching: "요청별 배칭",
    contracts: "실행 가능한 계약 검사",
    workspace: "Federation 실험",
    conditions: "01 / 실행 조건",
    transport: "실제 HTTP · 메모리 데이터",
    operation: "조회할 정보",
    cardsOperation: "상품 카드 · 세 도메인",
    onlyOperation: "카탈로그만 · 한 도메인",
    scenario: "재고 조회 조건",
    healthy: "정상 응답",
    dependencyError: "의존성 오류",
    timeout: "응답 기한 초과",
    missing: "레코드 없음",
    duplicates: "같은 SKU 한 번 더 조회",
    run: "조회 실행",
    runningButton: "조회 중…",
    send: "02 / 하나의 쿼리",
    named: "이름 있는 쿼리",
    queryLabel: "GraphQL 쿼리",
    loading: "쿼리를 불러오는 중…",
    loadError:
      "쿼리를 불러오지 못했습니다. 로컬 서버를 다시 시작하고 새로고침해 주세요.",
    queryFoot:
      "이 쿼리를 로컬 Apollo 게이트웨이에 보냅니다. 재고 필드는 null을 허용합니다. 미확인 상태를 품절로 바꾸지 않습니다.",
    follow: "03 / 실제 호출 흐름",
    ready: "실행 전",
    noResult: "결과 없음",
    gateway: "게이트웨이",
    catalog: "카탈로그",
    inventory: "재고",
    merchants: "판매자",
    graphAll: "카탈로그를 먼저 조회한 뒤 재고와 판매자를 조회합니다.",
    graphOnly: "카탈로그만 조회합니다. 재고와 판매자는 조회하지 않습니다.",
    graphNone: "기록된 서브그래프 호출이 없습니다.",
    empty: "조회 후 의존성 호출과 로더 배치를 확인할 수 있습니다.",
    noFetches: "서브그래프 호출 기록을 받지 못했습니다.",
    traceFoot:
      "시간은 이번 로컬 실행의 관측값이며 벤치마크가 아닙니다. 응답 기한이 지난 호출의 배치 정보는 받을 수 없습니다.",
    resultHeading: "04 / 상품 조회 결과",
    idle: "조건을 선택한 뒤 조회를 실행해 주세요.",
    running: "선택한 쿼리를 실행하고 있습니다…",
    complete: "응답 완료 · 선택한 필드를 조회했습니다",
    errorPrefix: "조회를 실행하지 못했습니다: ",
    noTrace:
      "이번 호출의 기록이 없습니다. 로컬 서버가 실행 중인지 확인해 주세요.",
    raw: "원본 GraphQL 응답 보기",
    responseLabel: "원본 GraphQL 응답",
    noResponse: "아직 응답이 없습니다.",
    noBatch: "배치 결과를 받지 못했습니다",
    merchantUnavailable: "판매자 정보 미확인",
    unknown: "재고 미확인",
    soldOut: "품절",
    ownership: "도메인별 책임을 연결합니다",
    ownershipBody:
      "카탈로그는 상품 식별자를 소유하고 재고는 같은 엔티티에 정보를 보탭니다. 판매자 정보는 별도 엔티티 참조로 조회합니다.",
    uncertainty: "모르는 상태를 숨기지 않습니다",
    uncertaintyBody:
      "레코드 없음, 품절, 의존성 실패는 서로 다른 상태입니다. 화면에서도 그 차이를 유지합니다.",
    contractHeading: "계약을 코드로 검사합니다",
    contractBody:
      "통합 테스트 전에 스키마 합성, API 스키마 비교, 이름 있는 쿼리 검증을 실행합니다. 각 검사는 서로 다른 문제를 찾습니다.",
    footer: "작은 실험에서 구현의 판단을 확인합니다.",
    footerBody:
      "독립적인 개인 프로젝트입니다. 데이터·오류·시간 설정은 모두 가상이며, 운영 구조나 실서비스 성능을 주장하지 않습니다.",
    language: "영어로 전환",
    fetchCount: (n) => `서브그래프 호출 ${n}건`,
    batchCount: (batches, keys) => `배치 ${batches}건 · 고유 키 ${keys}개`,
    productMissing: (n) => `${n}번째 상품을 찾지 못했습니다`,
    available: (n) => `재고 ${n}개`,
    partial: (n) => `부분 응답 · 오류 ${n}개 · 재고 미확인`,
    unknownCount: (n) => `응답 수신 · 재고 미확인 ${n}건`,
    catalogNote:
      "카탈로그만 선택하면 재고와 판매자는 조회하지 않습니다. 재고 오류도 결과에 영향을 주지 않습니다.",
    notes: {
      healthy:
        "세 서브그래프가 모두 응답합니다. 재고 배치 한 건과 서로 다른 판매자 키 두 개를 확인해 보세요.",
      "inventory-error":
        "재고 필드에서 오류가 발생합니다. 상품과 판매자 정보는 남아 있어야 합니다.",
      "inventory-timeout":
        "재고 응답이 설정한 기한을 넘깁니다. 게이트웨이는 기다림을 끝내고 나머지 필드를 반환합니다.",
      "missing-inventory":
        "램프의 재고 레코드가 없습니다. 전송 오류 없이도 미확인 상태와 품절을 구분합니다.",
    },
  },
};

export function initialLanguage(browserLanguage, storage) {
  let language = browserLanguage?.toLowerCase().startsWith("ko") ? "ko" : "en";
  try {
    const saved = storage?.getItem(languageKey);
    if (saved === "ko" || saved === "en") language = saved;
  } catch {
    /* Browser language remains usable when storage is blocked. */
  }
  return language;
}

// Locale is presentation state: it never schedules a request or rewrites evidence.
export function createExplorerState({
  language = "en",
  request = fetch,
  changed = () => {},
} = {}) {
  const state = {
    language,
    operations: null,
    operationsState: "loading",
    result: null,
    error: null,
    running: false,
  };
  return {
    state,
    setLanguage(next) {
      if (next !== "ko" && next !== "en") return;
      state.language = next;
      changed();
    },
    async load() {
      try {
        const response = await request("/operations");
        if (!response.ok) throw new Error("Could not load operations");
        state.operations = await response.json();
        state.operationsState = "ready";
      } catch {
        state.operationsState = "error";
      }
      changed();
    },
    async run(selection) {
      if (state.running) return;
      state.running = true;
      changed();
      try {
        const response = await request("/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(selection),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error ?? result.errors?.[0]?.message ?? "Request rejected",
          );
        state.result = result;
        state.error = null;
      } catch (error) {
        state.result = null;
        state.error = error.message;
      } finally {
        state.running = false;
        changed();
      }
    },
  };
}

export function mountExplorer(document, browser = window) {
  const byId = (id) => document.getElementById(id);
  let storage;
  try {
    storage = browser.localStorage;
  } catch {
    /* Storage is optional. */
  }
  let graphServices = ["catalog", "inventory", "merchants"];
  let renderedResult = null;
  const model = createExplorerState({
    language: initialLanguage(browser.navigator.language, storage),
    request: browser.fetch.bind(browser),
    changed: translate,
  });
  const t = () => messages[model.state.language];
  const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function updateGraph() {
    for (const node of document.querySelectorAll("[data-domain]"))
      node.classList.toggle(
        "inactive",
        !graphServices.includes(node.dataset.domain),
      );
    byId("branches").classList.toggle(
      "inactive",
      !graphServices.includes("inventory") &&
        !graphServices.includes("merchants"),
    );
    byId("graph").setAttribute(
      "aria-label",
      graphServices.length === 0
        ? t().graphNone
        : graphServices.length === 1
          ? t().graphOnly
          : t().graphAll,
    );
  }
  function updateQuery() {
    const { operations, operationsState } = model.state;
    setText(
      byId("query"),
      operations?.[byId("operation").value] ??
        (operationsState === "loading" ? t().loading : t().loadError),
    );
    setText(
      byId("scenario-note"),
      byId("operation").value === "CatalogOnly.graphql"
        ? t().catalogNote
        : t().notes[byId("scenario").value],
    );
  }
  function renderResult(result) {
    const fetches = result.extensions?.lab?.fetches ?? [];
    const errors = result.errors ?? [];
    if (result !== renderedResult) {
      graphServices = fetches.map((trace) => trace.service);
      renderedResult = result;
    }
    setText(byId("fetch-count"), t().fetchCount(fetches.length));
    byId("trace").replaceChildren(
      ...fetches.map((trace) => {
        const row = element(
          "div",
          undefined,
          `trace-row${trace.outcome === "ok" ? "" : " bad"}`,
        );
        const count = trace.batches.reduce(
          (sum, batch) => sum + batch.keys.length,
          0,
        );
        row.append(
          element("strong", t()[trace.service] ?? trace.service),
          element(
            "span",
            trace.batches.length
              ? t().batchCount(trace.batches.length, count)
              : t().noBatch,
            "batch",
          ),
          element("span", `${trace.durationMs} ms`, "time"),
        );
        row.title = `${trace.outcome}\n${trace.batches.flatMap((batch) => batch.keys).join(", ")}`;
        return row;
      }),
    );
    if (!fetches.length)
      byId("trace").append(element("p", t().noFetches, "empty"));
    byId("cards").replaceChildren(
      ...(result.data?.products ?? []).map((product, index) => {
        const card = element("article", undefined, "product");
        if (!product) {
          card.append(element("h3", t().productMissing(index + 1)));
          return card;
        }
        card.append(
          element("span", product.sku, "sku"),
          element("h3", product.name),
        );
        if (Object.hasOwn(product, "description"))
          card.append(element("p", product.description, "description"));
        if (Object.hasOwn(product, "merchant"))
          card.append(
            element(
              "p",
              product.merchant
                ? `${product.merchant.name} / ${product.merchant.city}`
                : t().merchantUnavailable,
              "merchant",
            ),
          );
        const footer = element("div", undefined, "product-foot");
        if (product.price)
          footer.append(
            element(
              "span",
              new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: product.price.currency,
              }).format(product.price.amountMinor / 100),
              "price",
            ),
          );
        if (Object.hasOwn(product, "availability")) {
          const availability = product.availability;
          const sold = availability?.status === "SOLD_OUT";
          footer.append(
            element(
              "span",
              availability
                ? sold
                  ? t().soldOut
                  : t().available(availability.quantity)
                : t().unknown,
              `badge${availability ? (sold ? " sold" : "") : " unknown"}`,
            ),
          );
        }
        if (footer.childElementCount) card.append(footer);
        return card;
      }),
    );
    const unknown = (result.data?.products ?? []).filter(
      (product) =>
        product &&
        Object.hasOwn(product, "availability") &&
        product.availability === null,
    ).length;
    setText(byId("response"), JSON.stringify(result, null, 2));
    return {
      text: errors.length
        ? t().partial(errors.length)
        : unknown
          ? t().unknownCount(unknown)
          : t().complete,
      warning: Boolean(errors.length || unknown),
    };
  }
  function translate() {
    const { language, result, error, running } = model.state;
    document.documentElement.lang = language;
    document.title = t().title;
    document
      .querySelector('meta[name="description"]')
      .setAttribute("content", t().meta);
    for (const node of document.querySelectorAll("[data-i18n]"))
      setText(node, t()[node.dataset.i18n]);
    for (const node of document.querySelectorAll("[data-i18n-label]"))
      node.setAttribute("aria-label", t()[node.dataset.i18nLabel]);
    byId("language").textContent = language === "ko" ? "English" : "한국어";
    byId("language").lang = language === "ko" ? "en" : "ko";
    byId("language").setAttribute("aria-label", t().language);
    byId("run").disabled = running;
    setText(byId("run-label"), running ? t().runningButton : t().run);
    updateQuery();
    let summary = {
      text: error ? t().errorPrefix + error : t().idle,
      warning: Boolean(error),
    };
    if (result) summary = renderResult(result);
    else {
      byId("cards").replaceChildren();
      byId("trace").replaceChildren(
        element("p", error ? t().noTrace : t().empty, "empty"),
      );
      setText(byId("fetch-count"), error ? t().noResult : t().ready);
      setText(
        byId("response"),
        error ? JSON.stringify({ error }, null, 2) : t().noResponse,
      );
    }
    setText(byId("status"), running ? t().running : summary.text);
    byId("status").className = !running && summary.warning ? "warning" : "";
    updateGraph();
  }
  for (const id of ["operation", "scenario"])
    byId(id).addEventListener("change", () => {
      graphServices =
        byId("operation").value === "CatalogOnly.graphql"
          ? ["catalog"]
          : ["catalog", "inventory", "merchants"];
      updateQuery();
      updateGraph();
    });
  byId("language").addEventListener("click", () => {
    model.setLanguage(model.state.language === "ko" ? "en" : "ko");
    try {
      storage?.setItem(languageKey, model.state.language);
    } catch {
      /* The active choice still applies. */
    }
  });
  byId("run").addEventListener("click", () =>
    model.run({
      operation: byId("operation").value,
      scenario: byId("scenario").value,
      duplicates: byId("duplicates").checked,
    }),
  );
  translate();
  void model.load();
  return model;
}

if (typeof document !== "undefined") mountExplorer(document);
