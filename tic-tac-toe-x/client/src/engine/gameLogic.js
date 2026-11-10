/**
 * TIC TAC TOE X - Client Core Game Logic & Unbeatable Minimax AI
 * Pure ES Module with zero external dependencies.
 */

export const WINNING_COMBINATIONS = [
  { indices: [0, 1, 2], type: 'row', index: 0, label: 'Top Row', coords: { x1: 6, y1: 16.67, x2: 94, y2: 16.67 } },
  { indices: [3, 4, 5], type: 'row', index: 1, label: 'Middle Row', coords: { x1: 6, y1: 50.0, x2: 94, y2: 50.0 } },
  { indices: [6, 7, 8], type: 'row', index: 2, label: 'Bottom Row', coords: { x1: 6, y1: 83.33, x2: 94, y2: 83.33 } },
  { indices: [0, 3, 6], type: 'col', index: 0, label: 'Left Column', coords: { x1: 16.67, y1: 6, x2: 16.67, y2: 94 } },
  { indices: [1, 4, 7], type: 'col', index: 1, label: 'Center Column', coords: { x1: 50.0, y1: 6, x2: 50.0, y2: 94 } },
  { indices: [2, 5, 8], type: 'col', index: 2, label: 'Right Column', coords: { x1: 83.33, y1: 6, x2: 83.33, y2: 94 } },
  { indices: [0, 4, 8], type: 'diag', index: 0, label: 'Main Diagonal', coords: { x1: 8, y1: 8, x2: 92, y2: 92 } },
  { indices: [2, 4, 6], type: 'diag', index: 1, label: 'Anti-Diagonal', coords: { x1: 92, y1: 8, x2: 8, y2: 92 } },
];

export function createEmptyBoard() {
  return Array(9).fill(null);
}

export function evaluateBoard(board) {
  for (const combo of WINNING_COMBINATIONS) {
    const [a, b, c] = combo.indices;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return {
        status: 'WIN',
        winner: board[a],
        line: combo.indices,
        lineMeta: combo,
      };
    }
  }

  if (board.every((cell) => cell === 'X' || cell === 'O')) {
    return {
      status: 'DRAW',
      winner: null,
      line: null,
      lineMeta: null,
    };
  }

  return {
    status: 'PLAYING',
    winner: null,
    line: null,
    lineMeta: null,
  };
}

export function getAvailableMoves(board) {
  const moves = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] === null) moves.push(i);
  }
  return moves;
}

export function minimax(board, depth, isMaximizing, aiSymbol, humanSymbol, alpha = -Infinity, beta = Infinity) {
  const evalResult = evaluateBoard(board);
  if (evalResult.status === 'WIN') {
    if (evalResult.winner === aiSymbol) return { score: 100 - depth, move: -1 };
    if (evalResult.winner === humanSymbol) return { score: depth - 100, move: -1 };
  }
  if (evalResult.status === 'DRAW') {
    return { score: 0, move: -1 };
  }

  const available = getAvailableMoves(board);
  const priorityOrder = [4, 0, 2, 6, 8, 1, 3, 5, 7];
  available.sort((a, b) => priorityOrder.indexOf(a) - priorityOrder.indexOf(b));

  let bestMove = available[0];

  if (isMaximizing) {
    let maxScore = -Infinity;
    for (const move of available) {
      board[move] = aiSymbol;
      const { score } = minimax(board, depth + 1, false, aiSymbol, humanSymbol, alpha, beta);
      board[move] = null;
      if (score > maxScore) {
        maxScore = score;
        bestMove = move;
      }
      alpha = Math.max(alpha, score);
      if (beta <= alpha) break;
    }
    return { score: maxScore, move: bestMove };
  } else {
    let minScore = Infinity;
    for (const move of available) {
      board[move] = humanSymbol;
      const { score } = minimax(board, depth + 1, true, aiSymbol, humanSymbol, alpha, beta);
      board[move] = null;
      if (score < minScore) {
        minScore = score;
        bestMove = move;
      }
      beta = Math.min(beta, score);
      if (beta <= alpha) break;
    }
    return { score: minScore, move: bestMove };
  }
}

function findImmediateWinningMove(board, symbol) {
  const available = getAvailableMoves(board);
  for (const move of available) {
    board[move] = symbol;
    const evalResult = evaluateBoard(board);
    board[move] = null;
    if (evalResult.status === 'WIN' && evalResult.winner === symbol) {
      return move;
    }
  }
  return -1;
}

export function computeAIMove(board, difficulty = 'HARD', aiSymbol = 'O') {
  const humanSymbol = aiSymbol === 'X' ? 'O' : 'X';
  const available = getAvailableMoves(board);
  if (available.length === 0) return -1;

  const diff = String(difficulty).toUpperCase();

  if (diff === 'EASY') {
    return available[Math.floor(Math.random() * available.length)];
  }

  if (diff === 'MEDIUM') {
    const winMove = findImmediateWinningMove([...board], aiSymbol);
    if (winMove !== -1) return winMove;

    const blockMove = findImmediateWinningMove([...board], humanSymbol);
    if (blockMove !== -1 && Math.random() < 0.75) return blockMove;

    if (Math.random() < 0.5) {
      return minimax([...board], 0, true, aiSymbol, humanSymbol).move;
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  // HARD Mode: Unbeatable Minimax
  if (available.length === 9) return 4;
  return minimax([...board], 0, true, aiSymbol, humanSymbol).move;
}
