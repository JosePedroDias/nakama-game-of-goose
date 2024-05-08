// https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/function-reference/

const tickRate = 2;
const maxEmptySec = 30;
const delayBetweenGamesSec = 5;
const turnTimeSec = 10;

interface MatchLabel {
  open: number; // whether the match is accepting players
}

interface MatchLabel {
  open: number;
}

type Outcome = undefined | ["roll"] | ["go", number];

const INITIAL_CELL = 0;
const LAST_CELL = 63;

const SPECIAL_CELLS: Record<number, Outcome> = {
  15: ["roll"],
  24: ["go", 17],
  32: ["roll"],
  43: ["go", 36],
  49: ["go", 57],
  62: ["go", 52],
};

function rollDice(): number {
  return Math.floor(1 + 6 * Math.random());
}

type UpdateMessage = {
  nextToPlay: string[] | null;
  diceValue: number | null;
  piecePositions: Record<string, number>;
};

type State = {
  label: MatchLabel;
  joinsInProgress: number;
  emptyTicks: number;
  nextGameRemainingTicks: number;
  presences: Record<string, nkruntime.Presence | null>;
  playing: boolean;

  nextToPlay: string[] | null;
  diceValue: number | null;
  piecePositions: Record<string, number>;
};

type UserDetails = {
  user_id: string;
  username: string;
};

let matchInit: nkruntime.MatchInitFunction<State> = function (
  _ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _params: { [key: string]: string },
) {
  //const fast = !!params["fast"];

  let label: MatchLabel = {
    open: 1,
  };

  let state: State = {
    label: { open: 1 },
    joinsInProgress: 0,
    emptyTicks: 0,
    nextGameRemainingTicks: 0,
    presences: {},
    playing: false,

    nextToPlay: null,
    diceValue: null,
    piecePositions: {},
  };

  return {
    state,
    tickRate,
    label: JSON.stringify(label),
  };
};

let matchJoinAttempt: nkruntime.MatchJoinAttemptFunction<State> = function (
  _ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: State,
  presence: nkruntime.Presence,
  _metadata: { [key: string]: any },
) {
  // Check if it's a user attempting to rejoin after a disconnect.
  if (presence.userId in state.presences) {
    if (state.presences[presence.userId] === null) {
      // User rejoining after a disconnect.
      state.joinsInProgress++;
      return {
        state: state,
        accept: false,
      };
    } else {
      // User attempting to join from 2 different devices at the same time.
      return {
        state: state,
        accept: false,
        rejectMessage: "already joined",
      };
    }
  }

  // Check if match is full.
  if (connectedPlayers(state) + state.joinsInProgress >= 2) {
    return {
      state: state,
      accept: false,
      rejectMessage: "match full",
    };
  }

  // New player attempting to connect.
  state.joinsInProgress++;
  return {
    state,
    accept: true,
  };
};

let matchJoin: nkruntime.MatchJoinFunction<State> = function (
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: State,
  newPresences: nkruntime.Presence[],
) {
  //const t = msecToSec(Date.now());

  for (const presence of newPresences) {
    state.joinsInProgress--;
    state.presences[presence.userId] = presence;
  }

  // check if match was open to new players, but should now be closed.
  if (Object.keys(state.presences).length >= 2 && state.label.open != 0) {
    state.label.open = 0;
    dispatcher.matchLabelUpdate(JSON.stringify(state.label));
  }

  dispatcher.broadcastMessage(
    OpCode.USERS_CHANGED,
    JSON.stringify(getUsersDetails(state)),
  );

  return { state };
};

let matchLeave: nkruntime.MatchLeaveFunction<State> = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: State,
  presences: nkruntime.Presence[],
) {
  for (let presence of presences) {
    logger.info("Player: %s left match: %s.", presence.userId, ctx.matchId);
    state.presences[presence.userId] = null;
  }

  state.playing = false;

  dispatcher.broadcastMessage(
    OpCode.USERS_CHANGED,
    JSON.stringify(getUsersDetails(state)),
  );

  return { state };
};

