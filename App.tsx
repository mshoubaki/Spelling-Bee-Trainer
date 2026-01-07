
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { GameState, WordData, TileItem, RoundStats, StageProgress } from './types.ts';
import { WORDS, COLORS } from './constants.ts';
import { generateTilePool, isAlpha } from './utils/helpers.ts';
import KittyMascot from './components/KittyMascot.tsx';
import { Play, RotateCcw, Volume2, Home, Trophy, Sparkles, Loader2, ChevronRight, Lock, Star, FastForward } from 'lucide-react';
import confetti from 'canvas-confetti';

function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const WORDS_PER_STAGE = 10;

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.START);
  const [currentStageIdx, setCurrentStageIdx] = useState(0);
  const [currentWordInStageIdx, setCurrentWordInStageIdx] = useState(0);
  const [userTyped, setUserTyped] = useState<string>('');
  const [tilePool, setTilePool] = useState<TileItem[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [sessionHistory, setSessionHistory] = useState<RoundStats[]>([]);
  const [shake, setShake] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  
  // Persistent progress
  const [stagesProgress, setStagesProgress] = useState<StageProgress[]>(() => {
    const saved = localStorage.getItem('kitty_speller_progress');
    if (saved) return JSON.parse(saved);
    const initial = Array.from({ length: 10 }, (_, i) => ({
      stars: 0,
      isUnlocked: i === 0,
      correctCount: 0
    }));
    return initial;
  });

  useEffect(() => {
    localStorage.setItem('kitty_speller_progress', JSON.stringify(stagesProgress));
  }, [stagesProgress]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const globalWordIdx = (currentStageIdx * WORDS_PER_STAGE) + currentWordInStageIdx;
  const currentWord = WORDS[globalWordIdx]?.word.toUpperCase() || '';

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  };

  const playTTSFallback = async (text: string) => {
    setIsGeneratingAudio(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say clearly: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
        const audioBuffer = await decodeAudioData(decodeBase64(base64Audio), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start();
      }
    } catch (err) {
      console.error("TTS Fallback failed:", err);
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const playWordAudio = useCallback((idx: number) => {
    if (audioRef.current && WORDS[idx]) {
      audioRef.current.pause();
      audioRef.current.src = WORDS[idx].audio;
      audioRef.current.load();
      audioRef.current.play().catch(() => {
        playTTSFallback(WORDS[idx].word);
      });
    }
  }, []);

  const initRound = useCallback((stageIdx: number, wordInStageIdx: number) => {
    const globalIdx = (stageIdx * WORDS_PER_STAGE) + wordInStageIdx;
    if (globalIdx >= WORDS.length || wordInStageIdx >= WORDS_PER_STAGE) {
      handleStageEnd(stageIdx);
      return;
    }

    const word = WORDS[globalIdx].word.toUpperCase();
    const pool = generateTilePool(word);
    
    setTilePool(pool);
    setUserTyped('');
    setMistakes(0);
    setStartTime(Date.now());
    setGameState(GameState.PLAYING);
    
    setTimeout(() => {
      playWordAudio(globalIdx);
    }, 600);
  }, [playWordAudio]);

  const handleStageEnd = (stageIdx: number) => {
    const correctCount = sessionHistory.filter(h => !h.skipped).length;
    let stars = 0;
    if (correctCount === 10) stars = 3;
    else if (correctCount >= 7) stars = 2;
    else if (correctCount >= 3) stars = 1;

    const nextUnlocked = stars >= 1;

    setStagesProgress(prev => {
      const next = [...prev];
      // Update current stage stars if better
      if (stars > next[stageIdx].stars) {
        next[stageIdx].stars = stars;
      }
      next[stageIdx].correctCount = Math.max(next[stageIdx].correctCount, correctCount);
      
      // Unlock next stage if 3+ correct
      if (nextUnlocked && stageIdx < 9) {
        next[stageIdx + 1].isUnlocked = true;
      }
      return next;
    });

    setGameState(GameState.GAME_OVER);
  };

  const handleWin = () => {
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#f472b6', '#a855f7', '#ec4899']
    });

    const timeSpent = Math.round((Date.now() - startTime) / 1000);
    const roundStat: RoundStats = {
      word: currentWord,
      mistakes,
      timeSpent,
      skipped: false
    };

    setSessionHistory(prev => [...prev, roundStat]);
    setGameState(GameState.CELEBRATING);
  };

  const skipWord = () => {
    const roundStat: RoundStats = {
      word: currentWord,
      mistakes: 0,
      timeSpent: 0,
      skipped: true
    };
    setSessionHistory(prev => [...prev, roundStat]);
    
    const nextIdxInStage = currentWordInStageIdx + 1;
    if (nextIdxInStage < WORDS_PER_STAGE) {
      setCurrentWordInStageIdx(nextIdxInStage);
      initRound(currentStageIdx, nextIdxInStage);
    } else {
      handleStageEnd(currentStageIdx);
    }
  };

  const nextWord = () => {
    const nextIdxInStage = currentWordInStageIdx + 1;
    if (nextIdxInStage < WORDS_PER_STAGE) {
      setCurrentWordInStageIdx(nextIdxInStage);
      initRound(currentStageIdx, nextIdxInStage);
    } else {
      handleStageEnd(currentStageIdx);
    }
  };

  const selectStage = (idx: number) => {
    if (!stagesProgress[idx].isUnlocked) return;
    setCurrentStageIdx(idx);
    setCurrentWordInStageIdx(0);
    setSessionHistory([]);
    initRound(idx, 0);
  };

  const handleTileClick = (tile: TileItem) => {
    if (gameState !== GameState.PLAYING || tile.isUsed) return;
    const nextCharIndex = userTyped.length;
    const targetChar = currentWord[nextCharIndex];

    if (tile.letter === targetChar) {
      const nextTyped = userTyped + tile.letter;
      setUserTyped(nextTyped);
      setTilePool(prev => prev.map(t => t.id === tile.id ? { ...t, isUsed: true } : t));
      if (nextTyped === currentWord) handleWin();
    } else {
      setMistakes(prev => prev + 1);
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  const renderStart = () => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-8 animate-in fade-in zoom-in duration-500">
      <div className="relative">
        <KittyMascot className="w-48 h-48 drop-shadow-xl" />
        <div className="absolute -top-4 -right-4 bg-white p-3 rounded-full shadow-lg animate-bounce">
          <Sparkles className="text-yellow-400 w-6 h-6" />
        </div>
      </div>
      <div className="space-y-4">
        <h1 className={`text-6xl font-extrabold ${COLORS.primary} tracking-tight font-brand`}>
          Kitty Spells
        </h1>
        <p className={`text-2xl ${COLORS.secondary} font-medium`}>
          Choose a stage to start learning!
        </p>
      </div>
      <button
        onClick={() => { getAudioContext(); setGameState(GameState.STAGE_SELECT); }}
        className={`${COLORS.button} text-white px-12 py-6 rounded-full text-3xl font-bold shadow-2xl hover:scale-105 transition-transform active:scale-95 flex items-center gap-4 group font-brand`}
      >
        <Play fill="currentColor" className="w-10 h-10" />
        GO TO STAGES
      </button>
    </div>
  );

  const renderStageSelect = () => (
    <div className="flex flex-col items-center w-full max-w-5xl mx-auto space-y-10 py-8 animate-in fade-in slide-in-from-bottom-8">
      <div className="text-center space-y-2">
        <h2 className="text-5xl font-brand text-purple-700">Pick a Stage</h2>
        <p className="text-pink-500 font-medium text-lg">Unlock next stages by getting 3 words right!</p>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-5 gap-6 w-full px-4">
        {stagesProgress.map((prog, i) => (
          <div key={i} className="flex flex-col items-center space-y-3">
            <button
              onClick={() => selectStage(i)}
              disabled={!prog.isUnlocked}
              className={`w-full aspect-square rounded-3xl flex flex-col items-center justify-center relative transition-all transform shadow-lg
                ${prog.isUnlocked 
                  ? 'bg-white hover:scale-105 active:scale-95 border-b-8 border-purple-200 cursor-pointer' 
                  : 'bg-gray-200 grayscale opacity-60 cursor-not-allowed border-none shadow-none'}
              `}
            >
              {!prog.isUnlocked ? (
                <Lock className="w-12 h-12 text-gray-400" />
              ) : (
                <>
                  <span className="text-4xl font-brand text-purple-600 mb-1">{i + 1}</span>
                  <span className="text-xs font-bold text-pink-400 uppercase tracking-widest">Stage</span>
                </>
              )}
            </button>
            
            <div className="flex gap-1 h-6">
              {prog.isUnlocked && Array.from({ length: 3 }).map((_, s) => (
                <Star 
                  key={s} 
                  size={20} 
                  className={s < prog.stars ? "fill-yellow-400 text-yellow-500" : "text-gray-300 fill-gray-100"} 
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <button onClick={() => setGameState(GameState.START)} className="flex items-center gap-2 text-purple-500 hover:text-pink-600 font-bold transition-colors">
        <Home className="w-6 h-6" /> Main Menu
      </button>
    </div>
  );

  const renderPlaying = () => (
    <div className={`flex flex-col items-center space-y-12 w-full max-w-4xl mx-auto ${shake ? 'animate-shake' : ''}`}>
      <div className="flex justify-between w-full px-6 py-4 bg-white/50 backdrop-blur-sm rounded-2xl shadow-sm border border-pink-200 items-center">
        <div className="flex flex-col">
          <span className="text-xs font-bold text-pink-400 uppercase">Stage {currentStageIdx + 1}</span>
          <span className="font-brand text-2xl text-purple-700">Word {currentWordInStageIdx + 1} / 10</span>
        </div>
        <div className="flex gap-4">
          <div className="px-4 py-2 rounded-xl bg-red-100 text-red-600 font-bold border border-red-200 text-sm">
            Errors: {mistakes}
          </div>
          <button 
            onClick={skipWord}
            className="px-4 py-2 rounded-xl bg-purple-100 text-purple-600 font-bold border border-purple-200 text-sm flex items-center gap-2 hover:bg-purple-200 transition-colors"
          >
            Skip <FastForward size={16} />
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center gap-6">
        <div className="relative">
          <KittyMascot className="w-32 h-32" />
          <button
            onClick={() => playWordAudio(globalWordIdx)}
            disabled={isGeneratingAudio}
            className="absolute -bottom-2 -right-2 p-4 bg-white rounded-full shadow-xl text-purple-600 hover:text-pink-500 hover:scale-110 transition-all border-2 border-purple-100 disabled:opacity-50"
          >
            {isGeneratingAudio ? <Loader2 className="w-8 h-8 animate-spin" /> : <Volume2 className="w-8 h-8" />}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap justify-center min-h-[80px]">
          {currentWord.split('').map((char, i) => (
            <div
              key={i}
              className={`w-12 h-16 border-b-4 flex items-center justify-center text-4xl font-brand transition-all
                ${userTyped[i] ? 'border-pink-500 text-purple-700 bg-pink-50' : 'border-gray-300 text-transparent bg-white/30'}`}
            >
              {userTyped[i] || ''}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3 p-6 bg-white/40 rounded-3xl backdrop-blur-md shadow-inner border border-white/50">
        {tilePool.map((tile) => (
          <button
            key={tile.id}
            onClick={() => handleTileClick(tile)}
            disabled={tile.isUsed}
            className={`w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center text-3xl font-brand rounded-2xl shadow-lg transition-all transform
              ${tile.isUsed 
                ? 'bg-gray-200 text-gray-400 scale-90 cursor-not-allowed opacity-40 shadow-none' 
                : 'bg-white text-purple-600 hover:-translate-y-1 hover:shadow-xl active:translate-y-0 active:scale-95 border-b-4 border-purple-100'
              }`}
          >
            {tile.letter}
          </button>
        ))}
      </div>
      
      <button onClick={() => setGameState(GameState.STAGE_SELECT)} className="flex items-center gap-2 text-purple-400 hover:text-pink-600 font-bold transition-colors">
        Quit to Stages
      </button>
    </div>
  );

  const renderCelebrating = () => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-8 animate-in zoom-in duration-500">
      <div className="relative">
        <KittyMascot className="w-48 h-48" />
        <div className="absolute top-0 left-0 w-full h-full animate-ping opacity-20">
          <KittyMascot className="w-full h-full" />
        </div>
      </div>
      <div className="space-y-2">
        <h2 className="text-5xl font-brand text-pink-500">PAW-SOME!</h2>
        <p className="text-6xl font-brand text-purple-700 tracking-widest">{currentWord}</p>
        <p className="text-xl text-purple-400 font-medium pt-4">Speedy spell! Next word coming up...</p>
      </div>
      <button
        onClick={nextWord}
        className={`${COLORS.button} text-white px-12 py-5 rounded-full text-2xl font-brand shadow-2xl hover:scale-105 transition-transform flex items-center gap-3`}
      >
        NEXT WORD <ChevronRight className="w-8 h-8" />
      </button>
    </div>
  );

  const renderGameOver = () => {
    const correctCount = sessionHistory.filter(h => !h.skipped).length;
    let stars = 0;
    if (correctCount === 10) stars = 3;
    else if (correctCount >= 7) stars = 2;
    else if (correctCount >= 3) stars = 1;

    return (
      <div className="flex flex-col items-center w-full max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700 py-8">
        <div className="text-center space-y-4">
          <h2 className="text-5xl font-brand text-purple-700">Stage {currentStageIdx + 1} Complete!</h2>
          <div className="flex justify-center gap-4 py-4">
            {Array.from({ length: 3 }).map((_, s) => (
              <div key={s} className="relative">
                <Star 
                  size={80} 
                  className={`drop-shadow-lg ${s < stars ? "fill-yellow-400 text-yellow-500" : "text-gray-200 fill-gray-50"}`}
                />
                {s < stars && <Sparkles className="absolute -top-2 -right-2 text-white w-6 h-6 animate-pulse" />}
              </div>
            ))}
          </div>
          <p className="text-2xl font-brand text-pink-500">
            {stars === 3 ? "PERFECT SCORE!" : stars >= 1 ? "GREAT JOB!" : "KEEP PRACTICING!"}
          </p>
          <p className="text-purple-400 text-xl font-medium">You got {correctCount} out of 10 words right!</p>
        </div>

        <div className="flex flex-col gap-4 w-full">
          <button
            onClick={() => {
              setCurrentWordInStageIdx(0);
              setSessionHistory([]);
              initRound(currentStageIdx, 0);
            }}
            className={`${COLORS.button} text-white px-10 py-5 rounded-full text-2xl font-brand shadow-2xl hover:scale-105 transition-transform flex items-center justify-center gap-3`}
          >
            <RotateCcw className="w-6 h-6" /> TRY STAGE AGAIN
          </button>
          
          <button
            onClick={() => setGameState(GameState.STAGE_SELECT)}
            className="bg-white text-purple-600 border-4 border-purple-100 px-10 py-5 rounded-full text-2xl font-brand shadow-xl hover:bg-purple-50 transition-all flex items-center justify-center gap-3"
          >
             BACK TO STAGES
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className={`min-h-screen ${COLORS.bg} selection:bg-purple-200 p-4 sm:p-8 overflow-x-hidden`}>
      <audio ref={audioRef} />
      <main className="max-w-5xl mx-auto min-h-[85vh] flex items-center justify-center">
        {gameState === GameState.START && renderStart()}
        {gameState === GameState.STAGE_SELECT && renderStageSelect()}
        {gameState === GameState.PLAYING && renderPlaying()}
        {gameState === GameState.CELEBRATING && renderCelebrating()}
        {gameState === GameState.GAME_OVER && renderGameOver()}
      </main>

      {isGeneratingAudio && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-purple-600 text-white px-6 py-3 rounded-full shadow-2xl font-brand animate-bounce">
          <Sparkles className="w-5 h-5 text-yellow-300" />
          AI Magic voice coming...
        </div>
      )}

      <style>{`
        .font-brand { font-family: 'Bubblegum Sans', cursive; }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }
        .animate-shake { animation: shake 0.2s ease-in-out 0s 2; }
      `}</style>
    </div>
  );
};

export default App;
