import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  fetchLottoData,
  analyzeLotto,
  generatePrediction,
  calculateBallColor,
  LottoStats
} from './services/lottoService';
import { LottoResult, PredictionResult } from './types';

const COLORS = ['#22d3ee', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

const Ball: React.FC<{ num: number, isBonus?: boolean }> = ({ num, isBonus }) => (
  <div className={`w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center text-lg md:text-xl font-bold shadow-lg 
    ${isBonus ? 'border-4 border-dashed border-gray-300 ' : ''} 
    ${calculateBallColor(num)}`}>
    {num}
  </div>
);

const App: React.FC = () => {
  const [allData, setAllData] = useState<LottoResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentSyncRound, setCurrentSyncRound] = useState(0);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [stats, setStats] = useState<LottoStats | null>(null);
  const [predictionMode, setPredictionMode] = useState<'BALANCED' | 'HOT' | 'COLD' | 'AI_HYBRID' | 'ADVANCED_FILTER'>('ADVANCED_FILTER');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setProgress(0);
    const data = await fetchLottoData((prog, round) => {
      setProgress(prog);
      setCurrentSyncRound(round);
    });
    setAllData(data);
    setStats(analyzeLotto(data));
    setLoading(false);
  };

  const handleGenerate = () => {
    if (allData.length > 0) {
      setPrediction(generatePrediction(allData, predictionMode));
    }
  };

  const chartData = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.frequencies)
      .map(([num, count]) => ({ num: parseInt(num, 10), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15); // Top 15 numbers
  }, [stats]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center space-y-4">
        <div className="text-2xl animate-pulse font-bold text-blue-400">동행복권 당첨 이력 동기화 중...</div>
        <div className="text-lg text-gray-400">
          {progress < 100 ? `현재 ${currentSyncRound}회차 수집 중 (${progress}%)` : '분석 중...'}
        </div>
        <div className="w-64 h-3 bg-gray-700 rounded-full overflow-hidden">
          <div 
            className="h-full bg-blue-500 transition-all duration-300 ease-out" 
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-sm text-gray-500 mt-2 text-center px-4">
          262회차부터 최신 회차까지 누락된 데이터를 가져오고 있습니다.<br/>
          (데이터는 로컬에 캐시되어 다음부터는 빠르게 로드됩니다)
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
            한국 로또 6/45 AI 마스터
          </h1>
          <p className="text-gray-400 text-lg">인공지능과 통계 기반의 번호 예측 시스템</p>
        </div>

        {/* Prediction Section */}
        <div className="bg-gray-800 rounded-2xl p-6 shadow-2xl border border-gray-700 flex flex-col items-center text-center">
          <h2 className="text-2xl font-bold mb-6 text-blue-300">AI 번호 추천</h2>
          
          <div className="flex flex-wrap justify-center gap-4 mb-8">
            {(['ADVANCED_FILTER', 'AI_HYBRID', 'BALANCED', 'HOT', 'COLD'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setPredictionMode(mode)}
                className={`px-4 py-2 rounded-full font-semibold transition-all ${
                  predictionMode === mode 
                    ? 'bg-blue-600 text-white shadow-lg scale-105' 
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {mode === 'ADVANCED_FILTER' ? '파이썬 필터' : mode === 'AI_HYBRID' ? 'AI 앙상블' : mode === 'BALANCED' ? '균형형' : mode === 'HOT' ? '다출현형' : '미출현형'}
              </button>
            ))}
          </div>

          <button 
            onClick={handleGenerate}
            className="w-full md:w-auto px-12 py-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-white rounded-xl font-bold text-xl shadow-[0_0_15px_rgba(16,185,129,0.5)] transition-all transform hover:scale-105 active:scale-95 mb-8"
          >
            추천 번호 생성하기
          </button>

          {prediction && (
            <div className="w-full bg-gray-900 rounded-xl p-6 border border-gray-700 animate-fade-in">
              <div className="flex flex-wrap justify-center gap-3 md:gap-4 mb-6">
                {prediction.numbers.map((num, i) => (
                  <Ball key={i} num={num} />
                ))}
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-300 mt-6 border-t border-gray-700 pt-6">
                <div className="bg-gray-800 p-3 rounded-lg">
                  <div className="text-gray-500 mb-1">총합</div>
                  <div className="text-xl font-bold text-white">{prediction.stats.sum}</div>
                </div>
                <div className="bg-gray-800 p-3 rounded-lg">
                  <div className="text-gray-500 mb-1">홀짝 비율</div>
                  <div className="text-xl font-bold text-white">{prediction.stats.oddEvenRatio}</div>
                </div>
                <div className="bg-gray-800 p-3 rounded-lg">
                  <div className="text-gray-500 mb-1">고저 비율</div>
                  <div className="text-xl font-bold text-white">{prediction.stats.highLowRatio}</div>
                </div>
                <div className="bg-gray-800 p-3 rounded-lg">
                  <div className="text-gray-500 mb-1">AI 신뢰도</div>
                  <div className="text-xl font-bold text-emerald-400">{prediction.confidence}%</div>
                </div>
              </div>
              <div className="mt-4 text-sm text-gray-400">
                적용된 알고리즘: {prediction.formulasUsed.join(', ')}
              </div>
            </div>
          )}
        </div>

        {/* Stats Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border border-gray-700">
            <h3 className="text-xl font-bold mb-4 text-blue-300 text-center">최근 많이 나온 번호 (Top 15)</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="num" stroke="#9ca3af" />
                  <YAxis stroke="#9ca3af" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '0.5rem', color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border border-gray-700">
            <h3 className="text-xl font-bold mb-4 text-blue-300 text-center">종합 통계 요약</h3>
            {stats && (
              <div className="space-y-4">
                <div className="bg-gray-900 p-4 rounded-lg">
                  <div className="text-sm text-gray-400 mb-2">가장 많이 나온 번호 (Hot 5)</div>
                  <div className="flex gap-2 flex-wrap">
                    {stats.hotNumbers.slice(0, 5).map(n => <Ball key={n} num={n} />)}
                  </div>
                </div>
                <div className="bg-gray-900 p-4 rounded-lg">
                  <div className="text-sm text-gray-400 mb-2">가장 안 나온 번호 (Cold 5)</div>
                  <div className="flex gap-2 flex-wrap">
                    {stats.coldNumbers.slice(0, 5).map(n => <Ball key={n} num={n} />)}
                  </div>
                </div>
                <div className="flex justify-between bg-gray-900 p-4 rounded-lg">
                  <div>
                    <div className="text-sm text-gray-400">평균 총합</div>
                    <div className="text-xl font-bold">{stats.averageSum}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-400">평균 홀짝 비율</div>
                    <div className="text-xl font-bold">{stats.oddEvenAverage}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* History Section */}
        <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border border-gray-700">
          <h2 className="text-2xl font-bold mb-6 text-blue-300 text-center">최근 추첨 결과 (모의 데이터)</h2>
          <div className="space-y-4">
            {allData.slice(0, 10).map((draw, idx) => (
              <div key={idx} className="flex flex-col md:flex-row items-center justify-between bg-gray-900 p-4 rounded-xl border border-gray-700">
                <div className="text-center md:text-left mb-4 md:mb-0">
                  <div className="text-lg font-bold text-white">{draw.round}회차</div>
                  <div className="text-sm text-gray-400">{draw.date}</div>
                </div>
                <div className="flex items-center gap-2">
                  {draw.numbers.map((num, i) => (
                    <Ball key={i} num={num} />
                  ))}
                  <div className="text-gray-500 text-2xl mx-1">+</div>
                  <Ball num={draw.bonus} isBonus={true} />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default App;
