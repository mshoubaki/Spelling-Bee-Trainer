import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { GameState, TileItem, RoundStats, StageProgress } from './types';
import { WORDS, COLORS } from './constants';
import { generateTilePool } from './utils/helpers';
import KittyMascot from './components/KittyMascot';
import { Play, Volume2, Home, Loader2, ChevronRight, Lock, Star, FastForward } from 'lucide-react';
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
      audioRef.current.play().catch(() => {
        console.warn(`Local audio failed for ${WORDS[idx].word}, falling back to TTS.`);
        playTTSFallback(WORDS[idx].word);
      });
    }
  }, []);

  const initRound = useCallback((stageIdx: number, wordInStageIdx: number) => {
    const globalIdx = (stageIdx * WORDS_PER_STAGE) + wordInStageIdx;
    if (globalIdx >= WORDS.length) {
      setGameState(GameState.GAME_OVER);
      return;
    }

    setTilePool(generateTilePool(WORDS[globalIdx].word.toUpperCase()));
    setUserTyped('');
    setMistakes(0);
    setStartTime(Date.now());
    setGameState(GameState.PLAYING);
    
    // Auto-play the word after a short delay
    setTimeout(() => playWordAudio(globalIdx), 800);
  }, [playWordAudio]);

  const finishWord = (isSkip: boolean) => {
    const stat: RoundStats = { 
      word: currentWord, 
      mistakes: isSkip ? 0 : mistakes, 
      timeSpent: isSkip ? 0 : Math.round((Date.now() - startTime) / 1000), 
      skipped: isSkip 
    };
    
    const updatedHistory = [...sessionHistory, stat];
    setSessionHistory(updatedHistory);

    const nextIdxInStage = currentWordInStageIdx + 1;
    
    if (nextIdxInStage < WORDS_PER_STAGE) {
      if (isSkip) {
        // If skipped, go directly to next word
        setCurrentWordInStageIdx(nextIdxInStage);
        initRound(currentStageIdx, nextIdxInStage);
      } else {
        // If won, show celebration first
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#f472b6', '#a855f7', '#ec4899'] });
        setGameState(GameState.CELEBRATING);
      }
    } else {
      // End of stage
      if (!isSkip) {
        confetti({ particleCount: 200, spread: 90, origin: { y: 0.5 } });
      }
      calculateStageResults(updatedHistory);
    }
  };

  const calculateStageResults = (history: RoundStats[]) => {
    const correctCount = history.filter(h => !h.skipped).length;
    let stars = 0;
    if (correctCount === 10) stars = 3;
    else if (correctCount >= 7) stars = 2;
    else if (correctCount >= 3) stars = 1;

    setStagesProgress(prev => {
      const next = [...prev];
      const stage = { ...next[currentStageIdx] };
      if (stars > stage.stars) stage.stars = stars;
      stage.correctCount = Math.max(stage.correctCount, correctCount);
      next[currentStageIdx] = stage;
      
      // Unlock next stage if we got at least 1 star
      if (stars >= 1 && currentStageIdx < 9) {
        next[currentStageIdx + 1] = { ...next[currentStageIdx + 1], isUnlocked: true };
      }
      return next;
    });
    setGameState(GameState.GAME_OVER);
  };

  const nextWord = () => {
    const nextIdx = currentWordInStageIdx + 1;
    setCurrentWordInStageIdx(nextIdx);
    initRound(currentStageIdx, nextIdx);
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
      if (nextTyped === currentWord) finishWord(false);
    } else {
      setMistakes(prev => prev + 1);
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <div className={`min-h-screen ${COLORS.bg} p-4 sm:p-8 selection:bg-purple-200 overflow-x-hidden`}>
      <audio ref={audioRef} onError={() => playTTSFallback(currentWord)} />
      <main className="max-w-5xl mx-auto min-h-[85vh] flex items-center justify-center">
        {gameState === GameState.START && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-8 animate-in fade-in zoom-in duration-500">
            <KittyMascot className="w-48 h-48 drop-shadow-xl" />
            <h1 className={`text-7xl font-extrabold ${COLORS.primary} font-brand tracking-tight drop-shadow-sm`}>Kitty Spells</h1>
            <p className="text-2xl text-pink-500 font-medium max-w-md">Learn to spell 100 fun words and collect all the stars!</p>
            <button onClick={() => { getAudioContext(); setGameState(GameState.STAGE_SELECT); }} className={`${COLORS.button} text-white px-12 py-6 rounded-full text-3xl font-bold font-brand shadow-2xl hover:scale-105 active:scale-95 transition-transform flex items-center gap-4`}>
              <Play fill="currentColor" className="w-10 h-10" /> START ADVENTURE
            </button>
          </div>
        )}

        {gameState === GameState.STAGE_SELECT && (
          <div className="flex flex-col items-center w-full max-w-5xl mx-auto space-y-10 py-8 animate-in fade-in slide-in-from-bottom-8">
            <div className="text-center space-y-2">
              <h2 className="text-5xl font-brand text-purple-700">Choose a Stage</h2>
              <p className="text-pink-500 font-bold">Get 3 correct to unlock the next level!</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-6 w-full px-4">
              {stagesProgress.map((prog, i) => (
                <div key={i} className="flex flex-col items-center space-y-3">
                  <button 
                    onClick={() => selectStage(i)} 
                    disabled={!prog.isUnlocked} 
                    className={`w-full aspect-square rounded-3xl flex flex-col items-center justify-center relative transition-all transform shadow-lg ${prog.isUnlocked ? 'bg-white hover:scale-105 border-b-8 border-purple-200 active:translate-y-1 active:border-b-0' : 'bg-gray-200 grayscale opacity-60 cursor-not-allowed'}`}
                  >
                    {!prog.isUnlocked ? (
                      <Lock className="w-12 h-12 text-gray-400" />
                    ) : (
                      <>
                        <span className="text-4xl font-brand text-purple-600 mb-1">{i + 1}</span>
                        <div className="flex gap-1">
                           {Array.from({ length: 3 }).map((_, s) => (
                            <Star key={s} size={18} className={s < prog.stars ? "fill-yellow-400 text-yellow-500" : "text-gray-300 fill-gray-100"} />
                          ))}
                        </div>
                      </>
                    )}
                  </button>
                  <span className="text-sm font-bold text-purple-400">Words {i * 10 + 1}-{i * 10 + 10}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setGameState(GameState.START)} className="flex items-center gap-2 text-purple-500 font-bold hover:text-pink-600 transition-colors py-4">
              <Home /> Back to Menu
            </button>
          </div>
        )}

        {gameState === GameState.PLAYING && (
          <div className={`flex flex-col items-center space-y-12 w-full max-w-4xl mx-auto ${shake ? 'animate-shake' : ''}`}>
            <div className="flex justify-between w-full px-6 py-4 bg-white/60 backdrop-blur-md rounded-2xl border-2 border-white items-center shadow-sm">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-pink-400 uppercase tracking-widest">Stage {currentStageIdx + 1}</span>
                <span className="font-brand text-2xl text-purple-700 tracking-tight">Word {currentWordInStageIdx + 1} of 10</span>
              </div>
              <button onClick={() => finishWord(true)} className="px-5 py-2.5 rounded-xl bg-purple-100 text-purple-600 font-bold border-2 border-purple-200 text-sm flex items-center gap-2 hover:bg-purple-200 transition-all hover:scale-105 active:scale-95">
                Skip Word <FastForward size={18} />
              </button>
            </div>

            <div className="flex flex-col items-center gap-8">
              <div className="relative group">
                <KittyMascot className="w-40 h-40 drop-shadow-lg group-hover:scale-105 transition-transform" />
                <button 
                  onClick={() => playWordAudio(globalWordIdx)} 
                  disabled={isGeneratingAudio}
                  className="absolute -bottom-2 -right-2 p-5 bg-white rounded-full shadow-2xl text-purple-600 hover:text-pink-500 hover:scale-110 transition-all border-4 border-pink-50 active:scale-90"
                >
                  {isGeneratingAudio ? <Loader2 className="animate-spin w-8 h-8" /> : <Volume2 className="w-8 h-8" />}
                </button>
              </div>

              <div className="flex gap-3 flex-wrap justify-center min-h-[100px] items-center">
                {currentWord.split('').map((char, i) => (
                  <div key={i} className={`w-14 h-20 border-b-8 flex items-center justify-center text-5xl font-brand transition-all rounded-t-xl ${userTyped[i] ? 'border-pink-500 text-purple-800 bg-white shadow-md' : 'border-gray-300 text-transparent bg-white/20'}`}>
                    {userTyped[i] || ''}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-4 p-8 bg-white/40 rounded-[3rem] shadow-inner border-2 border-white/50">
              {tilePool.map((tile) => (
                <button 
                  key={tile.id} 
                  onClick={() => handleTileClick(tile)} 
                  disabled={tile.isUsed} 
                  className={`w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center text-4xl font-brand rounded-2xl shadow-lg transition-all ${tile.isUsed ? 'bg-gray-100 text-gray-300 scale-90 opacity-40 shadow-none' : 'bg-white text-purple-600 hover:-translate-y-2 hover:shadow-2xl active:scale-90 border-b-8 border-purple-100'}`}
                >
                  {tile.letter}
                </button>
              ))}
            </div>

            <button onClick={() => setGameState(GameState.STAGE_SELECT)} className="font-bold text-purple-400 hover:text-pink-600 transition-colors underline decoration-2 underline-offset-4">Quit to Stage Select</button>
          </div>
        )}

        {gameState === GameState.CELEBRATING && (
          <div className="text-center space-y-8 animate-in zoom-in duration-300">
            <KittyMascot className="w-56 h-56 mx-auto animate-bounce" />
            <div className="space-y-2">
              <h2 className="text-6xl font-brand text-pink-500 tracking-tight">PAW-SOME!</h2>
              <div className="bg-white p-6 rounded-3xl shadow-xl border-4 border-pink-100 inline-block">
                <p className="text-7xl font-brand text-purple-800 tracking-widest">{currentWord}</p>
              </div>
            </div>
            <button onClick={nextWord} className={`${COLORS.button} text-white px-14 py-6 rounded-full text-3xl font-brand shadow-2xl hover:scale-105 active:scale-95 transition-transform flex items-center gap-4 mx-auto`}>
              NEXT WORD <ChevronRight size={32} />
            </button>
          </div>
        )}

        {gameState === GameState.GAME_OVER && (
          <div className="text-center space-y-10 animate-in fade-in duration-500 bg-white/80 backdrop-blur-lg p-12 rounded-[4rem] shadow-2xl border-4 border-white max-w-2xl w-full">
            <h2 className="text-6xl font-brand text-purple-700">Stage Complete!</h2>
            
            <div className="flex justify-center gap-6 py-4">
              {Array.from({ length: 3 }).map((_, s) => {
                const correctCount = sessionHistory.filter(h => !h.skipped).length;
                let earned = false;
                if (s === 0 && correctCount >= 3) earned = true;
                if (s === 1 && correctCount >= 7) earned = true;
                if (s === 2 && correctCount === 10) earned = true;
                return (
                  <div key={s} className="relative">
                    <Star size={100} className={`drop-shadow-xl transition-all duration-1000 ${earned ? "fill-yellow-400 text-yellow-500 scale-110 rotate-12" : "text-gray-200 fill-gray-50 opacity-40"}`} />
                    {earned && <div className="absolute inset-0 animate-ping rounded-full bg-yellow-200/50" />}
                  </div>
                );
              })}
            </div>

            <div className="space-y-2">
              <p className="text-3xl font-brand text-pink-500">You got {sessionHistory.filter(h => !h.skipped).length} of 10 words!</p>
              <p className="text-lg text-purple-400 font-medium italic">
                {sessionHistory.filter(h => !h.skipped).length >= 3 ? "Next stage unlocked! Keep it up!" : "Try again to unlock the next level!"}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-6 justify-center">
              <button onClick={() => setGameState(GameState.STAGE_SELECT)} className={`${COLORS.button} text-white px-10 py-5 rounded-full text-2xl font-brand shadow-xl hover:scale-105 active:scale-95 transition-all`}>BACK TO STAGES</button>
              <button onClick={() => selectStage(currentStageIdx)} className="bg-white text-purple-600 border-4 border-purple-100 px-10 py-5 rounded-full text-2xl font-brand hover:bg-purple-50 transition-all">REPLAY STAGE</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;