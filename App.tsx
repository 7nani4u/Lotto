import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeLotto,
  analyzeRepeatProbability,
  calculateBallColor,
  fetchLottoData,
  generateQuantumFlux,
  buildFilteredPoolAsync,
  buildFullAnalysisTable,
  buildFlowSignals,
  buildFusedTable,
  computeStability,
  secondOpinion645,
  buildLongAbsentDetails,
  classifyRecentlyBack,
  classifySegmentTrend,
  FLOW_WEIGHT_DEFAULT,
  LottoStats,
  RepeatAnalysis,
  FullIndicatorAnalysis,
  FusedRow,
  CombinationPool,
} from './services/lottoService';
import { LottoResult, PredictionResult, PredictionSource } from './types';
import { Ball } from './components/Ball';
import { TopPicksPanel } from './components/TopPicksPanel';
import { FlowPanel } from './components/FlowPanel';
import { RecentDrawStrip, RecentDrawsSummary } from './components/RecentDrawStrip';
import { DrawReport } from './components/DrawReport';
import { buildHistoryProfile } from './services/drawReport';
import { FILTER_SPACE_PASS, summarizeDraw } from './services/drawMeta';
import { buildEvidenceReport, EvidenceReport } from './services/evidence';

const GENERATED_HISTORY_KEY = 'lottoQuantumGeneratedHistoryV1';
const MAX_FIXED_NUMBERS = 5;

// 조합이 만들어진 경로 (서비스가 실제로 사용한 경로를 그대로 표시 — 고정 '신뢰도' 숫자는 삭제)
const SOURCE_LABEL: Record<PredictionSource, string> = {
  pool: '필터 통과 풀 상위 5% 중 무작위',
  list: '조합 목록 상위 5% 중 무작위',
  direct: '가중 무작위 생성 후 필터 검사',
  relaxed: '가중 무작위 (Whitson 조건 완화)',
  fallback: '필터 실패 → 순수 무작위 대체',
};

