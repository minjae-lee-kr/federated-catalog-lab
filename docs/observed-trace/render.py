"""Render the pinned historical recording; does not execute the HTTP experiment."""
from pathlib import Path
import argparse
import json
import hashlib

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib import font_manager

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--korean-font', help='Installed Korean font family name; no font download is performed.')
parser.add_argument('--output-dir', type=Path, default=HERE / 'assets', help='Output directory; defaults to the sibling assets directory.')
parser.add_argument('--preview-png', action='store_true', help='Also render PNG previews for visual inspection.')
args = parser.parse_args()
OUTPUT = args.output_dir
raw = (HERE / 'recording' / 'report.json').read_bytes()
raw_hash = hashlib.sha256(raw).hexdigest()
EXPECTED_HASH = '421617b5c8e27bb1446a864e909dfc3f0a3de6e223f914d323aa07502893aa50'
if raw_hash != EXPECTED_HASH:
    raise ValueError('Recording hash mismatch; refusing to relabel another run as the frozen trace.')
data = json.loads(raw)
if data['source']['git']['head'] != 'ff47d27ac38071cf7d1c611492b55f657d8d0a27' or data['source']['git']['dirty'] or not data['sourceUnchanged']:
    raise ValueError('Recording is not the expected clean historical revision.')
cases = {}
for case in data['cases']:
    origin = next(event['elapsedMs'] for event in case['final']['events'] if event['kind'] == 'admitted')
    cases[case['mode']] = {'events': [{**event, 'plotMs': round(event['elapsedMs'] - origin, 2)} for event in case['final']['events']]}

families = [args.korean_font] if args.korean_font else ['Malgun Gothic', 'Noto Sans CJK KR', 'Apple SD Gothic Neo', 'Noto Sans KR']
ko_font = None
for family in families:
    try:
        font_manager.findfont(font_manager.FontProperties(family=family), fallback_to_default=False)
        ko_font = family
        break
    except ValueError:
        pass
if ko_font is None:
    raise SystemExit('Install a Korean font or pass --korean-font with an installed family name. No figures were written.')
OUTPUT.mkdir(parents=True, exist_ok=True)

COPY = {
    'en': {
        'font': 'DejaVu Sans',
        'eyebrow': 'CANCELLATION DEBT  /  OBSERVED LOCAL TRACE',
        'title': 'The counter stayed within the limit.\nThe work did not.',
        'subtitle': 'Four sequential read attempts · Real HTTP · Synthetic inventory work',
        'panels': ['Release on caller departure — deliberately incorrect', 'Hold until underlying work settles — cancellation ignored'],
        'actual': 'Unfinished jobs', 'permits': 'Held permits', 'capacity': 'Capacity: 2',
        'caller': 'Caller completed', 'rejected': 'Admission rejected',
        'ylabel': 'Count', 'xlabel': 'Observed elapsed time since each case’s first admission (ms)',
        'wrong': '4 unfinished jobs / 1 permit\nat 559.24 ms',
        'correct': 'Work remains bounded at 2.\nTwo later attempts are rejected.',
        'takeaway': 'Keep the permit until the underlying operation settles.',
        'foot1': 'Steps use recorded events; cases aligned independently at first admission. No smoothing.',
        'foot2': 'Fixture: 160 ms per-subgraph fetch timeout; 1,000 ms uncancelled timer; capacity 2. Not a benchmark.',
        'foot3': 'Capture: 2026-10-16 16:48:24 UTC · clean ff47d27 · source d9fc503697e9…',
    },
    'ko': {
        'font': ko_font,
        'eyebrow': 'CANCELLATION DEBT  /  실제 로컬 실행 기록',
        'title': '슬롯 수는 한도 안에,\n실제 작업은 한도 밖에.',
        'subtitle': '같은 조회를 순차적으로 네 번 시도 · 실제 HTTP · 타이머로 모사한 재고 작업',
        'panels': ['호출자가 떠나면 슬롯 반환 — 의도적으로 잘못된 대조군', '실제 작업 종료까지 슬롯 유지 — 작업은 취소를 무시'],
        'actual': '미완료 작업', 'permits': '점유한 실행 슬롯', 'capacity': '한도: 2',
        'caller': '호출자 완료', 'rejected': '진입 거절',
        'ylabel': '개수', 'xlabel': '각 조건의 첫 작업 진입부터 실제 기록된 시간 (ms)',
        'wrong': '미완료 작업 4개 / 슬롯 1개\n559.24ms 시점',
        'correct': '실제 작업은 최대 2개.\n뒤의 두 시도는 거절된다.',
        'takeaway': '실행 슬롯은 실제 작업이 종료될 때 반환해야 한다.',
        'foot1': '기록된 이벤트를 계단선으로 표시. 각 조건의 첫 진입을 0ms로 정렬. 보간·평활화 없음.',
        'foot2': '설정: 서브그래프 fetch별 160ms / 취소되지 않은 타이머 1,000ms / 한도 2. 성능 벤치마크 아님.',
        'foot3': '기록: 2026-10-16 16:48:24 UTC · 변경 없는 ff47d27 · 소스 d9fc503697e9…',
    },
}

INK = '#14263B'
BLUE = '#006DB4'
AMBER = '#9C5500'
GRID = '#DDE5ED'
MUTED = '#475B6E'
RED = '#B13B4B'
BG = '#FAFCFF'

