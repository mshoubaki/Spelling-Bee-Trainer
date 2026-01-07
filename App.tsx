import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { GameState, TileItem, RoundStats, StageProgress } from './types';
import { WORDS, COLORS } from './constants';
import { generateTilePool } from './utils/helpers';
import KittyMascot from './components/KittyMascot';
import { Play, Volume2, Home, Loader2, ChevronRight, Lock, Star, FastForward, Sparkles } from 'lucide-react';
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
  
  const [stagesProgress, setStagesProgress] = useState<StageProgress[]>(() => {
    const saved = localStorage.getItem('kitty_speller_progress');
    if (saved) return JSON.parse(saved);
    return Array.from({ length: 10 }, (_, i) => ({
      stars: 0,
      isUnlocked: i === 0,
      correctCount: 0
    }));
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
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
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
      audioRef.current.play().catch(() => playTTSFallback(WORDS[idx].word));
    }
  }, []);

  const initRound = useCallback((stageIdx: number, wordInStageIdx: number) => {
    const globalIdx = (stageIdx * WORDS_PER_STAGE) + wordInStageIdx;
    if (globalIdx >= WORDS.length || wordInStageIdx >= WORDS_PER_STAGE) {
      setGameState(GameState.GAME_OVER);
      return;
    }

    setTilePool(generateTilePool(WORDS[globalIdx].word.toUpperCase()));
    setUserTyped('');
    setMistakes(0);
    setStartTime(Date.now());
    setGameState(GameState.PLAYING);
    
    setTimeout(() => playWordAudio(globalIdx), 600);
  }, [playWordAudio]);

  const handleStageEnd = () => {
    const correctCount = sessionHistory.filter(h => !h.skipped).length;
    let stars = 0;
    if (correctCount === 10) stars = 3;
    else if (correctCount >= 7) stars = 2;
    else if (correctCount >= 3) stars = 1;

    setStagesProgress(prev => {
      const next = [...prev];
      const stage = next[currentStageIdx];
      if (stars > stage.stars) stage.stars = stars;
      stage.correctCount = Math.max(stage.correctCount, correctCount);
      if (stars >= 1 && currentStageIdx < 9) next[currentStageIdx + 1].isUnlocked = true;
      return next;
    });
    setGameState(GameState.GAME_OVER);
  };

  const handleWin = () => {
    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#f472b6', '#a855f7', '#ec4899'] });
    const stat: RoundStats = { word: currentWord, mistakes, timeSpent: Math.round((Date.now() - startTime) / 1000), skipped: false };
    setSessionHistory(prev => [...prev, stat]);
    setGameState(GameState.CELEBRATING);
  };

  const skipWord = () => {
    const stat: RoundStats = { word: currentWord, mistakes: 0, timeSpent: 0, skipped: true };
    setSessionHistory(prev => [...prev, stat]);
    const nextIdx = currentWordInStageIdx + 1;
    if (nextIdx < WORDS_PER_STAGE) {
      setCurrentWordInStageIdx(nextIdx);
      initRound(currentStageIdx, nextIdx);
    } else {
      handleStageEnd();
    }
  };

  const nextWord = () => {
    const nextIdx = currentWordInStageIdx + 1;
    if (nextIdx < WORDS_PER_STAGE) {
      setCurrentWordInStageIdx(nextIdx);
      initRound(currentStageIdx, nextIdx);
    } else {
      handleStageEnd();
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
    if (tile.letter === currentWord[userTyped.length]) {
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

  return (
    <div className={`min-h-screen ${COLORS.bg} p-4 sm:p-8 selection:bg-purple-200 overflow-x-hidden`}>
      <audio ref={audioRef} />
      <main className="max-w-5xl mx-auto min-h-[85vh] flex items-center justify-center">
        {gameState === GameState.START && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-8 animate-in fade-in zoom-in duration-500">
            <KittyMascot className="w-48 h-48 drop-shadow-xl" />
            <h1 className={`text-6xl font-extrabold ${COLORS.primary} font-brand tracking-tight`}>Kitty Spells</h1>
            <button onClick={() => { getAudioContext(); setGameState(GameState.STAGE_SELECT); }} className={`${COLORS.button} text-white px-12 py-6 rounded-full text-3xl font-bold font-brand shadow-2xl hover:scale-105 active:scale-95 transition-transform flex items-center gap-4`}>
              <Play fill="currentColor" className="w-10 h-10" /> GO TO STAGES
            </button>
          </div>
        )}
        {gameState === GameState.STAGE_SELECT && (
          <div className="flex flex-col items-center w-full max-w-5xl mx-auto space-y-10 py-8 animate-in fade-in slide-in-from-bottom-8">
            <h2 className="text-5xl font-brand text-purple-700">Pick a Stage</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-6 w-full px-4">
              {stagesProgress.map((prog, i) => (
                <div key={i} className="flex flex-col items-center space-y-3">
                  <button onClick={() => selectStage(i)} disabled={!prog.isUnlocked} className={`w-full aspect-square rounded-3xl flex flex-col items-center justify-center relative transition-all transform shadow-lg ${prog.isUnlocked ? 'bg-white hover:scale-105 border-b-8 border-purple-200' : 'bg-gray-200 grayscale opacity-60'}`}>
                    {!prog.isUnlocked ? <Lock className="w-12 h-12 text-gray-400" /> : <span className="text-4xl font-brand text-purple-600">{i + 1}</span>}
                  </button>
                  <div className="flex gap-1 h-6">
                    {prog.isUnlocked && Array.from({ length: 3 }).map((_, s) => <Star key={s} size={20} className={s < prog.stars ? "fill-yellow-400 text-yellow-500" : "text-gray-300 fill-gray-100"} />)}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setGameState(GameState.START)} className="flex items-center gap-2 text-purple-500 font-bold hover:text-pink-600 transition-colors"><Home /> Main Menu</button>
          </div>
        )}
        {gameState === GameState.PLAYING && (
          <div className={`flex flex-col items-center space-y-12 w-full max-w-4xl mx-auto ${shake ? 'animate-shake' : ''}`}>
            <div className="flex justify-between w-full px-6 py-4 bg-white/50 backdrop-blur-sm rounded-2xl border border-pink-200 items-center">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-pink-400 uppercase tracking-tighter">Stage {currentStageIdx + 1}</span>
                <span className="font-brand text-2xl text-purple-700">Word {currentWordInStageIdx + 1} / 10</span>
              </div>
              <button onClick={skipWord} className="px-4 py-2 rounded-xl bg-purple-100 text-purple-600 font-bold border border-purple-200 text-sm flex items-center gap-2 hover:bg-purple-200 transition-colors">
                Skip <FastForward size={16} />
              </button>
            </div>
            <div className="flex flex-col items-center gap-6">
              <div className="relative">
                <KittyMascot className="w-32 h-32" />
                <button onClick={() => playWordAudio(globalWordIdx)} className="absolute -bottom-2 -right-2 p-4 bg-white rounded-full shadow-xl text-purple-600 hover:text-pink-500 hover:scale-110 transition-all border-2 border-purple-100 disabled:opacity-50">
                  {isGeneratingAudio ? <Loader2 className="animate-spin" /> : <Volume2 />}
                </button>
              </div>
              <div className="flex gap-2 flex-wrap justify-center min-h-[80px]">
                {currentWord.split('').map((char, i) => (
                  <div key={i} className={`w-12 h-16 border-b-4 flex items-center justify-center text-4xl font-brand transition-all ${userTyped[i] ? 'border-pink-500 text-purple-700 bg-pink-50' : 'border-gray-300 text-transparent bg-white/30'}`}>
                    {userTyped[i] || ''}
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3 p-6 bg-white/40 rounded-3xl shadow-inner">
              {tilePool.map((tile) => (
                <button key={tile.id} onClick={() => handleTileClick(tile)} disabled={tile.isUsed} className={`w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center text-3xl font-brand rounded-2xl shadow-lg transition-all ${tile.isUsed ? 'bg-gray-200 text-gray-400 scale-90 opacity-40 shadow-none' : 'bg-white text-purple-600 hover:-translate-y-1 hover:shadow-xl active:scale-95 border-b-4 border-purple-100'}`}>
                  {tile.letter}
                </button>
              ))}
            </div>
            <button onClick={() => setGameState(GameState.STAGE_SELECT)} className="font-bold text-purple-400 hover:text-pink-600">Quit to Stages</button>
          </div>
        )}
        {gameState === GameState.CELEBRATING && (
          <div className="text-center space-y-6 animate-in zoom-in">
            <KittyMascot className="w-48 h-48 mx-auto" />
            <div className="space-y-2">
              <h2 className="text-5xl font-brand text-pink-500">PAW-SOME!</h2>
              <p className="text-6xl font-brand text-purple-700 tracking-widest">{currentWord}</p>
            </div>
            <button onClick={nextWord} className={`${COLORS.button} text-white px-12 py-5 rounded-full text-2xl font-brand shadow-2xl hover:scale-105 transition-transform flex items-center gap-3 mx-auto`}>
              NEXT WORD <ChevronRight size={28} />
            </button>
          </div>
        )}
        {gameState === GameState.GAME_OVER && (
          <div className="text-center space-y-8 animate-in fade-in">
            <h2 className="text-5xl font-brand text-purple-700">Stage {currentStageIdx + 1} Complete!</h2>
            <div className="flex justify-center gap-4 py-4">
              {Array.from({ length: 3 }).map((_, s) => {
                const correctCount = sessionHistory.filter(h => !h.skipped).length;
                let earned = false;
                if (s === 0 && correctCount >= 3) earned = true;
                if (s === 1 && correctCount >= 7) earned = true;
                if (s === 2 && correctCount === 10) earned = true;
                return <Star key={s} size={80} className={`drop-shadow-lg ${earned ? "fill-yellow-400 text-yellow-500" : "text-gray-200 fill-gray-50"}`} />;
              })}
            </div>
            <p className="text-2xl font-brand text-pink-500">You got {sessionHistory.filter(h => !h.skipped).length} / 10 words!</p>
            <div className="flex flex-col gap-4 w-64 mx-auto">
              <button onClick={() => setGameState(GameState.STAGE_SELECT)} className={`${COLORS.button} text-white px-10 py-5 rounded-full text-xl font-brand shadow-xl`}>BACK TO STAGES</button>
              <button onClick={() => selectStage(currentStageIdx)} className="bg-white text-purple-600 border-4 border-purple-100 px-10 py-4 rounded-full text-xl font-brand">REPLAY STAGE</button>
            </div>
          </div>
        )}
      </main>
      <style>{`
        .font-brand { font-family: 'Fredoka One', cursive; }
      `}</style>
    </div>
  );
};

export default App;