import React, { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { GameState, WordData, TileItem, RoundStats } from './types.ts';
import { WORDS, COLORS } from './constants.ts';
import { generateTilePool, isAlpha } from './utils/helpers.ts';
import KittyMascot from './components/KittyMascot.tsx';
import { Play, RotateCcw, Volume2, Home, Trophy, Sparkles, Loader2, ChevronRight } from 'lucide-react';
import confetti from 'canvas-confetti';

// --- Audio Decoding Helpers (as per Gemini Guidelines) ---
// Decodes a base64 string into a Uint8Array
function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Decodes raw PCM audio data into an AudioBuffer for playback
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

// Fixed: Correctly typed as React.FC and returning JSX to satisfy the type requirement.
const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.START);
  const [currentWordIdx, setCurrentWordIdx] = useState(0);
  const [userTyped, setUserTyped] = useState<string>('');
  const [tilePool, setTilePool] = useState<TileItem[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [history, setHistory] = useState<RoundStats[]>([]);
  const [shake, setShake] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const currentWord = WORDS[currentWordIdx]?.word.toUpperCase() || '';

  // Lazy-initialize AudioContext for Safari and Chrome compatibility
  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  };

  // Uses Gemini TTS as a fallback when local audio files are missing
  const playTTSFallback = async (text: string) => {
    setIsGeneratingAudio(true);
    try {
      // Re-initialize for fresh state and API key usage
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say clearly: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' }, // Friendly child-like voice
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
        
        const audioBuffer = await decodeAudioData(
          decodeBase64(base64Audio),
          ctx,
          24000,
          1
        );
        
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

  // Main audio handler with local-first priority
  const playWordAudio = useCallback((index: number) => {
    if (audioRef.current && WORDS[index]) {
      audioRef.current.pause();
      audioRef.current.src = WORDS[index].audio;
      audioRef.current.load();
      audioRef.current.play().catch(e => {
        console.warn(`Local file ${WORDS[index].audio} not playable. Trying TTS fallback.`, e);
        playTTSFallback(WORDS[index].word);
      });
    }
  }, []);

  const initRound = useCallback((index: number) => {
    if (index >= WORDS.length) {
      setGameState(GameState.GAME_OVER);
      return;
    }

    const word = WORDS[index].word.toUpperCase();
    const pool = generateTilePool(word);
    
    setTilePool(pool);
    setUserTyped('');
    setMistakes(0);
    setStartTime(Date.now());
    setGameState(GameState.PLAYING);
    
    setTimeout(() => {
      playWordAudio(index);
    }, 600);
  }, [playWordAudio]);

  const startGame = () => {
    getAudioContext();
    initRound(0);
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
      timeSpent
    };

    setHistory(prev => [...prev, roundStat]);
    setGameState(GameState.CELEBRATING);
  };

  const nextRound = () => {
    const nextIdx = currentWordIdx + 1;
    setCurrentWordIdx(nextIdx);
    initRound(nextIdx);
  };

  const handleTileClick = (tile: TileItem) => {
    if (gameState !== GameState.PLAYING || tile.isUsed) return;

    const nextCharIndex = userTyped.length;
    const targetChar = currentWord[nextCharIndex];

    if (tile.letter === targetChar) {
      const nextTyped = userTyped + tile.letter;
      setUserTyped(nextTyped);
      setTilePool(prev => prev.map(t => t.id === tile.id ? { ...t, isUsed: true } : t));

      if (nextTyped === currentWord) {
        handleWin();
      }
    } else {
      setMistakes(prev => prev + 1);
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  const resetGame = () => {
    setCurrentWordIdx(0);
    setHistory([]);
    setGameState(GameState.START);
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
        <h1 className={`text-5xl font-extrabold ${COLORS.primary} tracking-tight`}>
          Kitty Spells
        </h1>
        <p className={`text-xl ${COLORS.secondary} font-medium`}>
          Ready to learn some new words with me?
        </p>
      </div>
      <button
        onClick={startGame}
        className={`${COLORS.button} text-white px-10 py-5 rounded-3xl text-3xl font-bold shadow-2xl hover:scale-105 transition-transform active:scale-95 flex items-center gap-4 group`}
      >
        <Play fill="currentColor" className="w-8 h-8 group-hover:animate-pulse" />
        START GAME
      </button>
    </div>
  );

  const renderPlaying = () => (
    <div className={`flex flex-col items-center space-y-12 w-full max-w-4xl mx-auto ${shake ? 'animate-shake' : ''}`}>
      <div className="flex justify-between w-full px-6 py-4 bg-white/50 backdrop-blur-sm rounded-2xl shadow-sm border border-pink-200">
        <div className="flex items-center gap-3">
          <Trophy className="text-yellow-500 w-6 h-6" />
          <span className="font-bold text-lg text-purple-700">Word {currentWordIdx + 1} of {WORDS.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`px-4 py-1 rounded-full bg-red-100 text-red-600 font-bold border border-red-200`}>
            Mistakes: {mistakes}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-6">
        <div className="relative">
          <KittyMascot className="w-32 h-32" />
          <button
            onClick={() => playWordAudio(currentWordIdx)}
            disabled={isGeneratingAudio}
            className={`absolute -bottom-2 -right-2 p-4 bg-white rounded-full shadow-xl text-purple-600 hover:text-pink-500 hover:scale-110 transition-all border-2 border-purple-100 disabled:opacity-50`}
          >
            {isGeneratingAudio ? <Loader2 className="w-8 h-8 animate-spin" /> : <Volume2 className="w-8 h-8" />}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap justify-center min-h-[80px]">
          {currentWord.split('').map((char, i) => (
            <div
              key={i}
              className={`w-12 h-16 border-b-4 flex items-center justify-center text-4xl font-black rounded-t-lg transition-all
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
            className={`w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center text-2xl font-black rounded-2xl shadow-lg transition-all transform
              ${tile.isUsed 
                ? 'bg-gray-200 text-gray-400 scale-90 cursor-not-allowed opacity-40 shadow-none' 
                : 'bg-white text-purple-600 hover:-translate-y-1 hover:shadow-xl active:translate-y-0 active:scale-95 border-b-4 border-purple-100'
              }`}
          >
            {tile.letter}
          </button>
        ))}
      </div>
      
      <button
        onClick={() => setGameState(GameState.START)}
        className="flex items-center gap-2 text-purple-500 hover:text-pink-600 font-semibold transition-colors pt-4"
      >
        <Home className="w-5 h-5" /> Quit to Menu
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
        <h2 className="text-4xl font-black text-pink-500">PAW-SOME!</h2>
        <p className="text-6xl font-black text-purple-700 tracking-widest">{currentWord}</p>
        <p className="text-xl text-purple-400 font-medium pt-4">You did it in {Math.round((Date.now() - startTime) / 1000)} seconds!</p>
      </div>
      <button
        onClick={nextRound}
        className={`${COLORS.button} text-white px-12 py-5 rounded-3xl text-2xl font-bold shadow-2xl hover:scale-105 transition-transform flex items-center gap-3`}
      >
        NEXT WORD <ChevronRight className="w-8 h-8" />
      </button>
    </div>
  );

  const renderGameOver = () => (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700 py-8">
      <div className="text-center space-y-4">
        <Trophy className="w-20 h-20 text-yellow-400 mx-auto drop-shadow-lg animate-bounce" />
        <h2 className="text-4xl font-black text-purple-700">Graduation Day!</h2>
        <p className="text-lg text-pink-500 font-medium">Look at everything you learned!</p>
      </div>

      <div className="w-full bg-white/60 rounded-3xl p-6 shadow-xl border border-pink-100 overflow-hidden">
        <div className="max-h-[400px] overflow-y-auto pr-2 space-y-3 custom-scrollbar">
          {history.map((stat, i) => (
            <div key={i} className="flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-purple-50">
              <div>
                <span className="text-xs font-bold text-pink-400 uppercase tracking-tighter">WORD {i + 1}</span>
                <p className="text-xl font-black text-purple-700">{stat.word}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-purple-400">{stat.timeSpent}s • {stat.mistakes} errors</p>
                <div className="flex gap-1 justify-end mt-1">
                  {[...Array(Math.max(0, 3 - stat.mistakes))].map((_, star) => (
                    <Sparkles key={star} className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={resetGame}
        className={`${COLORS.button} text-white px-10 py-5 rounded-3xl text-2xl font-bold shadow-2xl hover:scale-105 transition-transform flex items-center gap-3`}
      >
        <RotateCcw className="w-6 h-6" /> PLAY AGAIN
      </button>
    </div>
  );

  return (
    <div className={`min-h-screen ${COLORS.bg} font-sans selection:bg-purple-200 selection:text-purple-900 p-4 sm:p-8`}>
      <audio ref={audioRef} />
      
      <main className="max-w-5xl mx-auto min-h-[80vh] flex items-center justify-center">
        {gameState === GameState.START && renderStart()}
        {gameState === GameState.PLAYING && renderPlaying()}
        {gameState === GameState.CELEBRATING && renderCelebrating()}
        {gameState === GameState.GAME_OVER && renderGameOver()}
      </main>

      <footer className="mt-12 text-center text-purple-400 font-medium text-sm">
        Made with 💖 for young learners
      </footer>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }
        .animate-shake {
          animation: shake 0.2s ease-in-out 0s 2;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.3);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #fbcfe8;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #f472b6;
        }
      `}</style>
    </div>
  );
};

// Fixed: Added the missing default export to satisfy index.tsx import
export default App;