const App: React.FC = () => {
  const [allData, setAllData] = useState<LottoResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentSyncRound, setCurrentSyncRound] = useState(0);
  const [stats, setStats] = useState<LottoStats | null>(null);
  const [quantumPredictions, setQuantumPredictions] = useState<PredictionResult[]>([]);
  const [combinationCount, setCombinationCount] = useState(5);
  const [selectedAnalysisNum, setSelectedAnalysisNum] = useState<number | null>(null);
  const [repeatAnalysis, setRepeatAnalysis] = useState<RepeatAnalysis | null>(null);
  // 필터 통과 조합 풀 (로컬 전수 열거). 준비되기 전에는 null → 경로 B(직접 생성)로 동작
  const [combinationPool, setCombinationPool] = useState<CombinationPool | null>(null);
  const [poolReady, setPoolReady] = useState(false);   // 풀 생성이 끝났는가(성공·실패 모두) — 끝나기 전에는 '엔진 준비 중'
  const [isGeneratingQuantum, setIsGeneratingQuantum] = useState(false);
  const analysisReportRef = useRef<HTMLDivElement>(null);
  const [expandedDrawRound, setExpandedDrawRound] = useState<number | null>(null);
  const generatedHistoryRef = useRef<Set<string>>(new Set());
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [freqPage, setFreqPage] = useState(0);
  const [fixedNumbers, setFixedNumbers] = useState<number[]>([]);
  const [fixedInput, setFixedInput] = useState('');
  const [indicatorTable, setIndicatorTable] = useState<FullIndicatorAnalysis[]>([]);
  const [evidence, setEvidence] = useState<EvidenceReport | null>(null);
  const [evidenceProgress, setEvidenceProgress] = useState(0);

  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem(GENERATED_HISTORY_KEY);
      if (savedHistory) {
        const parsed = JSON.parse(savedHistory) as string[];
        generatedHistoryRef.current = new Set(parsed);
      }
    } catch (e) {
      console.error('조합 기록 로드 오류:', e);
      generatedHistoryRef.current = new Set();
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setProgress(0);

      // 필터 통과 조합 풀을 로컬에서 비동기 생성 (네트워크 파일 불필요, 약 1초, UI 양보하며 진행)
      buildFilteredPoolAsync()
        .then(pool => setCombinationPool(pool))
        .catch(error => console.error('조합 풀 생성 오류:', error))
        .finally(() => setPoolReady(true));

      const data = await fetchLottoData((nextProgress, round) => {
        setProgress(nextProgress);
        setCurrentSyncRound(round);
      });

      setAllData(data);
      setStats(analyzeLotto(data));
      setIndicatorTable(buildFullAnalysisTable(data));
      setLoading(false);
    };

    void loadData();
  }, []);

  // reportOpen 이 true 로 바뀐 뒤 React 가 DOM 을 commit 한 다음 스크롤.
  // setTimeout(0) 은 브라우저 paint 한 프레임 뒤 실행을 보장해 ref 가 항상 유효.
  useEffect(() => {
    // 이제 인라인으로 표시되므로 별도의 스크롤 효과는 필요하지 않습니다.
  }, [expandedDrawRound]);

  const chartData = useMemo(() => {
    if (!stats) return [];

    const sorted = Object.entries(stats.frequencies as Record<string, number>)
      .map(([num, count]) => ({ num: Number(num), count: count as number }))
      .sort((a, b) => b.count - a.count);

    const maxCount = sorted[0]?.count ?? 1;

    return sorted.map((item) => ({
      ...item,
      percentage: (item.count / maxCount) * 100,
    }));
  }, [stats]);

  const saveGeneratedHistory = (history: Set<string>) => {
    try {
      localStorage.setItem(GENERATED_HISTORY_KEY, JSON.stringify(Array.from(history)));
    } catch (e) {
      console.error('조합 기록 저장 오류:', e);
    }
  };

  const generateUniquePredictionSet = (generator: () => PredictionResult, count: number) => {
    const unique = new Map<string, PredictionResult>();
    let attempts = 0;
    const maxAttempts = Math.max(300, count * 300);

    while (unique.size < count && attempts < maxAttempts) {
      const result = generator();
      const key = result.numbers.join('-');

      if (generatedHistoryRef.current.has(key) || unique.has(key)) {
        attempts++;
        continue;
      }

      unique.set(key, result);
      attempts++;
    }

    const nextPredictions = Array.from(unique.values());

    if (nextPredictions.length > 0) {
      const nextHistory = new Set<string>(generatedHistoryRef.current);
      nextPredictions.forEach((prediction) => nextHistory.add(prediction.numbers.join('-')));
      generatedHistoryRef.current = nextHistory;
      saveGeneratedHistory(nextHistory);
    }

    return nextPredictions;
  };

  // ── 번호 흐름 분석: 추세·갭·구간·대기 + 연결강도·융합 (allData 변경 시 재계산)
  // 정의 단일화: 추세/갭/복귀/구간 판정은 services/lottoService.ts §4.7
  // (Python lotto_technical_indicators.py와 동일 임계값). 기존 인라인 계산은
  // 임계값이 달라 같은 데이터에 다른 라벨을 붙였음.
  const flowSignals = useMemo(() => buildFlowSignals(allData), [allData]);

  const flowAnalysis = useMemo(() => {
    if (!flowSignals || allData.length < 10) return null;
    const draws = allData; // index 0 = 가장 최근
    const { trends, gapInfo, connectionScores, flowScores } = flowSignals;

    // 구간별 흐름 (5구간, 최근5 vs 이전5) — 7개 번호 집계 + 비율 규칙 통일
    const segs = [
      { label: '1~10',  lo: 1,  hi: 10 },
      { label: '11~20', lo: 11, hi: 20 },
      { label: '21~30', lo: 21, hi: 30 },
      { label: '31~40', lo: 31, hi: 40 },
      { label: '41~45', lo: 41, hi: 45 },
    ];
    const segmentFlow = segs.map(seg => {
      const cnt = (set: LottoResult[]) =>
        set.reduce((acc, d) => acc + [...d.numbers, d.bonus].filter(n => n >= seg.lo && n <= seg.hi).length, 0);
      const r5 = cnt(draws.slice(0, 5));
      const p5 = cnt(draws.slice(5, 10));
      const exp5 = (5 * 7 * (seg.hi - seg.lo + 1)) / 45;
      return {
        label: seg.label, lo: seg.lo, hi: seg.hi,
        recent5: r5, prev5: p5,
        trend: classifySegmentTrend(r5 / exp5, p5 / exp5),
      };
    });

    // 최근 복귀 번호 (최근 3회 내 출현 + 그 이전 5회 이상 공백 — Python과 동일 정의)
    const recentlyBack = classifyRecentlyBack(allData);

    return { trends, gapInfo, segmentFlow, recentlyBack, connectionScores, flowScores };
  }, [flowSignals, allData]);

  // ── 융합 랭킹 + 안정도 (🏆/📋/🔗 표식의 단일 근거)
  // fused = (1−w)×종합 + w×흐름, w=0.25. 안정도 = 80% 서브샘플 융합 상위 진입율.
  const stabilityMap = useMemo(
    () => computeStability(allData, 40, FLOW_WEIGHT_DEFAULT),
    [allData],
  );
  const fusedTable: FusedRow[] = useMemo(
    () => (indicatorTable.length > 0
      ? buildFusedTable(indicatorTable, flowSignals, FLOW_WEIGHT_DEFAULT, stabilityMap, allData[0]?.round ?? 0)
      : []),
    [indicatorTable, flowSignals, stabilityMap],
  );

  // ── 세컨드 오피니언: 독립 스택 Top6 (렌더마다 재계산하지 않도록 메모)
  const secondOpinion = useMemo(
    () => (indicatorTable.length > 0 ? secondOpinion645(allData, indicatorTable, flowSignals, FLOW_WEIGHT_DEFAULT) : null),
    [allData, indicatorTable, flowSignals],
  );

  // ── 워크포워드 검증(백테스트): 화면 점수가 과거에 무작위보다 나았는지 — 비동기·UI 양보
  useEffect(() => {
    if (allData.length < 360) return;
    let cancelled = false;
    setEvidence(null);
    setEvidenceProgress(0);
    buildEvidenceReport(allData, {
      minTrain: 300,                       // 학습 최소 300회 이후 가능한 모든 시점을 검증 (창 크기에 따라 결론이 달라지는 일 방지)
      isCancelled: () => cancelled,
      onProgress: ratio => { if (!cancelled) setEvidenceProgress(ratio); },
    })
      .then(report => { if (!cancelled) setEvidence(report); })
      .catch(error => console.error('검증 계산 오류:', error));
    return () => { cancelled = true; };
  }, [allData]);

  // ── 최근 10회 구조 요약 (합·홀짝·연번·AC·필터·이월) + 회고 적중
  const drawMetas = useMemo(
    () => allData.slice(0, 10).map((draw, i) => summarizeDraw(draw, allData[i + 1])),
    [allData],
  );
  // 회차 리포트의 "역대 실측" 기준 (전체 회차를 한 번만 집계)
  const historyProfile = useMemo(
    () => (allData.length > 0 ? buildHistoryProfile(allData) : null),
    [allData],
  );
  const retroByRound = useMemo(
    () => new Map((evidence?.recent ?? []).map(r => [r.round, r] as const)),
    [evidence],
  );

  // ── 장기 대기 심층 (⏳ 섹션 근거: 미출 기간·평균·조건부 재출현율)
  const absenceReport = useMemo(
    () => buildLongAbsentDetails(allData, 10, 10),
    [allData],
  );

  const handleGenerateQuantum = async () => {
    if (allData.length === 0 || isGeneratingQuantum) return;

    setIsGeneratingQuantum(true);
    setGenerationStatus('추출하는 중...');
    setCopySuccess(false);

    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0);
    });

    const nextPredictions = generateUniquePredictionSet(
      () => generateQuantumFlux(allData, combinationPool ?? [], undefined, fixedNumbers),
      combinationCount
    );

    setQuantumPredictions(nextPredictions);

    if (nextPredictions.length === 0) {
      setGenerationStatus('이전에 한 번이라도 출력된 조합을 제외한 새 조합을 찾지 못했습니다.');
      setIsGeneratingQuantum(false);
      return;
    }

    if (nextPredictions.length < combinationCount) {
      setGenerationStatus(`중복 없는 새 조합 ${nextPredictions.length}개만 생성했습니다.`);
      setIsGeneratingQuantum(false);
      return;
    }

    setGenerationStatus(null);
    setIsGeneratingQuantum(false);
  };

  // -------------------------------------------------------
  // "최근 당첨 번호" 섹션의 행 클릭 시 호출.
  // 선택한 회차 데이터를 기반으로 동적 리포트 생성 및 인라인 출력 (토글).
  // -------------------------------------------------------
  const handleDrawBallClick = (draw: LottoResult) => {
    // 아코디언 동작: 동일 회차를 클릭하면 닫고, 다른 회차를 클릭하면 기존 리포트를 닫고 새 리포트를 엽니다.
    setExpandedDrawRound((prev) => prev === draw.round ? null : draw.round);
  };

  const handleBallClick = (num: number) => {
    setSelectedAnalysisNum(num);
    setRepeatAnalysis(analyzeRepeatProbability(allData, num, 100));
    setTimeout(() => {
      analysisReportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const handleCopyPredictions = async () => {
    if (quantumPredictions.length === 0) return;
    
    // 두 자리 숫자로 포맷팅 (예: 5 -> "05")
    const padNum = (n: number) => n.toString().padStart(2, '0');
    
    // 각 조합을 공백으로 구분된 문자열로 만들고, 줄바꿈으로 연결
    const textToCopy = quantumPredictions
      .map(p => p.numbers.map(padNum).join(' '))
      .join('\n');
      
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000); // 2초 후 성공 메시지 원래대로
    } catch (err) {
      console.error('클립보드 복사 실패:', err);
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = textToCopy;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch (e) {
        console.error('Fallback 복사 실패:', e);
      }
      document.body.removeChild(textArea);
    }
  };

  const handleAddFixedNumber = () => {
    const n = parseInt(fixedInput, 10);
    const canAdd =
      !Number.isNaN(n) &&
      n >= 1 &&
      n <= 45 &&
      !fixedNumbers.includes(n) &&
      fixedNumbers.length < MAX_FIXED_NUMBERS;

    if (canAdd) {
      setFixedNumbers((prev) => [...prev, n].sort((a, b) => a - b));
    }

    setFixedInput('');
  };

  const handleRemoveFixedNumber = (num: number) => {
    setFixedNumbers((prev) => prev.filter((value) => value !== num));
  };

  const fixedNumbersRemaining = MAX_FIXED_NUMBERS - fixedNumbers.length;
  const fixedNumberLimitReached = fixedNumbersRemaining === 0;
  const hasPredictionResults = quantumPredictions.length > 0;
  const isEngineBusy = !poolReady;
  const isGenerateDisabled = isEngineBusy || isGeneratingQuantum;
  const normalizedFixedInput = fixedInput.trim();
  const canSubmitFixedNumber = normalizedFixedInput !== '' && !fixedNumberLimitReached;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center space-y-4">
        <div className="text-2xl animate-pulse font-bold text-blue-400">동행복권 당첨 이력 동기화 중...</div>
        <div className="text-lg text-gray-400">
          {progress < 100 ? `현재 ${currentSyncRound}회차 수집 중 (${progress}%)` : '분석 중...'}
        </div>
        <div className="w-64 h-3 bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
        </div>
        <div className="text-sm text-gray-500 mt-2 text-center px-4">
          262회차부터 최신 회차까지 누락된 데이터를 가져오고 있습니다.
          <br />
          (데이터는 로컬에 캐시되어 다음부터는 빠르게 로드됩니다)
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 break-keep break-words">
            한국 로또 6/45 AI 마스터
          </h1>
          <p className="text-gray-400 text-sm sm:text-base md:text-lg break-keep break-words">인공지능과 통계 기반의 번호 예측 시스템</p>
        </div>

        <div className="bg-gray-800 rounded-2xl p-6 md:p-8 shadow-2xl border border-purple-900/50">
          <div className="flex flex-col gap-8">
            <div className="text-center md:text-left">
              <div className="inline-flex items-center gap-2 rounded-full border border-purple-700/40 bg-purple-950/40 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-purple-200">
                <span>추천 엔진</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>{isEngineBusy ? '준비 중' : '사용 가능'}</span>
              </div>
              <div className="mt-4">
                <div>
                  <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white break-keep break-words">
                    AI 로또 조합 추출
                  </h2>
                  <p className="mt-3 max-w-3xl text-sm sm:text-base leading-6 text-gray-300 break-keep break-words">
                    원하는 조합 수와 고정 번호를 설정한 뒤 최적의 로또 번호 조합을 추출해 보세요.
                  </p>
                </div>
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-gray-700 bg-gray-900/70 px-4 py-4 text-left">
                    <div className="text-xs font-semibold text-gray-500">추천 조합</div>
                    <div className="mt-2 text-2xl font-black text-white">{combinationCount}개</div>
                    <div className="mt-1 text-xs text-gray-500">한 번에 생성할 조합 수</div>
                  </div>
                  <div className="rounded-2xl border border-gray-700 bg-gray-900/70 px-4 py-4 text-left">
                    <div className="text-xs font-semibold text-gray-500">고정 번호</div>
                    <div className="mt-2 text-2xl font-black text-purple-300">{fixedNumbers.length}개</div>
                    <div className="mt-1 text-xs text-gray-500">선택한 번호 개수</div>
                  </div>
                  <div className="rounded-2xl border border-gray-700 bg-gray-900/70 px-4 py-4 text-left">
                    <div className="text-xs font-semibold text-gray-500">복사 가능</div>
                    <div className="mt-2 text-2xl font-black text-emerald-300">{hasPredictionResults ? '예' : '대기'}</div>
                    <div className="mt-1 text-xs text-gray-500">추천 결과 생성 후 활성화</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
              <div className="rounded-2xl border border-gray-700 bg-gray-900/70 p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-bold text-white">1. 추천 개수 선택</div>
                    <div className="mt-1 text-sm leading-6 text-gray-400">한 번에 받을 조합 수를 정합니다.</div>
                  </div>
                  <div className="shrink-0 whitespace-nowrap rounded-full bg-blue-950/60 px-2.5 py-1 text-[11px] font-bold text-blue-300">
                    1~20개
                  </div>
                </div>
                <div className="mt-4">
                  <label className="mb-2 block text-xs font-bold text-gray-400">추천 조합 수</label>
                  <select
                    value={combinationCount}
                    onChange={(e) => setCombinationCount(Number(e.target.value))}
                    className="w-full rounded-xl border border-gray-600 bg-gray-800 px-4 py-3.5 text-base font-semibold text-white outline-none transition-colors focus:border-blue-500"
                  >
                    {Array.from({ length: 20 }, (_, i) => i + 1).map((count) => (
                      <option key={count} value={count}>{count}개</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-2xl border border-purple-900/40 bg-gray-900/70 p-5 sm:p-6">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-base font-bold text-white">2. 고정 번호 설정</div>
                      <div className="mt-1 text-sm leading-6 text-gray-400">
                        꼭 넣고 싶은 번호가 있으면 추가하세요. 최대 {MAX_FIXED_NUMBERS}개까지 설정할 수 있습니다.
                      </div>
                    </div>
                    <div className={`self-start whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${fixedNumberLimitReached ? 'bg-amber-950/70 text-amber-300' : 'bg-purple-950/60 text-purple-300'}`}>
                      {fixedNumberLimitReached ? '입력 완료' : `${fixedNumbersRemaining}개 더 추가 가능`}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <input
                      type="number"
                      min={1}
                      max={45}
                      value={fixedInput}
                      onChange={(e) => setFixedInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddFixedNumber(); }}
                      placeholder="번호 입력 (1~45)"
                      disabled={fixedNumberLimitReached}
                      className="w-full rounded-xl border border-gray-600 bg-gray-800 px-4 py-3.5 text-center text-base font-semibold text-white outline-none transition-colors focus:border-purple-500 disabled:cursor-not-allowed disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      onClick={handleAddFixedNumber}
                      disabled={!canSubmitFixedNumber}
                      className="rounded-xl bg-purple-600 px-4 py-3.5 text-sm font-bold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40 md:min-w-[110px]"
                    >
                      번호 추가
                    </button>
                    <button
                      onClick={() => setFixedNumbers([])}
                      disabled={fixedNumbers.length === 0}
                      className="rounded-xl border border-gray-600 bg-gray-800 px-4 py-3.5 text-sm font-bold text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 md:min-w-[110px]"
                    >
                      전체 지우기
                    </button>
                  </div>

                  <div className="rounded-xl border border-dashed border-gray-700 bg-gray-950/40 px-4 py-4">
                    <div className="mb-2 text-xs font-bold text-gray-500">선택한 고정 번호</div>
                    <div className="flex min-h-[44px] flex-wrap items-center gap-2">
                      {fixedNumbers.length === 0 ? (
                        <span className="text-xs text-gray-500">아직 선택한 번호가 없습니다.</span>
                      ) : (
                        fixedNumbers.map((n) => {
                          const chipCls = n <= 10 ? 'bg-yellow-600' : n <= 20 ? 'bg-blue-600' : n <= 30 ? 'bg-red-600' : n <= 40 ? 'bg-gray-500' : 'bg-green-600';
                          return (
                            <span key={n} className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black text-white ${chipCls}`}>
                              {n}
                              <button
                                onClick={() => handleRemoveFixedNumber(n)}
                                className="leading-none text-white/75 transition-colors hover:text-white"
                                aria-label={`${n}번 고정 번호 제거`}
                              >
                                ×
                              </button>
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {hasPredictionResults && !isGeneratingQuantum && (
                    <div className="flex justify-end">
                      <button
                        onClick={() => { void handleCopyPredictions(); }}
                        className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-300 ${
                          copySuccess
                            ? 'bg-green-600 text-white'
                            : 'border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'
                        }`}
                      >
                        <span>{copySuccess ? '완료' : '복사'}</span>
                        <span>{copySuccess ? '저장됨' : '결과 복사'}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-indigo-900/40 bg-gradient-to-r from-purple-950/40 to-indigo-950/40 p-5 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-base font-bold text-white">3. 추천 실행</div>
                  <div className="mt-1 text-sm text-gray-300 break-keep break-words">
                    선택한 조건을 기준으로 중복 이력을 피한 새 조합을 생성합니다.
                  </div>
                </div>
                <button
                  onClick={() => { void handleGenerateQuantum(); }}
                  disabled={isGenerateDisabled}
                  className={`w-full md:w-auto px-6 sm:px-8 py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-lg sm:text-xl shadow-[0_0_20px_rgba(147,51,234,0.35)] transition-all transform active:scale-95 flex items-center justify-center gap-2 break-keep break-words ${
                    isGenerateDisabled ? 'cursor-not-allowed opacity-60' : 'hover:scale-[1.02] hover:from-purple-500 hover:to-indigo-500'
                  }`}
                >
                  {isEngineBusy ? (
                    <><span className="animate-spin">⚙️</span> <span className="whitespace-nowrap">엔진 준비 중</span></>
                  ) : isGeneratingQuantum ? (
                    <><span className="animate-spin">🎲</span> <span className="whitespace-nowrap">조합 생성 중</span></>
                  ) : (
                    <><span>추천 받기</span></>
                  )}
                </button>
              </div>
            </div>
          </div>

          {generationStatus && !isGeneratingQuantum && (
            <div className="mt-6 rounded-xl border border-amber-700/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
              {generationStatus}
            </div>
          )}

          {quantumPredictions.length > 0 && (
            <div className="mt-6 rounded-xl border border-indigo-800/50 bg-indigo-950/30 px-4 py-3 text-xs sm:text-sm leading-relaxed text-indigo-100 break-keep">
              <b className="text-white">모든 조합의 1등 당첨 확률은 1/8,145,060으로 같습니다.</b>{' '}
              필터 5종을 통과하는 조합은 전체의 {(FILTER_SPACE_PASS * 100).toFixed(1)}%이며, 필터와 점수는 후보를 고르는 방식일 뿐 당첨 확률을 높이지 않습니다.
            </div>
          )}

          {quantumPredictions.length > 0 && (
            <div className="mt-4 grid w-full grid-cols-1 gap-4 animate-fade-in xl:grid-cols-2">
              {quantumPredictions.map((prediction, index) => {
                const fixedInCombo = fixedNumbers.filter(n => prediction.numbers.includes(n));
                return (
                  <div key={prediction.numbers.join('-')} className="bg-gray-900/80 rounded-2xl p-4 sm:p-6 border border-purple-900/50 shadow-inner">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="text-sm font-bold text-purple-300">추천 조합 #{index + 1}</div>
                        <div className="mt-1 text-xs text-gray-500">번호를 클릭하면 개별 분석을 확인할 수 있습니다.</div>
                      </div>
                      {fixedInCombo.length > 0 && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-300 border border-amber-700">
                          고정 {fixedInCombo.join(', ')} 포함
                        </span>
                      )}
                    </div>
                    <div className="flex flex-nowrap justify-center gap-2 sm:gap-3 md:gap-4 mb-6">
                      {prediction.numbers.map((num, i) => (
                        <div key={i} className={fixedNumbers.includes(num) ? 'ring-2 ring-amber-400 rounded-full' : ''}>
                          <Ball num={num} responsive onClick={() => handleBallClick(num)} />
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:gap-4 text-sm text-gray-300 border-t border-gray-700/60 pt-5 sm:pt-6">
                      <div className="bg-gray-800/80 p-3 sm:p-4 rounded-xl border border-gray-700/60 flex flex-col items-center justify-center">
                        <div className="text-gray-400 mb-2 font-medium whitespace-nowrap">총합</div>
                        <div className="text-2xl font-black text-white">{prediction.stats.sum}</div>
                      </div>
                      <div className="bg-gray-800/80 p-3 sm:p-4 rounded-xl border border-gray-700/60 flex flex-col items-center justify-center">
                        <div className="text-gray-400 mb-2 font-medium whitespace-nowrap">필터 5종</div>
                        <div className={`text-2xl font-black whitespace-nowrap ${prediction.passesFilters ? 'text-emerald-300' : 'text-amber-300'}`}>{prediction.passesFilters ? '✓ 통과' : '✗ 미통과'}</div>
                        <div className="mt-1 text-[10px] leading-snug text-gray-500 text-center break-keep">{SOURCE_LABEL[prediction.source]}</div>
                      </div>
                      <div className="bg-gray-800/80 p-3 sm:p-4 rounded-xl border border-gray-700/60 flex flex-col items-center justify-center">
                        <div className="text-gray-400 mb-2 font-medium whitespace-nowrap">홀짝 비율</div>
                        <div className="text-2xl font-black text-blue-300">{prediction.stats.oddEvenRatio}</div>
                      </div>
                      <div className="bg-gray-800/80 p-3 sm:p-4 rounded-xl border border-gray-700/60 flex flex-col items-center justify-center">
                        <div className="text-gray-400 mb-2 font-medium whitespace-nowrap">고저 비율</div>
                        <div className="text-2xl font-black text-purple-300">{prediction.stats.highLowRatio}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ══ [1] 출현가능성 상위 6개 번호 + 검증 배너 + 세컨드 오피니언 + 전체 테이블 ══ */}
        {indicatorTable.length > 0 && fusedTable.length > 0 && (
          <TopPicksPanel
            fused={fusedTable}
            table={indicatorTable}
            trends={flowAnalysis?.trends ?? null}
            gapInfo={flowAnalysis?.gapInfo ?? null}
            secondOpinion={secondOpinion}
            evidence={evidence}
            evidenceProgress={evidenceProgress}
            dataRounds={allData.length}
            latestRound={allData[0]?.round ?? 0}
            onBallClick={handleBallClick}
          />
        )}

        {/* ══ [1.5] 🔗 번호 흐름 분석 ══ */}
        {flowAnalysis && fusedTable.length > 0 && (
          <FlowPanel
            trends={flowAnalysis.trends}
            segmentFlow={flowAnalysis.segmentFlow}
            recentlyBack={flowAnalysis.recentlyBack}
            absence={absenceReport}
            top6={fusedTable.slice(0, 6).map(r => r.number)}
            rounds={allData.length >= 10 ? { from: allData[9].round, to: allData[0].round } : null}
            onBallClick={handleBallClick}
          />
        )}

        {/* ══ [3] 주요 통계 분석 ══ */}
        {/* 출현 빈도 순위 (전체 1~45, 15개씩 3페이지) */}
        <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border border-blue-900/40 mt-8">
          <div className="flex flex-col sm:flex-row items-center justify-between border-b border-gray-700/60 pb-4 mb-6 gap-3">
            <h2 className="text-lg font-bold text-blue-300 flex items-center gap-2"><span>📊</span> 출현 빈도 순위 <span className="text-gray-500 font-normal text-xs">— 262회차부터 전체 1~45번</span></h2>
            {/* 페이지 이동 버튼 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFreqPage(p => Math.max(0, p - 1))}
                disabled={freqPage === 0}
                className="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 text-sm font-bold disabled:opacity-30 hover:bg-gray-600 transition-colors"
              >◀</button>
              <span className="text-sm text-gray-400 min-w-[56px] text-center">{freqPage + 1} / 3 페이지</span>
              <button
                onClick={() => setFreqPage(p => Math.min(2, p + 1))}
                disabled={freqPage === 2}
                className="px-3 py-1.5 rounded-lg bg-gray-700 text-gray-300 text-sm font-bold disabled:opacity-30 hover:bg-gray-600 transition-colors"
              >▶</button>
            </div>
          </div>

          {/* 15개 카드 그리드 */}
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {chartData.slice(freqPage * 15, freqPage * 15 + 15).map((item) => {
              const rank = chartData.findIndex(d => d.num === item.num); // 0-indexed global rank
              return (
                <div
                  key={item.num}
                  className="flex flex-col items-center bg-gray-900 rounded-xl p-3 border border-gray-700 hover:border-blue-500 transition-colors cursor-pointer"
                  onClick={() => handleBallClick(item.num)}
                >
                  <span className={`text-[11px] font-bold mb-1 ${rank < 3 ? 'text-yellow-400' : rank < 5 ? 'text-gray-300' : rank < 15 ? 'text-blue-400' : 'text-gray-500'}`}>
                    {rank + 1}위
                  </span>
                  <Ball num={item.num} small />
                  <span className="text-xs text-gray-400 mt-1">{item.count}회</span>
                  <div className="w-full h-1 bg-gray-800 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${rank < 5 ? 'bg-blue-500' : rank < 15 ? 'bg-blue-700' : 'bg-gray-600'}`}
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 페이지 탭 */}
          <div className="flex justify-center gap-1.5 sm:gap-2 mt-5">
            {[0, 1, 2].map(p => (
              <button
                key={p}
                onClick={() => setFreqPage(p)}
                className={`px-2 sm:px-4 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-colors whitespace-nowrap flex-1 sm:flex-none max-w-[100px] sm:max-w-none ${freqPage === p ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
              >
                {p * 15 + 1}위 ~ {p * 15 + 15}위
              </button>
            ))}
          </div>
        </div>

        {/* ══ [4] 보조 분석 — 최근 당첨 번호 ══ */}
        <div className="ko-flow bg-gray-800 rounded-2xl p-4 sm:p-6 md:p-8 shadow-xl border border-blue-900/40 mt-8">
          <div className="flex flex-col md:flex-row items-center justify-between border-b border-gray-700/60 pb-4 mb-6">
            <h2 className="text-lg font-bold text-blue-300 flex items-center gap-2"><span>📅</span> 보조 분석 — 최근 당첨 번호</h2>
            <div className="text-xs sm:text-sm text-gray-400 bg-gray-700/40 px-3 py-2 rounded-xl mt-3 md:mt-0 flex flex-col sm:flex-row items-center gap-1 sm:gap-3 text-center break-keep break-words">
              <span className="text-yellow-400">💡 번호 클릭 → 정밀 분석</span>
              <span className="hidden sm:block text-gray-600">|</span>
              <span className="text-green-400">📋 번호 외 영역 클릭 → 회차 리포트</span>
            </div>
          </div>
          <RecentDrawsSummary draws={allData.slice(0, 10)} metas={drawMetas} retro={evidence?.recent ?? null} />
          <div className="space-y-4">
            {allData.slice(0, 10).map((draw, idx) => {
              const isExpanded = expandedDrawRound === draw.round;
              
              return (
              <div key={idx} className="flex flex-col gap-2">
                {/* 행 전체 클릭 → 회차 리포트 토글 */}
                <div
                  className={`flex flex-col md:flex-row items-center justify-between bg-gray-900 p-4 sm:p-5 rounded-xl border transition-colors cursor-pointer ${isExpanded ? 'border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.2)]' : 'border-gray-700 hover:border-green-700/60'}`}
                  onClick={() => handleDrawBallClick(draw)}
                >
                  {/* 회차·날짜 영역: 클릭 시 리포트 (부모 onClick 그대로 전파) */}
                  <div className="text-center md:text-left mb-4 md:mb-0 w-32 flex-shrink-0 select-none">
                    <div className="text-xl font-black text-white flex items-center justify-center md:justify-start gap-2">
                      {draw.round}회차
                      <span className="text-xs text-gray-500 md:hidden">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                    <div className="text-sm text-gray-400 mt-1">{draw.date}</div>
                  </div>

                  {/* 번호 영역: 개별 공 클릭은 stopPropagation 후 정밀 분석으로 이동 */}
                  <div className="flex items-center gap-[3px] sm:gap-2 flex-nowrap justify-center mt-2 md:mt-0 px-0 sm:px-2 w-full max-w-full">
                    <div className="flex items-center gap-[3px] sm:gap-2 flex-shrink-0">
                      {draw.numbers.map((num, i) => (
                        <div
                          key={i}
                          onClick={(e) => { e.stopPropagation(); handleBallClick(num); }}
                        >
                          <Ball num={num} responsive />
                        </div>
                      ))}
                    </div>
                    <div className="text-gray-500 text-base sm:text-2xl md:text-3xl mx-[2px] sm:mx-2 font-light flex-shrink-0 select-none">+</div>
                    <div onClick={(e) => { e.stopPropagation(); handleBallClick(draw.bonus); }}>
                      <Ball num={draw.bonus} isBonus responsive />
                    </div>
                  </div>
                  
                  <div className="hidden md:flex items-center justify-center w-8 text-gray-500">
                    {isExpanded ? '▲' : '▼'}
                  </div>
                </div>

                {drawMetas[idx] && <RecentDrawStrip meta={drawMetas[idx]} retro={retroByRound.get(draw.round)} />}

                {/* ── 회차 분석 리포트 (행 바로 아래 인라인 확장) — components/DrawReport.tsx ── */}
                {isExpanded && historyProfile && (
                  <DrawReport
                    results={allData}
                    index={idx}
                    profile={historyProfile}
                    retro={retroByRound.get(draw.round)}
                    evidenceVerdict={evidence?.verdictLabel ?? null}
                    onBallClick={handleBallClick}
                    onClose={() => setExpandedDrawRound(null)}
                  />
                )}
              </div>
            )})}
          </div>
        </div>

        {selectedAnalysisNum && repeatAnalysis && (
          <div ref={analysisReportRef} className="ko-flow bg-gray-800 rounded-2xl p-4 sm:p-6 md:p-8 shadow-xl border border-blue-900/40 mt-8">
            <h2 className="text-xl sm:text-2xl font-bold mb-6 text-blue-300 flex items-center justify-center md:justify-start gap-2 sm:gap-3 border-b border-gray-700/60 pb-4 break-keep break-words">
              <Ball num={selectedAnalysisNum} small />
              <span>
                <span className="block sm:inline">선택 번호</span>{' '}
                <span className="block sm:inline">정밀 분석 리포트</span>
              </span>
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="space-y-4 lg:col-span-1">
                {/* [정정] 이 값은 "262회차부터"가 아니라 최근 windowRounds(100)회차 안의 출현 횟수입니다 — 전체 기간 횟수는 아래 Z-Score 영역에 표시 */}
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700/60 flex justify-between items-center gap-3">
                  <span className="text-gray-400 font-medium">최근 {repeatAnalysis.windowRounds}회차 내 출현<span className="block text-[10px] text-gray-600 font-normal">균등 기대 {(repeatAnalysis.windowRounds * 7 / 45).toFixed(1)}회</span></span>
                  <span className="font-bold text-xl text-white whitespace-nowrap">{repeatAnalysis.totalOccurrences}회</span>
                </div>
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700/60 flex justify-between items-center gap-3">
                  <span className="text-gray-400 font-medium">최근 10회차 내 출현<span className="block text-[10px] text-gray-600 font-normal">균등 기대 {(10 * 7 / 45).toFixed(1)}회</span></span>
                  <span className="font-bold text-xl text-white whitespace-nowrap">{repeatAnalysis.recent10Occurrences}회</span>
                </div>
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700/60 flex justify-between items-center gap-3">
                  <span className="text-gray-400 font-medium">최근 30회차 내 출현<span className="block text-[10px] text-gray-600 font-normal">균등 기대 {(30 * 7 / 45).toFixed(1)}회</span></span>
                  <span className="font-bold text-xl text-white whitespace-nowrap">{repeatAnalysis.recent30Occurrences}회</span>
                </div>
              </div>

              <div className="space-y-4 lg:col-span-1">
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700/60 flex justify-between items-center gap-3">
                  <span className="text-gray-400 font-medium">연속(이월) 출현 횟수<span className="block text-[10px] text-gray-600 font-normal">출현 직전 회차에도 나온 비율 {repeatAnalysis.repeatPercentage.toFixed(1)}% (균등 기대 {(700 / 45).toFixed(1)}%)</span></span>
                  <span className="font-bold text-xl text-white whitespace-nowrap">{repeatAnalysis.repeatAfterOne}회</span>
                </div>
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700/60 flex justify-between items-center gap-3">
                  <span className="text-gray-400 font-medium">평균 출현 간격<span className="block text-[10px] text-gray-600 font-normal">균등 기대 {(45 / 7).toFixed(1)}회</span></span>
                  <span className="font-bold text-xl text-white whitespace-nowrap">{repeatAnalysis.averageGap.toFixed(1)}회</span>
                </div>
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700/60 flex justify-between items-center gap-3">
                  <span className="text-gray-400 font-medium">미출현 기간<span className="block text-[10px] text-gray-600 font-normal">{repeatAnalysis.averageGap > 0 ? `평균 간격의 ${(repeatAnalysis.roundsSinceLastSeen / repeatAnalysis.averageGap).toFixed(1)}배` : '평균 간격 계산 불가'}</span></span>
                  <span className="font-bold text-xl text-white whitespace-nowrap">{repeatAnalysis.roundsSinceLastSeen}회차째</span>
                </div>
              </div>

              <div className="bg-gray-900 p-5 rounded-xl border border-blue-900/40 flex flex-col justify-center lg:col-span-1 relative overflow-hidden">
                <div className="text-sm text-blue-400 mb-2 font-bold flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="whitespace-nowrap">관찰 요약</span>
                  <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${repeatAnalysis.notable ? 'bg-amber-600/80 text-white' : 'bg-gray-700 text-gray-200'}`}>
                    {repeatAnalysis.insight}
                  </span>
                </div>
                <p className="text-gray-300 leading-relaxed text-sm md:text-base break-words">{repeatAnalysis.observation}</p>
                <div className="mt-3 text-[11px] leading-relaxed text-gray-500 break-keep">
                  지금까지의 모습을 설명할 뿐입니다. 어떤 번호든 다음 회차 본번호에 포함될 확률은 <b className="text-gray-300 whitespace-nowrap">6/45 = 13.3%</b>이며 이 관찰로 달라지지 않습니다.
                  {repeatAnalysis.notable && ' 세 가지 관찰 중 가장 드문 것을 고르므로 5% 미만도 우연히 자주 나옵니다.'}
                </div>
                <div className="mt-3 pt-3 border-t border-gray-800 text-xs text-gray-500">
                  마지막 출현: {repeatAnalysis.lastSeenRound > 0 ? `${repeatAnalysis.lastSeenRound}회차` : '기록 없음'}
                </div>
              </div>
            </div>

            {/* Z-Score 지표 */}
            <div className="mt-6 bg-gray-900 rounded-xl border border-blue-900/40 p-5">
              <h3 className="text-sm font-bold text-blue-400 mb-4 flex items-center gap-2">
                <span>📊</span> <span className="whitespace-nowrap">Z-Score 지표</span> <span className="text-gray-500 font-normal text-xs whitespace-nowrap">(전체 회차 기준 편차)</span>
              </h3>
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <div className="flex flex-col items-center justify-center bg-gray-800 rounded-xl p-5 min-w-[120px] border border-gray-700">
                  <span className="text-xs text-gray-400 mb-1">Z-Score</span>
                  <span className={`text-3xl font-black ${repeatAnalysis.zScore > 1 ? 'text-red-400' : repeatAnalysis.zScore < -1 ? 'text-blue-400' : 'text-green-400'}`}>
                    {repeatAnalysis.zScore > 0 ? '+' : ''}{repeatAnalysis.zScore.toFixed(2)}
                  </span>
                  <span className={`mt-2 text-xs font-bold px-2 py-0.5 rounded ${repeatAnalysis.zScore > 1 ? 'bg-red-900/50 text-red-300' : repeatAnalysis.zScore < -1 ? 'bg-blue-900/50 text-blue-300' : 'bg-green-900/50 text-green-300'}`}>
                    {repeatAnalysis.zScore > 1 ? '많이 나온 편' : repeatAnalysis.zScore < -1 ? '적게 나온 편' : '평균 수준'}
                  </span>
                  <span className="mt-2 text-[10px] text-gray-500 text-center leading-snug">전체 {repeatAnalysis.allTimeRounds}회차 중 <span className="whitespace-nowrap">{repeatAnalysis.allTimeOccurrences}회</span><br />(균등 기대 <span className="whitespace-nowrap">{(repeatAnalysis.allTimeRounds * 7 / 45).toFixed(0)}회</span>)</span>
                </div>
                <div className="flex-1 space-y-2 text-sm text-gray-300 w-full">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-red-400 flex-shrink-0" />
                    <span><strong className="text-red-300">Z &gt; +1.0</strong>: 번호들 가운데 평균보다 많이 나온 편</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-green-400 flex-shrink-0" />
                    <span><strong className="text-green-300">-1.0 ~ +1.0</strong>: 평균 수준</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-blue-400 flex-shrink-0" />
                    <span><strong className="text-blue-300">Z &lt; -1.0</strong>: 번호들 가운데 평균보다 적게 나온 편</span>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500 break-words">
                    Z-Score = (해당 번호 출현 빈도 − 전체 평균 빈도) ÷ 표준편차 &nbsp;|&nbsp; 전체 1~45번 기준 계산
                    <div className="mt-1.5 text-gray-600 break-keep">
                      45개 번호끼리의 상대 위치일 뿐 통계적 유의성 검정이 아닙니다. 45개 중 약 1/3은 우연히도 |Z|&gt;1 입니다.
                      {evidence ? ` 번호 균등성 검정(χ²) p=${evidence.uniformity.p.toFixed(2)} — 번호 간 출현 횟수 차이는 우연 범위입니다.` : ''}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 동반 출현 번호 Top 10 */}
            {repeatAnalysis.coOccurrenceTop10.length > 0 && (
              <div className="mt-6 bg-gray-900 rounded-xl border border-indigo-900/40 p-5">
                <h3 className="text-sm font-bold text-indigo-300 mb-4 flex items-center gap-2">
                  <span>🔗</span> 동반 출현 번호 Top 10 <span className="text-gray-500 font-normal text-xs">(같은 회차에 함께 출현한 번호 순위)</span>
                </h3>
                <div className="space-y-2">
                  {repeatAnalysis.coOccurrenceTop10.map((entry, idx) => {
                    const maxCount = repeatAnalysis.coOccurrenceTop10[0].count;
                    const barPct = maxCount > 0 ? (entry.count / maxCount) * 100 : 0;
                    return (
                      <div key={entry.number} className="flex items-center gap-3">
                        <span className={`w-6 text-right text-xs font-bold flex-shrink-0 ${idx < 3 ? 'text-yellow-400' : 'text-gray-500'}`}>
                          {idx + 1}
                        </span>
                        <div className="flex-shrink-0">
                          <Ball num={entry.number} small onClick={() => handleBallClick(entry.number)} />
                        </div>
                        <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${idx < 3 ? 'bg-purple-500' : 'bg-gray-600'}`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                        <span className="w-14 text-right text-sm font-bold text-gray-300 flex-shrink-0">
                          {entry.count}회
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500 break-words">
                  * 전체 회차(262회차~) 데이터 기준. 공을 클릭하면 해당 번호의 정밀 분석으로 이동합니다.
                  <div className="mt-1.5 text-gray-600 break-keep">
                    무작위로 함께 나올 기대는 {repeatAnalysis.coOccurrenceExpected.mean.toFixed(1)}회(±{repeatAnalysis.coOccurrenceExpected.sd.toFixed(1)})입니다. 순위 차이는 대부분 이 범위 안의 우연입니다.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
