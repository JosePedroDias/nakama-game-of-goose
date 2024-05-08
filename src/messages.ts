// game opcodes must be POSITIVE integers

enum OpCode {
  // server to client
  GAME_OVER = 100,
  SLEEP = 101,
  REJECTED = 103,
  FEEDBACK = 105,
  NEXT_TO_PLAY = 106,
  USERS_CHANGED = 107,
  PIECE_MOVED = 108,
  ROLL_DICE_OUTCOME = 109,

  // client to server
  ROLL_DICE = 200,
}