for lang, copy in COPY.items():
    with plt.rc_context({'font.family': copy['font'], 'font.size': 11, 'svg.fonttype': 'path', 'svg.hashsalt': EXPECTED_HASH, 'axes.unicode_minus': False}):
        fig = plt.figure(figsize=(12.8, 10.2), dpi=160, facecolor=BG)
        fig.text(.085, .958, copy['eyebrow'], color=MUTED, fontsize=10, weight='bold')
        fig.text(.085, .916, copy['title'], color=INK, fontsize=27, weight='bold', va='top', linespacing=1.25)
        fig.text(.085, .798, copy['subtitle'], color=MUTED, fontsize=11.5)
        axes = [fig.add_axes([.085, .497, .85, .205]), fig.add_axes([.085, .202, .85, .205])]
        for index, (ax, mode) in enumerate(zip(axes, ['early-release', 'admission-only'])):
            case = cases[mode]
            events = case['events']
            times = [event['plotMs'] for event in events]
            assert all(a <= b for a, b in zip(times, times[1:]))
            active = [event['active'] for event in events]
            permits = [event['permits'] for event in events]
            ax.set_facecolor(BG)
            ax.axhline(2, color=MUTED, linestyle=(0, (2, 4)), lw=1.2, zorder=1)
            ax.fill_between(times, active, permits, step='post', color=BLUE, alpha=.07, zorder=1)
            ax.step(times, active, where='post', color=BLUE, lw=3, zorder=3)
            ax.step(times, permits, where='post', color=AMBER, lw=2.3, linestyle=(0, (5, 3)), zorder=4)
            # The two held-permit/work curves deliberately overlap in the correct control.
            callers = [event['plotMs'] for event in events if event['kind'] == 'caller-completed']
            ax.scatter(callers, [-.23] * len(callers), marker='|', s=90, color=MUTED, linewidths=1.5, zorder=5)
            rejected = [event for event in events if event['kind'] == 'rejected']
            if rejected:
                ax.scatter([e['plotMs'] for e in rejected], [e['active'] for e in rejected], marker='x', s=70, linewidths=2, color=RED, zorder=6)
            ax.set_xlim(0, 1650)
            ax.set_ylim(-.4, 4.6)
            ax.set_yticks(range(5))
            ax.set_xticks(range(0, 1601, 200))
            ax.tick_params(axis='both', colors=MUTED, labelsize=10, length=0, pad=8)
            ax.set_ylabel(copy['ylabel'], fontsize=10, color=MUTED)
            ax.grid(axis='y', color=GRID, lw=.7, zorder=0)
            ax.set_title(f'{index + 1:02d}  {copy["panels"][index]}', loc='left', pad=16, fontsize=13, weight='bold', color=INK)
            for spine in ['top', 'right', 'left']:
                ax.spines[spine].set_visible(False)
            ax.spines['bottom'].set_color(GRID)
            if index == 0:
                event = next(e for e in events if e['kind'] == 'admitted' and e['active'] == 4)
                ax.scatter([event['plotMs']], [event['active']], s=36, color=BLUE, zorder=6)
                ax.annotate(copy['wrong'], xy=(event['plotMs'], 4), xytext=(45, 3.25),
                    color=INK, fontsize=11, linespacing=1.4,
                    arrowprops={'arrowstyle': '-', 'color': MUTED, 'lw': 1.1},
                    bbox={'facecolor': BG, 'edgecolor': 'none', 'pad': 3}, zorder=7)
            else:
                ax.text(780, 3.2, copy['correct'], color=INK, fontsize=11, linespacing=1.4)
                ax.set_xlabel(copy['xlabel'], color=MUTED, fontsize=10, labelpad=12)
        handles = [Line2D([0], [0], color=BLUE, lw=3, label=copy['actual']),
                   Line2D([0], [0], color=AMBER, lw=2.3, linestyle=(0, (5, 3)), label=copy['permits']),
                   Line2D([0], [0], color=MUTED, lw=1.2, linestyle=(0, (2, 4)), label=copy['capacity']),
                   Line2D([0], [0], color=MUTED, marker='|', linestyle='none', markersize=10, label=copy['caller']),
                   Line2D([0], [0], color=RED, marker='x', linestyle='none', markersize=7, label=copy['rejected'])]
        fig.legend(handles=handles, loc='upper left', bbox_to_anchor=(.078, .777), ncol=5, frameon=False,
                   fontsize=9.7, handlelength=2.5, columnspacing=1.6, labelcolor=MUTED)
        fig.text(.085, .102, copy['takeaway'], fontsize=14, color=INK, weight='bold')
        for y, key in [(.068, 'foot1'), (.048, 'foot2'), (.028, 'foot3')]:
            fig.text(.085, y, copy[key], fontsize=8.5, color=MUTED)
        if args.preview_png:
            fig.savefig(OUTPUT / f'cancellation-trace-{lang}.png', dpi=160, facecolor=BG)
        svg = OUTPUT / f'cancellation-trace-{lang}.svg'
        fig.savefig(svg, facecolor=BG,
                    metadata={'Title': copy['title'].replace('\n', ' '), 'Description': 'Frozen ff47d27 observed events; synthetic work, real HTTP; not a benchmark.', 'Date': data['generatedAt']})
        # Keep generated XML portable in Git without changing path coordinates.
        svg.write_bytes(('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines()) + '\n').encode('utf-8'))
        plt.close(fig)
print(json.dumps({'figures': ['cancellation-trace-en.svg', 'cancellation-trace-ko.svg'], 'recordingSha256': raw_hash, 'koreanFont': ko_font, 'matplotlib': matplotlib.__version__}))
