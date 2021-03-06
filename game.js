var m = require('mori');
var set = require('./setLogic.js');

//// GAME STATE ////

// Structure of game state object:
// map{'deck': <card sequence ordered by ID>,
//     'toDeal': #queue <of card IDs as ints in random order>,
//     'board': map{ <slot id>: <card id> },
//     'players': map{<name>: map{'color': <int>,
//                                'score': <int>,
//                                'claimed': set #(<card>)}
//                   }
// }

exports.getInitialState = function() {
    var deck = set.makeDeck();
    var toDeal = shuffleIDs(deck);
    var board = getEmptyBoard();
    var players = m.hashMap();
    var gameState = m.hashMap('deck', deck,
                              'board', board,
                              'toDeal', toDeal,
                              'players', players);
    return gameState;
}


//// BOARD ////

var SLOTS = m.vector('A', 'B', 'C', 'D', 'E', 'F',
    'G', 'H', 'I', 'J', 'K', 'L',
    'M', 'N', 'O', 'P', 'Q', 'R');

function getEmptyBoard() {
    return m.zipmap(SLOTS, m.map(m.constantly(null), m.range(18)));
}

function sortBoard(board) {
    return m.sortBy(function(pair) { return m.nth(pair, 0); }, board);
}

exports.startBoard = function(oldState) {
    var slots = m.take(12, SLOTS);
    return m.reduce(function(state, slot) {
        return deal(state, slot);
    }, oldState, slots);
}

function partitionSlots(slots) {
    var byThrees = m.partition(3, slots);
    var first12 = m.flatten(m.take(4, byThrees));
    var extra1 = m.nth(byThrees, 4);
    var extra2 = m.nth(byThrees, 5);
    return [first12, extra1, extra2];
}

function getPairsWhereCardIs(nullOrNot, board) {
    //nullOrNot should be null or !null
    // console.log("nullOrNot", nullOrNot);
    return m.filter(function(pair) {
        // console.log("filtering", pair, "-", (m.nth(pair, 1) !== null) === !!nullOrNot);
        return (m.nth(pair, 1) !== null) === !!nullOrNot;
    }, board);
}

function getCardIDs(slotCardPairs) {
    return m.map(function(pair) { return m.nth(pair, 1); }, slotCardPairs);
}

function getSlotIDs(slotCardPairs) {
    return m.map(function(pair) { return m.nth(pair, 0); }, slotCardPairs);
}

// hasOpenings and hasCards could be refactored to:
// - use getPairsWhereCardIs()
// - be lazy (with recursion)
function hasOpenings(board, slotGroup) {
    return m.reduce(function(answer, slot) {
        return answer || m.get(board, slot) === null;
    }, false, slotGroup);
}
// see comment above hasOpenings
function hasCards(board, slotGroup) {
    return m.reduce(function(answer, slot) {
        return answer || m.get(board, slot) !== null;
    }, false, slotGroup);
}

function needsDownsize(board) {
    // console.log("checking if needsDownsize...")
    // console.log("board:", sortBoard(board));
    var grouped = partitionSlots(SLOTS);
    var first12 = grouped[0], extra1 = grouped[1], extra2 = grouped[2];
    if (hasCards(board, extra2)) {
        return hasOpenings(board, m.into(first12, extra1));
    } else if (hasCards(board, extra1)) {
        return hasOpenings(board, first12);
    } else {
        return false;
    }
}

function downsizeBoard(oldBoard) {
    var sortedBoard = sortBoard(oldBoard);
    var cards = getCardIDs(getPairsWhereCardIs(!null, sortedBoard));
    // console.log("cards in board:", cards);
    return m.merge(getEmptyBoard(), m.zipmap(SLOTS, cards));
}

function downsizeIfNeeded(oldState) {
    var oldBoard = m.get(oldState, 'board');
    console.log("board:", sortBoard(oldBoard));
    if (needsDownsize(oldBoard)) {
        console.log('needs downsize!');
        return m.assoc(oldState, 'board', downsizeBoard(oldBoard));
    } else {
        console.log('no downsize needed');
        return oldState;
    }
}

function refillBoard(oldState) {
    var sorted12 = m.take(12, sortBoard(m.get(oldState, 'board')));
    var emptySlots = getSlotIDs(getPairsWhereCardIs(null, sorted12));
    return m.reduce(function(state, slot) {
        return deal(state, slot);
    }, oldState, emptySlots);
}

function refillIfNeeded(oldState) {
    var first12 = partitionSlots(SLOTS)[0];
    var oldBoard = m.get(oldState, 'board');
    console.log("board:", sortBoard(oldBoard));
    if (hasOpenings(oldBoard, first12)) {
        console.log("needs refill!")
        return refillBoard(oldState);
    } else {
        console.log('no refill needed');
        return oldState;
    }
}

exports.upsizeIfNeeded = function(oldState) {
    var grouped = partitionSlots(SLOTS);
    var oldBoard = m.get(oldState, 'board');
    var extra1 = grouped[1];
    var extra2 = grouped[2];
    if (hasOpenings(oldBoard, extra1)) {
        return dealGroup(oldState, extra1);
    } else if (hasOpenings(oldBoard, extra2)) {
        return dealGroup(oldState, extra2);
    } else {
        return oldState;
    }
}

//// CARD DEALING/DISCARDING ////

function shuffleIDs(deck) {
    var idSeq = m.sortBy(function(c) { return Math.random() }, m.range(m.count(deck)));
    var idQueue = m.into(m.queue(), idSeq);
    // console.log("idQueue:", idQueue);
    return idQueue;
}

