(function (PopoGame) {
'use strict';

const PHASE = {
  INTRO: 'intro',
  TUTORIAL: 'tutorial',
  READY: 'ready',
  CASTING: 'casting',
  REELING: 'reeling',
  CELEBRATING: 'celebrating',
  WRONG_PULL: 'wrongPull',
  LOSING_BALANCE: 'losingBalance',
  FALLING: 'falling',
  SUBMERGED: 'submerged',
  RESURFACING: 'resurfacing',
  RECOVERING: 'recovering',
  LEVEL_TRANSITION: 'levelTransition',
  COMPLETE: 'complete',
};

const state = {
  phase: PHASE.INTRO,
  paused: false,
  locationIndex: 0,
  challengeIndex: 0,
  target: null,
  fish: [],
  selectedFish: null,
  collected: [],
  discovered: new Set(),
  muted: false,
  token: 0,
  idleTime: 0,
  hintShown: false,
};

function resetProgress() {
  state.phase = PHASE.INTRO;
  state.paused = false;
  state.locationIndex = 0;
  state.challengeIndex = 0;
  state.target = null;
  state.fish = [];
  state.selectedFish = null;
  state.collected = [];
  state.discovered = new Set();
  state.idleTime = 0;
  state.hintShown = false;
}

// Every sequence captures a token; bumping it cancels anything still waiting.
function newToken() {
  state.token += 1;
  return state.token;
}

function isCurrent(token) {
  return token === state.token;
}

Object.assign(PopoGame, { PHASE, state, resetProgress, newToken, isCurrent });
})(window.PopoGame = window.PopoGame || {});
