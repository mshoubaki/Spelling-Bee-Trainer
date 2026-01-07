
export interface WordData {
  word: string;
  audio: string;
}

export interface TileItem {
  id: string;
  letter: string;
  isUsed: boolean;
}

export interface RoundStats {
  word: string;
  mistakes: number;
  timeSpent: number;
}

export enum GameState {
  START = 'START',
  PLAYING = 'PLAYING',
  CELEBRATING = 'CELEBRATING',
  GAME_OVER = 'GAME_OVER'
}