let matchLoop: nkruntime.MatchLoopFunction<State> = function (
  _ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: State,
  messages: nkruntime.MatchMessage[],
) {
  logger.debug("Running match loop. Tick: %d", tick);

  if (connectedPlayers(state) + state.joinsInProgress === 0) {
    state.emptyTicks++;
    if (state.emptyTicks >= maxEmptySec * tickRate) {
      // match has been empty for too long, close it.
      logger.info("closing idle match");
      return null;
    }
  }

  //let t = msecToSec(Date.now());

  // If there's no game in progress check if we can (and should) start one!
  if (!state.playing) {
    // Between games any disconnected users are purged, there's no in-progress game for them to return to anyway.
    for (let userID in state.presences) {
      if (state.presences[userID] === null) {
        delete state.presences[userID];
      }
    }

    // Check if we need to update the label so the match now advertises itself as open to join.
    if (Object.keys(state.presences).length < 2 && state.label.open != 1) {
      state.label.open = 1;
      let labelJSON = JSON.stringify(state.label);
      dispatcher.matchLabelUpdate(labelJSON);
    }

    // Check if we have enough players to start a game.
    if (Object.keys(state.presences).length < 2) {
      return { state };
    }

    // Check if enough time has passed since the last game.
    if (state.nextGameRemainingTicks > 0) {
      state.nextGameRemainingTicks--;
      return { state };
    }

    // We can start a game! Set up the game state and assign the marks to each player.
    state.playing = true;
    Object.keys(state.presences).forEach((userId) => {
      state.piecePositions[userId] = INITIAL_CELL;
    });
    state.nextToPlay = Object.keys(state.presences).filter(
      (userId) => userId !== null,
    );

    dispatcher.broadcastMessage(
      OpCode.USERS_CHANGED,
      JSON.stringify(getUsersDetails(state)),
    );

    dispatcher.broadcastMessage(
      OpCode.NEXT_TO_PLAY,
      JSON.stringify(state.nextToPlay),
    );

    //state.deadlineRemainingTicks = calculateDeadlineTicks();
    state.nextGameRemainingTicks = 0;

    return { state };
  }

  // There's a game in progress. Check for input, update match state, and send messages to clients.
  for (const message of messages) {
    switch (message.opCode) {
      case OpCode.ROLL_DICE:
        logger.debug(
          "Received ROLL_DICE message from user: %v",
          message.sender.userId,
        );
        const nextUserId = (state.nextToPlay as string[])[0];
        if (message.sender.userId !== nextUserId) {
          dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
          continue;
        }

        const deltaPosition = rollDice();
        logger.debug("dice roll result was: %v", deltaPosition);

        state.diceValue = deltaPosition;

        dispatcher.broadcastMessage(
          OpCode.ROLL_DICE_OUTCOME,
          JSON.stringify(state.diceValue),
        );

        let playerPosition = state.piecePositions[nextUserId];
        playerPosition += deltaPosition;

        if (playerPosition > LAST_CELL) {
          playerPosition = LAST_CELL;
        }

        dispatcher.broadcastMessage(
          OpCode.PIECE_MOVED,
          JSON.stringify({
            user_id: message.sender.userId,
            cell_no: playerPosition,
          }),
        );

        if (playerPosition === LAST_CELL) {
          dispatcher.broadcastMessage(
            OpCode.GAME_OVER,
            JSON.stringify(message.sender.userId),
          );
          return null;
        }

        const outcome: Outcome = SPECIAL_CELLS[playerPosition];

        if (outcome === undefined) {
          dispatcher.broadcastMessage(
            OpCode.FEEDBACK,
            JSON.stringify("landed on regular cell"),
          );
          logger.debug(
            "landed on regular cell. position: %v. change next player",
            playerPosition,
          );
          state.piecePositions[nextUserId] = playerPosition;
          toNextPlayer(state);
          dispatcher.broadcastMessage(
            OpCode.NEXT_TO_PLAY,
            JSON.stringify(state.nextToPlay),
          );
        } else if (outcome[0] === "go") {
          dispatcher.broadcastMessage(
            OpCode.FEEDBACK,
            JSON.stringify("landed on GO cell"),
          );
          playerPosition = outcome[1];
          logger.debug(
            "landed on go cell. position: %v. change next player",
            playerPosition,
          );
          state.piecePositions[nextUserId] = playerPosition;

          dispatcher.broadcastMessage(OpCode.SLEEP, JSON.stringify(500));

          dispatcher.broadcastMessage(
            OpCode.PIECE_MOVED,
            JSON.stringify({
              user_id: message.sender.userId,
              cell_no: playerPosition,
            }),
          );

          toNextPlayer(state);
          dispatcher.broadcastMessage(
            OpCode.NEXT_TO_PLAY,
            JSON.stringify(state.nextToPlay),
          );
        } else if (outcome[0] === "roll") {
          dispatcher.broadcastMessage(
            OpCode.FEEDBACK,
            JSON.stringify("landed on ROLL cell"),
          );
          logger.debug(
            "landed on roll cell. position: %v. keep same player playing",
            playerPosition,
          );

          dispatcher.broadcastMessage(
            OpCode.NEXT_TO_PLAY,
            JSON.stringify(state.nextToPlay),
          );

          state.piecePositions[nextUserId] = playerPosition;
        } else {
          logger.debug("Unexpected outcome: %v", outcome);
        }

        break;

      default:
        // No other opcodes are expected from the client, so automatically treat it as an error.
        dispatcher.broadcastMessage(OpCode.REJECTED, null, [message.sender]);
        logger.error("Unexpected opcode received: %d", message.opCode);
    }
  }

  return { state };
};

let matchTerminate: nkruntime.MatchTerminateFunction<State> = function (
  _ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: State,
  _graceSeconds: number,
) {
  state.playing = false;
  return { state };
};

let matchSignal: nkruntime.MatchSignalFunction<State> = function (
  _ctx: nkruntime.Context,
  _logger: nkruntime.Logger,
  _nk: nkruntime.Nakama,
  _dispatcher: nkruntime.MatchDispatcher,
  _tick: number,
  state: State,
  _data: string = "",
) {
  return { state, data: undefined };
};

function toNextPlayer(state: State): void {
  state.nextToPlay?.push(state.nextToPlay?.shift() as string);
}

function calculateDeadlineTicks(): number {
  return turnTimeSec * tickRate;
}

// to filter out players who might have left and were assigned null
function getNonNullUserIds(state: State): string[] {
  const remainingUserIds: string[] = [];
  for (const [k, v] of Object.entries(state.presences)) {
    if (v !== null) remainingUserIds.push(k);
  }
  return remainingUserIds;
}

function getUsersDetails(state: State): Record<string, UserDetails> {
  const result: Record<string, UserDetails> = {};
  for (const [k, v] of Object.entries(state.presences)) {
    if (v === null) continue;
    result[k] = {
      user_id: v.userId,
      username: v.username,
    };
  }
  return result;
}

function connectedPlayers(state: State): number {
  return getNonNullUserIds(state).length;
}

function msecToSec(n: number): number {
  return Math.floor(n / 1000);
}
