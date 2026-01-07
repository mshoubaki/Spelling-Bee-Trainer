
import { TileItem } from '../types.ts';
import { ALPHABET, EXTRA_TILES_COUNT } from '../constants.ts';

export const generateTilePool = (word: string): TileItem[] => {
  const letters = word.toUpperCase().split('').filter(char => /[A-Z]/.test(char));
  
  const wordTiles: TileItem[] = letters.map((letter, index) => ({
    id: `word-${letter}-${index}-${Math.random().toString(36).substr(2, 9)}`,
    letter,
    isUsed: false,
  }));

  const wordSet = new Set(letters);
  const poolOfExtras = ALPHABET.filter(l => !wordSet.has(l));
  const extraLetters: string[] = [];
  
  for (let i = 0; i < EXTRA_TILES_COUNT; i++) {
    const randomIdx = Math.floor(Math.random() * poolOfExtras.length);
    extraLetters.push(poolOfExtras[randomIdx]);
  }

  const extraTiles: TileItem[] = extraLetters.map((letter, index) => ({
    id: `extra-${letter}-${index}-${Math.random().toString(36).substr(2, 9)}`,
    letter,
    isUsed: false,
  }));

  return [...wordTiles, ...extraTiles].sort(() => Math.random() - 0.5);
};

export const isAlpha = (char: string): boolean => {
  return /^[A-Z]$/i.test(char);
};
