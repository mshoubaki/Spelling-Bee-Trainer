
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
  skipped: boolean;
}

export interface StageProgress {
  stars: number; // 0 to 3
  isUnlocked: boolean;
  correctCount: number;
}

export enum GameState {
  START = 'START',
  STAGE_SELECT = 'STAGE_SELECT',
  PLAYING = 'PLAYING',
  CELEBRATING = 'CELEBRATING',
  GAME_OVER = 'GAME_OVER'
}
