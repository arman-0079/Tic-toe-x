/**
 * Automated Verification Suite for TIC TAC TOE X Engine, Minimax AI, and Persistence Layer
 */

const assert = require('assert');
const {
  createEmptyBoard,
  evaluateBoard,
  validateAndApplyMove,
  computeAIMove,
} = require('./gameEngine');
const { StatsDatabase } = require('./db');

function testWinAndDrawDetection() {
  // Row win
  const rowBoard = ['X', 'X', 'X', 'O', 'O', null, null, null, null];
  const rowEval = evaluateBoard(rowBoard);
  assert.strictEqual(rowEval.status, 'WIN');
  assert.strictEqual(rowEval.winner, 'X');
  assert.deepStrictEqual(rowEval.line, [0, 1, 2]);

  // Diagonal win
  const diagBoard = ['O', 'X', 'X', null, 'O', null, 'X', null, 'O'];
  const diagEval = evaluateBoard(diagBoard);
  assert.strictEqual(diagEval.status, 'WIN');
  assert.strictEqual(diagEval.winner, 'O');
  assert.deepStrictEqual(diagEval.line, [0, 4, 8]);

  // Draw board
  const drawBoard = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
  const drawEval = evaluateBoard(drawBoard);
  assert.strictEqual(drawEval.status, 'DRAW');
  assert.strictEqual(drawEval.winner, null);
}

function testServerMoveValidation() {
  const state = {
    status: 'PLAYING',
    board: createEmptyBoard(),
    turn: 'X',
    players: { X: 'player_alpha', O: 'player_beta' },
  };

  // Out-of-turn player attempt must fail
  const outOfTurn = validateAndApplyMove(state, {
    playerId: 'player_beta',
    symbol: 'O',
    index: 4,
  });
  assert.strictEqual(outOfTurn.valid, false);
  assert.strictEqual(outOfTurn.code, 'OUT_OF_TURN');

  // Out-of-bounds cell index must fail
  const invalidIndex = validateAndApplyMove(state, {
    playerId: 'player_alpha',
    symbol: 'X',
    index: 12,
  });
  assert.strictEqual(invalidIndex.valid, false);
  assert.strictEqual(invalidIndex.code, 'INVALID_CELL_INDEX');

  // Valid move by X
  const validMove = validateAndApplyMove(state, {
    playerId: 'player_alpha',
    symbol: 'X',
    index: 4,
  });
  assert.strictEqual(validMove.valid, true);
  assert.strictEqual(validMove.board[4], 'X');
  assert.strictEqual(validMove.turn, 'O');

  // Attempting to overwrite cell 4 must fail
  const occupiedMove = validateAndApplyMove(
    {
      status: 'PLAYING',
      board: validMove.board,
      turn: 'O',
      players: state.players,
    },
    { playerId: 'player_beta', symbol: 'O', index: 4 }
  );
  assert.strictEqual(occupiedMove.valid, false);
  assert.strictEqual(occupiedMove.code, 'CELL_OCCUPIED');
}

/**
 * Exhaustively verifies that Hard Mode Minimax AI NEVER loses a single game
 * across every possible human response tree, playing both as X (first) and O (second).
 */
function testMinimaxNeverLoses() {
  function simulateAllHumanBranches(board, currentTurn, aiSymbol, humanSymbol) {
    const evaluation = evaluateBoard(board);
    if (evaluation.status !== 'PLAYING') {
      assert.notStrictEqual(
        evaluation.winner,
        humanSymbol,
        `Minimax AI (${aiSymbol}) lost on board: ${JSON.stringify(board)}`
      );
      return 1;
    }

    let terminalGamesChecked = 0;
    if (currentTurn === aiSymbol) {
      const aiMove = computeAIMove(board, 'HARD', aiSymbol);
      assert.ok(aiMove >= 0 && aiMove <= 8 && board[aiMove] === null);
      const nextBoard = [...board];
      nextBoard[aiMove] = aiSymbol;
      terminalGamesChecked += simulateAllHumanBranches(
        nextBoard,
        humanSymbol,
        aiSymbol,
        humanSymbol
      );
    } else {
      for (let i = 0; i < 9; i++) {
        if (board[i] === null) {
          const nextBoard = [...board];
          nextBoard[i] = humanSymbol;
          terminalGamesChecked += simulateAllHumanBranches(
            nextBoard,
            aiSymbol,
            aiSymbol,
            humanSymbol
          );
        }
      }
    }
    return terminalGamesChecked;
  }

  const gamesAsO = simulateAllHumanBranches(createEmptyBoard(), 'X', 'O', 'X');
  const gamesAsX = simulateAllHumanBranches(createEmptyBoard(), 'X', 'X', 'O');
  console.log(
    `[PASS] Exhaustive Minimax verification: 0 losses across ${gamesAsO + gamesAsX} complete game trees.`
  );
}

function testStatsDatabase() {
  const db = new StatsDatabase();
  const testId = 'test_user_verification';
  db.resetPlayerStats(testId, 'Tester');
  const afterWin = db.recordMatch(testId, {
    playerName: 'Tester',
    mode: 'AI_HARD',
    outcome: 'WIN',
    playerSymbol: 'X',
    opponentName: 'Minimax AI',
    durationSec: 14,
  });
  assert.strictEqual(afterWin.modes.AI_HARD.wins, 1);
  assert.strictEqual(afterWin.modes.AI_HARD.bestStreak, 1);
  assert.strictEqual(afterWin.modes.AI_HARD.fastestWinSec, 14);
  db.resetPlayerStats(testId, 'Tester');
  console.log(`[PASS] Database persistence test passed (Engine: ${db.engineType}).`);
}

testWinAndDrawDetection();
console.log('[PASS] Win & Draw detection verified.');
testServerMoveValidation();
console.log('[PASS] Authoritative server move & turn validation verified.');
testMinimaxNeverLoses();
testStatsDatabase();
console.log('ALL BACKEND & ENGINE TESTS PASSED.');
