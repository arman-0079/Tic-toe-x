/**
 * TIC TAC TOE X - Core Authoritative Game Engine & Minimax AI
 * Shared deterministic ruleset used by the Node.js Socket.IO server and client.
 * Completely independent of UI frameworks and platform-specific SDKs.
 */

const WINNING_COMBINATIONS = [
  { indices: [0, 1, 2], type: 'row', index: 0, label: 'Top Row' },
  { indices: [3, 4, 5], type: 'row', index: 1, label: 'Middle Row' },
  { indices: [6, 7, 8], type: 'row', index: 2, label: 'Bottom Row' },
  { indices: [0, 3, 6], type: 'col', index: 0, label: 'Left Column' },
  { indices: [1, 4, 7], type: 'col', index: 1, label: 'Center Column' },
  { indices: [2, 5, 8], type: 'col', index: 2, label: 'Right Column' },
  { indices: [0, 4, 8], type: 'diag', index: 0, label: 'Main Diagonal' },
  { indices: [2, 4, 6], type: 'diag', index: 1, label: 'Anti-Diagonal' },
];

/**
 * Creates a fresh 3x3 board represented as a 9-element array.
 */
function createEmptyBoard() {
  return Array(9).fill(null);
}

/**
 * Evaluates a 9-element board for a winner or draw.
 * @param {Array<string|null>} board
 * @returns {{ status: 'PLAYING'|'WIN'|'DRAW', winner: 'X'|'O'|null, line: number[]|null, lineMeta: object|null }}
 */
function evaluateBoard(board) {
  if (!Array.isArray(board) || board.length !== 9) {
    throw new Error('Invalid board state: must be an array of 9 cells.');
  }

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

  const isFull = board.every((cell) => cell === 'X' || cell === 'O');
  if (isFull) {
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

/**
 * Returns indices of all unoccupied cells on the board.
 */
function getAvailableMoves(board) {
  const moves = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] === null) moves.push(i);
  }
  return moves;
}

/**
 * Server-authoritative move validation for online and local matches.
 * Prevents out-of-turn play, invalid cell indices, overwriting cells, or playing after game end.
 */
function validateAndApplyMove(state, { playerId, symbol, index }) {
  if (!state || state.status !== 'PLAYING') {
    return { valid: false, code: 'MATCH_NOT_ACTIVE', error: 'The match is not currently active.' };
  }

  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 8) {
    return { valid: false, code: 'INVALID_CELL_INDEX', error: 'Move index must be an integer between 0 and 8.' };
  }

  if (symbol !== 'X' && symbol !== 'O') {
    return { valid: false, code: 'INVALID_SYMBOL', error: 'Player symbol must be X or O.' };
  }

  if (state.players && playerId) {
    const expectedPlayerId = state.players[state.turn];
    if (expectedPlayerId !== playerId) {
      return {
        valid: false,
        code: 'OUT_OF_TURN',
        error: `Out of turn: it is currently ${state.turn}'s turn.`,
      };
    }
  }

  if (state.turn !== symbol) {
    return {
      valid: false,
      code: 'OUT_OF_TURN',
      error: `Cannot play ${symbol} on ${state.turn}'s turn.`,
    };
  }

  if (state.board[index] !== null) {
    return {
      valid: false,
      code: 'CELL_OCCUPIED',
      error: `Cell ${index} is already occupied by ${state.board[index]}.`,
    };
  }

  const nextBoard = [...state.board];
  nextBoard[index] = symbol;
  const evaluation = evaluateBoard(nextBoard);
  const nextTurn = evaluation.status === 'PLAYING' ? (symbol === 'X' ? 'O' : 'X') : state.turn;

  return {
    valid: true,
    board: nextBoard,
    turn: nextTurn,
    evaluation,
    moveRecord: {
      index,
      symbol,
      playerId: playerId || symbol,
      timestamp: Date.now(),
    },
  };
}

/**
 * Minimax algorithm with Alpha-Beta Pruning and depth-preference scoring.
 * Guarantees optimal play in Hard mode (never makes a losing mistake).
 */
function minimax(board, depth, isMaximizing, aiSymbol, humanSymbol, alpha = -Infinity, beta = Infinity) {
  const result = evaluateBoard(board);
  if (result.status === 'WIN') {
    if (result.winner === aiSymbol) return { score: 100 - depth, move: -1 };
    if (result.winner === humanSymbol) return { score: depth - 100, move: -1 };
  }
  if (result.status === 'DRAW') {
    return { score: 0, move: -1 };
  }

  const available = getAvailableMoves(board);
  // Strategic move ordering: center (4), corners (0,2,6,8), edges (1,3,5,7) for faster pruning & strong tie-breaking
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

/**
 * Finds an immediate winning move for `symbol` if one exists.
 */
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

/**
 * Computes AI move according to difficulty ('EASY' | 'MEDIUM' | 'HARD').
 * - EASY: Plays random valid moves (with occasional tactical mistake even if a block exists).
 * - MEDIUM: Takes immediate wins, blocks 75% of immediate threats, otherwise blends heuristic/random.
 * - HARD: Full Minimax with Alpha-Beta Pruning. Never loses.
 */
function computeAIMove(board, difficulty = 'HARD', aiSymbol = 'O', rng = Math.random) {
  const humanSymbol = aiSymbol === 'X' ? 'O' : 'X';
  const available = getAvailableMoves(board);
  if (available.length === 0) return -1;

  const normalizedDiff = String(difficulty).toUpperCase();

  if (normalizedDiff === 'EASY') {
    const randomIndex = Math.floor(rng() * available.length);
    return available[randomIndex];
  }

  if (normalizedDiff === 'MEDIUM') {
    // 1. Always take an immediate winning move if available
    const winMove = findImmediateWinningMove([...board], aiSymbol);
    if (winMove !== -1) return winMove;

    // 2. Block opponent's immediate win 75% of the time
    const blockMove = findImmediateWinningMove([...board], humanSymbol);
    if (blockMove !== -1 && rng() < 0.75) return blockMove;

    // 3. 50% chance to use Minimax, 50% random available cell
    if (rng() < 0.5) {
      return minimax([...board], 0, true, aiSymbol, humanSymbol).move;
    }
    const randomIndex = Math.floor(rng() * available.length);
    return available[randomIndex];
  }

  // HARD Mode: Unbeatable Minimax algorithm
  // Fast opening optimization: if board is completely empty, pick center (4) or corner (0)
  if (available.length === 9) {
    return 4;
  }
  const { move } = minimax([...board], 0, true, aiSymbol, humanSymbol);
  return move;
}

module.exports = {
  WINNING_COMBINATIONS,
  createEmptyBoard,
  evaluateBoard,
  getAvailableMoves,
  validateAndApplyMove,
  minimax,
  computeAIMove,
};
