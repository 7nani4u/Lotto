import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeLotto,
  analyzeRepeatProbability,
  calculateBallColor,
  fetchLottoData,
  generateQuantumFlux,
  fetchGithubCombinations,
  backtestStrategies,
  optimizeQuantumParameters,
  buildFullAnalysisTable,
  buildFlowSignals,
  buildFusedTable,
  computeStability,
  secondOpinion645,
  classifyRecentlyBack,
  classifySegmentTrend,
  FLOW_WEIGHT_DEFAULT,
  LottoStats,
  RepeatAnalysis,
  StrategyAnalysis,
  QuantumOptimizationResult,
  OptimizedWeights,
  FullIndicatorAnalysis,
  FusedRow,
} from './services/lottoService';
import { LottoResult, PredictionResult } from './types';

const GENERATED_HISTORY_KEY = 'lottoQuantumGeneratedHistoryV1';
const MAX_FIXED_NUMBERS = 5;

const Ball: React.FC<{ num: number; isBonus?: boolean; onClick?: () => void; small?: boolean; responsive?: boolean }> = ({
  num,
  isBonus,
  onClick,
  small,
  responsive,
}) => {
  let sizeClass = small ? 'w-8 h-8 text-xs sm:text-sm' : 'w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 text-[15px] sm:text-lg md:text-xl flex-shrink-0';
  let borderClass = isBonus ? 'border-[3px] border-dashed border-gray-300 ' : '';

  if (responsive) {
    sizeClass = 'w-[26px] h-[26px] sm:w-8 sm:h-8 md:w-12 md:h-12 text-[11px] sm:text-sm md:text-xl flex-shrink-0';
    borderClass = isBonus ? 'border-2 sm:border-[3px] border-dashed border-gray-300 ' : '';
  }

  return (
    <div
      onClick={onClick}
      className={`${sizeClass} rounded-full flex items-center justify-center font-bold shadow-lg ${borderClass}${onClick ? 'cursor-pointer hover:scale-110 transition-transform ' : ''}${calculateBallColor(num)}`}
    >
      {num}
    </div>
  );
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
  const [githubCombinations, setGithubCombinations] = useState<number[][]>([]);
  const [strategyAnalysis, setStrategyAnalysis] = useState<StrategyAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [quantumOptResult, setQuantumOptResult] = useState<QuantumOptimizationResult | null>(null);
  const [isOptimizingQuantum, setIsOptimizingQuantum] = useState(false);
  const [isGeneratingQuantum, setIsGeneratingQuantum] = useState(false);
  const [quantumApplied, setQuantumApplied] = useState(false);
  const analysisReportRef = useRef<HTMLDivElement>(null);
  const strategyReportRef = useRef<HTMLDivElement>(null);
  const [expandedDrawRound, setExpandedDrawRound] = useState<number | null>(null);
  const autoInitStartedRef = useRef(false);
  const generatedHistoryRef = useRef<Set<string>>(new Set());
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [freqPage, setFreqPage] = useState(0);
  const [fixedNumbers, setFixedNumbers] = useState<number[]>([]);
  const [fixedInput, setFixedInput] = useState('');
  const [indicatorTable, setIndicatorTable] = useState<FullIndicatorAnalysis[]>([]);
  const [showFullTable, setShowFullTable] = useState(false);

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

      // GitHub 로또 조합 데이터 비동기 로드
      fetchGithubCombinations().then(data => setGithubCombinations(data));

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

  useEffect(() => {
    if (!quantumOptResult) return;
    setQuantumApplied(true);
  }, [quantumOptResult]);

  // reportOpen 이 true 로 바뀐 뒤 React 가 DOM 을 commit 한 다음 스크롤.
  // setTimeout(0) 은 브라우저 paint 한 프레임 뒤 실행을 보장해 ref 가 항상 유효.
  useEffect(() => {
    // 이제 인라인으로 표시되므로 별도의 스크롤 효과는 필요하지 않습니다.
  }, [expandedDrawRound]);

  useEffect(() => {
    if (allData.length === 0 || autoInitStartedRef.current) return;
    autoInitStartedRef.current = true;
    void Promise.allSettled([handleRunAnalysis(), handleQuantumOptimize()]);
  }, [allData]);

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

  // 양자 최적화 결과와 전략 분석 결과를 병합한 최종 가중치 계산
  const mergedWeights = useMemo((): OptimizedWeights | undefined => {
    const base = strategyAnalysis?.optimizedWeights;
    if (!quantumOptResult || !quantumApplied) return base;
    return {
      ...base,
      gaussianFactor: base?.gaussianFactor ?? 1.0,
      fibonacciFactor: base?.fibonacciFactor ?? 1.4,
      goldenRatioFactor: base?.goldenRatioFactor ?? 1.6,
      pythagoreanFactor: base?.pythagoreanFactor ?? 0.4,
      paretoTier1Factor: base?.paretoTier1Factor ?? 2.5,
      quantumNoiseFactor: quantumOptResult.optimalQNoise,
      quantumSigma: quantumOptResult.optimalSigma,
      whitsonFilterEnabled: base?.whitsonFilterEnabled ?? true,
    };
  }, [strategyAnalysis, quantumOptResult, quantumApplied]);

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

    // 장기 대기 번호 (10회차 이상 미출현, 초과율 내림차순)
    const longAbsent = Array.from({ length: 45 }, (_, i) => i + 1)
      .filter(n => gapInfo[n].curGap >= 10)
      .sort((a, b) => gapInfo[b].overdueRatio - gapInfo[a].overdueRatio)
      .slice(0, 10)
      .map(n => ({ number: n, curGap: gapInfo[n].curGap, overdueRatio: gapInfo[n].overdueRatio, avgGap: gapInfo[n].avgGap }));

    // 최근 복귀 번호 (최근 3회 내 출현 + 그 이전 5회 이상 공백 — Python과 동일 정의)
    const recentlyBack = classifyRecentlyBack(allData);

    return { trends, gapInfo, segmentFlow, longAbsent, recentlyBack, connectionScores, flowScores };
  }, [flowSignals, allData]);

  // ── 융합 랭킹 + 안정도 (🏆/📋/🔗 표식의 단일 근거)
  // fused = (1−w)×종합 + w×흐름, w=0.25. 안정도 = 80% 서브샘플 융합 상위 진입율.
  const stabilityMap = useMemo(
    () => computeStability(allData, 10, FLOW_WEIGHT_DEFAULT),
    [allData],
  );
  const fusedTable: FusedRow[] = useMemo(
    () => (indicatorTable.length > 0
      ? buildFusedTable(indicatorTable, flowSignals, FLOW_WEIGHT_DEFAULT, stabilityMap)
      : []),
    [indicatorTable, flowSignals, stabilityMap],
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
      () => generateQuantumFlux(allData, githubCombinations, mergedWeights, fixedNumbers),
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

  const handleQuantumOptimize = async () => {
    if (allData.length === 0) return;
    setIsOptimizingQuantum(true);
    try {
      const result = await optimizeQuantumParameters(allData, 52, 30);
      setQuantumOptResult(result);
      setQuantumApplied(false); // 새 결과는 적용 전 상태로
    } catch (e) {
      console.error('양자 최적화 오류:', e);
    }
    setIsOptimizingQuantum(false);
  };

  const handleRunAnalysis = async () => {
    if (allData.length === 0) return;
    setIsAnalyzing(true);
    try {
      const result = await backtestStrategies(allData, 52, 25);
      setStrategyAnalysis(result);
      setTimeout(() => { strategyReportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200);
    } catch (e) {
      console.error('백테스트 오류:', e);
    }
    setIsAnalyzing(false);
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

  // 동적으로 특정 회차의 리포트 데이터를 계산하는 함수
  const generateDynamicReportData = (draw: LottoResult) => {
    const nums = draw.numbers;

    // 1. 구간 분포 계산
    const distribution = [
      { range: '1~10', count: nums.filter(n => n >= 1 && n <= 10).length },
      { range: '11~20', count: nums.filter(n => n >= 11 && n <= 20).length },
      { range: '21~30', count: nums.filter(n => n >= 21 && n <= 30).length },
      { range: '31~40', count: nums.filter(n => n >= 31 && n <= 40).length },
      { range: '41~45', count: nums.filter(n => n >= 41 && n <= 45).length },
    ];

    // 2. 홀짝 / 고저 계산
    const odd = nums.filter(n => n % 2 !== 0).length;
    const even = nums.filter(n => n % 2 === 0).length;
    const low = nums.filter(n => n <= 22).length;
    const high = nums.filter(n => n > 22).length;

    // 3. 번호 합계
    const sumTotal = nums.reduce((a, b) => a + b, 0);
    const average = 139.4; // 이론적 평균
    const deviation = +(sumTotal - average).toFixed(1);

    // 4. 이전 회차 비교
    const prevDrawIndex = allData.findIndex(d => d.round === draw.round - 1);
    const prevDraw = prevDrawIndex !== -1 ? allData[prevDrawIndex] : null;
    let prevNumbers: number[] = [];
    let reappeared: number[] = [];
    let newNumbers: number[] = [...nums];

    if (prevDraw) {
      prevNumbers = prevDraw.numbers;
      reappeared = nums.filter(n => prevNumbers.includes(n));
      newNumbers = nums.filter(n => !prevNumbers.includes(n));
    }

    // 5. 함께 자주 나온 쌍 (간단한 예시를 위해 해당 회차 번호들의 전체 동반 출현 빈도를 분석)
    // 실제로는 전체 데이터를 순회해야 하지만 성능상 현재는 정적 데이터 또는 단순화된 데이터를 사용하거나
    // 이전 분석 로직을 활용할 수 있습니다. 여기서는 1219회 데이터 구조와 호환되게 동적으로 계산합니다.
    const pairs = [];
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        const pair = [nums[i], nums[j]].sort((a, b) => a - b);
        let count = 0;
        allData.forEach(d => {
          if (d.numbers.includes(pair[0]) && d.numbers.includes(pair[1])) count++;
        });
        pairs.push({ pair, count, percentage: +((count / allData.length) * 100).toFixed(1) });
      }
    }
    const frequentPairs = pairs.sort((a, b) => b.count - a.count).slice(0, 5);

    return {
      round: draw.round,
      date: draw.date,
      numbers: nums,
      bonus: draw.bonus,
      sections: {
        distribution,
        oddEven: { odd, even },
        highLow: { low, high, lowRange: '1-22', highRange: '23-45' },
        sum: { total: sumTotal, average, deviation, min: 100, max: 175 },
        prevCompare: {
          prevRound: draw.round - 1,
          prevNumbers,
          reappeared,
          newNumbers,
        },
        frequentPairs,
      }
    };
  };

  const fixedNumbersRemaining = MAX_FIXED_NUMBERS - fixedNumbers.length;
  const fixedNumberLimitReached = fixedNumbersRemaining === 0;
  const hasPredictionResults = quantumPredictions.length > 0;
  const isEngineBusy = isAnalyzing || isOptimizingQuantum;
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
            <div className="mt-6 grid w-full grid-cols-1 gap-4 animate-fade-in xl:grid-cols-2">
              {quantumPredictions.map((prediction, index) => {
                const fixedInCombo = fixedNumbers.filter(n => prediction.numbers.includes(n));
                return (
                  <div key={prediction.numbers.join('-')} className="bg-gray-900/80 rounded-2xl p-6 border border-purple-900/50 shadow-inner">
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
                          <Ball num={num} onClick={() => handleBallClick(num)} />
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-300 border-t border-gray-700/60 pt-6">
                      <div className="bg-gray-800/80 p-4 rounded-xl border border-gray-700/60 flex flex-col items-center justify-center">
                        <div className="text-gray-400 mb-2 font-medium">총합</div>
                        <div className="text-2xl font-black text-white">{prediction.stats.sum}</div>
                      </div>
                      <div className="bg-gray-800/80 p-4 rounded-xl border border-gray-700/60 flex flex-col items-center justify-center">
                        <div className="text-gray-400 mb-2 font-medium">AI 신뢰도</div>
                        <div className="text-2xl font-black text-purple-400">{prediction.confidence}%</div>
                      </div>
                      <div className="bg-gray-800/80 p-4 rounded-xl border border-gray-700/60 flex flex-col items-center justify-center">
                        <div className="text-gray-400 mb-2 font-medium">홀짝 비율</div>
                        <div className="text-2xl font-black text-blue-300">{prediction.stats.oddEvenRatio}</div>
                      </div>
                      <div className="bg-gray-800/80 p-4 rounded-xl border border-gray-700/60 flex flex-col items-center justify-center">
                        <div className="text-gray-400 mb-2 font-medium">고저 비율</div>
                        <div className="text-2xl font-black text-purple-300">{prediction.stats.highLowRatio}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 내부 분석/최적화는 자동 실행되며 화면에는 표시하지 않음 */}

        {/* ══ [1] 출현가능성 상위 6개 번호 + 전체 테이블 ══ */}
        {indicatorTable.length > 0 && (() => {
          // 선정 기준 = 융합 순위 (종합 75% + 흐름 25%). 표·카드·근거가 같은 순서를 공유.
          const fused = fusedTable.length > 0
            ? fusedTable
            : [...indicatorTable].sort((a, b) => b.compositeScore - a.compositeScore)
                .map((t, i) => ({
                  number: t.number, compositeScore: t.compositeScore, ensRank: t.rank,
                  fusedScore: t.compositeScore, fusedRank: i + 1, agreement5: 0,
                  stability: null as number | null, tier: 'mid' as const, contested: false,
                }));
          const top6 = fused.slice(0, 6);
          const byNum = new Map<number, FullIndicatorAnalysis>(
            indicatorTable.map(t => [t.number, t] as [number, FullIndicatorAnalysis]),
          );
          const cutoffGap = fused.length >= 7
            ? +(fused[5].fusedScore - fused[6].fusedScore).toFixed(3)
            : NaN;
          const TIER_BADGE: Record<string, { label: string; cls: string }> = {
            pick:  { label: '▶ 확정', cls: 'text-emerald-300 bg-emerald-900/50 border border-emerald-700/60' },
            next:  { label: '◆ 차순', cls: 'text-yellow-300 bg-yellow-900/40 border border-yellow-700/60' },
            avoid: { label: '✕ 회피', cls: 'text-blue-400 bg-blue-900/30 border border-blue-800/50' },
            mid:   { label: '· 중립', cls: 'text-gray-500 bg-gray-800/40 border border-gray-700/50' },
          };
          // 패턴: 공인 가중 총평 signalScore(MA 20% + RSI 30% + BB 35% + Aroon 15%) 단일 기준.
          // 기존에는 MA+RSI 원시값 독자 임계값(65/35 등)만 사용해 서비스 공인
          // 판정과 어긋났음. 방향 정의는 기존과 동일(상승=과열 활성,
          // 하락=냉각 후 회귀 기대). 분포 검증: 합성 957회차에서
          // 상승 3 · 하락 20 · 유지 5 · 변동 17로 변별력 확보.
          const getPatObj = (item: FullIndicatorAnalysis) => {
            const v = item.signalScore;
            if (v <= -0.5) return { label: '상승', cls: 'text-red-400 bg-red-900/40 border border-red-800/60' };
            if (v >= 0.5)  return { label: '하락', cls: 'text-blue-400 bg-blue-900/40 border border-blue-800/60' };
            if (Math.abs(v) <= 0.15) return { label: '유지', cls: 'text-gray-400 bg-gray-700/40 border border-gray-600/50' };
            return { label: '변동', cls: 'text-yellow-400 bg-yellow-900/30 border border-yellow-800/60' };
          };
          // 특징: 공인 이산 신호 + Z-Score + 가중 총평을 순서 고정으로 열거.
          // 기존에는 MA 누락·Aroon ±60(공인 ±30과 불일치) 문제가 있었음.
          const getFeat = (item: FullIndicatorAnalysis) => {
            const f: string[] = [];
            if (item.signalScore >= 0.5)       f.push('회귀 우세');
            else if (item.signalScore <= -0.5) f.push('과열 우세');
            if (item.zScore < -1.0)            f.push('장기 저출현');
            else if (item.zScore > 1.0)         f.push('장기 과출현');
            if (item.rsiScore > 0)             f.push('RSI 과소');
            else if (item.rsiScore < 0)         f.push('RSI 과다');
            if (item.bbScore > 0)              f.push('BB 하단');
            else if (item.bbScore < 0)          f.push('BB 상단');
            if (item.aroonScore > 0)           f.push('장기 공백');
            else if (item.aroonScore < 0)       f.push('단기 활성');
            if (item.maScore > 0)              f.push('MA 냉각');
            else if (item.maScore < 0)          f.push('MA 과열');
            return f.length > 0 ? f.join(' · ') : '평균 범위 내';
          };
          return (
            <div className="bg-gray-800 rounded-2xl p-6 md:p-8 shadow-xl border border-teal-900/40 mt-8">
              <h2 className="text-lg font-bold text-teal-300 border-b border-gray-700/60 pb-3 mb-5 flex items-center gap-2">
                <span>🏆</span> 출현가능성 상위 6개 번호
                <span className="text-xs font-normal text-gray-500 ml-1">융합 순위 (종합 75% + 흐름 25%)</span>
              </h2>

              {/* Top 6 카드 — 융합 선정 + 티어 표식 */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
                {top6.map((row, idx) => {
                  const item = byNum.get(row.number);
                  if (!item) return null;
                  const tier = TIER_BADGE[row.tier];
                  const trend = flowAnalysis?.trends[row.number] ?? '안정';
                  const gap = flowAnalysis?.gapInfo[row.number];
                  const signals: string[] = [];
                  if (item.zScore < -0.5)    signals.push('저출현 회귀');
                  if (item.rsiScore > 0)     signals.push('RSI 과소');
                  if (item.bbScore > 0)      signals.push('BB 하단');
                  if (item.aroonScore > 0)   signals.push('장기 공백');
                  if (item.maScore > 0)      signals.push('MA 냉각');
                  const borderCls = row.tier === 'pick'
                    ? 'border-emerald-700/60 bg-emerald-950/40'
                    : row.tier === 'next'
                      ? 'border-yellow-700/60 bg-yellow-950/30'
                      : 'border-gray-700 bg-gray-900/50';
                  const scoreCls = row.fusedScore >= 65 ? 'text-emerald-400' : row.fusedScore >= 50 ? 'text-yellow-400' : 'text-gray-300';
                  return (
                    <div key={row.number}
                         className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 cursor-pointer hover:scale-105 transition-transform ${borderCls}`}
                         onClick={() => handleBallClick(row.number)}
                         title={`융합 ${row.fusedRank}위 · 종합 ${row.ensRank}위 · 합의 ${row.agreement5}/5${row.contested ? ' · 의견 분열' : ''}`}>
                      <div className="flex items-center gap-1">
                        <div className="text-[10px] text-gray-500 font-bold">#{idx + 1}</div>
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded whitespace-nowrap ${tier.cls}`}>{tier.label}</span>
                        {row.contested && (
                          <span className="text-[9px] font-bold px-1 py-0.5 rounded whitespace-nowrap text-red-300 bg-red-900/50 border border-red-700/60">※</span>
                        )}
                      </div>
                      <Ball num={row.number} small />
                      <div className={`text-sm font-black ${scoreCls}`}>{row.fusedScore.toFixed(1)}점</div>
                      <div className="text-[9px] text-gray-500">종합 {row.compositeScore.toFixed(1)} · {trend}{gap ? ` · ${gap.curGap}회 대기` : ''}</div>
                      <div className="text-[9px] text-gray-500">
                        합의 {row.agreement5}/5 · 안정 {row.stability === null ? '─' : `${Math.round(row.stability * 100)}%`}
                      </div>
                      {/* 5종 지표 서브점수 미니바 */}
                      <div className="w-full space-y-[3px] mt-1.5">
                        {([
                          ['Z', item.zSubScore],
                          ['BB', item.bbSubScore],
                          ['RSI', item.rsiSubScore],
                          ['MA', item.maSubScore],
                          ['Ar', item.aroonSubScore],
                        ] as [string, number][]).map(([lbl, val]) => (
                          <div key={lbl} className="flex items-center gap-1">
                            <span className="text-[7px] text-gray-600 w-4 text-right flex-shrink-0 font-bold">{lbl}</span>
                            <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${val >= 65 ? 'bg-emerald-500' : val >= 50 ? 'bg-yellow-500' : 'bg-gray-600'}`}
                                style={{ width: `${val}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-col items-center gap-0.5 w-full mt-1">
                        {signals.slice(0, 2).map(s => (
                          <span key={s} className="text-[9px] px-1 py-0.5 rounded bg-teal-900/50 text-teal-300 border border-teal-800/60 text-center w-full truncate">{s}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 세컨드 오피니언 — 5엔진 통합 스택 Top6와 융합 Top6의 일치도 */}
              {(() => {
                const so = secondOpinion645(allData, indicatorTable, flowSignals, FLOW_WEIGHT_DEFAULT);
                if (!so) return null;
                return (
                  <div className="mb-6 rounded-xl border border-indigo-800/50 bg-indigo-950/30 p-3">
                    <div className="text-[11px] font-bold text-indigo-300 mb-2 flex items-center gap-1.5">
                      <span>🔀</span> 세컨드 오피니언 — 독립 스택 Top6 · 융합 Top6와 {so.overlap}개 일치
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {so.numbers.map(n => (
                        <span key={n}
                              onClick={() => handleBallClick(n)}
                              className="cursor-pointer hover:scale-110 transition-transform inline-block"
                              title={so.shared.includes(n) ? '융합 Top6와 공통' : '통합 스택 고유'}>
                          <Ball num={n} small />
                        </span>
                      ))}
                      <span className="text-[10px] text-gray-500 ml-1">
                        공통: {so.shared.length > 0 ? so.shared.join(', ') : '없음'} · 고유: {so.uniqueToUnified.length > 0 ? so.uniqueToUnified.join(', ') : '없음'}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-600 mt-1.5">스택 간 다변화 신호이며 적중률 우위를 의미하지 않습니다.</div>
                  </div>
                );
              })()}

              {/* 전체 테이블 토글 */}
              <div className="border border-gray-700 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowFullTable(v => !v)}
                  className="w-full flex items-center justify-between px-3 sm:px-4 py-3 bg-gray-900 hover:bg-gray-700/50 transition-colors gap-2"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-left">
                    <span className="text-sm font-bold text-gray-300 flex items-center gap-1.5 whitespace-nowrap">
                      <span>📋</span> 전체 데이터 테이블
                    </span>
                    <span className="text-[10px] sm:text-xs text-gray-500 font-normal break-keep">
                      — 1~45번 출현가능성 점수 전체 (융합 순위순 = 실제 선정 순서)
                    </span>
                  </div>
                  <span className="text-xs text-gray-500 font-bold flex-shrink-0 whitespace-nowrap">{showFullTable ? '▲ 접기' : '▼ 펼치기'}</span>
                </button>
                {!Number.isNaN(cutoffGap) && cutoffGap < 0.5 && (
                  <div className="px-3 sm:px-4 py-2 bg-yellow-950/40 border-t border-yellow-800/40 text-[11px] text-yellow-300">
                    ⚠️ 6위–7위 격차 {cutoffGap.toFixed(3)}점 — 사실상 동점이라 7~8위가 언제든 뒤집힐 수 있습니다.
                  </div>
                )}
                {showFullTable && (
                  <div className="overflow-x-auto border-t border-gray-700 custom-scrollbar">
                    <table className="w-full text-xs min-w-[680px]">
                      <thead>
                        <tr className="bg-gray-900 border-b border-gray-700">
                          <th className="py-2 px-2 text-gray-500 font-bold text-center whitespace-nowrap" title="융합 순위 (실제 선정 순서)">순위</th>
                          <th className="py-2 px-2 text-gray-500 font-bold text-center whitespace-nowrap">번호</th>
                          <th className="py-2 px-2 text-gray-500 font-bold text-center whitespace-nowrap">티어</th>
                          <th className="py-2 px-3 text-teal-400 font-bold text-center whitespace-nowrap">융합 <span className="text-gray-600 font-normal text-[10px]">점수(0~100)</span></th>
                          <th className="py-2 px-2 text-gray-500 font-bold text-center whitespace-nowrap" title="순수 앙상블 종합 점수">종합</th>
                          <th className="py-2 px-2 text-gray-500 font-bold text-center whitespace-nowrap" title="5종 서브점수 중 65점 이상 개수">합의</th>
                          <th className="py-2 px-2 text-gray-500 font-bold text-center whitespace-nowrap" title="80% 서브샘플 융합 상위 진입율">안정</th>
                          <th className="py-2 px-2 text-gray-500 font-bold text-center whitespace-nowrap">패턴</th>
                          <th className="py-2 px-3 text-gray-500 font-bold text-left whitespace-nowrap">특징 요약</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fused.map(row => {
                          const item = byNum.get(row.number);
                          if (!item) return null;
                          const patObj = getPatObj(item);
                          const feat = getFeat(item);
                          const tier = TIER_BADGE[row.tier];
                          const rowCls = row.tier === 'pick' ? 'bg-teal-950/20' : row.tier === 'next' ? 'bg-yellow-950/10' : '';
                          const scoreCls = row.fusedScore >= 65 ? 'text-emerald-400'
                            : row.fusedScore >= 50 ? 'text-yellow-400'
                            : row.fusedScore >= 35 ? 'text-gray-300' : 'text-blue-400';
                          const barCls = row.fusedScore >= 65 ? 'bg-emerald-500'
                            : row.fusedScore >= 50 ? 'bg-yellow-500'
                            : row.fusedScore >= 35 ? 'bg-gray-500' : 'bg-blue-500';
                          return (
                            <tr key={row.number}
                                className={`border-b border-gray-800/60 hover:bg-gray-700/20 transition-colors ${rowCls}`}>
                              <td className="py-1.5 px-2 text-center">
                                <span className={`font-black ${row.fusedRank <= 3 ? 'text-yellow-400' : row.fusedRank <= 6 ? 'text-teal-400' : 'text-gray-600'}`}>
                                  {row.fusedRank}
                                </span>
                                <div className="text-[9px] text-gray-600">종합 {row.ensRank}위</div>
                              </td>
                              <td className="py-1.5 px-2 text-center">
                                <div className="flex justify-center cursor-pointer" onClick={() => handleBallClick(row.number)}>
                                  <Ball num={row.number} small />
                                </div>
                              </td>
                              <td className="py-1.5 px-2 text-center whitespace-nowrap">
                                <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${tier.cls}`}>{tier.label}</span>
                                {row.contested && (
                                  <div className="text-[9px] font-bold text-red-300 mt-0.5" title="앙상블 순위와 10위 이상 엇갈림">※분열</div>
                                )}
                              </td>
                              <td className="py-1.5 px-3 text-center whitespace-nowrap">
                                <div className={`font-black text-sm ${scoreCls}`}>{row.fusedScore.toFixed(1)}</div>
                                <div className="w-full h-1 bg-gray-700 rounded-full mt-0.5 overflow-hidden">
                                  <div className={`h-full rounded-full ${barCls}`} style={{ width: `${Math.min(100, row.fusedScore)}%` }} />
                                </div>
                              </td>
                              <td className="py-1.5 px-2 text-center whitespace-nowrap">
                                <span className="text-gray-400 text-[11px]">{row.compositeScore.toFixed(1)}</span>
                              </td>
                              <td className="py-1.5 px-2 text-center whitespace-nowrap">
                                <span className={`text-[11px] font-bold ${row.agreement5 >= 4 ? 'text-emerald-400' : row.agreement5 >= 3 ? 'text-yellow-400' : 'text-gray-500'}`}>
                                  {row.agreement5}/5
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-center whitespace-nowrap">
                                <span className="text-gray-400 text-[11px]">
                                  {row.stability === null ? '─' : `${Math.round(row.stability * 100)}%`}
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-center whitespace-nowrap">
                                <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${patObj.cls}`}>{patObj.label}</span>
                              </td>
                              <td className="py-1.5 px-3 whitespace-nowrap">
                                <span className="text-gray-400 text-[11px]">{feat}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="px-3 sm:px-4 py-2 bg-gray-900 text-[10px] text-gray-500 border-t border-gray-700">
                      ▶확정 1~6위(가져갈 번호) · ◆차순 7~12위(교체 후보) · ✕회피 40~45위 · ※분열 = 종합 순위와 10위 이상 엇갈림 · 합의 n/5 · 안정 = 재현율(선택의 재현성이지 적중률이 아님)
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ══ [1.5] 🔗 번호 흐름 분석 ══ */}
        {flowAnalysis && indicatorTable.length > 0 && (() => {
          // 융합 Top6의 흐름 근거 — 카드·표와 동일한 선정 순서 공유.
          const fusedTop6 = fusedTable.length > 0
            ? fusedTable.slice(0, 6)
            : [...indicatorTable].sort((a, b) => b.compositeScore - a.compositeScore).slice(0, 6)
                .map((t, i) => ({
                  number: t.number, compositeScore: t.compositeScore, ensRank: t.rank,
                  fusedScore: t.compositeScore, fusedRank: i + 1, agreement5: 0,
                  stability: null as number | null, tier: 'mid' as const, contested: false,
                }));
          const { trends, gapInfo, segmentFlow, longAbsent, recentlyBack, connectionScores } = flowAnalysis;
          const segOf = (n: number) => segmentFlow.find(s => n >= s.lo && n <= s.hi);

          const trendStyle: Record<string, string> = {
            '급락': 'text-blue-300 bg-blue-900/50 border border-blue-700/60',
            '급등': 'text-red-300 bg-red-900/50 border border-red-700/60',
            '상승': 'text-orange-300 bg-orange-900/40 border border-orange-700/60',
            '하락': 'text-cyan-300 bg-cyan-900/40 border border-cyan-700/60',
            '안정': 'text-gray-400 bg-gray-700/50 border border-gray-600/50',
          };
          const segStyle: Record<string, { bg: string; text: string; icon: string }> = {
            '상승': { bg: 'border-orange-700/60 bg-orange-950/30', text: 'text-orange-300', icon: '↑' },
            '하락': { bg: 'border-cyan-700/60 bg-cyan-950/30',    text: 'text-cyan-300',   icon: '↓' },
            '안정': { bg: 'border-gray-700 bg-gray-900/60',        text: 'text-gray-400',   icon: '→' },
          };
          const trendGroups: Record<string, number[]> = { '급등': [], '상승': [], '안정': [], '하락': [], '급락': [] };
          for (let n = 1; n <= 45; n++) trendGroups[trends[n]]?.push(n);

          return (
            <div className="bg-gray-800 rounded-2xl p-6 md:p-8 shadow-xl border border-indigo-900/40 mt-8">
              <h2 className="text-lg font-bold text-indigo-300 border-b border-gray-700/60 pb-3 mb-6 flex items-center gap-2">
                <span>🔗</span> 번호 흐름 분석
                <span className="text-xs font-normal text-gray-500 ml-1">최근 10회차 추세 · 구간 흐름 · 대기 현황</span>
              </h2>

              {/* 1. 구간별 흐름 */}
              <div className="mb-6">
                <div className="text-xs font-bold text-gray-400 mb-3 flex items-center gap-1.5">
                  <span>📊</span> 구간별 흐름 — 최근 5회 vs 이전 5회
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {segmentFlow.map(seg => {
                    const st = segStyle[seg.trend];
                    return (
                      <div key={seg.label} className={`rounded-xl border p-3 flex flex-col items-center gap-1.5 ${st.bg}`}>
                        <div className="text-[11px] font-bold text-gray-400">{seg.label}</div>
                        <div className={`text-xl font-black ${st.text}`}>{st.icon}</div>
                        <div className={`text-xs font-bold ${st.text}`}>{seg.trend}</div>
                        <div className="text-[10px] text-gray-500">{seg.recent5} / {seg.prev5}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. 최근 추세 분류 */}
              <div className="mb-6">
                <div className="text-xs font-bold text-gray-400 mb-3 flex items-center gap-1.5">
                  <span>📈</span> 최근 추세 분류
                </div>
                <div className="space-y-2">
                  {(['급등', '상승', '안정', '하락', '급락'] as const).map(t => {
                    const nums = trendGroups[t];
                    if (!nums || nums.length === 0) return null;
                    return (
                      <div key={t} className="flex items-start gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex-shrink-0 min-w-[38px] text-center ${trendStyle[t]}`}>{t}</span>
                        <div className="flex gap-1 flex-wrap">
                          {nums.map(n => (
                            <span key={n}
                              className={`text-[11px] font-bold px-1.5 py-0.5 rounded cursor-pointer hover:scale-110 transition-transform inline-block ${trendStyle[t]}`}
                              onClick={() => handleBallClick(n)}>
                              {n}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. 장기 대기 번호 */}
              {longAbsent.length > 0 && (
                <div className="mb-6">
                  <div className="text-xs font-bold text-gray-400 mb-3 flex items-center gap-1.5">
                    <span>⏳</span> 장기 대기 번호 — 10회차 이상 미출현 (초과율 높은 순)
                  </div>
                  <div className="bg-gray-900/80 rounded-xl border border-gray-700/60 p-4 space-y-2">
                    {longAbsent.map(item => {
                      const pct = Math.min(100, ((item.overdueRatio - 1) / 4) * 100);
                      const barCls  = item.overdueRatio >= 3 ? 'bg-red-500' : item.overdueRatio >= 2 ? 'bg-orange-500' : 'bg-yellow-500';
                      const textCls = item.overdueRatio >= 3 ? 'text-red-300' : item.overdueRatio >= 2 ? 'text-orange-300' : 'text-yellow-300';
                      return (
                        <div key={item.number} className="flex items-center gap-3 cursor-pointer" onClick={() => handleBallClick(item.number)}>
                          <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 bg-gray-700 text-gray-200">
                            {item.number}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] text-gray-500">{item.curGap}회 대기 / 평균 {item.avgGap}회</span>
                              <span className={`text-[11px] font-bold ${textCls}`}>{item.overdueRatio.toFixed(1)}×</span>
                            </div>
                            <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${barCls}`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 4. 상위 6개 번호 흐름 근거 (융합 선정 + 디테일 흐름) */}
              <div>
                <div className="text-xs font-bold text-gray-400 mb-3 flex items-center gap-1.5">
                  <span>🏆</span> 상위 6개 번호 흐름 근거
                  <span className="font-normal text-gray-600">— 융합 순위 공유 · 추세/대기/연결/구간 근거</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {fusedTop6.map((row, idx) => {
                    const trend  = trends[row.number] ?? '안정';
                    const gap    = gapInfo[row.number];
                    const conn   = connectionScores?.[row.number];
                    const seg    = segOf(row.number);
                    const isBack = recentlyBack.includes(row.number);
                    const isOverdue = gap && gap.overdueRatio >= 1.2;
                    const reasons: string[] = [];
                    if (trend === '급락')      reasons.push('급락 후 반등 기대');
                    else if (trend === '급등') reasons.push('상승 모멘텀 유지');
                    else if (trend === '상승') reasons.push('안정적 상승세');
                    else if (trend === '하락') reasons.push('저활성 → 회귀 가능');
                    if (isOverdue && gap) reasons.push(`${gap.curGap}회 대기 (평균 ${gap.avgGap}회 · ${gap.overdueRatio.toFixed(1)}× 초과)`);
                    else if (gap)         reasons.push(`${gap.curGap}회 대기 (평균 ${gap.avgGap}회)`);
                    if (conn !== undefined) reasons.push(`연결강도 ${conn.toFixed(0)}/100`);
                    if (seg) reasons.push(`구간 [${seg.label}] ${seg.trend}`);
                    if (isBack)              reasons.push('장기 공백 후 복귀');
                    if (gap?.isPeriodic)     reasons.push('주기적 출현 패턴');
                    if (reasons.length === 0) reasons.push('지표 종합 우위');
                    return (
                      <div key={row.number}
                           className="bg-gray-900/80 rounded-xl border border-gray-700/60 p-3 flex items-start gap-3 cursor-pointer hover:bg-gray-700/30 transition-colors"
                           onClick={() => handleBallClick(row.number)}
                           title={`융합 ${row.fusedScore.toFixed(1)}점 · 합의 ${row.agreement5}/5 · 안정 ${row.stability === null ? '─' : `${Math.round(row.stability * 100)}%`}${row.contested ? ' · 의견 분열' : ''}`}>
                        <div className="flex flex-col items-center gap-1 flex-shrink-0">
                          <div className="text-[9px] text-gray-600 font-bold">#{idx + 1}</div>
                          <Ball num={row.number} small />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${trendStyle[trend] ?? trendStyle['안정']}`}>{trend}</span>
                            {gap && <span className="text-[10px] text-gray-500">{gap.curGap}회 대기</span>}
                            {conn !== undefined && <span className="text-[10px] text-gray-500">연결 {conn.toFixed(0)}</span>}
                            {row.contested && <span className="text-[10px] font-bold text-red-300">※분열</span>}
                          </div>
                          <div className="text-[11px] text-gray-400 leading-relaxed">{reasons.join(' · ')}</div>
                          <div className="text-[10px] text-gray-600 mt-0.5">
                            융합 {row.fusedScore.toFixed(1)} · 합의 {row.agreement5}/5 · 안정 {row.stability === null ? '─' : `${Math.round(row.stability * 100)}%`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

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
        <div className="bg-gray-800 rounded-2xl p-6 md:p-8 shadow-xl border border-blue-900/40 mt-8">
          <div className="flex flex-col md:flex-row items-center justify-between border-b border-gray-700/60 pb-4 mb-6">
            <h2 className="text-lg font-bold text-blue-300 flex items-center gap-2"><span>📅</span> 보조 분석 — 최근 당첨 번호</h2>
            <div className="text-xs sm:text-sm text-gray-400 bg-gray-700/40 px-3 py-2 rounded-xl mt-3 md:mt-0 flex flex-col sm:flex-row items-center gap-1 sm:gap-3 text-center break-keep break-words">
              <span className="text-yellow-400">💡 번호 클릭 → 정밀 분석</span>
              <span className="hidden sm:block text-gray-600">|</span>
              <span className="text-green-400">📋 번호 외 영역 클릭 → 회차 리포트</span>
            </div>
          </div>
          <div className="space-y-4">
            {allData.slice(0, 10).map((draw, idx) => {
              const isExpanded = expandedDrawRound === draw.round;
              const dynamicData = isExpanded ? generateDynamicReportData(draw) : null;
              
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

                {/* ── 회차 분석 리포트 (행 바로 아래 인라인 확장) ── */}
                {isExpanded && dynamicData && (
                  <div className="bg-gray-800/80 rounded-xl p-4 sm:p-6 md:p-8 shadow-inner border border-green-900/30 mt-2 mb-4 animate-fade-in ml-0 md:ml-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-700 pb-4 mb-6 gap-3">
                      <h2 className="text-lg sm:text-xl font-bold text-green-300 flex items-center gap-2">
                        <span>📋</span>
                        <span className="break-keep break-words">제 {dynamicData.round}회 당첨 번호 분석 리포트</span>
                      </h2>
                    </div>

                    <div className="space-y-6 text-gray-200">
                      {/* 1. 당첨 번호 요약 */}
                      <div className="bg-gray-900/80 p-5 rounded-xl border border-gray-700/60">
                        <div className="text-center mb-4">
                          <div className="text-sm text-gray-400 mb-1">{dynamicData.date}</div>
                          <div className="text-xl font-black text-white">제 {dynamicData.round}회 당첨 번호</div>
                        </div>
                        <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
                          {dynamicData.numbers.map(num => (
                            <Ball key={num} num={num} onClick={() => handleBallClick(num)} />
                          ))}
                          <div className="text-gray-500 text-2xl mx-1 font-light">+</div>
                          <Ball num={dynamicData.bonus} isBonus onClick={() => handleBallClick(dynamicData.bonus)} />
                        </div>
                      </div>

                      {/* 2. 구간 분포 & 홀짝/고저 */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-gray-900/80 p-5 rounded-xl border border-gray-700/60">
                          <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
                            <span>📊</span> 구간 분포
                          </h3>
                          <div className="space-y-3">
                            {dynamicData.sections.distribution.map((item, idx) => (
                              <div key={idx} className="flex items-center gap-3">
                                <span className="text-xs text-gray-400 w-12 text-right">{item.range}</span>
                                <div className="flex-1 h-4 bg-gray-800 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-green-500 rounded-full"
                                    style={{ width: `${(item.count / 3) * 100}%` }}
                                  />
                                </div>
                                <span className="text-sm font-bold text-white w-6">{item.count}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="bg-gray-900/80 p-5 rounded-xl border border-gray-700/60">
                          <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
                            <span>⚖️</span> 홀짝 · 고저
                          </h3>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-gray-800 p-3 rounded-lg text-center border border-gray-700/60/60">
                              <div className="text-xs text-gray-400 mb-1">홀짝 비율</div>
                              <div className="text-xl font-black text-blue-300">
                                {dynamicData.sections.oddEven.odd} : {dynamicData.sections.oddEven.even}
                              </div>
                            </div>
                            <div className="bg-gray-800 p-3 rounded-lg text-center border border-gray-700/60/60">
                              <div className="text-xs text-gray-400 mb-1">고저 비율</div>
                              <div className="text-xl font-black text-purple-300">
                                {dynamicData.sections.highLow.low} : {dynamicData.sections.highLow.high}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 text-xs text-gray-500 text-center">
                            저({dynamicData.sections.highLow.lowRange}) / 고({dynamicData.sections.highLow.highRange})
                          </div>
                        </div>
                      </div>

                      {/* 3. 번호 합계 */}
                      <div className="bg-gray-900/80 p-5 rounded-xl border border-gray-700/60 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <span>➕</span>
                          <span className="text-sm font-bold text-gray-300">번호 합계</span>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-center">
                            <div className="text-xs text-gray-400">합계</div>
                            <div className="text-xl font-black text-white">{dynamicData.sections.sum.total}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xs text-gray-400">이론 평균</div>
                            <div className="text-lg font-bold text-gray-300">{dynamicData.sections.sum.average}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xs text-gray-400">편차</div>
                            <div className={`text-lg font-bold ${dynamicData.sections.sum.deviation < 0 ? 'text-blue-400' : 'text-red-400'}`}>
                              {dynamicData.sections.sum.deviation > 0 ? '+' : ''}{dynamicData.sections.sum.deviation}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 4. 이전 회차 비교 */}
                      <div className="bg-gray-900/80 p-5 rounded-xl border border-gray-700/60">
                        <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
                          <span>🔄</span> 이전 회차 비교
                          <span className="text-xs text-gray-500 font-normal ml-2">({dynamicData.sections.prevCompare.prevRound}회 → {dynamicData.round}회)</span>
                        </h3>
                        <div className="space-y-4">
                          <div>
                            <div className="text-xs text-gray-400 mb-2">이전 회차 번호</div>
                            <div className="flex gap-2 flex-wrap">
                              {dynamicData.sections.prevCompare.prevNumbers.length > 0 ? (
                                dynamicData.sections.prevCompare.prevNumbers.map(n => (
                                  <Ball key={`prev-${n}`} num={n} small onClick={() => handleBallClick(n)} />
                                ))
                              ) : (
                                <div className="text-sm text-gray-500">데이터 없음</div>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                            <div className="bg-gray-800 p-3 rounded-lg border border-gray-700/60">
                              <div className="text-xs text-gray-400 mb-2">재등장 ({dynamicData.sections.prevCompare.reappeared.length}개)</div>
                              <div className="flex gap-2 flex-wrap">
                                {dynamicData.sections.prevCompare.reappeared.map(n => (
                                  <Ball key={`re-${n}`} num={n} small onClick={() => handleBallClick(n)} />
                                ))}
                              </div>
                            </div>
                            <div className="bg-gray-800 p-3 rounded-lg border border-gray-700/60">
                              <div className="text-xs text-gray-400 mb-2">신규 ({dynamicData.sections.prevCompare.newNumbers.length}개)</div>
                              <div className="flex gap-2 flex-wrap">
                                {dynamicData.sections.prevCompare.newNumbers.map(n => (
                                  <Ball key={`new-${n}`} num={n} small onClick={() => handleBallClick(n)} />
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 5. 함께 자주 나온 쌍 Top 5 */}
                      <div className="bg-gray-900/80 p-5 rounded-xl border border-gray-700/60">
                        <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
                          <span>🔗</span> 함께 자주 나온 쌍 Top 5
                        </h3>
                        <div className="space-y-3">
                          {dynamicData.sections.frequentPairs.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-3 p-2 hover:bg-gray-800 rounded-lg transition-colors">
                              <span className={`text-xs font-bold w-4 text-center ${idx < 3 ? 'text-yellow-400' : 'text-gray-500'}`}>
                                {idx + 1}
                              </span>
                              <div className="flex items-center gap-1">
                                <Ball num={item.pair[0]} small onClick={() => handleBallClick(item.pair[0])} />
                                <span className="text-gray-500 text-xs mx-1">+</span>
                                <Ball num={item.pair[1]} small onClick={() => handleBallClick(item.pair[1])} />
                              </div>
                              <div className="ml-auto text-right">
                                <div className="text-sm font-bold text-white">{item.count}회</div>
                                <div className="text-xs text-gray-400">({item.percentage.toFixed(1)}%)</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      <div className="text-center text-xs text-gray-500 pt-4">
                        로또는 예측 불가합니다. 본 서비스의 분석 및 추천은 통계 참고 자료이며 당첨을 보장하지 않습니다.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )})}
          </div>
        </div>

        {selectedAnalysisNum && repeatAnalysis && (
          <div ref={analysisReportRef} className="bg-gray-800 rounded-2xl p-6 md:p-8 shadow-xl border border-blue-900/40 mt-8">
            <h2 className="text-xl sm:text-2xl font-bold mb-6 text-blue-300 flex items-center justify-center md:justify-start gap-2 sm:gap-3 border-b border-gray-700/60 pb-4 break-keep break-words">
              <Ball num={selectedAnalysisNum} small />
              <span>선택 번호 정밀 분석 리포트</span>
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="space-y-4 lg:col-span-1">
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700/60 flex justify-between items-center">
                  <span className="text-gray-400 font-medium">262회차부터 출현 횟수</span>
                  <span className="font-bold text-xl text-white">{repeatAnalysis.totalOccurrences}회</span>
                </div>
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700/60 flex justify-between items-center">
                  <span className="text-gray-400 font-medium">최근 10회차 내 출현</span>
                  <span className="font-bold text-xl text-white">{repeatAnalysis.recent10Occurrences}회</span>
                </div>
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700/60 flex justify-between items-center">
                  <span className="text-gray-400 font-medium">최근 30회차 내 출현</span>
                  <span className="font-bold text-xl text-white">{repeatAnalysis.recent30Occurrences}회</span>
                </div>
              </div>

              <div className="space-y-4 lg:col-span-1">
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700/60 flex justify-between items-center">
                  <span className="text-gray-400 font-medium">연속(이월) 출현 횟수</span>
                  <span className="font-bold text-xl text-white">{repeatAnalysis.repeatAfterOne}회</span>
                </div>
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700/60 flex justify-between items-center">
                  <span className="text-gray-400 font-medium">평균 출현 간격</span>
                  <span className="font-bold text-xl text-white">{repeatAnalysis.averageGap.toFixed(1)}회</span>
                </div>
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700/60 flex justify-between items-center">
                  <span className="text-gray-400 font-medium">미출현 기간</span>
                  <span className={`font-bold text-xl ${repeatAnalysis.roundsSinceLastSeen > 10 ? 'text-red-400' : 'text-white'}`}>
                    {repeatAnalysis.roundsSinceLastSeen}회차째
                  </span>
                </div>
              </div>

              <div className="bg-gray-900 p-5 rounded-xl border border-blue-900/40 flex flex-col justify-center lg:col-span-1 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-2 opacity-10 text-6xl">🤖</div>
                <div className="text-sm text-blue-400 mb-2 font-bold flex items-center gap-2">
                  <span>AI Insight</span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs text-white ${
                      repeatAnalysis.confidenceLevel === 'HIGH'
                        ? 'bg-red-500'
                        : repeatAnalysis.confidenceLevel === 'MEDIUM'
                          ? 'bg-yellow-500'
                          : 'bg-gray-500'
                    }`}
                  >
                    {repeatAnalysis.insight}
                  </span>
                </div>
                <p className="text-gray-300 leading-relaxed text-sm md:text-base break-words">{repeatAnalysis.recommendation}</p>
                <div className="mt-4 pt-3 border-t border-gray-800 text-xs text-gray-500">
                  마지막 출현: {repeatAnalysis.lastSeenRound > 0 ? `${repeatAnalysis.lastSeenRound}회차` : '기록 없음'}
                </div>
              </div>
            </div>

            {/* Z-Score 지표 */}
            <div className="mt-6 bg-gray-900 rounded-xl border border-blue-900/40 p-5">
              <h3 className="text-sm font-bold text-blue-400 mb-4 flex items-center gap-2">
                <span>📊</span> Z-Score 지표 <span className="text-gray-500 font-normal text-xs">(전체 회차 기준 통계적 편차)</span>
              </h3>
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <div className="flex flex-col items-center justify-center bg-gray-800 rounded-xl p-5 min-w-[120px] border border-gray-700">
                  <span className="text-xs text-gray-400 mb-1">Z-Score</span>
                  <span className={`text-3xl font-black ${repeatAnalysis.zScore > 1 ? 'text-red-400' : repeatAnalysis.zScore < -1 ? 'text-blue-400' : 'text-green-400'}`}>
                    {repeatAnalysis.zScore > 0 ? '+' : ''}{repeatAnalysis.zScore.toFixed(2)}
                  </span>
                  <span className={`mt-2 text-xs font-bold px-2 py-0.5 rounded ${repeatAnalysis.zScore > 1 ? 'bg-red-900/50 text-red-300' : repeatAnalysis.zScore < -1 ? 'bg-blue-900/50 text-blue-300' : 'bg-green-900/50 text-green-300'}`}>
                    {repeatAnalysis.zScore > 1 ? '과출현' : repeatAnalysis.zScore < -1 ? '저출현' : '평균 수준'}
                  </span>
                </div>
                <div className="flex-1 space-y-2 text-sm text-gray-300 w-full">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-red-400 flex-shrink-0" />
                    <span><strong className="text-red-300">Z &gt; +1.0</strong>: 평균보다 유의미하게 많이 출현한 번호 (과출현)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-green-400 flex-shrink-0" />
                    <span><strong className="text-green-300">-1.0 ~ +1.0</strong>: 평균 수준의 출현 빈도 (정상 범위)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-blue-400 flex-shrink-0" />
                    <span><strong className="text-blue-300">Z &lt; -1.0</strong>: 평균보다 유의미하게 적게 출현한 번호 (저출현)</span>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500 break-words">
                    Z-Score = (해당 번호 출현 빈도 − 전체 평균 빈도) ÷ 표준편차 &nbsp;|&nbsp; 전체 1~45번 기준 계산
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
