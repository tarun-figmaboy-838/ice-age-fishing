(function (PopoGame) {
'use strict';
const { loadCoreAssets, AudioEngine, Game, Stage, state, PHASE, UI } = PopoGame;

const stage = new Stage(document.getElementById('stage'), document.getElementById('world'));
const ui = new UI();
const audio = new AudioEngine();
const game = new Game({ stage, ui, audio });

ui.on('play', () => game.start());
ui.on('fishTap', (fish, point) => game.onFishTap(fish, point));
document.getElementById('stage').addEventListener('pointerdown', (e) => {
  if (e.target.closest('button, .hud, .overlay')) return;
  if (game.skipDialogue()) return;
  game.onWaterTap(stage.toStage(e.clientX, e.clientY));
});
ui.on('pause', () => { audio.play('ui'); game.togglePause(); });
ui.on('resume', () => { audio.play('ui'); game.togglePause(); });
ui.on('restart', () => { audio.play('ui'); game.restart(); });
ui.on('sound', () => { game.toggleSound(); audio.play('ui'); });
ui.on('heroTap', () => audio.play('wiggle'));
ui.on('playAgain', () => { audio.play('ui'); game.restart(); });

try {
  if (localStorage.getItem('popo-muted') === '1') {
    state.muted = true;
    audio.setMuted(true);
    ui.setSound(true);
  }
} catch (e) { /* storage may be unavailable */ }

window.addEventListener('pagehide', (event) => { if (!event.persisted) game.dispose(); });
window.addEventListener('resize', () => game.resize());
window.addEventListener('orientationchange', () => setTimeout(() => game.resize(), 150));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.suspend();
  else if (!state.paused) audio.resume();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.phase !== PHASE.INTRO) game.togglePause();
});
game.resize();

if (new URLSearchParams(location.search).has('debug')) {
  window.popoDebug = { state, game };
}

ui.setLoading('Loading…');
loadCoreAssets()
  .then(() => {
    ui.setLoading('');
    game.showIdleScene();
  })
  .catch((err) => ui.setLoading(`Could not load the game art (${err.message}).`));
})(window.PopoGame = window.PopoGame || {});
