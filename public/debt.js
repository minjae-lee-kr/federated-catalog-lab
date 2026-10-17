const $ = id => document.getElementById(id);
const messages = {
  en: {
    eyebrow:'A controlled experiment / experimental branch', title:'The request ended.\nThe work did not.',
    lede:'A timeout limits how long you wait. It does not, by itself, limit how much work is still running. Follow the jobs that survive four attempts.',
    boundary:'Synthetic timer-held work · Real HTTP and socket cancellation · No production performance claims',
    setup:'One read. Four attempts. Four policies.', fixture:'Each subgraph fetch times out after 160 ms. Uncancelled inventory work lasts 1,000 ms. Admission capacity: 2.', route:'Client → Apollo Gateway → Catalog → Inventory + Merchants', run:'Run the experiment',
    ready:'Run locally to collect fresh observations. No prerecorded result is displayed.', running:'Running four policies over real HTTP. Waiting for underlying work to settle before closing each lab…',
    success:'Expected observations reproduced. The deliberately incorrect controls are labeled below.', failed:'An expected observation failed or source changed during execution. Inspect the raw evidence before drawing conclusions.', error:'The experiment could not finish. Check the local server and try again.', busy:'Another experiment is running. Wait for it to finish, then try again.',
    comparison:'What remained after the response?', comparisonNote:'Peak work and peak permits are independently reconstructed from the event log. “Left running” is observed after the final caller response.',
    scrollHint:'On narrow screens, focus the table and scroll horizontally to see every column.',
    download:'Download evidence', policy:'Policy', peakWork:'Peak work', peakPermits:'Peak permits', leftover:'Left running', completed:'Completed', cancelled:'Cancelled', rejected:'Not admitted',
    trace:'Inspect the work timeline', choose:'Policy to inspect', active:'Actual active jobs', permits:'Held permits', caller:'Caller response completed', timeNote:'Elapsed milliseconds within this local case, including startup. Timing is observational; configured delays are not benchmarks.',
    chartHint:'On narrow screens, scroll the chart horizontally. With a keyboard, focus the chart and use Left/Right Arrow.',
    events:'Raw ordered work events', raw:'Full report, GraphQL responses and source manifest', lessonLabel:'The invariant that matters', lesson:'The permit belongs to the work, not the waiter.',
    lessonBody:'Keep admission ownership until the underlying operation actually settles. Cancellation can shorten that lifetime only when every required layer cooperates. If a dependency ignores cancellation, admission still bounds work—but retries may need to be rejected.',
    limits:'One inventory process, one shared host clock and instrumented timer work. No distributed capacity bound, database query cancellation, CPU preemption or external-effect rollback is demonstrated. Catalog and merchant fields remain readable when inventory is unavailable.',
    original:'Original personal experiment with public patterns and synthetic data. No employer architecture, traffic or outcome is represented.',
    control:'Counterexample control', mitigation:'Mitigation with an explicit boundary', language:'한국어 — Switch to Korean',
    evidenceTitle:'Capture details', recordedNotice:'Saved run · Read-only. Opening this page does not rerun the experiment.', generated:'Captured at (UTC)', revision:'Source revision', fingerprint:'Source SHA-256', evidenceNote:'A source fingerprint supports reproduction under unchanged source. It is not execution attestation or evidence of production performance.', rawFile:'Open raw JSON', recordedSuccess:'This saved run reproduced the expected observations. The deliberately incorrect controls remain labeled.', recordedFailure:'This saved run did not reproduce every expected observation. Inspect its raw evidence.', clean:'clean', dirty:'uncommitted changes', stable:'source unchanged during capture', changed:'source changed during capture', unavailable:'unavailable',
    names:{'timeout-only':'Timeout only','early-release':'Release on timeout','admission-only':'Hold until settlement','cooperative':'Hold + cooperative cancellation'},
    notes:{'timeout-only':'Every retry starts another job while previous timed-out work continues.','early-release':'A permit is released when its caller disconnects. The counter looks bounded while the underlying jobs keep running.','admission-only':'Signal-ignoring work keeps its permits. Further work is rejected while those slots remain occupied.','cooperative':'The gateway forwards an explicit deadline and disconnect signal. The timer accepts cancellation; its permit is released after the timer settles.'},
    findings:{'timeout-only':'A finished client response is not evidence that downstream work has finished.','early-release':'The permit counter is not a trustworthy capacity bound if a permit can outlive its connection to real work.','admission-only':'The capacity bound holds, but noncooperative work still finishes after the caller stops waiting.','cooperative':'Cancellation stops this cooperative timer. It would not automatically stop a database driver or remote side effect that ignores the signal.'},
  },
  ko: {
    eyebrow:'통제된 실험 / 실험 브랜치', title:'요청은 끝났습니다.\n작업은 끝나지 않았습니다.',
    lede:'타임아웃은 기다리는 시간을 제한합니다. 실행 중인 작업까지 제한해 주지는 않습니다. 네 번의 시도 뒤에 남은 작업을 추적해 보세요.',
    boundary:'타이머로 유지하는 가상 작업 · 실제 HTTP와 소켓 취소 · 운영 성능을 주장하지 않습니다',
    setup:'같은 조회, 네 번의 시도, 네 가지 정책', fixture:'각 서브그래프 조회는 160ms 후 타임아웃됩니다. 취소되지 않은 재고 작업은 1,000ms 동안 실행됩니다. 동시 실행을 제한하는 실행 슬롯(permit)은 2개입니다.', route:'클라이언트 → Apollo 게이트웨이 → 상품 → 재고 + 판매자', run:'실험 실행',
    ready:'직접 실행해 새로운 관측을 수집합니다. 미리 기록한 결과를 표시하지 않습니다.', running:'네 가지 정책을 실제 HTTP로 실행하고 있습니다. 각 실험의 작업이 끝난 뒤 서버를 정리합니다…',
    success:'예상한 현상을 재현했습니다. 의도적으로 잘못 구현한 대조군은 아래에 구분했습니다.', failed:'예상한 현상을 확인하지 못했거나 실행 중 소스가 바뀌었습니다. 원본 근거를 먼저 확인해 주세요.', error:'실험을 완료하지 못했습니다. 로컬 서버를 확인하고 다시 실행해 주세요.', busy:'다른 실험이 실행 중입니다. 완료된 뒤 다시 시도해 주세요.',
    comparison:'응답이 끝난 뒤 무엇이 남았을까요?', comparisonNote:'최대 작업 수와 슬롯 수는 이벤트 기록에서 독립적으로 재구성합니다. ‘남은 작업’은 마지막 호출자의 응답 직후에 관측합니다.',
    scrollHint:'좁은 화면에서는 표에 초점을 맞춘 뒤 가로로 스크롤하면 모든 열을 볼 수 있습니다.',
    download:'근거 내려받기', policy:'정책', peakWork:'최대 작업', peakPermits:'최대 슬롯', leftover:'남은 작업', completed:'완료', cancelled:'취소', rejected:'실행 거절',
    trace:'작업의 실제 흐름', choose:'살펴볼 정책', active:'실제로 실행 중인 작업', permits:'사용 중인 슬롯', caller:'호출자 응답 완료', timeNote:'각 로컬 실험 시작 후 경과 시간(ms)이며 서버 준비 시간도 포함합니다. 설정한 지연과 관측 시간은 벤치마크가 아닙니다.',
    chartHint:'좁은 화면에서는 그래프를 가로로 스크롤하세요. 키보드로는 그래프에 초점을 맞춘 뒤 좌우 방향키를 사용하세요.',
    events:'순서대로 기록한 작업 이벤트', raw:'전체 보고서 · GraphQL 응답 · 소스 해시 목록', lessonLabel:'기다림이 끝나도 작업은 계속될 수 있습니다.', lesson:'실행 슬롯은 실제 작업이 끝난 뒤에 반환해야 합니다.',
    lessonBody:'실제 작업이 끝날 때까지 슬롯을 유지해야 합니다. 필요한 모든 계층이 취소에 협력할 때만 작업을 일찍 끝낼 수 있습니다. 의존성이 취소를 무시하더라도 동시 실행 제한은 지킬 수 있지만, 재시도를 거절해야 할 수 있습니다.',
    limits:'재고 프로세스 하나, 같은 호스트의 시계, 계측된 타이머 작업을 사용합니다. 분산 실행 제한, DB 쿼리 취소, CPU 선점, 외부 효과의 롤백을 증명하지 않습니다. 재고 조회가 실패해도 상품과 판매자 정보는 유지됩니다.',
    original:'공개된 패턴과 가상 데이터로 만든 개인 실험입니다. 회사의 내부 구조, 트래픽, 성과를 재현하지 않습니다.',
    control:'반례를 드러내는 대조군', mitigation:'한계를 명시한 완화 방법', language:'English — 영어로 전환',
    evidenceTitle:'기록 정보', recordedNotice:'저장된 실행 결과 · 읽기 전용. 이 페이지를 열어도 실험을 다시 실행하지 않습니다.', generated:'기록 시각 (UTC)', revision:'소스 리비전', fingerprint:'소스 SHA-256', evidenceNote:'소스 지문은 소스가 바뀌지 않은 상태에서의 재현을 돕습니다. 실행 증명이나 운영 성능의 근거는 아닙니다.', rawFile:'원본 JSON 열기', recordedSuccess:'저장된 실행에서 예상한 현상을 재현했습니다. 의도적으로 잘못 구현한 대조군도 구분했습니다.', recordedFailure:'저장된 실행에서 예상한 현상을 모두 확인하지 못했습니다. 원본 근거를 확인해 주세요.', clean:'미커밋 변경 없음', dirty:'미커밋 변경 있음', stable:'기록 중 소스 변경 없음', changed:'기록 중 소스 변경 있음', unavailable:'확인 불가',
    names:{'timeout-only':'타임아웃만 적용','early-release':'타임아웃에 슬롯 반환','admission-only':'작업 종료까지 슬롯 유지','cooperative':'슬롯 유지 + 협력적 취소'},
    notes:{'timeout-only':'앞선 요청이 타임아웃돼도 작업은 계속됩니다. 재시도마다 새로운 작업이 겹쳐 실행됩니다.','early-release':'호출자의 연결이 끊기면 슬롯을 반환합니다. 슬롯 수는 제한을 지키는 것처럼 보이지만 실제 작업은 계속 늘어납니다.','admission-only':'취소 신호를 무시하는 작업도 슬롯을 유지합니다. 빈 슬롯이 없으면 추가 작업을 거절합니다.','cooperative':'게이트웨이가 명시적 기한과 연결 종료 신호를 전달합니다. 타이머가 취소를 받아 실제로 끝난 뒤 슬롯을 반환합니다.'},
    findings:{'timeout-only':'클라이언트 응답이 끝났다는 사실만으로 하위 작업의 종료를 알 수는 없습니다.','early-release':'슬롯이 실제 작업의 수명에서 분리되면 슬롯 수만 보고 동시 실행량이 제한된다고 믿을 수 없습니다.','admission-only':'동시 실행 제한은 지키지만, 취소에 협력하지 않는 작업은 호출자가 떠난 뒤에도 완료됩니다.','cooperative':'이번 타이머는 취소를 받아 중단됩니다. 취소를 무시하는 DB 드라이버나 원격 부수 효과까지 자동으로 멈추는 것은 아닙니다.'},
  },
};
let lang = navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
try { const saved = localStorage.getItem('cancellation-lab-language'); if (saved === 'ko' || saved === 'en') lang = saved; } catch {}
let report; let statusKey = 'ready';
const recorded = document.documentElement.dataset.reportMode === 'recorded';
const t = () => messages[lang];
function element(tag, value) { const node = document.createElement(tag); if (value !== undefined) node.textContent = String(value); return node; }
function translate() {
  document.documentElement.lang = lang; document.title = lang === 'ko' ? '끝나지 않은 작업 | GraphQL 실험' : 'Cancellation debt | GraphQL experiment';
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t()[node.dataset.i18n];
  $('language').textContent = lang === 'ko' ? 'English' : '한국어'; $('language').setAttribute('aria-label', t().language);
  $('status').textContent = t()[statusKey];
  if (report) render();
}
function svgNode(tag, attributes, content) { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key,value] of Object.entries(attributes)) node.setAttribute(key, String(value)); if (content !== undefined) node.textContent = String(content); return node; }
function draw(item) {
  const events = item.final.events; const width = 880, height = 235, left = 33, right = 20, top = 18, bottom = 32;
  const maxTime = Math.max(1, ...events.map(event => event.elapsedMs)); const maxCount = Math.max(2, item.final.maxActive, item.final.maxPermits);
  const x = ms => left + ms / maxTime * (width-left-right); const y = count => height-bottom-count/maxCount*(height-top-bottom);
  const svg = svgNode('svg', {viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':`${t().trace}: ${t().names[item.mode]}`});
  svg.append(svgNode('title', {}, `${t().active} / ${t().permits}`));
  for (let count=0; count<=maxCount; count++) { svg.append(svgNode('line',{x1:left,y1:y(count),x2:width-right,y2:y(count),class:'grid'}),svgNode('text',{x:left-10,y:y(count)+4,'text-anchor':'end'},count)); }
  for (let step=0;step<=4;step++) { const ms=maxTime*step/4; svg.append(svgNode('text',{x:x(ms),y:height-8,'text-anchor':'middle'},Math.round(ms))); }
  for (const event of events.filter(value=>value.kind==='caller-completed')) svg.append(svgNode('line',{x1:x(event.elapsedMs),x2:x(event.elapsedMs),y1:top,y2:height-bottom,class:'caller'}));
  for (const [key,style] of [['active','work'],['permits','permit']]) { let previous=0; const points=[`${left},${y(0)}`]; for(const event of events){points.push(`${x(event.elapsedMs)},${y(previous)}`,`${x(event.elapsedMs)},${y(event[key])}`);previous=event[key];} svg.append(svgNode('polyline',{points:points.join(' '),class:style})); }
  $('chart').replaceChildren(svg);
}
function inspect() {
  const item = report.cases.find(value => value.mode === $('case').value) ?? report.cases[0];
  $('case-note').textContent = t().notes[item.mode]; $('finding').textContent = t().findings[item.mode];
  $('events').textContent = JSON.stringify({analysis:item.analysis,events:item.final.events},null,2); draw(item);
}
function render() {
  $('results').hidden=false;
  $('evidence').hidden=false; $('recorded-notice').hidden=!recorded; $('raw-file').hidden=!recorded;
  $('generated-at').textContent=new Date(report.generatedAt).toISOString();
  const git=report.source.git;
  $('revision').textContent=git ? `${git.head.slice(0,12)} · ${git.dirty?t().dirty:t().clean} · ${report.sourceUnchanged?t().stable:t().changed}` : t().unavailable;
  $('revision').title=git?.head ?? ''; $('source-fingerprint').textContent=report.source.sha256;
  $('rows').replaceChildren(...report.cases.map(item=>{const row=element('tr');if(item.analysis.physicalBoundSatisfied===false)row.className='bad';const title=element('td',t().names[item.mode]);title.append(element('small',item.role==='counterexample'?t().control:t().mitigation));row.append(title,...[item.final.maxActive,item.final.maxPermits,item.afterCallers.active,item.final.completed,item.final.cancelled,item.final.rejected].map(value=>element('td',value)));return row;}));
  const selected=$('case').value;
  $('case').replaceChildren(...report.cases.map(item=>{const option=element('option',t().names[item.mode]);option.value=item.mode;return option;}));
  $('case').value=selected || 'early-release'; $('raw').textContent=JSON.stringify(report,null,2); inspect();
}
$('language').addEventListener('click',()=>{lang=lang==='ko'?'en':'ko';try{localStorage.setItem('cancellation-lab-language',lang);}catch{}translate();});
$('case').addEventListener('change',inspect);
globalThis.cancellationDebtView={
  setStatus(key){statusKey=key;$('status').textContent=t()[statusKey];},
  setReport(value){report=value;statusKey=report.passed?'success':'failed';render();$('status').textContent=t()[statusKey];},
};
$('download').addEventListener('click',()=>{
  const link=element('a');link.download='cancellation-debt.json';
  if(recorded){link.href='./report.json';link.click();return;}
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));link.href=url;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
if(recorded){report=globalThis.CANCELLATION_DEBT_REPORT;statusKey=report.passed?'recordedSuccess':'recordedFailure';}
translate();
