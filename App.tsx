import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeLotto,
  analyzeRepeatProbability,
  calculateBallColor,
  fetchLottoData,
  generateQuantumFlux,
  fetchGithubCombinations,
  LottoStats,
  RepeatAnalysis,
} from './services/lottoService';
import { LottoResult, PredictionResult } from './types';

const Ball: React.FC<{ num: number; isBonus?: boolean; onClick?: () => void; small?: boolean }> = ({
  num,
  isBonus,
  onClick,
  small,
}) => {
  const sizeClass = small ? 'w-8 h-8 text-xs sm:text-sm' : 'w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 text-base sm:text-lg md:text-xl flex-shrink-0';

  return (
    <div
      onClick={onClick}
      className={`${sizeClass} rounded-full flex items-center justify-center font-bold shadow-lg ${
        isBonus ? 'border-4 border-dashed border-gray-300 ' : ''
      }${onClick ? 'cursor-pointer hover:scale-110 transition-transform ' : ''}${calculateBallColor(num)}`}
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
  const analysisReportRef = useRef<HTMLDivElement>(null);

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
      setLoading(false);
    };

    void loadData();
  }, []);

  const chartData = useMemo(() => {
    if (!stats) return [];

    const sorted = Object.entries(stats.frequencies)
      .map(([num, count]) => ({ num: Number(num), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const maxCount = sorted[0]?.count ?? 1;

    return sorted.map((item) => ({
      ...item,
      percentage: (item.count / maxCount) * 100,
    }));
  }, [stats]);

  const generateUniquePredictionSet = (generator: () => PredictionResult, count: number) => {
    const unique = new Map<string, PredictionResult>();
    let attempts = 0;
    const maxAttempts = Math.max(20, count * 20);

    while (unique.size < count && attempts < maxAttempts) {
      const result = generator();
      unique.set(result.numbers.join('-'), result);
      attempts++;
    }

    return Array.from(unique.values());
  };

  const handleGenerateQuantum = () => {
    if (allData.length === 0) return;
    setQuantumPredictions(generateUniquePredictionSet(() => generateQuantumFlux(allData, githubCombinations), combinationCount));
  };

  const handleBallClick = (num: number) => {
    setSelectedAnalysisNum(num);
    setRepeatAnalysis(analyzeRepeatProbability(allData, num, 100));
    setTimeout(() => {
      analysisReportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

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
          <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
            한국 로또 6/45 AI 마스터
          </h1>
          <p className="text-gray-400 text-lg">인공지능과 통계 기반의 번호 예측 시스템</p>
        </div>

        <div className="bg-gray-800 rounded-2xl p-6 md:p-8 shadow-2xl border border-purple-900/50 flex flex-col items-center text-center">
          <h2 className="text-3xl font-extrabold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-400 border-b border-gray-700 pb-4 w-full flex items-center justify-center gap-3">
            <span>🌌</span> 양자 변동 번호 추천
          </h2>
          <p className="text-gray-400 text-sm mb-8 max-w-2xl">
            최근 2회차 당첨 번호의 흐름과 양자 요동값을 결합한 뒤, 파이썬 필터(AC산술복잡도, 합46, 총합 85~189 등)의 고급 조건까지 함께 통과한 최적의 조합만 추출합니다.
          </p>

          <div className="w-full flex flex-col md:flex-row items-center justify-center gap-4 mb-8">
            <div className="flex items-center gap-3 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3">
              <span className="text-sm text-gray-400">출력 조합 수</span>
              <select
                value={combinationCount}
                onChange={(e) => setCombinationCount(Number(e.target.value))}
                className="bg-gray-800 text-white rounded-lg px-3 py-2 border border-gray-600 outline-none"
              >
                {Array.from({ length: 20 }, (_, i) => i + 1).map((count) => (
                  <option key={count} value={count}>
                    {count}개
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleGenerateQuantum}
            className="w-full md:w-2/3 px-8 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-2xl font-black text-2xl shadow-[0_0_20px_rgba(147,51,234,0.4)] transition-all transform hover:scale-[1.02] active:scale-95 mb-8 flex items-center justify-center gap-3"
          >
            <span>🚀</span> 양자 변동 번호 추출
          </button>

          {quantumPredictions.length > 0 && (
            <div className="w-full grid grid-cols-1 xl:grid-cols-2 gap-4 animate-fade-in">
              {quantumPredictions.map((prediction, index) => (
                <div key={prediction.numbers.join('-')} className="bg-gray-900/80 rounded-2xl p-6 border border-purple-900/50 shadow-inner">
                  <div className="text-left text-sm text-purple-300 font-bold mb-4">양자 조합 #{index + 1}</div>
                  <div className="flex flex-nowrap justify-center gap-2 sm:gap-3 md:gap-4 mb-6">
                    {prediction.numbers.map((num, i) => (
                      <Ball key={i} num={num} onClick={() => handleBallClick(num)} />
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

                  <div className="mt-4 p-4 bg-gray-800/50 rounded-lg border border-gray-700/50 text-sm text-gray-300 text-left">
                    <span className="font-bold text-gray-400 mr-2">적용된 알고리즘:</span>
                    {prediction.formulasUsed.join(', ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>





        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
          <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border border-gray-700">
            <div className="flex flex-col items-center border-b border-gray-700 pb-4 mb-6">
              <h3 className="text-xl font-bold text-blue-300">최근 많이 나온 번호 (Top 15)</h3>
              <div className="text-xs text-yellow-400 mt-2">💡 공을 클릭하여 정밀 분석 확인</div>
            </div>
            <div className="space-y-3">
              {chartData.map((item, index) => (
                <div key={item.num} className="flex items-center gap-3 relative">
                  <div className={`w-8 sm:w-10 font-bold text-right flex-shrink-0 ${index < 3 ? 'text-yellow-400' : index < 5 ? 'text-gray-300' : 'text-gray-500'}`}>
                    <span className="whitespace-nowrap">{index + 1}위</span>
                  </div>
                  <div className="w-10 flex-shrink-0 flex justify-center">
                    <Ball num={item.num} small onClick={() => handleBallClick(item.num)} />
                  </div>
                  <div className="flex-1 h-6 bg-gray-900 rounded-full overflow-hidden flex items-center">
                    <div
                      className={`h-full ${index < 5 ? 'bg-blue-500' : 'bg-gray-600'} transition-all duration-500`}
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                  <div className="w-12 text-right font-medium text-gray-300 flex-shrink-0 text-sm sm:text-base">
                    <span className="whitespace-nowrap">{item.count}회</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border border-gray-700 flex flex-col">
            <h3 className="text-xl font-bold mb-6 text-blue-300 text-center border-b border-gray-700 pb-4">종합 통계 요약</h3>
            {stats && (
              <div className="space-y-6 flex-1 flex flex-col justify-center">
                <div className="bg-gray-900 p-5 rounded-xl border border-gray-700">
                  <div className="text-sm text-gray-400 mb-3 font-medium flex items-center gap-2">
                    <span className="text-red-400">🔥</span> 가장 많이 나온 번호 (Hot 5)
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {stats.hotNumbers.slice(0, 5).map((n) => (
                      <Ball key={n} num={n} onClick={() => handleBallClick(n)} />
                    ))}
                  </div>
                </div>

                <div className="bg-gray-900 p-5 rounded-xl border border-gray-700">
                  <div className="text-sm text-gray-400 mb-3 font-medium flex items-center gap-2">
                    <span className="text-blue-400">❄️</span> 가장 안 나온 번호 (Cold 5)
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {stats.coldNumbers.slice(0, 5).map((n) => (
                      <Ball key={n} num={n} onClick={() => handleBallClick(n)} />
                    ))}
                  </div>
                </div>

                <div className="flex justify-between bg-gray-900 p-5 rounded-xl border border-gray-700">
                  <div>
                    <div className="text-sm text-gray-400 mb-1 font-medium">평균 총합</div>
                    <div className="text-2xl font-bold text-white">{stats.averageSum}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-400 mb-1 font-medium">평균 홀짝 비율</div>
                    <div className="text-2xl font-bold text-blue-300">{stats.oddEvenAverage}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-6 md:p-8 shadow-xl border border-gray-700 mt-8">
          <div className="flex flex-col md:flex-row items-center justify-between border-b border-gray-700 pb-4 mb-6">
            <h2 className="text-2xl font-bold text-blue-300">최근 당첨 번호</h2>
            <div className="text-sm text-yellow-400 bg-yellow-400/10 px-3 py-1.5 rounded-full mt-3 md:mt-0 flex items-center gap-2 animate-pulse">
              <span>💡</span> 공을 클릭하면 해당 번호의 <strong>정밀 분석 리포트</strong>를 볼 수 있습니다.
            </div>
          </div>
          <div className="space-y-4">
            {allData.slice(0, 10).map((draw, idx) => (
              <div
                key={idx}
                className="flex flex-col md:flex-row items-center justify-between bg-gray-900 p-5 rounded-xl border border-gray-700 hover:border-gray-500 transition-colors"
              >
                <div className="text-center md:text-left mb-4 md:mb-0 w-32 flex-shrink-0">
                  <div className="text-xl font-black text-white">{draw.round}회차</div>
                  <div className="text-sm text-gray-400 mt-1">{draw.date}</div>
                </div>
                <div className="flex items-center gap-1 sm:gap-2 flex-nowrap justify-center">
                  {draw.numbers.map((num, i) => (
                    <Ball key={i} num={num} onClick={() => handleBallClick(num)} />
                  ))}
                  <div className="text-gray-500 text-3xl mx-2 font-light">+</div>
                  <Ball num={draw.bonus} isBonus onClick={() => handleBallClick(draw.bonus)} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {selectedAnalysisNum && repeatAnalysis && (
          <div ref={analysisReportRef} className="bg-gray-800 rounded-2xl p-6 md:p-8 shadow-xl border border-blue-900/50 mt-8">
            <h2 className="text-2xl font-bold mb-6 text-blue-300 flex items-center gap-3 border-b border-gray-700 pb-4">
              <Ball num={selectedAnalysisNum} small />
              <span>선택 번호 정밀 분석 리포트</span>
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="space-y-4 lg:col-span-1">
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-700 flex justify-between items-center">
                  <span className="text-gray-400 font-medium">전체 출현 횟수</span>
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
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
