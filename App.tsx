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
  LottoStats,
  RepeatAnalysis,
  StrategyAnalysis,
  QuantumOptimizationResult,
  OptimizedWeights,
  FullIndicatorAnalysis,
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
      gaussianFactor:      base?.gaussianFactor      ?? 1.0,
      fibonacciFactor:     base?.fibonacciFactor      ?? 1.4,
      goldenRatioFactor:   base?.goldenRatioFactor    ?? 1.6,
      pythagoreanFactor:   base?.pythagoreanFactor    ?? 0.4,
      paretoTier1Factor:   base?.paretoTier1Factor    ?? 2.5,
      quantumNoiseFactor:  quantumOptResult.optimalQNoise,
      quantumSigma:        quantumOptResult.optimalSigma,
      whitsonFilterEnabled: base?.whitsonFilterEnabled ?? true,
    };
  }, [strategyAnalysis, quantumOptResult, quantumApplied]);

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
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 break-keep">
            한국 로또 6/45 AI 마스터
          </h1>
          <p className="text-gray-400 text-sm sm:text-base md:text-lg break-keep">인공지능과 통계 기반의 번호 예측 시스템</p>
        </div>

        <div className="bg-gray-800 rounded-2xl p-6 md:p-8 shadow-2xl border border-purple-900/50">
          <div className="flex flex-col gap-8">
            <div className="text-center md:text-left">
              <div className="inline-flex items-center gap-2 rounded-full border border-purple-700/40 bg-purple-950/40 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-purple-200">
                <span>추천 엔진</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>{isEngineBusy ? '준비 중' : '사용 가능'}</span>
              </div>
              <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-white break-keep">
                    보기 편하고 바로 쓸 수 있는 번호 추천
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm sm:text-base leading-6 text-gray-300 break-keep">
                    조합 수를 선택하고 필요하면 고정 번호를 넣은 뒤 추천을 실행하세요. 복잡한 계산 과정은 내부에서 자동 처리하고, 화면에는 핵심 입력과 결과만 깔끔하게 보여줍니다.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-left text-xs sm:text-sm">
                  <div className="rounded-2xl border border-gray-700 bg-gray-900/70 px-4 py-3">
                    <div className="text-gray-500">추천 조합</div>
                    <div className="mt-1 text-lg font-black text-white">{combinationCount}개</div>
                  </div>
                  <div className="rounded-2xl border border-gray-700 bg-gray-900/70 px-4 py-3">
                    <div className="text-gray-500">고정 번호</div>
                    <div className="mt-1 text-lg font-black text-purple-300">{fixedNumbers.length}개</div>
                  </div>
                  <div className="rounded-2xl border border-gray-700 bg-gray-900/70 px-4 py-3">
                    <div className="text-gray-500">복사 가능</div>
                    <div className="mt-1 text-lg font-black text-emerald-300">{hasPredictionResults ? '예' : '대기'}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1.4fr] gap-4">
              <div className="rounded-2xl border border-gray-700 bg-gray-900/70 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-white">1. 추천 개수 선택</div>
                    <div className="mt-1 text-xs leading-5 text-gray-400">한 번에 받을 조합 수를 정합니다.</div>
                  </div>
                  <div className="rounded-full bg-blue-950/60 px-2.5 py-1 text-[11px] font-bold text-blue-300">
                    1~20개
                  </div>
                </div>
                <div className="mt-4">
                  <label className="mb-2 block text-xs font-bold text-gray-400">추천 조합 수</label>
                  <select
                    value={combinationCount}
                    onChange={(e) => setCombinationCount(Number(e.target.value))}
                    className="w-full rounded-xl border border-gray-600 bg-gray-800 px-4 py-3 text-base font-semibold text-white outline-none transition-colors focus:border-blue-500"
                  >
                    {Array.from({ length: 20 }, (_, i) => i + 1).map((count) => (
                      <option key={count} value={count}>{count}개</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-2xl border border-purple-900/40 bg-gray-900/70 p-5">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-sm font-bold text-white">2. 고정 번호 설정</div>
                      <div className="mt-1 text-xs leading-5 text-gray-400">
                        꼭 넣고 싶은 번호가 있으면 추가하세요. 최대 {MAX_FIXED_NUMBERS}개까지 설정할 수 있습니다.
                      </div>
                    </div>
                    <div className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${fixedNumberLimitReached ? 'bg-amber-950/70 text-amber-300' : 'bg-purple-950/60 text-purple-300'}`}>
                      {fixedNumberLimitReached ? '입력 완료' : `${fixedNumbersRemaining}개 더 추가 가능`}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                    <input
                      type="number"
                      min={1}
                      max={45}
                      value={fixedInput}
                      onChange={(e) => setFixedInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddFixedNumber(); }}
                      placeholder="번호 입력 (1~45)"
                      disabled={fixedNumberLimitReached}
                      className="w-full rounded-xl border border-gray-600 bg-gray-800 px-4 py-3 text-center text-base font-semibold text-white outline-none transition-colors focus:border-purple-500 disabled:cursor-not-allowed disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      onClick={handleAddFixedNumber}
                      disabled={!canSubmitFixedNumber}
                      className="rounded-xl bg-purple-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      번호 추가
                    </button>
                    <button
                      onClick={() => setFixedNumbers([])}
                      disabled={fixedNumbers.length === 0}
                      className="rounded-xl border border-gray-600 bg-gray-800 px-4 py-3 text-sm font-bold text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      전체 지우기
                    </button>
                  </div>

                  <div className="rounded-xl border border-dashed border-gray-700 bg-gray-950/40 px-4 py-3">
                    <div className="mb-2 text-xs font-bold text-gray-500">선택한 고정 번호</div>
                    <div className="flex min-h-[36px] flex-wrap items-center gap-2">
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

            <div className="rounded-2xl border border-indigo-900/40 bg-gradient-to-r from-purple-950/40 to-indigo-950/40 p-4 sm:p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-bold text-white">3. 추천 실행</div>
                  <div className="mt-1 text-sm text-gray-300 break-keep">
                    선택한 조건을 기준으로 중복 이력을 피한 새 조합을 생성합니다.
                  </div>
                </div>
                <button
                  onClick={() => { void handleGenerateQuantum(); }}
                  disabled={isGenerateDisabled}
                  className={`w-full md:w-auto px-6 sm:px-8 py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl font-black text-lg sm:text-xl shadow-[0_0_20px_rgba(147,51,234,0.35)] transition-all transform active:scale-95 flex items-center justify-center gap-2 break-keep ${
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

                    <div className="grid grid-cols-2 gap-4 text-sm text-gray-300 border-t border-gray-700/50 pt-6">
                      <div className="bg-gray-800/80 p-4 rounded-xl border border-gray-700 flex flex-col items-center justify-center">
                        <div className="text-gray-400 mb-2 font-medium">총합</div>
                        <div className="text-2xl font-black text-white">{prediction.stats.sum}</div>
                      </div>
                      <div className="bg-gray-800/80 p-4 rounded-xl border border-gray-700 flex flex-col items-center justify-center">
                        <div className="text-gray-400 mb-2 font-medium">AI 신뢰도</div>
                        <div className="text-2xl font-black text-purple-400">{prediction.confidence}%</div>
                      </div>
                      <div className="bg-gray-800/80 p-4 rounded-xl border border-gray-700 flex flex-col items-center justify-center">
                        <div className="text-gray-400 mb-2 font-medium">홀짝 비율</div>
                        <div className="text-2xl font-black text-blue-300">{prediction.stats.oddEvenRatio}</div>
                      </div>
                      <div className="bg-gray-800/80 p-4 rounded-xl border border-gray-700 flex flex-col items-center justify-center">
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

        {/* ══ [1] 출현 가능성 점수 상위 추천 번호 6개 + 전체 테이블 ══ */}
        {indicatorTable.length > 0 && (() => {
          const top6 = [...indicatorTable].sort((a, b) => b.compositeScore - a.compositeScore).slice(0, 6);
          const sorted45 = [...indicatorTable].sort((a, b) => a.rank - b.rank);
          const getPatObj = (item: FullIndicatorAnalysis) => {
            const { maSignal, rsi } = item;
            if (rsi > 65 && maSignal > 0.015)  return { label: '상승', cls: 'text-red-400 bg-red-900/40 border border-red-800/60' };
            if (rsi < 35 && maSignal < -0.015) return { label: '하락', cls: 'text-blue-400 bg-blue-900/40 border border-blue-800/60' };
            if (Math.abs(maSignal) <= 0.012 && rsi >= 38 && rsi <= 62) return { label: '유지', cls: 'text-gray-400 bg-gray-700/40 border border-gray-600/50' };
            return { label: '변동', cls: 'text-yellow-400 bg-yellow-900/30 border border-yellow-800/60' };
          };
          const getFeat = (item: FullIndicatorAnalysis) => {
            const f: string[] = [];
            if (item.zScore < -1.0)            f.push('장기 저출현');
            else if (item.zScore > 1.0)         f.push('장기 과출현');
            if (item.rsi < 30)                  f.push('RSI 과소');
            else if (item.rsi > 70)             f.push('RSI 과다');
            if (item.bollingerPctB < 0.15)      f.push('BB 하단');
            else if (item.bollingerPctB > 0.85) f.push('BB 상단');
            if (item.aroonOscillator < -60)     f.push('장기 공백');
            else if (item.aroonOscillator > 60) f.push('단기 활성');
            return f.length > 0 ? f.join(' · ') : '평균 범위 내';
          };
          return (
            <div className="bg-gray-800 rounded-2xl p-6 md:p-8 shadow-xl border border-teal-900/50 mt-8">
              <h2 className="text-lg font-bold text-teal-300 border-b border-gray-700 pb-3 mb-5 flex items-center gap-2">
                <span>🏆</span> 출현 가능성 점수 상위 추천 번호 6개
              </h2>

              {/* Top 6 카드 */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
                {top6.map((item, idx) => {
                  const signals: string[] = [];
                  if (item.zScore < -0.5)         signals.push('저출현 회귀');
                  if (item.rsi < 35)              signals.push('RSI 과소');
                  if (item.bollingerPctB < 0.3)   signals.push('BB 하단');
                  if (item.aroonOscillator < -30)  signals.push('장기 공백');
                  if (item.maSignal < -0.01)      signals.push('MA 냉각');
                  const borderCls = item.compositeScore >= 65
                    ? 'border-emerald-700/60 bg-emerald-950/40'
                    : item.compositeScore >= 50
                      ? 'border-yellow-700/60 bg-yellow-950/30'
                      : 'border-gray-700 bg-gray-900/50';
                  const scoreCls = item.compositeScore >= 65 ? 'text-emerald-400' : item.compositeScore >= 50 ? 'text-yellow-400' : 'text-gray-300';
                  return (
                    <div key={item.number}
                         className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 cursor-pointer hover:scale-105 transition-transform ${borderCls}`}
                         onClick={() => handleBallClick(item.number)}>
                      <div className="text-[10px] text-gray-500 font-bold">#{idx + 1}</div>
                      <Ball num={item.number} small />
                      <div className={`text-sm font-black ${scoreCls}`}>{item.compositeScore.toFixed(1)}점</div>
                      <div className="flex flex-col items-center gap-0.5 w-full">
                        {signals.slice(0, 2).map(s => (
                          <span key={s} className="text-[9px] px-1 py-0.5 rounded bg-teal-900/50 text-teal-300 border border-teal-800/60 text-center w-full truncate">{s}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 전체 테이블 토글 */}
              <div className="border border-gray-700 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowFullTable(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-900 hover:bg-gray-700/50 transition-colors"
                >
                  <span className="text-sm font-bold text-gray-300 flex items-center gap-2">
                    <span>📋</span> 전체 데이터 테이블
                    <span className="text-xs text-gray-500 font-normal">— 1~45번 출현 가능성 점수 전체 (순위순)</span>
                  </span>
                  <span className="text-xs text-gray-500 font-bold flex-shrink-0">{showFullTable ? '▲ 접기' : '▼ 펼치기'}</span>
                </button>
                {showFullTable && (
                  <div className="overflow-x-auto border-t border-gray-700">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-900 border-b border-gray-700">
                          <th className="py-2 px-2 text-gray-500 font-bold text-center">순위</th>
                          <th className="py-2 px-2 text-gray-500 font-bold text-center">번호</th>
                          <th className="py-2 px-3 text-teal-400 font-bold text-center">출현 가능성<br/><span className="text-gray-600 font-normal text-[10px]">점수(0~100)</span></th>
                          <th className="py-2 px-2 text-gray-500 font-bold text-center">패턴</th>
                          <th className="py-2 px-3 text-gray-500 font-bold text-left">특징 요약</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted45.map(item => {
                          const patObj = getPatObj(item);
                          const feat = getFeat(item);
                          const rowCls = item.rank <= 6 ? 'bg-teal-950/20' : '';
                          const scoreCls = item.compositeScore >= 65 ? 'text-emerald-400'
                            : item.compositeScore >= 50 ? 'text-yellow-400'
                            : item.compositeScore >= 35 ? 'text-gray-300' : 'text-blue-400';
                          const barCls = item.compositeScore >= 65 ? 'bg-emerald-500'
                            : item.compositeScore >= 50 ? 'bg-yellow-500'
                            : item.compositeScore >= 35 ? 'bg-gray-500' : 'bg-blue-500';
                          return (
                            <tr key={item.number}
                                className={`border-b border-gray-800/60 hover:bg-gray-700/20 transition-colors ${rowCls}`}>
                              <td className="py-1.5 px-2 text-center">
                                <span className={`font-black ${item.rank <= 3 ? 'text-yellow-400' : item.rank <= 6 ? 'text-teal-400' : 'text-gray-600'}`}>
                                  {item.rank}
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-center">
                                <div className="flex justify-center cursor-pointer" onClick={() => handleBallClick(item.number)}>
                                  <Ball num={item.number} small />
                                </div>
                              </td>
                              <td className="py-1.5 px-3 text-center">
                                <div className={`font-black text-sm ${scoreCls}`}>{item.compositeScore.toFixed(1)}</div>
                                <div className="w-full h-1 bg-gray-700 rounded-full mt-0.5 overflow-hidden">
                                  <div className={`h-full rounded-full ${barCls}`} style={{ width: `${item.compositeScore}%` }} />
                                </div>
                              </td>
                              <td className="py-1.5 px-2 text-center">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${patObj.cls}`}>{patObj.label}</span>
                              </td>
                              <td className="py-1.5 px-3">
                                <span className="text-gray-400 text-[11px]">{feat}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ══ [2] 번호 출현 현황 ══ */}
        {stats && (
          <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border border-blue-900/40 mt-8">
            <h2 className="text-lg font-bold text-blue-300 border-b border-gray-700 pb-3 mb-5 flex items-center gap-2">
              <span>🔥</span> 번호 출현 현황
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-gray-900 rounded-xl p-4 border border-red-900/40">
                <div className="text-xs font-bold text-red-400 mb-3 flex items-center gap-1.5">🔥 최다 출현 (Hot 5)</div>
                <div className="flex gap-2 flex-wrap">
                  {stats.hotNumbers.slice(0, 5).map(n => (
                    <Ball key={n} num={n} small onClick={() => handleBallClick(n)} />
                  ))}
                </div>
              </div>
              <div className="bg-gray-900 rounded-xl p-4 border border-blue-900/40">
                <div className="text-xs font-bold text-blue-400 mb-3 flex items-center gap-1.5">❄️ 최소 출현 (Cold 5)</div>
                <div className="flex gap-2 flex-wrap">
                  {stats.coldNumbers.slice(0, 5).map(n => (
                    <Ball key={n} num={n} small onClick={() => handleBallClick(n)} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ [3] 주요 통계 분석 ══ */}
        {/* 출현 빈도 순위 (전체 1~45, 15개씩 3페이지) */}
        <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border border-gray-700 mt-8">
          <div className="flex flex-col sm:flex-row items-center justify-between border-b border-gray-700 pb-4 mb-6 gap-3">
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
          <div className="flex justify-center gap-2 mt-5">
            {[0, 1, 2].map(p => (
              <button
                key={p}
                onClick={() => setFreqPage(p)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${freqPage === p ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
              >
                {p * 15 + 1}위 ~ {p * 15 + 15}위
              </button>
            ))}
          </div>
        </div>

        {/* ══ [4] 보조 분석 — 최근 당첨 번호 ══ */}
        <div className="bg-gray-800 rounded-2xl p-6 md:p-8 shadow-xl border border-gray-700 mt-8">
          <div className="flex flex-col md:flex-row items-center justify-between border-b border-gray-700 pb-4 mb-6">
            <h2 className="text-lg font-bold text-blue-300 flex items-center gap-2"><span>📅</span> 보조 분석 — 최근 당첨 번호</h2>
            <div className="text-xs sm:text-sm text-gray-400 bg-gray-700/40 px-3 py-2 rounded-xl mt-3 md:mt-0 flex flex-col sm:flex-row items-center gap-1 sm:gap-3 text-center break-keep">
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
                        <span className="break-keep">제 {dynamicData.round}회 당첨 번호 분석 리포트</span>
                      </h2>
                    </div>

                    <div className="space-y-6 text-gray-200">
                      {/* 1. 당첨 번호 요약 */}
                      <div className="bg-gray-900/80 p-5 rounded-xl border border-gray-700/50">
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
                        <div className="bg-gray-900/80 p-5 rounded-xl border border-gray-700/50">
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

                        <div className="bg-gray-900/80 p-5 rounded-xl border border-gray-700/50">
                          <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
                            <span>⚖️</span> 홀짝 · 고저
                          </h3>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-gray-800 p-3 rounded-lg text-center border border-gray-700/50">
                              <div className="text-xs text-gray-400 mb-1">홀짝 비율</div>
                              <div className="text-xl font-black text-blue-300">
                                {dynamicData.sections.oddEven.odd} : {dynamicData.sections.oddEven.even}
                              </div>
                            </div>
                            <div className="bg-gray-800 p-3 rounded-lg text-center border border-gray-700/50">
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
                      <div className="bg-gray-900/80 p-5 rounded-xl border border-gray-700/50 flex flex-col sm:flex-row items-center justify-between gap-4">
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
                      <div className="bg-gray-900/80 p-5 rounded-xl border border-gray-700/50">
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
                            <div className="bg-gray-800 p-3 rounded-lg border border-gray-700/50">
                              <div className="text-xs text-gray-400 mb-2">재등장 ({dynamicData.sections.prevCompare.reappeared.length}개)</div>
                              <div className="flex gap-2 flex-wrap">
                                {dynamicData.sections.prevCompare.reappeared.map(n => (
                                  <Ball key={`re-${n}`} num={n} small onClick={() => handleBallClick(n)} />
                                ))}
                              </div>
                            </div>
                            <div className="bg-gray-800 p-3 rounded-lg border border-gray-700/50">
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
                      <div className="bg-gray-900/80 p-5 rounded-xl border border-gray-700/50">
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
          <div ref={analysisReportRef} className="bg-gray-800 rounded-2xl p-6 md:p-8 shadow-xl border border-blue-900/50 mt-8">
            <h2 className="text-xl sm:text-2xl font-bold mb-6 text-blue-300 flex items-center justify-center md:justify-start gap-2 sm:gap-3 border-b border-gray-700 pb-4 break-keep">
              <Ball num={selectedAnalysisNum} small />
              <span className="whitespace-nowrap">선택 번호 정밀 분석 리포트</span>
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="space-y-4 lg:col-span-1">
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700 flex justify-between items-center">
                  <span className="text-gray-400 font-medium">262회차부터 출현 횟수</span>
                  <span className="font-bold text-xl text-white">{repeatAnalysis.totalOccurrences}회</span>
                </div>
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700 flex justify-between items-center">
                  <span className="text-gray-400 font-medium">최근 10회차 내 출현</span>
                  <span className="font-bold text-xl text-white">{repeatAnalysis.recent10Occurrences}회</span>
                </div>
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700 flex justify-between items-center">
                  <span className="text-gray-400 font-medium">최근 30회차 내 출현</span>
                  <span className="font-bold text-xl text-white">{repeatAnalysis.recent30Occurrences}회</span>
                </div>
              </div>

              <div className="space-y-4 lg:col-span-1">
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700 flex justify-between items-center">
                  <span className="text-gray-400 font-medium">연속(이월) 출현 횟수</span>
                  <span className="font-bold text-xl text-white">{repeatAnalysis.repeatAfterOne}회</span>
                </div>
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700 flex justify-between items-center">
                  <span className="text-gray-400 font-medium">평균 출현 간격</span>
                  <span className="font-bold text-xl text-white">{repeatAnalysis.averageGap.toFixed(1)}회</span>
                </div>
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700 flex justify-between items-center">
                  <span className="text-gray-400 font-medium">미출현 기간</span>
                  <span className={`font-bold text-xl ${repeatAnalysis.roundsSinceLastSeen > 10 ? 'text-red-400' : 'text-white'}`}>
                    {repeatAnalysis.roundsSinceLastSeen}회차째
                  </span>
                </div>
              </div>

              <div className="bg-gray-900 p-5 rounded-xl border border-blue-800/50 flex flex-col justify-center lg:col-span-1 relative overflow-hidden">
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
                <p className="text-gray-300 leading-relaxed text-sm md:text-base">{repeatAnalysis.recommendation}</p>
                <div className="mt-4 pt-3 border-t border-gray-800 text-xs text-gray-500">
                  마지막 출현: {repeatAnalysis.lastSeenRound > 0 ? `${repeatAnalysis.lastSeenRound}회차` : '기록 없음'}
                </div>
              </div>
            </div>

            {/* ── 기술 지표 분석 패널 (MA · RSI · 볼린저밴드 · Aroon) ── */}
            <div className="mt-6 bg-gray-900 rounded-xl border border-cyan-800/50 p-5">
              <h3 className="text-sm font-bold text-cyan-400 mb-4 flex items-center gap-2">
                <span>📈</span> 기술 지표 분석
                <span className="text-gray-500 font-normal text-xs">(MA · RSI · 볼린저밴드 · Aroon — 평균 회귀 관점)</span>
              </h3>

              {/* 4개 지표 카드 그리드 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                {/* ① MA 이동평균 */}
                {(() => {
                  const v  = repeatAnalysis.maSignal;
                  const sc = repeatAnalysis.maScore;
                  const isCold = v < -0.01;
                  const isHot  = v > 0.01;
                  const stateBadge = isCold ? { label: '빈도 감소 추세', cls: 'bg-blue-900/60 text-blue-300' }
                                  : isHot  ? { label: '빈도 증가 추세', cls: 'bg-red-900/60 text-red-300' }
                                  :          { label: '중립', cls: 'bg-gray-700 text-gray-400' };
                  const scoreBadge = sc === 1  ? { label: '+1 회귀 신호', cls: 'bg-emerald-800/70 text-emerald-300 border border-emerald-700' }
                                   : sc === -1 ? { label: '−1 억제 신호', cls: 'bg-red-900/70 text-red-300 border border-red-800' }
                                   :             { label: '±0 중립', cls: 'bg-gray-700/80 text-gray-400 border border-gray-600' };
                  return (
                    <div className="bg-gray-800/70 rounded-xl p-4 border border-gray-700/60">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="text-xs font-bold text-cyan-300">이동평균 (MA)</div>
                          <div className="text-xs text-gray-500 mt-0.5">단기(10회) − 장기(30회) 빈도</div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${stateBadge.cls}`}>{stateBadge.label}</span>
                          <span className={`text-[11px] font-black px-2 py-0.5 rounded ${scoreBadge.cls}`}>{scoreBadge.label}</span>
                        </div>
                      </div>
                      <div className="text-xl font-black text-white mt-1">{v > 0 ? '+' : ''}{v.toFixed(4)}</div>
                      <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                        {isCold
                          ? `단기 빈도가 장기보다 낮습니다. 최근 출현 둔화 → 평균 회귀 기대.`
                          : isHot
                          ? `단기 빈도가 장기보다 높습니다. 최근 출현 집중 → 과열 가능성.`
                          : `단기/장기 빈도가 거의 동일합니다. 추세 신호 없음.`}
                      </p>
                      <div className="mt-2 text-[10px] text-gray-600">가중치 20% · 기준: 신호 &lt; −0.01 → +1 / 신호 &gt; +0.01 → −1</div>
                    </div>
                  );
                })()}

                {/* ② RSI */}
                {(() => {
                  const v  = repeatAnalysis.rsi;
                  const sc = repeatAnalysis.rsiScore;
                  const isOversold   = v < 30;
                  const isOverbought = v > 70;
                  const stateBadge = isOversold   ? { label: '과소출현 (과매도)', cls: 'bg-blue-900/60 text-blue-300' }
                                   : isOverbought ? { label: '과다출현 (과매수)', cls: 'bg-red-900/60 text-red-300' }
                                   :               { label: '중립 구간', cls: 'bg-gray-700 text-gray-400' };
                  const scoreBadge = sc === 1  ? { label: '+1 회귀 신호', cls: 'bg-emerald-800/70 text-emerald-300 border border-emerald-700' }
                                   : sc === -1 ? { label: '−1 억제 신호', cls: 'bg-red-900/70 text-red-300 border border-red-800' }
                                   :             { label: '±0 중립', cls: 'bg-gray-700/80 text-gray-400 border border-gray-600' };
                  const barC = isOversold ? 'bg-blue-500' : isOverbought ? 'bg-red-500' : 'bg-yellow-500';
                  return (
                    <div className="bg-gray-800/70 rounded-xl p-4 border border-gray-700/60">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="text-xs font-bold text-cyan-300">RSI 출현 모멘텀</div>
                          <div className="text-xs text-gray-500 mt-0.5">최근 20회 출현/미출현 비율</div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${stateBadge.cls}`}>{stateBadge.label}</span>
                          <span className={`text-[11px] font-black px-2 py-0.5 rounded ${scoreBadge.cls}`}>{scoreBadge.label}</span>
                        </div>
                      </div>
                      <div className="text-xl font-black text-white mt-1">{v.toFixed(1)}</div>
                      <div className="w-full h-2 bg-gray-700 rounded-full mt-2 overflow-hidden">
                        <div className={`h-full rounded-full ${barC}`} style={{ width: `${v}%` }} />
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
                        <span>0 (과매도)</span><span>50</span><span>100 (과매수)</span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                        {isOversold
                          ? `RSI ${v.toFixed(1)} — 최근 출현이 매우 드뭅니다. 통계적 회귀 기대 ↑`
                          : isOverbought
                          ? `RSI ${v.toFixed(1)} — 최근 출현이 집중됩니다. 빈도 억제 가능성.`
                          : `RSI ${v.toFixed(1)} — 정상 범위 내 출현 빈도입니다.`}
                      </p>
                      <div className="mt-2 text-[10px] text-gray-600">가중치 30% · 기준: RSI &lt; 30 → +1 / RSI &gt; 70 → −1</div>
                    </div>
                  );
                })()}

                {/* ③ 볼린저밴드 %B */}
                {(() => {
                  const v  = repeatAnalysis.bollingerPctB;
                  const sc = repeatAnalysis.bbScore;
                  const isBelow = v < 0.15;
                  const isAbove = v > 0.85;
                  const stateBadge = isBelow ? { label: '하단밴드 근처', cls: 'bg-blue-900/60 text-blue-300' }
                                   : isAbove ? { label: '상단밴드 근처', cls: 'bg-red-900/60 text-red-300' }
                                   :           { label: '밴드 내부', cls: 'bg-gray-700 text-gray-400' };
                  const scoreBadge = sc === 1  ? { label: '+1 회귀 신호', cls: 'bg-emerald-800/70 text-emerald-300 border border-emerald-700' }
                                   : sc === -1 ? { label: '−1 억제 신호', cls: 'bg-red-900/70 text-red-300 border border-red-800' }
                                   :             { label: '±0 중립', cls: 'bg-gray-700/80 text-gray-400 border border-gray-600' };
                  const pct    = Math.max(0, Math.min(100, v * 100));
                  const dotPos = `${Math.max(2, Math.min(95, pct))}%`;
                  return (
                    <div className="bg-gray-800/70 rounded-xl p-4 border border-gray-700/60">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="text-xs font-bold text-cyan-300">볼린저밴드 %B</div>
                          <div className="text-xs text-gray-500 mt-0.5">45번호 롤링빈도(30회) 횡단면 밴드</div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${stateBadge.cls}`}>{stateBadge.label}</span>
                          <span className={`text-[11px] font-black px-2 py-0.5 rounded ${scoreBadge.cls}`}>{scoreBadge.label}</span>
                        </div>
                      </div>
                      <div className="text-xl font-black text-white mt-1">{v.toFixed(4)}</div>
                      <div className="relative w-full h-4 mt-2">
                        <div className="absolute inset-y-0 left-0 right-0 bg-gradient-to-r from-blue-900 via-gray-700 to-red-900 rounded-full opacity-50" />
                        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-cyan-400 shadow"
                             style={{ left: dotPos }} />
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
                        <span>LB(0)</span><span>중앙(0.5)</span><span>UB(1)</span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                        {isBelow
                          ? `%B ${v.toFixed(3)} — 45개 번호 중 최하위 빈도권. 횡단면 과소출현.`
                          : isAbove
                          ? `%B ${v.toFixed(3)} — 45개 번호 중 최상위 빈도권. 횡단면 과다출현.`
                          : `%B ${v.toFixed(3)} — 밴드 중앙 근처. 횡단면 평균 수준.`}
                      </p>
                      <div className="mt-2 text-[10px] text-gray-600">가중치 35% · 기준: %B &lt; 0.15 → +1 / %B &gt; 0.85 → −1</div>
                    </div>
                  );
                })()}

                {/* ④ Aroon 오실레이터 */}
                {(() => {
                  const v  = repeatAnalysis.aroonOscillator;
                  const sc = repeatAnalysis.aroonScore;
                  const isActive = v > 50;
                  const isCold   = v < -50;
                  const stateBadge = isActive ? { label: '최근 활성 출현', cls: 'bg-orange-900/60 text-orange-300' }
                                   : isCold   ? { label: '장기 공백 패턴', cls: 'bg-blue-900/60 text-blue-300' }
                                   :            { label: '혼재 신호', cls: 'bg-gray-700 text-gray-400' };
                  const scoreBadge = sc === 1  ? { label: '+1 회귀 신호', cls: 'bg-emerald-800/70 text-emerald-300 border border-emerald-700' }
                                   : sc === -1 ? { label: '−1 억제 신호', cls: 'bg-red-900/70 text-red-300 border border-red-800' }
                                   :             { label: '±0 중립', cls: 'bg-gray-700/80 text-gray-400 border border-gray-600' };
                  const pct    = ((v + 100) / 200) * 100;
                  const dotPos = `${Math.max(2, Math.min(95, pct))}%`;
                  return (
                    <div className="bg-gray-800/70 rounded-xl p-4 border border-gray-700/60">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="text-xs font-bold text-cyan-300">Aroon 오실레이터</div>
                          <div className="text-xs text-gray-500 mt-0.5">마지막 출현 재귀 + 최장 공백</div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${stateBadge.cls}`}>{stateBadge.label}</span>
                          <span className={`text-[11px] font-black px-2 py-0.5 rounded ${scoreBadge.cls}`}>{scoreBadge.label}</span>
                        </div>
                      </div>
                      <div className="text-xl font-black text-white mt-1">{v > 0 ? '+' : ''}{v.toFixed(1)}</div>
                      <div className="relative w-full h-4 mt-2">
                        <div className="absolute inset-y-0 left-0 right-0 bg-gradient-to-r from-blue-900 via-gray-700 to-orange-900 rounded-full opacity-50" />
                        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-cyan-400 shadow"
                             style={{ left: dotPos }} />
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
                        <span>−100(냉각)</span><span>0</span><span>+100(활성)</span>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                        {isActive
                          ? `+${v.toFixed(0)} — 최근에 출현했고 공백이 짧습니다. 단기 활성 상태.`
                          : isCold
                          ? `${v.toFixed(0)} — 오랫동안 미출현하고 최장 공백이 깁니다. 회귀 기대.`
                          : `${v > 0 ? '+' : ''}${v.toFixed(0)} — 출현/공백 신호가 혼재합니다.`}
                      </p>
                      <div className="mt-2 text-[10px] text-gray-600">가중치 15% · 기준: Aroon &lt; −50 → +1 / Aroon &gt; +50 → −1</div>
                    </div>
                  );
                })()}
              </div>{/* end grid */}

              {/* ── 선택 번호 출현 가능성 점수 ── */}
              {indicatorTable.length > 0 && selectedAnalysisNum !== null && (() => {
                const item = indicatorTable.find(d => d.number === selectedAnalysisNum);
                if (!item) return null;
                const { maSignal, rsi } = item;
                const patObj = (() => {
                  if (rsi > 65 && maSignal > 0.015)
                    return { label: '상승', cls: 'text-red-400 bg-red-900/40 border border-red-800/60' };
                  if (rsi < 35 && maSignal < -0.015)
                    return { label: '하락', cls: 'text-blue-400 bg-blue-900/40 border border-blue-800/60' };
                  if (Math.abs(maSignal) <= 0.012 && rsi >= 38 && rsi <= 62)
                    return { label: '유지', cls: 'text-gray-400 bg-gray-700/40 border border-gray-600/50' };
                  return { label: '변동', cls: 'text-yellow-400 bg-yellow-900/30 border border-yellow-800/60' };
                })();
                const featArr: string[] = [];
                if (item.zScore < -1.0)            featArr.push('장기 저출현');
                else if (item.zScore > 1.0)         featArr.push('장기 과출현');
                if (item.rsi < 30)                  featArr.push('RSI 과소');
                else if (item.rsi > 70)             featArr.push('RSI 과다');
                if (item.bollingerPctB < 0.15)      featArr.push('BB 하단');
                else if (item.bollingerPctB > 0.85) featArr.push('BB 상단');
                if (item.aroonOscillator < -60)     featArr.push('장기 공백');
                else if (item.aroonOscillator > 60) featArr.push('단기 활성');
                const feat = featArr.length > 0 ? featArr.join(' · ') : '평균 범위 내';
                const scoreCls = item.compositeScore >= 65 ? 'text-emerald-400'
                  : item.compositeScore >= 50 ? 'text-yellow-400'
                  : item.compositeScore >= 35 ? 'text-gray-300' : 'text-blue-400';
                const barCls = item.compositeScore >= 65 ? 'bg-emerald-500'
                  : item.compositeScore >= 50 ? 'bg-yellow-500'
                  : item.compositeScore >= 35 ? 'bg-gray-500' : 'bg-blue-500';
                return (
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {/* 출현 가능성 점수 */}
                    <div className="bg-gray-800/70 rounded-xl p-4 border border-gray-700/60 flex flex-col items-center justify-center gap-2">
                      <div className="text-xs text-gray-500 font-bold">출현 가능성 점수</div>
                      <div className={`text-2xl font-black ${scoreCls}`}>{item.compositeScore.toFixed(1)}</div>
                      <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${barCls}`} style={{ width: `${item.compositeScore}%` }} />
                      </div>
                      <div className="text-[10px] text-gray-600">0 ~ 100점</div>
                    </div>
                    {/* 패턴 */}
                    <div className="bg-gray-800/70 rounded-xl p-4 border border-gray-700/60 flex flex-col items-center justify-center gap-2">
                      <div className="text-xs text-gray-500 font-bold">패턴</div>
                      <span className={`text-base font-black px-3 py-1 rounded ${patObj.cls}`}>{patObj.label}</span>
                    </div>
                    {/* 특징 요약 */}
                    <div className="bg-gray-800/70 rounded-xl p-4 border border-gray-700/60 flex flex-col items-center justify-center gap-2">
                      <div className="text-xs text-gray-500 font-bold">특징 요약</div>
                      <div className="text-xs text-gray-300 text-center leading-relaxed">{feat}</div>
                    </div>
                  </div>
                );
              })()}

            </div>

            {/* Z-Score 지표 */}
            <div className="mt-6 bg-gray-900 rounded-xl border border-indigo-800/50 p-5">
              <h3 className="text-sm font-bold text-indigo-400 mb-4 flex items-center gap-2">
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
                  <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500">
                    Z-Score = (해당 번호 출현 빈도 − 전체 평균 빈도) ÷ 표준편차 &nbsp;|&nbsp; 전체 1~45번 기준 계산
                  </div>
                </div>
              </div>
            </div>

            {/* 동반 출현 번호 Top 10 */}
            {repeatAnalysis.coOccurrenceTop10.length > 0 && (
              <div className="mt-6 bg-gray-900 rounded-xl border border-purple-800/50 p-5">
                <h3 className="text-sm font-bold text-purple-400 mb-4 flex items-center gap-2">
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
                <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500">
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