function deal(oldState, slotID) {
    var oldBoard = m.get(oldState, 'board');
    var oldToDeal = m.get(oldState, 'toDeal');

    var newBoard = m.assoc(oldBoard, slotID, m.peek(oldToDeal));
    var newToDeal = m.pop(oldToDeal);

    return m.pipeline(oldState,
        m.curry(m.assoc, 'board', newBoard),
        m.curry(m.assoc, 'toDeal', newToDeal)
    );
}

function dealGroup(oldState, slotGroup) {
    return m.reduce(function(state, slot) {
        return deal(state, slot);
    }, oldState, slotGroup);
}

function discard(oldState, card) {
    var cardID = m.get(card, 'id');
    console.log("discarding card", cardID);

    var slotCardPair = m.nth(m.filter(function(slotCard) {
        return m.nth(slotCard, 1) === cardID;
    }, m.get(oldState, 'board')), 0);
    var slotID = m.nth(slotCardPair, 0);
    console.log("card was in slot", slotID);


    return m.assocIn(oldState, ['board', slotID], null);
}

function discardSet(oldState, setCards) {
    return m.reduce(function(state, card) {
        console.log("REDUCING:")
        console.log("card", card);
        console.log("board", m.get(state, 'board'));
        return discard(state, card);
    }, oldState, setCards);
}


//// CARD AND SET CLAIMING ////

//TODO claimCard and unclaimCard differ only in conj vs. disj
// refactor to close over a helper function which takes the fn as arg
exports.claimCard = function(player, cardID, oldState) {
    var card = m.nth(m.get(oldState, 'deck'), Number(cardID));
    var oldClaimed = m.getIn(oldState, ['players', player, 'claimed']);
    var newClaimed = m.conj(oldClaimed, card);
    return m.assocIn(oldState, ['players', player, 'claimed'], newClaimed);
}
exports.unclaimCard = function(player, cardID, oldState) {
    var card = m.nth(m.get(oldState, 'deck'), Number(cardID));
    var oldClaimed = m.getIn(oldState, ['players', player, 'claimed']);
    var newClaimed = m.disj(oldClaimed, card);
    return m.assocIn(oldState, ['players', player, 'claimed'], newClaimed);
}
exports.isClaimed = function(cardID, player, oldState){
    var card = m.nth(m.get(oldState, 'deck'), Number(cardID));
    var oldClaimed = m.getIn(oldState, ['players', player, 'claimed']);
    return m.isSubset(m.set([card]), oldClaimed);
}
exports.toggleClaimed = function(player, cardID, oldState) {
    if (exports.isClaimed(cardID, player, oldState)) {
        return exports.unclaimCard(player, cardID, oldState);
    } else {
        return exports.claimCard(player, cardID, oldState);
    }
}


exports.checkForCandidate = function(player, state) {
    var claimed = m.getIn(state, ['players', player, 'claimed']);
    return m.count(claimed) === 3;
}

function checkForSet(player, state) {
    var claimed = m.getIn(state, ['players', player, 'claimed']);
    console.log("claimed:", claimed);
    console.log("playerHasSet:", set.isSet(claimed));
    return set.isSet(claimed);
}

function emptyClaimed(oldState, player) {
    console.log("emptying claimed for", player);
    return m.assocIn(oldState, ['players', player, 'claimed'], m.set());
}


exports.processCandidate = function(player, gameState) {
    // should return a setData hashMap with keys:
    // {'user': player,
    // 'set': set candidate (3 claimed cards),
    // 'gameState': new gameState after set found/failed,
    // 'event': name of event to be emitted ("set found"|"set failed")}
    var claimed = m.getIn(gameState, ['players', player, 'claimed']);
    var hasSet = checkForSet(player, gameState);
    var scoreDiff, setEvent, newState;
    if (hasSet) {
      console.log("SET FOUND", player, claimed);
      scoreDiff = 1;
      // discard cards
      console.log("Attempting discard, downsize, and refill...")
      console.log("Board before:", sortBoard(m.get(gameState, 'board')));
      newState = m.pipeline(gameState,
          m.curry(discardSet, claimed),
          downsizeIfNeeded,
          refillIfNeeded
      );
      console.log("Board after:",  sortBoard(m.get(newState, 'board')));
      setEvent = 'set found';
    }
    else {
      console.log("SET FAILED", player, claimed);
      scoreDiff = -1;
      setEvent = 'set failed';
      newState = gameState
    }
    console.log(setEvent.toUpperCase(), player, claimed);
    var scoredState = m.pipeline(newState,
        m.curry(updateScore, player, scoreDiff),
        m.curry(emptyClaimed, player)
    );

    //TODO return data object including new gameState
    return m.hashMap('user', player,
                     'set', claimed,
                     'event', setEvent,
                     'gameState', scoredState);
}


//// PLAYERS AND SCORES ////

exports.addPlayer = function(name, color, oldState) {
    return m.assocIn(oldState, ['players', name], m.hashMap('color', color, 'score', 0, 'claimed', m.set()));
}

exports.removePlayer = function(name, oldState) {
    var newPlayers = m.dissoc(m.get(oldState, 'players'), name)
    return m.assoc(oldState, 'players', newPlayers);
}

function updateScore(oldState, player, scoreChange) {
    return m.updateIn(oldState, ['players', player, 'score'], function(oldScore){
        return oldScore + scoreChange;
    });
}
